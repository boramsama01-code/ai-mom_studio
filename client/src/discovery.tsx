/** 자동 화제 발굴 — 배지·설정 패널·오늘의 화제 목록 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useDirtyGuard } from "./state";
import { useToast } from "./toast";
import { GuardedLink, StatusBadge, fmtDate } from "./ui";
import { DISCOVERY_DEFAULT_QUERIES, type DiscoveryInfo, type DiscoverySettings } from "@shared/domain";

export function DiscoveryBadge({ info }: { info: DiscoveryInfo | null | undefined }) {
  if (!info) return null;
  return (
    <span className="badge hot" title={`언론사: ${info.outlets.join(", ")}`}>
      화제 · 언론 {info.score}곳{info.pickedBy !== "buzz" ? " · AI 선정" : ""}
    </span>
  );
}

/** 상세 화면: 왜 골랐는지 */
export function DiscoveryNote({ info }: { info: DiscoveryInfo | null | undefined }) {
  if (!info) return null;
  return (
    <div className="notice discovery-note">
      <div className="row" style={{ gap: 8 }}>
        <DiscoveryBadge info={info} />
        <span className="small muted">
          탐색 주제 "{info.query}" · {fmtDate(info.discoveredAt)} 발굴 · 같은 사건 기사 {info.articleCount}건
        </span>
      </div>
      {info.reason && (
        <p style={{ margin: "8px 0 0" }}>
          <b>고른 이유</b> {info.reason}
        </p>
      )}
      {info.angle && (
        <p style={{ margin: "4px 0 0" }}>
          <b>대화 질문 제안</b> {info.angle}
        </p>
      )}
      {!info.reason && <p className="small muted" style={{ margin: "8px 0 0" }}>유료 AI 선정 없이 화제도(다룬 언론사 수) 순으로 골랐습니다.</p>}
      <p className="small muted" style={{ margin: "6px 0 0" }}>다룬 언론사: {info.outlets.join(", ")}</p>
    </div>
  );
}

/** 오늘의 작업: 최근 발굴한 화제 */
export type DiscoveredRow = { id: number; title: string; discovery: DiscoveryInfo; reviewStatus: string; hasDraft: boolean; createdAt: string };
export function HotTopics({ cid, rows, settings }: { cid: number; rows: DiscoveredRow[]; settings: DiscoverySettings | null }) {
  if (!settings) return null;
  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>최근 발굴한 화제</h2>
        <GuardedLink href="/rules" className="small">
          {settings.enabled ? `자동 발굴 켜짐 · 1회 ${settings.picksPerRun}건` : "자동 발굴 꺼짐"} · 설정
        </GuardedLink>
      </div>
      {!rows.length ? (
        <p className="muted small" style={{ margin: 0 }}>
          아직 발굴한 화제가 없습니다. 위의 <b>지금 수집</b>을 누르면 뉴스를 훑어 여러 언론이 함께 다루는 화제를 찾아 수집함에 넣습니다.
        </p>
      ) : (
        <ul className="hot-list">
          {rows.map((r) => (
            <li key={r.id}>
              <GuardedLink href={`/items/${cid}/${r.id}`} className="title-link">
                {r.title}
              </GuardedLink>
              {r.discovery.headline !== r.title && <div className="small muted">원 기사: {r.discovery.headline}</div>}
              {r.discovery.reason && <div className="small">{r.discovery.reason}</div>}
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                <DiscoveryBadge info={r.discovery} />
                <span className={`badge ${r.hasDraft ? "ok" : ""}`}>{r.hasDraft ? "초안 있음" : "초안 없음"}</span>
                <StatusBadge type="review" value={r.reviewStatus} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 검색 설정: 자동 발굴 켜기·탐색 주제 */
export function DiscoveryPanel({ cid, kind, settings }: { cid: number; kind: "science_dialogue" | "current_dialogue"; settings: DiscoverySettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(settings);
  const [text, setText] = useState(settings.queries.join("\n"));
  const guard = useDirtyGuard();
  const [baseline,setBaseline] = useState(JSON.stringify(settings));
  const draft = {...f,queries:text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)};
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => {
    if (!dirty) { setF(settings); setText(settings.queries.join("\n")); setBaseline(JSON.stringify(settings)); }
  }, [settings]);
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<{ integrations: Record<string, unknown> }>("/status") });
  const ai = !!status.data?.integrations.aiConfigured && !!(status.data?.integrations.flags as Record<string, boolean> | undefined)?.autoGenerate;
  const save = useMutation({
    mutationFn: () =>
      api(`/channels/${cid}/discovery`, {
        method: "PUT",
        body: { ...f, queries: text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) },
      }),
    onSuccess: () => {
      toast("ok", "자동 발굴 설정을 저장했습니다. 다음 수집부터 반영됩니다.");
      setBaseline(JSON.stringify(draft));
      qc.invalidateQueries({ queryKey: ["ch", cid] });
      qc.invalidateQueries({ queryKey: ["collection"] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  useEffect(() => {
    guard.setDirty(`discovery-${cid}`,dirty,async()=>{try { await save.mutateAsync(); return true; } catch { return false; }});
    return ()=>guard.setDirty(`discovery-${cid}`,false);
  },[cid,dirty,text,f,guard.setDirty,save.mutateAsync]);
  return (
    <fieldset disabled={save.isPending} className="panel stack discovery-panel">
      <div className="row between">
        <div>
          <h2 style={{ margin: 0 }}>자동 화제 발굴 {f.enabled ? <span className="badge ok">켜짐</span> : <span className="badge">꺼짐</span>}</h2>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            검색어를 넣지 않아도 됩니다. 수집할 때마다 아래 탐색 주제로 최근 뉴스를 확인하고, <b>여러 언론사가 함께 다루는 사건</b>을 화제로 찾습니다.
            {ai ? " 자동 작성이 켜진 예약 수집에서는 AI가 화제 선정과 초안 작성을 도울 수 있습니다." : " 현재는 유료 AI 호출 없이 화제도 순으로 저장합니다."}
          </p>
        </div>
        <label className="check" style={{ flex: "none" }}>
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> 사용
        </label>
      </div>
      <div className="grid grid-2">
        <label className="field">
          탐색 주제 (한 줄에 하나, 최대 8개 · 뉴스 탐색에 사용)
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="hint">
            넓은 말일수록 좋습니다. 기본값: {DISCOVERY_DEFAULT_QUERIES[kind].join(", ")}{" "}
            <button type="button" className="linklike" onClick={() => setText(DISCOVERY_DEFAULT_QUERIES[kind].join("\n"))}>
              기본값으로
            </button>
          </span>
        </label>
        <div className="stack">
          <label className="field">
            한 번에 고를 화제 수
            <input type="number" min={1} max={10} value={f.picksPerRun} onChange={(e) => setF({ ...f, picksPerRun: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={f.autoDraft} onChange={(e) => setF({ ...f, autoDraft: e.target.checked })} /> 고른 화제로 대화 초안 자동 생성(선택한 AI 사용)
          </label>
          <p className="small muted" style={{ margin: 0 }}>
            초안이 만들어져도 바로 게시되지 않습니다. 수집함에서 검토 → 카드 → 최종 승인을 거칩니다. 강력범죄·자살·마약 등 아이와 나누기 부적절한 주제는 자동으로 뺍니다.
          </p>
        </div>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "저장 중…" : "저장"}
        </button>
      </div>
    </fieldset>
  );
}


