import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SearchRule } from "@shared/schema";
import { api } from "../api";
import { DiscoveryPanel } from "../discovery";
import { Icon } from "../icons";
import { ErrorBox, GuardedLink } from "../ui";
import { RuleForm, useRules } from "./Rules";

/** The inbox edits the same persisted rules used by scheduled collection. */
export function InboxKeywords({ cid, kind }: { cid: number; kind: string }) {
  const rules = useRules(cid), qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SearchRule | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(12);
  const [removed, setRemoved] = useState<SearchRule | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ch", cid, "rules"] }); qc.invalidateQueries({ queryKey: ["collection"] }); };
  const change = useMutation({
    mutationFn: ({ rule, action }: { rule: SearchRule; action: "toggle" | "delete" | "restore" }) => action === "toggle"
      ? api(`/channels/${cid}/rules/${rule.id}`, { method: "PATCH", body: { version: rule.version, enabled: !rule.enabled } })
      : api(`/channels/${cid}/rules/${rule.id}/${action}`, { method: "POST", body: { version: rule.version } }),
    onSuccess: (_result, { rule, action }) => { if (action === "delete") setRemoved({ ...rule, version: rule.version + 1 }); else if (action === "restore") setRemoved(null); refresh(); },
    onError: refresh,
  });
  const items = rules.data?.items ?? [];
  const active = items.filter(r => r.enabled);
  const filtered = items.filter(r => r.query.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const discovery = rules.data?.discovery;
  return <section className="panel inbox-keywords" aria-label="수집 키워드 관리">
    <div className="keyword-heading">
      <button className="keyword-expand" aria-expanded={open} aria-controls={`keywords-${cid}`} onClick={() => setOpen(v => !v)}>
        <Icon name="sliders" size={18} /><strong>수집 키워드</strong><span className="muted">{rules.isLoading ? "불러오는 중" : `${items.length}개 · 사용 중 ${active.length}개`}</span><Icon name="chevron" size={16} />
      </button>
      <button className="btn sm" onClick={() => setEditing("new")}><Icon name="plus" size={16} />키워드 추가</button>
    </div>
    {!open && !!items.length && <div className="keyword-preview">{items.slice(0, 5).map(r => <button key={r.id} className={r.enabled ? "" : "paused"} onClick={() => setEditing(r)} title="키워드 수정">{r.query}</button>)}<button className="keyword-more" onClick={() => setOpen(true)}>{items.length > 5 ? `+${items.length - 5}개 · 전체 관리` : "수정·삭제"}</button></div>}
    {!open && !items.length && !rules.isLoading && !rules.error && <p className="small muted">모으고 싶은 주제를 추가하세요. 저장한 키워드는 다음 수집부터 적용됩니다.</p>}
    {rules.error && <ErrorBox error={rules.error} retry={() => rules.refetch()} />}
    <div id={`keywords-${cid}`} hidden={!open} className="keyword-manager stack">
      <p className="small muted">변경 사항은 다음 수집부터 반영됩니다. 키워드를 삭제해도 모아 둔 자료는 남습니다.</p>
      <label className="field"><span className="sr-only">등록한 키워드 찾기</span><input type="search" placeholder="등록한 키워드 찾기" value={query} onChange={e => { setQuery(e.target.value); setLimit(12); }} /></label>
      <ul className="keyword-list">{filtered.slice(0, limit).map(rule => <li key={rule.id}>
        <div className="keyword-copy"><strong>{rule.query}</strong><span>{rule.endpoint === "blog" ? "블로그" : "뉴스"}{rule.excludeTerms.length ? ` · 제외어 ${rule.excludeTerms.join(", ")}` : ""}</span></div>
        <div className="keyword-actions"><button className={`keyword-toggle ${rule.enabled ? "on" : ""}`} role="switch" aria-checked={rule.enabled} aria-label={`${rule.query} 수집 사용`} disabled={change.isPending} onClick={() => change.mutate({ rule, action: "toggle" })}><span aria-hidden="true" />{rule.enabled ? "사용 중" : "일시정지"}</button><button className="btn sm ghost" disabled={change.isPending} onClick={() => setEditing(rule)} aria-label={`${rule.query} 수정`}>수정</button><button className="btn sm ghost danger" disabled={change.isPending} onClick={() => change.mutate({ rule, action: "delete" })} aria-label={`${rule.query} 삭제`}>삭제</button></div>
      </li>)}</ul>
      {!filtered.length && <p className="muted small">{query ? "일치하는 키워드가 없습니다." : "등록한 키워드가 없습니다."}</p>}
      {filtered.length > limit && <button className="btn sm" onClick={() => setLimit(n => n + 20)}>키워드 더 보기 ({filtered.length - limit}개)</button>}
      {discovery && (kind === "science_dialogue" || kind === "current_dialogue") && <details className="keyword-discovery"><summary>자동 화제 탐색 주제 {discovery.queries.length}개 관리</summary><DiscoveryPanel key={cid} cid={cid} kind={kind} settings={discovery} /></details>}
      <GuardedLink className="small" href="/rules">대량 추가·공식 출처·삭제한 키워드 관리 →</GuardedLink>
    </div>
    {removed && <div className="keyword-feedback" role="status"><span>‘{removed.query}’ 키워드를 삭제했습니다.</span><button className="btn sm" disabled={change.isPending} onClick={() => change.mutate({ rule: removed, action: "restore" })}>복원 · 일시정지 상태</button></div>}
    {change.error && <ErrorBox error={change.error} />}
    {editing && <RuleForm key={typeof editing === "string" ? "new" : editing.id} cid={cid} rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
  </section>;
}
