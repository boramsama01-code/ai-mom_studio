import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useToast } from "../toast";
import { DiscoveryBadge } from "../discovery";
import { useDirtyGuard } from "../state";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, GuardedLink, Loading, Pager, StatusBadge } from "../ui";
import { NOTICE_CATEGORIES, CONTENT_KIND_LABEL, type ContentKind } from "@shared/domain";
import type { ContentItem } from "@shared/schema";
import { kstDay } from "@shared/collection";
import { CollectionPanel, useKstToday } from "../collection";

export type ListRow = {
  item: ContentItem;
  source: { id: number; kind: string; url: string; publishedAt: string | null; publishedPrecision: string | null; fetchStatus: string; snippet: string } | null;
  channelSlug: string;
  channelName: string;
  matchedQuery?: string | null;
};
type ListResp = { total: number; page: number; pageSize: number; items: ListRow[] };

const SOURCE_KIND: Record<string, string> = { naver_news: "뉴스", naver_blog: "블로그", official: "공식", manual: "직접 추가" };

export function InboxPage() {
  const { selected, current } = useChannel();
  const params = new URLSearchParams(useSearch());
  const today = useKstToday();
  const [followToday, setFollowToday] = useState(!params.has("collectedOn"));
  const [f, setF] = useState({
    q: params.get("q") ?? "",
    review: params.get("review") ?? "",
    schedule: params.get("schedule") ?? "",
    evidence: params.get("evidence") ?? "",
    category: params.get("category") ?? "",
    view: (params.get("view") as "inbox" | "excluded" | "all") ?? "inbox",
    collectedOn: params.get("collectedOn") === "all" ? "" : params.get("collectedOn") ?? kstDay(),
  });
  const [page, setPage] = useState(1);
  useEffect(() => { if (followToday) { setF(old => ({ ...old, collectedOn: today })); setPage(1); } }, [today, followToday]);
  const [qInput, setQInput] = useState(f.q);
  const query = useQuery({
    queryKey: ["ch", selected, "items", f, page],
    queryFn: () => api<ListResp>(`/items?${qs({ channelId: selected, ...f, collectedOn: f.collectedOn || undefined, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const set = (k: keyof typeof f, v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    setPage(1);
  };
  const isNotice = current ? current.contentType === "notice" : true;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>수집함</h1>
          <p className="muted small">검색·공식 출처에서 모은 자료입니다. 제목을 눌러 원문·근거를 확인하고 편집하세요.</p>
        </div>
      </div>
      <CollectionPanel date={f.collectedOn || undefined} />
      <div className="row collection-date-filter" role="group" aria-label="수집 날짜">
        <button className={`btn sm ${f.collectedOn === today ? "primary" : ""}`} onClick={() => { setFollowToday(true); set("collectedOn", today); }}>오늘</button>
        <button className="btn sm" onClick={() => { setFollowToday(false); set("collectedOn", kstDay(new Date(Date.now() - 86400_000))); }}>어제</button>
        <button className={`btn sm ${!f.collectedOn ? "primary" : ""}`} onClick={() => { setFollowToday(false); set("collectedOn", ""); }}>전체 기간</button>
        <label className="field"><span className="sr-only">수집일 선택</span><input type="date" aria-label="수집일 선택" value={f.collectedOn} onChange={e => { setFollowToday(false); set("collectedOn", e.target.value); }} /></label>
        <span className="small muted">{query.data?.total ?? 0}건{f.review ? " · 검토 상태 필터 적용 중" : ""}</span>
      </div>
      <form
        className="panel stack"
        style={{ marginBottom: 16 }}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", qInput.trim());
        }}
      >
        <div className="row">
          <label className="field" style={{ flex: "2 1 220px" }}>
            <span className="sr-only">검색</span>
            <input placeholder="제목 검색" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </label>
          <button className="btn">검색</button>
        </div>
        <details className="filters" open={typeof window !== "undefined" && window.innerWidth > 900}>
          <summary className="btn sm" style={{ width: "fit-content" }}>필터{[f.review, f.evidence, f.schedule, f.category].filter(Boolean).length ? ` (${[f.review, f.evidence, f.schedule, f.category].filter(Boolean).length}개 적용)` : ""}{f.view !== "inbox" ? " · 보기 변경됨" : ""}</summary>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <label className="field">
            보기
            <select value={f.view} onChange={(e) => set("view", e.target.value)}>
              <option value="inbox">수집한 자료</option>
              <option value="excluded">제외된 자료</option>
              <option value="all">전부</option>
            </select>
          </label>
          <label className="field">
            검토 상태
            <select value={f.review} onChange={(e) => set("review", e.target.value)}>
              <option value="">전체</option>
              <option value="pending,review_required">검토 대기·재검토</option>
              <option value="reviewed">검토 완료</option>
              <option value="held">보류</option>
              <option value="rejected">제외(검토)</option>
            </select>
          </label>
          <label className="field">
            근거
            <select value={f.evidence} onChange={(e) => set("evidence", e.target.value)}>
              <option value="">전체</option>
              <option value="official_confirmed">공식 원문 확인</option>
              <option value="secondary_only">보도·2차 자료만</option>
              <option value="needs_review,fetch_failed,conflict">확인 필요·실패·충돌</option>
            </select>
          </label>
          {isNotice && (
            <>
              <label className="field">
                일정
                <select value={f.schedule} onChange={(e) => set("schedule", e.target.value)}>
                  <option value="">전체</option>
                  <option value="open,upcoming">접수 중·예정</option>
                  <option value="closed">마감</option>
                  <option value="unknown">일정 미확인</option>
                </select>
              </label>
              <label className="field">
                카테고리
                <select value={f.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="">전체</option>
                  {NOTICE_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        </details>
      </form>

      {query.isLoading ? (
        <Loading lines={4} label="수집함 불러오는 중" />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <Empty>
          {f.collectedOn ? `${f.collectedOn}에 새로 수집된 자료가 없습니다. ` : "조건에 맞는 자료가 없습니다. "}
          {f.view === "inbox" && !f.q && !f.review && !f.evidence ? "검색 설정에서 키워드를 켜고 수집을 요청하거나, 시험 검색 결과를 저장해 보세요." : "필터를 바꿔 보세요."}
        </Empty>
      ) : (
        <div className="stack" aria-busy={query.isFetching}>
          {selected === "all" ? <ItemList rows={query.data.items} showChannel /> : <TriageList rows={query.data.items} cid={selected} />}
          <Pager page={page} pageSize={20} total={query.data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}

export function ItemList({ rows, showChannel }: { rows: ListRow[]; showChannel: boolean }) {
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.item.id} className="list-item">
          <ItemBody row={r} showChannel={showChannel} />
        </li>
      ))}
    </ul>
  );
}

function ItemBody({ row: { item, source, channelName, matchedQuery }, showChannel }: { row: ListRow; showChannel: boolean }) {
  return (
    <>
      <GuardedLink href={`/items/${item.channelId}/${item.id}`} className="title">
        {item.title}
      </GuardedLink>
      {item.discovery?.reason ? <p className="small snippet">AI 선정 이유: {item.discovery.reason}</p> : source?.snippet && <p className="small muted snippet">{source.snippet}</p>}
      <div className="meta">
        {showChannel && <span>{channelName}</span>}
        <span>{CONTENT_KIND_LABEL[item.kind as ContentKind]}</span>
        {item.category && <span>{item.category}</span>}
        {source && <span>{SOURCE_KIND[source.kind] ?? source.kind} · 게시 {fmtDate(source.publishedAt, source.publishedPrecision)}</span>}
        <span>수집 {fmtDate(item.createdAt as unknown as string)}</span>
        {matchedQuery && <span>검색어: {matchedQuery}</span>}
      </div>
      <div className="row">
        {item.isSample && <Badge kind="sample">샘플 · 실제 정보 아님</Badge>}
        <DiscoveryBadge info={item.discovery} />
        <StatusBadge type="review" value={item.reviewStatus} />
        <StatusBadge type="evidence" value={item.evidenceStatus} />
        {item.kind === "notice" && <StatusBadge type="schedule" value={item.scheduleStatus} />}
        {item.relevance !== "uncertain" && <StatusBadge type="relevance" value={item.relevance} />}
        {item.publishStatus !== "waiting" && <StatusBadge type="publish" value={item.publishStatus} />}
        {item.excluded && <Badge kind="err">제외됨: {item.excludedReason}</Badge>}
      </div>
    </>
  );
}

/** 수집함 분류 목록 — 여러 개 선택 후 한꺼번에 처리, 키보드로 빠르게 훑기 */
function TriageList({ rows, cid }: { rows: ListRow[]; cid: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useDirtyGuard();
  const [, navigate] = useLocation();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => setPicked(new Set()), [rows]);
  const bulk = useMutation({
    mutationFn: (a: { ids: number[]; action: string }) => api<{ updated: number }>(`/channels/${cid}/items/bulk`, { method: "POST", body: a }),
    onSuccess: (r, a) => {
      const label = { exclude: "제외", unexclude: "제외 해제", hold: "보류", pending: "검토 대기" }[a.action];
      toast("ok", `${r.updated}건을 '${label}'(으)로 바꿨습니다.`);
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["ch", cid] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const act = (action: string, ids = [...picked]) => ids.length && bulk.mutate({ ids, action });
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".modal-backdrop")) return;
      const row = rows[focus];
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(f + 1, rows.length - 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => Math.max(f - 1, 0)); }
      else if (e.key === "Enter" && row) guard.confirmLeave(() => navigate(`/items/${cid}/${row.item.id}`));
      else if (e.key === "x" && row) toggle(row.item.id);
      else if (e.key === "e" && row) act(row.item.excluded ? "unexclude" : "exclude", [row.item.id]);
      else if (e.key === "h" && row) act("hold", [row.item.id]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(() => refs.current[focus]?.scrollIntoView({ block: "nearest" }), [focus]);

  const all = rows.length > 0 && rows.every((r) => picked.has(r.item.id));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {picked.size > 0 ? (
        <div className="bulkbar" role="region" aria-label="선택한 항목 처리">
          <strong>{picked.size}건 선택</strong>
          <button className="btn sm" onClick={() => act("hold")}>보류</button>
          <button className="btn sm" onClick={() => act("pending")}>검토 대기로</button>
          <button className="btn sm" onClick={() => act("exclude")}>수집함에서 제외</button>
          <button className="btn sm" onClick={() => setPicked(new Set())}>선택 해제</button>
        </div>
      ) : (
        <div className="row between">
          <label className="check" style={{ minHeight: 32 }}>
            <input type="checkbox" className="row-check" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.item.id)))} /> 이 페이지 전체 선택
          </label>
          <span className="shortcut-hint hide-mobile">
            <span><kbd>J</kbd>/<kbd>K</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span><kbd>X</kbd> 선택</span><span><kbd>H</kbd> 보류</span><span><kbd>E</kbd> 제외</span>
          </span>
        </div>
      )}
      <ul className="list">
        {rows.map((r, i) => (
          <li key={r.item.id} ref={(el) => { refs.current[i] = el; }} className={`list-item ${i === focus ? "focused" : ""}`} onClick={() => setFocus(i)}>
            <div className="item-head">
              <input type="checkbox" className="row-check" aria-label={`${r.item.title} 선택`} checked={picked.has(r.item.id)} onChange={() => toggle(r.item.id)} style={{ marginTop: 3 }} />
              <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                <ItemBody row={r} showChannel={false} />
              </div>
              <div className="quick hide-mobile">
                <button className="btn sm ghost" title="보류 (H)" onClick={(e) => { e.stopPropagation(); act("hold", [r.item.id]); }}>보류</button>
                <button className="btn sm ghost" title="제외 (E)" onClick={(e) => { e.stopPropagation(); act(r.item.excluded ? "unexclude" : "exclude", [r.item.id]); }}>{r.item.excluded ? "제외 해제" : "제외"}</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

