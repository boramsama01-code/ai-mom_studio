import { CategorySelect } from "../CategorySelect";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, Loading, Modal } from "../ui";
import { ADMISSION_KEYWORDS, NOTICE_CATEGORIES, SCHOOL_TYPE_LABEL, type DiscoverySettings } from "@shared/domain";
import { DiscoveryPanel } from "../discovery";
import type { OfficialSource, SearchRule } from "@shared/schema";

type RulesResp = { items: SearchRule[]; discovery: DiscoverySettings | null; estimate: { activeRules: number; discoveryCalls: number; callsPerRun: number; cappedByBudget: boolean; budget: number } };
type TrialItem = { endpoint: "news" | "blog"; title: string; description: string; link: string; originallink?: string; bloggername?: string; published: { raw: string | null; iso: string | null; precision: "datetime" | "date" | "unknown" }; excludedReason: string | null };

export function RulesPage() {
  const { selected, current } = useChannel();
  const [tab, setTab] = useState<"rules" | "bulk" | "official" | "deleted">("rules");
  if (selected === "all" || !current)
    return (
      <>
        <h1>검색 설정</h1>
        <Empty>검색 설정은 채널별로 관리합니다. 오른쪽 위 ‘보기 채널’에서 설정할 채널을 선택해 주세요.</Empty>
      </>
    );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>검색 설정</h1>
          <p className="small muted">
            {current.contentType === "notice"
              ? "검색어(키워드)와 공식 출처를 따로 관리합니다. 수정·정지는 다음 실행부터 반영됩니다."
              : "이 채널은 자동 화제 발굴로 수집합니다. 검색어는 꼭 챙기고 싶은 주제가 있을 때만 추가하세요."}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["rules", "검색어"],
            ["bulk", "대량 추가·후보 생성"],
            ["official", "공식 출처"],
            ["deleted", "삭제된 검색어"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === "rules" && <RulesTab key={current.id} cid={current.id} kind={current.contentType} />}
      {tab === "bulk" && <BulkTab key={current.id} cid={current.id} isNotice={current.contentType === "notice"} />}
      {tab === "official" && <OfficialTab key={current.id} cid={current.id} />}
      {tab === "deleted" && <DeletedTab key={current.id} cid={current.id} />}
    </>
  );
}

export function useRules(cid: number, deleted = false) {
  return useQuery({ queryKey: ["ch", cid, "rules", deleted], queryFn: () => api<RulesResp>(`/channels/${cid}/rules${deleted ? "?deleted=1" : ""}`) });
}

