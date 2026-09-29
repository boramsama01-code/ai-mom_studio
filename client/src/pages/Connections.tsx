import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, ErrorBox, fmtDate, Loading } from "../ui";
import type { SecretGroup } from "@shared/secretsCatalog";

type Status = { key: string; source: "environment" | "screen" | "none" | "unreadable"; updatedAt: string | null; valueLength: number | null; secret: boolean; value: string | null };
type Resp = { groups: SecretGroup[]; statuses: Status[]; tests: Record<string, { ok: boolean; message: string; at: string }> };

export function useSecrets() {
  return useQuery({ queryKey: ["secrets"], queryFn: () => api<Resp>("/secrets") });
}

export function SourceBadge({ s }: { s: Status | undefined }) {
  if (!s || s.source === "none") return <Badge kind="warn">미입력</Badge>;
  if (s.source === "environment") return <Badge kind="ok">Render 환경변수 사용 중</Badge>;
  if (s.source === "unreadable") return <Badge kind="err">다시 입력 필요</Badge>;
  return <Badge kind="ok">입력됨{s.updatedAt ? ` · ${fmtDate(s.updatedAt)}` : ""}</Badge>;
}

/** 하나의 키 입력칸 — 비밀값은 저장 후 다시 보여주지 않음 */
export function SecretInput({ k, label, hint, placeholder, status, value, onChange }: { k: string; label: string; hint?: string; placeholder?: string; status: Status | undefined; value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const del = useMutation({ mutationFn: () => api(`/secrets/${k}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["secrets"] }); qc.invalidateQueries({ queryKey: ["status"] }); } });
  const envOwned = status?.source === "environment";
  const has = status && status.source !== "none";
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between">
        <label htmlFor={`sec-${k}`} style={{ fontWeight: 600, fontSize: 14 }}>
          {label} <span className="small muted" style={{ fontWeight: 400 }}>{k}</span>
        </label>
        <SourceBadge s={status} />
      </div>
      {hint && <span className="small muted">{hint}</span>}
      {envOwned ? (
        <p className="small muted" style={{ margin: 0 }}>Render(또는 GitHub)에 직접 넣은 값이 우선 적용됩니다. 화면에서 관리하려면 Render의 Environment에서 이 항목을 지우세요.</p>
      ) : (
        <div className="row">
          <input
            id={`sec-${k}`}
            type={status?.secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            style={{ flex: "1 1 220px", width: "auto" }}
            placeholder={has && status?.secret ? "저장됨 — 바꾸려면 새 값을 붙여 넣으세요" : placeholder ?? (status?.value ? "" : "값을 붙여 넣으세요")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {has && status?.source !== "environment" && (
            <button type="button" className="btn sm danger" onClick={() => confirm(`${label} 값을 지울까요?`) && del.mutate()} disabled={del.isPending}>
              지우기
            </button>
          )}
        </div>
      )}
      {!status?.secret && status?.value && <span className="small muted">현재 값: {status.value}</span>}
      {del.error && <ErrorBox error={del.error} />}
    </div>
  );
}

function GroupPanel({ g, data }: { g: SecretGroup; data: Resp }) {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const changed = Object.entries(vals).filter(([, v]) => v.trim());
  const save = useMutation({
    mutationFn: async () => {
      for (const [k, v] of changed) await api(`/secrets/${k}`, { method: "PUT", body: { value: v.trim() } });
    },
    onSuccess: () => {
      setVals({});
      qc.invalidateQueries({ queryKey: ["secrets"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>(`/secrets/test/${g.id}`, { method: "POST", body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["secrets"] }),
  });
  const last = test.data ?? data.tests[g.id];
  const st = (k: string) => data.statuses.find((s) => s.key === k);
  return (
    <form className="panel stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="row between">
        <h3 style={{ margin: 0 }}>{g.title}</h3>
        {g.docs && (
          <a href={g.docs} target="_blank" rel="noopener noreferrer" className="small">
            키 발급 페이지 ↗
          </a>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{g.description}</p>
      {g.fields.map((f) => (
        <SecretInput key={f.key} k={f.key} label={f.label} hint={f.hint} placeholder={f.placeholder} status={st(f.key)} value={vals[f.key] ?? ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} />
      ))}
      <div className="row">
        <button className="btn primary" disabled={!changed.length || save.isPending}>
          {save.isPending ? "저장 중…" : "저장"}
        </button>
        {g.testable && (
          <button type="button" className="btn" onClick={() => test.mutate()} disabled={test.isPending || changed.length > 0} title={changed.length ? "먼저 저장하세요" : undefined}>
            {test.isPending ? "확인 중…" : "연결 확인"}
          </button>
        )}
      </div>
      {save.error && <ErrorBox error={save.error} />}
      {save.isSuccess && <div className="notice ok small">저장했습니다. 값은 암호화되어 보관되며 바로 적용됩니다.</div>}
      {last && (
        <div className={`notice small ${last.ok ? "ok" : "err"}`} role="status">
          {last.ok ? "연결 확인 성공" : "연결 확인 실패"}: {last.message}
          {"at" in last && last.at ? <span className="muted"> ({fmtDate(last.at as string)})</span> : null}
        </div>
      )}
    </form>
  );
}

export function ConnectionsSection() {
  const q = useSecrets();
  return (
    <section className="stack" style={{ marginBottom: 16 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>서비스 연결 (모든 채널 공통)</h2>
        <p className="small muted" style={{ margin: 0 }}>
          여기에 입력한 키는 암호화되어 데이터베이스에 저장되고, 웹 화면과 GitHub Actions 워커가 함께 사용합니다. 비밀값은 저장 후 다시 보이지 않습니다.
        </p>
      </div>
      {q.isLoading ? <Loading lines={2} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <div className="grid grid-2">
          {q.data!.groups.map((g) => (
            <GroupPanel key={g.id} g={g} data={q.data!} />
          ))}
        </div>
      )}
    </section>
  );
}
