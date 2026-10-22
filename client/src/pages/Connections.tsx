import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useDirtyGuard } from "../state";
import { Badge, ErrorBox, fmtDate, Loading } from "../ui";
import type { SecretField, SecretGroup } from "@shared/secretsCatalog";

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
export function SecretInput({ k, label, hint, placeholder, options, secret, status, value, onChange }: { k: string; label: string; hint?: string; placeholder?: string; options?: SecretField["options"]; secret?: boolean; status: Status | undefined; value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const del = useMutation({ mutationFn: () => api(`/secrets/${k}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["secrets"] }); qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["studio"] }); } });
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
          {options ? (
            <select id={`sec-${k}`} value={value || status?.value || "auto"} onChange={(e) => onChange(e.target.value)} style={{ flex: "1 1 220px" }}>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : <input
            id={`sec-${k}`}
            type={(secret ?? status?.secret) ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            style={{ flex: "1 1 220px", width: "auto" }}
            placeholder={has && status?.secret ? "저장됨 — 바꾸려면 새 값을 붙여 넣으세요" : placeholder ?? (status?.value ? "" : "값을 붙여 넣으세요")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />}
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

type AiStatus = { integrations: { aiProvider: "openai" | "anthropic"; aiConfigured: boolean } };

function AiProviderPanel({ data }: { data: Resp }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const status = data.statuses.find(s => s.key === "AI_PROVIDER");
  const current = status?.value || "auto";
  const envOwned = status?.source === "environment";
  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? current;
  const changed = !envOwned && choice !== null && (choice !== current || status?.source === "unreadable");
  const actual = useQuery({ queryKey: ["status"], queryFn: () => api<AiStatus>("/status") });
  const save = useMutation({
    mutationFn: () => api("/secrets/AI_PROVIDER", { method: "PUT", body: { value: selected } }),
    onSuccess: async () => {
      guard.setDirty("ai-provider", false);
      await Promise.all([qc.invalidateQueries({ queryKey: ["secrets"] }), qc.invalidateQueries({ queryKey: ["status"] }), qc.invalidateQueries({ queryKey: ["studio"] })]);
      setChoice(null);
    },
  });
  useEffect(() => {
    guard.setDirty("ai-provider", changed, async () => { try { await save.mutateAsync(); return true; } catch { return false; } });
    return () => guard.setDirty("ai-provider", false);
  }, [changed, selected]);
  return <form className="panel stack" onSubmit={e => { e.preventDefault(); if (changed) save.mutate(); }}>
    <div className="row between"><h3 style={{ margin: 0 }}>글쓰기 AI 선택</h3><Badge kind={status?.source === "unreadable" ? "warn" : ""}>{envOwned ? "서버에서 설정" : status?.source === "unreadable" ? "다시 선택 필요" : status?.source === "screen" ? "저장됨" : "기본값 사용"}</Badge></div>
    <p className="small muted" style={{ margin: 0 }}>API 키를 입력하는 칸이 아닙니다. 글을 만들 때 기본으로 사용할 AI를 선택하세요.</p>
    <label className="field" htmlFor="ai-provider-choice">기본 글쓰기 AI
      <select id="ai-provider-choice" value={selected} disabled={envOwned || save.isPending} onChange={e => setChoice(e.target.value)} aria-describedby="ai-provider-help">
        <option value="auto">자동 선택 · GPT 우선</option><option value="openai">GPT · OpenAI</option><option value="anthropic">Claude · Anthropic</option>
      </select>
    </label>
    <p id="ai-provider-help" className="small muted" style={{ margin: 0 }}>자동 선택은 GPT 키가 있으면 GPT, Claude 키만 있으면 Claude를 사용합니다. 그림 생성은 OpenAI 키를 사용합니다.</p>
    {actual.data && <div className="row small" aria-live="polite"><span>현재 적용: <strong>{actual.data.integrations.aiProvider === "anthropic" ? "Claude" : "GPT"}</strong></span><Badge kind={actual.data.integrations.aiConfigured ? "ok" : "warn"}>{actual.data.integrations.aiConfigured ? "API 키 등록됨" : "API 키 등록 필요"}</Badge></div>}
    {actual.error && <ErrorBox error={actual.error} retry={() => actual.refetch()} />}
    <div className="row small"><a href="#connection-openai">GPT 키 입력으로 ↓</a><a href="#connection-anthropic">Claude 키 입력으로 ↓</a></div>
    {envOwned ? <p className="small muted" style={{ margin: 0 }}>서버의 AI_PROVIDER 설정이 우선 적용되어 선택이 잠겨 있습니다. 화면에서 변경하려면 Render의 Environment에서 해당 항목을 제거한 뒤 재배포하세요.</p> : <div className="row"><button className="btn primary" disabled={!changed || save.isPending}>{save.isPending ? "저장 중…" : "선택 저장"}</button>{changed && <span className="small muted">저장하면 적용됩니다.</span>}</div>}
    {save.error && <ErrorBox error={save.error} />}
    {save.isSuccess && !changed && <div className="notice ok small" role="status">글쓰기 AI 선택을 저장했습니다.</div>}
  </form>;
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
      qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["studio"] });
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>(`/secrets/test/${g.id}`, { method: "POST", body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["secrets"] }),
  });
  const last = test.data ?? data.tests[g.id];
  const st = (k: string) => data.statuses.find((s) => s.key === k);
  return (
    <form id={`connection-${g.id}`} className="panel stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
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
        <SecretInput key={f.key} k={f.key} label={f.label} hint={f.hint} placeholder={f.placeholder} options={f.options} secret={f.secret} status={st(f.key)} value={vals[f.key] ?? ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} />
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
      {save.isSuccess && <div className="notice ok small">저장했습니다.</div>}
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
        <h2 style={{ marginBottom: 4 }}>서비스 연결</h2>
        <p className="small muted" style={{ margin: 0 }}>
          모든 채널에서 공통으로 사용합니다. 키는 암호화해 저장하며 Render 환경변수가 있으면 우선 적용합니다.
        </p>
      </div>
      {q.isLoading ? <Loading lines={2} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <div className="grid grid-2">
          {q.data!.groups.map((g) => (
            g.id === "ai" ? <AiProviderPanel key={g.id} data={q.data!} /> : <GroupPanel key={g.id} g={g} data={q.data!} />
          ))}
        </div>
      )}
    </section>
  );
}