function RulesTab({ cid, kind }: { cid: number; kind: string }) {
  const qc = useQueryClient();
  const rules = useRules(cid);
  const [editing, setEditing] = useState<SearchRule | "new" | null>(null);
  const [trial, setTrial] = useState<{ query: string; endpoint: "news" | "blog"; excludeTerms: string[]; excludeScope: string; categoryHint: string | null } | null>(null);
  const toggle = useMutation({
    mutationFn: (r: SearchRule) => api(`/channels/${cid}/rules/${r.id}`, { method: "PATCH", body: { version: r.version, enabled: !r.enabled } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ch", cid, "rules"] }),
  });
  const del = useMutation({
    mutationFn: (r: SearchRule) => api(`/channels/${cid}/rules/${r.id}/delete`, { method: "POST", body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ch", cid, "rules"] }),
  });
  if (rules.isLoading) return <Loading />;
  if (rules.error) return <ErrorBox error={rules.error} retry={() => rules.refetch()} />;
  const { items, estimate, discovery } = rules.data!;
  return (
    <div className="stack">
      {discovery && (kind === "science_dialogue" || kind === "current_dialogue") && <DiscoveryPanel cid={cid} kind={kind} settings={discovery} />}
      <div className="panel row between">
        <div>
          <strong>한 번 실행할 때 예상 검색 요청: {estimate.callsPerRun}회</strong>
          <div className="small muted">
            {estimate.discoveryCalls > 0 && `자동 발굴 ${estimate.discoveryCalls}회 + `}
            활성 검색어 {estimate.activeRules}개 (뉴스·블로그는 각각 1회) · 실행당 한도 {estimate.budget}회
            {estimate.cappedByBudget && " — 이번에 처리하지 못한 검색어는 다음 실행에서 먼저 처리합니다"}
          </div>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          검색어 추가
        </button>
      </div>
      {(toggle.error || del.error) && <ErrorBox error={toggle.error || del.error} />}
      {!items.length ? (
        <Empty>{discovery ? "추가 검색어 없음 — 자동 화제 발굴만으로 수집합니다." : "등록된 검색어가 없습니다."}</Empty>
      ) : (
        <ul className="list">
          {items.map((r) => (
            <li key={r.id} className="list-item">
              <div className="row between">
                <div className="row" style={{ minWidth: 0 }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{r.query}</strong>
                  <Badge>{r.endpoint === "news" ? "뉴스" : "블로그"}</Badge>
                  <Badge kind={r.enabled ? "ok" : ""}>{r.enabled ? "사용 중" : "일시정지"}</Badge>
                  {r.categoryHint && <span className="small muted">{r.categoryHint}</span>}
                </div>
                <div className="row">
                  <button className="btn sm" onClick={() => setTrial({ query: r.query, endpoint: r.endpoint as "news" | "blog", excludeTerms: r.excludeTerms, excludeScope: r.excludeScope, categoryHint: r.categoryHint })}>
                    시험 검색
                  </button>
                  <button className="btn sm" onClick={() => toggle.mutate(r)} disabled={toggle.isPending}>
                    {r.enabled ? "일시정지" : "다시 사용"}
                  </button>
                  <button className="btn sm" onClick={() => setEditing(r)}>
                    수정
                  </button>
                  <button className="btn sm danger" onClick={() => del.mutate(r)} disabled={del.isPending}>
                    삭제
                  </button>
                </div>
              </div>
              <div className="meta">
                <span>우선순위 {r.priority}</span>
                <span>결과 {r.display}건</span>
                {r.excludeTerms.length > 0 && <span>제외어 {r.excludeTerms.join(", ")} ({r.excludeScope === "title" ? "제목" : "제목+요약"})</span>}
                <span>
                  마지막 실행 {r.lastRunAt ? fmtDate(r.lastRunAt as unknown as string) : "없음"}
                  {r.lastRunStatus && ` · ${r.lastRunStatus === "ok" ? `신규 저장 ${r.lastRunNewCount ?? 0}건` : `실패: ${r.lastRunError}`}`}
                </span>
                {r.memo && <span>메모: {r.memo}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">‘마지막 실행’ 수치는 그 실행에서 새로 저장된 건수이며, 수집 정확도나 전체 자료를 빠짐없이 모았다는 뜻이 아닙니다.</p>
      {editing && <RuleForm cid={cid} rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {trial && <TrialModal cid={cid} {...trial} onClose={() => setTrial(null)} />}
    </div>
  );
}

export function RuleForm({ cid, rule, onClose, initialSubcategory = "" }: { cid: number; rule: SearchRule | null; onClose: () => void; initialSubcategory?: string }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState(rule?.query ?? "");
  const [endpoints, setEndpoints] = useState<Array<"news" | "blog">>(rule ? [rule.endpoint as "news" | "blog"] : ["news"]);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [categoryHint, setCat] = useState(rule?.categoryHint ?? "");
  const [subcategory, setSubcategory] = useState(rule?.subcategory ?? initialSubcategory);
  const { allChannels } = useChannel();
  const channel = allChannels.find(c => c.id === cid)?.slug ?? "";
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [display, setDisplay] = useState(rule?.display ?? 10);
  const [excludeTerms, setEx] = useState((rule?.excludeTerms ?? []).join("\n"));
  const [excludeScope, setScope] = useState(rule?.excludeScope ?? "title");
  const [memo, setMemo] = useState(rule?.memo ?? "");
  const booleanWarn = /\b(OR|AND)\b|\|/.test(query);
  const m = useMutation({
    mutationFn: () => {
      const common = {
        enabled,
        categoryHint: categoryHint || null,
        subcategory: subcategory || null,
        priority: Number(priority),
        display: Number(display),
        excludeTerms: excludeTerms.split("\n").map((s) => s.trim()).filter(Boolean),
        excludeScope,
        memo,
      };
      return rule
        ? api(`/channels/${cid}/rules/${rule.id}`, { method: "PATCH", body: { version: rule.version, query, endpoint: endpoints[0], ...common } })
        : api(`/channels/${cid}/rules`, { method: "POST", body: { query, endpoints, ...common } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ch", cid, "rules"] });
      qc.invalidateQueries({ queryKey: ["collection"] });
      onClose();
    },
  });
  const flip = (e: "news" | "blog") => setEndpoints((a) => (rule ? [e] : a.includes(e) ? a.filter((x) => x !== e) : [...a, e]));
  return (
    <Modal title={rule ? "수집 키워드 수정" : "수집 키워드 추가"} onClose={() => !m.isPending && onClose()}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <label className="field">
          수집 키워드
          <span className="hint">검색창에 입력하듯 적습니다. 쉼표로 나누지 않습니다.</span>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} required maxLength={100} disabled={m.isPending} />
        </label>
        <CategorySelect channel={channel} value={subcategory} onChange={setSubcategory} disabled={m.isPending} />
        {booleanWarn && <div className="notice warn small">검색 경로마다 OR/AND 해석이 다를 수 있습니다. 안정적인 수집을 위해 검색어를 나눠 추가하세요.</div>}
        <fieldset className="row">
          <legend>검색 대상</legend>
          <label className="check">
            <input type={rule ? "radio" : "checkbox"} name="ep" checked={endpoints.includes("news")} onChange={() => flip("news")} /> 뉴스
          </label>
          <label className="check">
            <input type={rule ? "radio" : "checkbox"} name="ep" checked={endpoints.includes("blog")} onChange={() => flip("blog")} /> 블로그
          </label>
        </fieldset>
        {endpoints.length === 2 && <p className="small muted">뉴스와 블로그를 각각 수집합니다. 블로그 검색에는 네이버 연결이 필요합니다.</p>}
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 사용
        </label>
        <details>
          <summary>고급 설정</summary>
          <div className="stack">
            <label className="field">
              분류 힌트
              <select value={categoryHint} onChange={(e) => setCat(e.target.value)}>
                <option value="">없음</option>
                {NOTICE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-2">
              <label className="field">
                우선순위(작을수록 먼저)
                <input type="number" min={0} max={10000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
              </label>
              <label className="field">
                결과 수(최대 100)
                <input type="number" min={1} max={100} value={display} onChange={(e) => setDisplay(Number(e.target.value))} />
              </label>
            </div>
            <label className="field">
              제외어
              <span className="hint">한 줄에 하나. 수집 후 적용하며 제외 사유와 원본을 남깁니다.</span>
              <textarea rows={3} value={excludeTerms} onChange={(e) => setEx(e.target.value)} />
            </label>
            <label className="field">
              제외어 적용 범위
              <select value={excludeScope} onChange={(e) => setScope(e.target.value)}>
                <option value="title">제목</option>
                <option value="title_and_snippet">제목+요약</option>
              </select>
            </label>
            <label className="field">
              메모
              <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
            </label>
          </div>
        </details>
        {m.error && <ErrorBox error={m.error} />}
        <div className="row">
          <button className="btn primary" disabled={m.isPending || !endpoints.length || !query.trim()}>
            {m.isPending ? "저장 중…" : "키워드 저장"}
          </button>
          <button type="button" className="btn" disabled={m.isPending} onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TrialModal({ cid, query, endpoint, excludeTerms, excludeScope, categoryHint, onClose }: { cid: number; query: string; endpoint: "news" | "blog"; excludeTerms: string[]; excludeScope: string; categoryHint: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const run = useQuery({
    queryKey: ["trial", cid, query, endpoint],
    queryFn: () => api<{ items: TrialItem[]; warnings?: string[] }>(`/channels/${cid}/trial-search`, { method: "POST", body: { query, endpoint, excludeTerms, excludeScope } }),
    staleTime: Infinity,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => api<{ created: number; duplicates: number }>(`/channels/${cid}/trial-search/save`, { method: "POST", body: { categoryHint, items: run.data!.items.filter((_, i) => picked.has(i)) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });
  return (
    <Modal title={`시험 검색: ${query} (${endpoint === "news" ? "뉴스" : "블로그"})`} onClose={onClose}>
      <p className="small muted">최대 5건 · {endpoint === "news" ? "공개 뉴스 RSS · API 키 불필요" : "네이버 블로그 · 연결 키 필요"}. 선택한 자료만 저장합니다.</p>
      {!!run.data?.warnings?.length && <div className="notice warn small">일부 수집 경로를 확인하지 못했습니다.<ul>{run.data.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      {run.isLoading ? (
        <Loading lines={3} />
      ) : run.error ? (
        <ErrorBox error={run.error} />
      ) : !run.data?.items.length ? (
        <p className="muted">결과가 없습니다.</p>
      ) : (
        <ul className="list">
          {run.data.items.map((it, i) => (
            <li key={i} className="stack" style={{ gap: 4, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <label className="check" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                <span>
                  <strong>{it.title}</strong>
                  <br />
                  <span className="small muted">
                    {it.published.raw ?? "날짜 없음"} · <a href={it.originallink || it.link} target="_blank" rel="noopener noreferrer">원문</a>
                  </span>
                </span>
              </label>
              <span className="small">{it.description}</span>
              {it.excludedReason && <Badge kind="warn">{it.excludedReason}</Badge>}
            </li>
          ))}
        </ul>
      )}
      {save.data && <div className="notice ok small">새로 저장 {save.data.created}건 · 이미 있음 {save.data.duplicates}건</div>}
      {save.error && <ErrorBox error={save.error} />}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!picked.size || save.isPending} onClick={() => save.mutate()}>
          선택 자료 저장 ({picked.size})
        </button>
        <button className="btn" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  );
}

function BulkTab({ cid, isNotice }: { cid: number; isNotice: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [endpoints, setEndpoints] = useState<Array<"news" | "blog">>(["news"]);
  const [enabled, setEnabled] = useState(false);
  const [cat, setCat] = useState("");
  const [types, setTypes] = useState<string[]>(["gifted"]);
  const [kws, setKws] = useState<string[]>(["모집요강"]);
  const preview = useMutation({
    mutationFn: () => api<{ rows: Array<{ query: string; endpoint: string; duplicate: boolean }>; newCount: number; duplicateCount: number }>(`/channels/${cid}/rules/bulk-preview`, { method: "POST", body: { text, endpoints } }),
  });
  const save = useMutation({
    mutationFn: () => api<{ created: unknown[]; duplicates: unknown[] }>(`/channels/${cid}/rules/bulk`, { method: "POST", body: { text, endpoints, enabled, categoryHint: cat || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ch", cid, "rules"] });
      preview.reset();
    },
  });
  const cands = useMutation({
    mutationFn: () => api<{ candidates: Array<{ query: string }>; newCount: number; duplicateCount: number }>(`/channels/${cid}/rules/school-candidates`, { method: "POST", body: { schoolTypes: types, keywords: kws } }),
    onSuccess: (r) => {
      setText(r.candidates.map((c) => c.query).join("\n"));
      setEndpoints(["news"]);
      setCat(types.length === 1 && types[0] === "national_autonomous" ? "전국단위 자사고 입시" : "영재학교·과학고 입시");
      preview.reset();
    },
  });
  const flip = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="stack">
      {isNotice && (
        <section className="panel stack">
          <h2>학교 × 입시 키워드 후보 만들기</h2>
          <p className="small muted">모든 조합을 한꺼번에 켜면 호출이 크게 늘어납니다. 후보를 만든 뒤 아래에서 미리보고, 기본은 ‘일시정지’로 저장하세요.</p>
          <fieldset className="row">
            <legend>학교 유형</legend>
            {(["national_autonomous", "gifted", "science_high"] as const).map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={types.includes(t)} onChange={() => setTypes(flip(types, t))} /> {SCHOOL_TYPE_LABEL[t]}
              </label>
            ))}
          </fieldset>
          <fieldset className="row">
            <legend>입시 키워드</legend>
            {ADMISSION_KEYWORDS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={kws.includes(k)} onChange={() => setKws(flip(kws, k))} /> {k}
              </label>
            ))}
          </fieldset>
          <div>
            <button className="btn" disabled={!types.length || !kws.length || cands.isPending} onClick={() => cands.mutate()}>
              후보를 아래 입력칸에 채우기
            </button>
          </div>
          {cands.data && <p className="small">후보 {cands.data.candidates.length}개 · 이미 있음 {cands.data.duplicateCount}개</p>}
          {cands.error && <ErrorBox error={cands.error} />}
        </section>
      )}
      <section className="panel stack">
        <h2>줄 단위 대량 추가</h2>
        <label className="field">
          검색어 (한 줄에 하나)
          <textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); preview.reset(); }} />
        </label>
        <fieldset className="row">
          <legend>검색 대상</legend>
          <label className="check">
            <input type="checkbox" checked={endpoints.includes("news")} onChange={() => setEndpoints(flip(endpoints, "news"))} /> 뉴스
          </label>
          <label className="check">
            <input type="checkbox" checked={endpoints.includes("blog")} onChange={() => setEndpoints(flip(endpoints, "blog"))} /> 블로그
          </label>
        </fieldset>
        <div className="grid grid-2">
          <label className="field">
            분류 힌트
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">없음</option>
              {NOTICE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 저장 즉시 사용(체크하지 않으면 일시정지로 저장)
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={!text.trim() || !endpoints.length || preview.isPending} onClick={() => preview.mutate()}>
            미리보기
          </button>
          <button className="btn primary" disabled={!preview.data || !preview.data.newCount || save.isPending} onClick={() => save.mutate()}>
            새 검색어 {preview.data?.newCount ?? 0}개 저장
          </button>
        </div>
        {preview.data && (
          <div className="stack">
            <p className="small">
              새로 추가 {preview.data.newCount}개 · 이미 있음 {preview.data.duplicateCount}개{enabled && ` · 실행당 호출 +${preview.data.newCount}회`}
            </p>
            <table className="simple">
              <tbody>
                {preview.data.rows.slice(0, 100).map((r, i) => (
                  <tr key={i}>
                    <td>{r.query}</td>
                    <td>{r.endpoint === "news" ? "뉴스" : "블로그"}</td>
                    <td>{r.duplicate ? <Badge>이미 있음</Badge> : <Badge kind="ok">새로 추가</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {save.data && <div className="notice ok small">{save.data.created.length}개를 저장했습니다.</div>}
        {(preview.error || save.error) && <ErrorBox error={preview.error || save.error} />}
      </section>
    </div>
  );
}

function DeletedTab({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const rules = useRules(cid, true);
  const restore = useMutation({
    mutationFn: (r: SearchRule) => api(`/channels/${cid}/rules/${r.id}/restore`, { method: "POST", body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ch", cid, "rules"] }),
  });
  if (rules.isLoading) return <Loading />;
  if (rules.error) return <ErrorBox error={rules.error} />;
  return (
    <div className="stack">
      <p className="small muted">삭제해도 이 검색어로 모은 자료와 실행 기록은 남아 있습니다. 복구하면 ‘일시정지’ 상태로 돌아옵니다.</p>
      {restore.error && <ErrorBox error={restore.error} />}
      {!rules.data!.items.length ? (
        <Empty>삭제된 검색어가 없습니다.</Empty>
      ) : (
        <ul className="list">
          {rules.data!.items.map((r) => (
            <li key={r.id} className="list-item">
              <div className="row between">
                <span>
                  <strong>{r.query}</strong> <Badge>{r.endpoint === "news" ? "뉴스" : "블로그"}</Badge>
                </span>
                <button className="btn sm" onClick={() => restore.mutate(r)} disabled={restore.isPending}>
                  복구
                </button>
              </div>
              <span className="small muted">삭제 {fmtDate(r.deletedAt as unknown as string)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OfficialTab({ cid }: { cid: number }) {
  const q = useQuery({ queryKey: ["ch", cid, "official"], queryFn: () => api<OfficialSource[]>(`/channels/${cid}/official-sources`) });
  const [editing, setEditing] = useState<OfficialSource | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data!;
  const connected = rows.filter((r) => r.adapter && r.enabled).length;
  return (
    <div className="stack">
      <div className="notice warn small">
        공식 게시판 자동 수집기(어댑터)가 연결된 곳: {connected}/{rows.length}. 새 검색어를 추가해도 공식 게시판 수집기가 생기지는 않습니다. 도메인을 확인해 두면, 그 도메인의 원문은 ‘공식 원문 확인’으로 판정됩니다.
      </div>
      {!rows.length ? (
        <Empty>등록된 공식 출처가 없습니다.</Empty>
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="list-item">
              <div className="row between">
                <div className="row">
                  <strong>{r.name}</strong>
                  <span className="small muted">{r.aliases.join(", ")}</span>
                  {r.schoolType && <Badge>{SCHOOL_TYPE_LABEL[r.schoolType] ?? r.schoolType}</Badge>}
                </div>
                <button className="btn sm" onClick={() => setEditing(r)}>
                  확인 정보 입력
                </button>
              </div>
              <div className="row small">
                <Badge kind={r.domain && r.verifiedAt ? "ok" : "warn"}>{r.domain && r.verifiedAt ? `도메인 확인: ${r.domain}` : "도메인 미확인"}</Badge>
                <Badge kind={r.adapter ? "ok" : ""}>{r.adapter ? `수집기: ${r.adapter}` : "게시판 수집기 미연결"}</Badge>
                {r.verifiedAt && <span className="muted">확인 {fmtDate(r.verifiedAt as unknown as string)}</span>}
              </div>
              {r.lastCheckedAt && <span className="small muted">최근 확인 {fmtDate(r.lastCheckedAt as unknown as string)} · {r.lastStatus === "ok" ? `신규 ${r.lastNewCount}건` : r.lastError || "확인 필요"}</span>}
              {r.verificationNote && <span className="small muted">{r.verificationNote}</span>}
            </li>
          ))}
        </ul>
      )}
      {editing && <OfficialForm cid={cid} src={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OfficialForm({ cid, src, onClose }: { cid: number; src: OfficialSource; onClose: () => void }) {
  const qc = useQueryClient();
  const [domain, setDomain] = useState(src.domain ?? "");
  const [boardUrl, setBoard] = useState(src.boardUrl ?? "");
  const [aliases, setAliases] = useState(src.aliases.join("\n"));
  const [verified, setVerified] = useState(!!src.verifiedAt);
  const [note, setNote] = useState(src.verificationNote);
  const cfg = src.adapterConfig as { linkSelector?: string; titleSelector?: string | null; dateSelector?: string | null };
  const [useBoard, setUseBoard] = useState(src.adapter === "generic_board");
  const [enabled, setEnabled] = useState(src.enabled);
  const [linkSel, setLinkSel] = useState(cfg.linkSelector ?? "");
  const [dateSel, setDateSel] = useState(cfg.dateSelector ?? "");
  const m = useMutation({
    mutationFn: () =>
      api<OfficialSource>(`/channels/${cid}/official-sources/${src.id}`, {
        method: "PATCH",
        body: {
          version: src.version, domain: domain.trim() || null, boardUrl: boardUrl.trim() || null, aliases: aliases.split("\n").map((s) => s.trim()).filter(Boolean), verified, verificationNote: note, enabled,
          adapter: useBoard ? "generic_board" : null,
          ...(useBoard ? { adapterConfig: { ...src.adapterConfig, linkSelector: linkSel.trim(), dateSelector: dateSel.trim() || null, maxItems: src.adapterConfig.maxItems ?? 20 } } : {}),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ch", cid, "official"] });
      onClose();
    },
  });
  const test = useMutation({ mutationFn: () => api<{ entries: Array<{ url: string; title: string; dateText: string | null }>; warnings?: string[] }>(`/channels/${cid}/official-sources/${src.id}/test-board`, { method: "POST", body: {} }) });
  return (
    <Modal title={`공식 출처: ${src.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="field">
          별칭 (한 줄에 하나)
          <textarea rows={3} value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        <label className="field">
          공식 도메인
          <span className="hint">학교·기관 누리집에서 직접 확인한 도메인만 입력하세요. 예: school.hs.kr</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <label className="field">
          공지 게시판 URL (https)
          <input type="url" value={boardUrl} onChange={(e) => setBoard(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> 공식 자료로 학교 분류·도메인을 확인했음
        </label>
        <fieldset className="stack">
          <legend>공지 게시판 수집기(선택)</legend>
          <label className="check">
            <input type="checkbox" checked={useBoard} onChange={(e) => setUseBoard(e.target.checked)} /> 이 게시판을 설정형 수집기로 읽기
          </label>
          {useBoard && (
            <>
              <label className="field">
                목록 링크 선택자 (CSS)
                <span className="hint">게시판 목록에서 각 글 제목 링크를 고르는 선택자. 예: table.board_list td.subject a</span>
                <input value={linkSel} onChange={(e) => setLinkSel(e.target.value)} />
              </label>
              <label className="field">
                날짜 선택자 (같은 행 안, 선택)
                <input value={dateSel} onChange={(e) => setDateSel(e.target.value)} />
              </label>
            </>
          )}
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 수집에 사용 (도메인 확인 + 수집기 설정이 있을 때만 실제로 읽음)
          </label>
          {src.adapter === "generic_board" && (
            <div className="stack">
              <div>
                <button type="button" className="btn sm" onClick={() => test.mutate()} disabled={test.isPending}>
                  {test.isPending ? "읽는 중…" : "저장된 설정으로 게시판 시험 읽기"}
                </button>
              </div>
              {test.error && <ErrorBox error={test.error} />}
              {test.data?.warnings?.map(w => <p className="small muted" key={w}>{w}</p>)}
              {test.data && (test.data.entries.length ? <ul className="small">{test.data.entries.map((e) => <li key={e.url}>{e.dateText ?? ""} {e.title}</li>)}</ul> : <p className="small muted">목록을 찾지 못했습니다. 선택자를 확인하세요.</p>)}
            </div>
          )}
        </fieldset>
        <label className="field">
          확인 메모 (출처·확인일)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {m.error && <ErrorBox error={m.error} />}
        <div className="row">
          <button className="btn primary" disabled={m.isPending}>
            저장
          </button>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
