import { CategorySelect } from "../CategorySelect";
import { studioKey } from "@shared/channelKeys";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { isIdeaChannel, readIdea } from "@shared/ideaBank";
import { InboxKeywords } from "./InboxKeywords";
import { NOTICE_INTENTS, NOTICE_INTENT_LABEL, type NoticeIntent } from "@shared/noticeIntent";
import { WorkModeControl, type WorkMode } from "../WorkModeControl";
import { channelCategories } from "@shared/channelCategories";

export type ListRow = {
  item: ContentItem;
  source: { id: number; kind: string; url: string; publisher?: string | null; publishedAt: string | null; publishedPrecision: string | null; fetchStatus: string; snippet: string } | null;
  channelSlug: string;
  channelName: string;
  matchedQuery?: string | null;
  noticeIntent?: NoticeIntent | null;
};
type ListResp = { total: number; page: number; pageSize: number; items: ListRow[] };

const SOURCE_KIND: Record<string, string> = { naver_web: "네이버 웹문서", opportunity_listing: "공모전·활동 사이트", naver_news: "네이버 뉴스", naver_blog: "블로그", google_news_rss: "Google 뉴스 RSS", rss_direct: "언론사 RSS", official: "공식", manual: "직접 추가", manual_text: "본문 직접 저장" };
const BODY_FILTERS = [
  { value: "", label: "모든 본문 상태" },
  { value: "ok", label: "본문 확보" },
  { value: "not_fetched", label: "본문 미조회" },
  { value: "failed,blocked,unsupported", label: "본문 확인 필요" },
];
const BODY_STATES: Record<string, { label: string; kind: "" | "ok" | "warn" | "err"; hint: string }> = {
  ok: { label: "본문 확보", kind: "ok", hint: "원문 본문이 저장되어 있습니다." },
  not_fetched: { label: "본문 미조회", kind: "", hint: "제목·요약만 수집한 상태로, 아직 본문 조회를 시도하지 않았습니다." },
  failed: { label: "본문 조회 실패", kind: "err", hint: "본문 조회를 완료하지 못했습니다. 자료를 열어 원인과 복구 방법을 확인하세요." },
  blocked: { label: "자동 조회 제한", kind: "warn", hint: "출처가 자동 조회를 제한했습니다. 원문을 직접 확인할 수 있습니다." },
  unsupported: { label: "본문 직접 확인", kind: "warn", hint: "공개 응답에서 본문을 추출하지 못했습니다. 원문 확인이나 본문 붙여넣기가 필요합니다." },
};

export function InboxPage() {
  const { selected, current, allChannels } = useChannel();
  const [workMode, setWorkMode] = useState<WorkMode>("auto");
  const params = new URLSearchParams(useSearch());
  const today = useKstToday();
  const [followToday, setFollowToday] = useState(!params.has("collectedOn"));
  const [f, setF] = useState({
    q: params.get("q") ?? "",
    review: params.get("review") ?? "",
    schedule: params.get("schedule") ?? "",
    evidence: params.get("evidence") ?? "",
    fetchStatus: params.get("fetchStatus") ?? "",
    category: params.get("category") ?? "",
    subcategory: params.get("subcategory") ?? "",
    noticeIntent: params.get("noticeIntent") ?? (params.has("subcategory") ? "all" : "candidate"),
    view: (params.get("view") as "inbox" | "excluded" | "all") ?? "inbox",
    collectedOn: params.get("collectedOn") === "all" ? "" : params.get("collectedOn") ?? kstDay(),
  });
  const [page, setPage] = useState(1);
  useEffect(() => { if (followToday) { setF(old => ({ ...old, collectedOn: today })); setPage(1); } }, [today, followToday]);
  const [qInput, setQInput] = useState(f.q);
  const [mode, setMode] = useState<"ideas" | "scraps">(() => params.has("collectedOn") || params.has("subcategory") || params.has("fetchStatus") ? "scraps" : "ideas");
  const ideas = isIdeaChannel(current) && mode === "ideas";
  const previousChannel = useRef(selected);
  useEffect(() => { setPage(1); if (previousChannel.current !== selected) { setMode("ideas"); setWorkMode("auto"); setF(old => ({ ...old, subcategory: "" })); previousChannel.current = selected; } }, [selected]);
  const noticeChannel = current?.contentType === "notice";
  const query = useQuery({
    queryKey: ["ch", selected, "items", f, page, ideas],
    queryFn: () => api<ListResp>(`/items?${qs({ channelId: selected, ...f, fetchStatus: ideas ? undefined : f.fetchStatus || undefined, noticeIntent: noticeChannel ? f.noticeIntent : undefined, collectedOn: ideas ? undefined : f.collectedOn || undefined, origin: ideas ? "idea" : "scrap", page, pageSize: 20 })}`),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === selected && previousQuery?.queryKey[5] === ideas ? previous : undefined,
    refetchInterval: 60_000,
  });
  const set = (k: keyof typeof f, v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    setPage(1);
  };
  const resetFilters = () => { setQInput(""); setFollowToday(false); setF({ q: "", review: "", schedule: "", evidence: "", fetchStatus: "", category: "", subcategory: "", noticeIntent: "all", view: "inbox", collectedOn: "" }); setPage(1); };
  const yesterday = kstDay(new Date(Date.now() - 86400_000));
  const isNotice = current ? current.contentType === "notice" : true;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>수집함</h1>
          <p className="muted small">{current?.contentType === "manual" ? "아이디어를 골라 원고·카드뉴스·웹툰으로 이어가세요." : "자료를 고르고, 원문을 확인한 뒤 콘텐츠로 만드세요."}</p>
        </div>
        {current && <GuardedLink className="btn sm" href={`/?start=free&channel=${studioKey(current.slug)}`}>새 콘텐츠 자동 제작</GuardedLink>}
      </div>
      <WorkModeControl context="collect" mode={workMode} onChange={setWorkMode} />
      {workMode === "auto" && current?.contentType === "manual" && <div className="notice small">이 채널은 직접 제작용입니다. 소재를 선택하거나 <GuardedLink href={`/?start=free&channel=${studioKey(current.slug)}`}>주제로 자동 제작</GuardedLink>을 시작하세요. 자료 자동 수집이 필요하면 <GuardedLink href="/settings">채널 설정</GuardedLink>에서 자료 유형을 지정하세요.</div>}
      {workMode === "auto" && !ideas && current?.contentType !== "manual" && <CollectionPanel date={f.collectedOn || undefined} subcategory={f.subcategory} />}
      {workMode === "manual" && <section className="panel stack" aria-label="수동 자료 작업"><h2>수동으로 이어서 만들기</h2><p className="small muted">자동 수집·생성의 한도나 연결 문제일 때 사용하세요. 아래 자료를 열어 본문을 직접 붙여넣거나, 완성한 이미지를 가져올 수 있습니다.</p><div className="row"><GuardedLink className="btn" href={`/?start=free${current ? `&channel=${studioKey(current.slug)}` : ""}&mode=manual`}>직접 원고 작성</GuardedLink><GuardedLink className="btn" href={`/?start=finished${current ? `&channel=${studioKey(current.slug)}` : ""}&mode=manual`}>완성 이미지 가져오기</GuardedLink></div></section>}
      {isIdeaChannel(current) && <div className="tabs inbox-modes" role="group" aria-label="수집함 자료 유형"><button aria-pressed={ideas} onClick={() => { setMode("ideas"); resetFilters(); }}>아이디어 100</button><button aria-pressed={!ideas} onClick={() => { setMode("scraps"); resetFilters(); }}>스크랩 자료</button></div>}
      {ideas && <p className="small muted idea-intro">소재를 선택하면 구성안과 참고 자료를 볼 수 있습니다. 제작 보드에서 원고와 이미지를 완성하세요.</p>}
      <form
        className="panel stack inbox-search-panel"
        style={{ marginBottom: 16, minWidth: 0 }}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", qInput.trim());
        }}
      >
        <div className="row">
          <label className="field" style={{ flex: "2 1 220px", minWidth: 0 }}>
            <span className="sr-only">검색</span>
            <input placeholder={ideas ? "아이디어 제목 검색" : "제목 검색"} value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </label>
          <button className="btn primary">검색</button>
          <button type="button" className="btn ghost" onClick={resetFilters}>필터 초기화</button>
        </div>
        <div className="row" style={{ alignItems: "flex-end", gap: 12, minWidth: 0 }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}><CategorySelect channel={current?.slug ?? "all"} categories={current?.categories ?? (selected === "all" ? [...new Set((allChannels ?? []).flatMap(channel => channelCategories(channel.slug, channel.categories)))] : undefined)} value={f.subcategory} onChange={v => set("subcategory", v)} filter /></div>
          {!ideas && <label className="field" style={{ flex: "1 1 180px", minWidth: 0 }}>
            본문 상태
            <select aria-label="본문 상태" value={f.fetchStatus} onChange={e => set("fetchStatus", e.target.value)}>
              {BODY_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>}
          {noticeChannel && <label className="field" style={{ flex: "1 1 180px", minWidth: 0 }}>
            공고 성격
            <select aria-label="공고 성격" value={f.noticeIntent} onChange={e => set("noticeIntent", e.target.value)}>
              {[...NOTICE_INTENTS, "all"].map(intent => <option key={intent} value={intent}>{intent === "all" ? "전체 자료" : NOTICE_INTENT_LABEL[intent as NoticeIntent]}</option>)}
            </select>
          </label>}
        </div>
        {!ideas && <div className="row collection-date-filter" role="group" aria-label="수집 날짜" style={{ margin: 0, padding: 0, minWidth: 0 }}>
          <button type="button" className={`btn sm ${f.collectedOn === today ? "primary" : ""}`} aria-pressed={f.collectedOn === today} onClick={() => { setFollowToday(true); set("collectedOn", today); }}>오늘</button>
          <button type="button" className={`btn sm ${f.collectedOn === yesterday ? "primary" : ""}`} aria-pressed={f.collectedOn === yesterday} onClick={() => { setFollowToday(false); set("collectedOn", yesterday); }}>어제</button>
          <button type="button" className={`btn sm ${!f.collectedOn ? "primary" : ""}`} aria-pressed={!f.collectedOn} onClick={() => { setFollowToday(false); set("collectedOn", ""); }}>전체 기간</button>
          <label className="field" style={{ minWidth: 0 }}><span className="sr-only">수집일 선택</span><input type="date" aria-label="수집일 선택" value={f.collectedOn} onChange={e => { setFollowToday(false); set("collectedOn", e.target.value); }} /></label>
        </div>}
        {!ideas && <p className="small muted" style={{ margin: 0 }}>본문 미조회는 오류가 아닌 조회 전 상태입니다.{noticeChannel ? " 모집·접수 후보의 자격과 마감일은 공식 원문에서 확인하세요." : ""}</p>}
        <details className="filters" open={!!(f.review || f.evidence || f.schedule || f.category || f.view !== "inbox")}>
          <summary className="btn sm" style={{ width: "fit-content", maxWidth: "100%", whiteSpace: "normal" }}>추가 필터{[f.review, f.evidence, f.schedule, f.category].filter(Boolean).length ? ` (${[f.review, f.evidence, f.schedule, f.category].filter(Boolean).length}개 적용)` : ""}{f.view !== "inbox" ? " · 보기 변경됨" : ""}</summary>
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

      {(!ideas || current) && <details className="settings-details inbox-collection-options" style={{ margin: "0 0 16px", minWidth: 0 }}>
        <summary style={{ display: "list-item", listStylePosition: "inside" }}>수집 현황·설정 <span className="small muted" style={{ fontWeight: 400, marginLeft: 8 }}>지금 수집 · 키워드 관리</span></summary>
        <div className="stack" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {current && <InboxKeywords key={current.id} cid={current.id} kind={current.contentType} subcategory={f.subcategory} />}
        </div>
      </details>}

      {!query.isLoading && !query.error && <p className="small muted" role="status">{ideas ? "아이디어" : "자료"} {query.data?.total ?? 0}건{!ideas && f.fetchStatus ? ` · ${BODY_FILTERS.find(option => option.value === f.fetchStatus)?.label ?? "본문 상태 필터 적용"}` : ""}</p>}

      {query.isLoading ? (
        <Loading lines={4} label="수집함 불러오는 중" />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <Empty>
          {f.fetchStatus && !ideas ? "선택한 기간에 이 본문 상태의 자료가 없습니다. " : noticeChannel && f.noticeIntent !== "all" ? `선택한 기간에 ‘${NOTICE_INTENT_LABEL[f.noticeIntent as NoticeIntent] ?? "공고"}’ 자료가 없습니다. ‘확인 필요’ 또는 ‘전체 자료’도 확인하세요. ` : f.q || f.review || f.evidence || f.category || f.subcategory || f.schedule ? "조건에 맞는 자료가 없습니다. " : f.collectedOn ? `${f.collectedOn}에 새로 수집된 자료가 없습니다. ` : "조건에 맞는 자료가 없습니다. "}
          {f.view === "inbox" && !f.q && !f.review && !f.evidence && !f.fetchStatus ? "수집 현황·설정에서 키워드를 추가하거나, 전체 기간의 자료를 확인해 보세요." : "필터를 바꿔 보세요."}
          <div className="empty-actions"><button className="btn" onClick={resetFilters}>전체 자료 보기</button></div>
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

function ItemBody({ row: { item, source, channelName, matchedQuery, noticeIntent }, showChannel }: { row: ListRow; showChannel: boolean }) {
  const idea = readIdea(item.edited);
  const bodyState = source ? BODY_STATES[source.fetchStatus] : undefined;
  if (item.origin === "idea" && idea) return <div className="idea-list-content"><span className="idea-number">{String(idea.number).padStart(3, "0")}</span><div style={{ minWidth: 0, overflowWrap: "anywhere" }}><div className="meta"><span>{idea.category}</span><span>{idea.format}</span>{showChannel && <span>{channelName}</span>}</div><GuardedLink href={`/items/${item.channelId}/${item.id}`} className="title">{item.title}</GuardedLink><p className="small muted snippet">{idea.angle}</p><span className="small muted">기획 아이디어 · 게시 전 확인 필요</span></div></div>;
  return (
    <>
      <GuardedLink href={`/items/${item.channelId}/${item.id}`} className="title">
        {item.title}
      </GuardedLink>
      {item.discovery?.reason ? <p className="small snippet" style={{ overflowWrap: "anywhere" }}>AI 선정 이유: {item.discovery.reason}</p> : source?.snippet && <p className="small muted snippet" style={{ overflowWrap: "anywhere" }}>수집 요약: {source.snippet}</p>}
      <div className="meta" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {showChannel && <span>{channelName}</span>}
        <span>{CONTENT_KIND_LABEL[item.kind as ContentKind]}</span>
        {item.category && <span>{item.category}</span>}
        {source && <span>{source.publisher && `${source.publisher} · `}{SOURCE_KIND[source.kind] ?? source.kind} · 게시 {fmtDate(source.publishedAt, source.publishedPrecision)}</span>}
        <span>수집 {fmtDate(item.createdAt as unknown as string)}</span>
        {matchedQuery && <span>검색어: {matchedQuery}</span>}
      </div>
      <div className="row">
        {bodyState && <Badge kind={bodyState.kind} title={bodyState.hint}>{bodyState.label}</Badge>}
        {item.isSample && <Badge kind="sample">샘플 · 실제 정보 아님</Badge>}
        {noticeIntent && <Badge kind={noticeIntent === "candidate" ? "ok" : "warn"}>{NOTICE_INTENT_LABEL[noticeIntent]}</Badge>}
        <DiscoveryBadge info={item.discovery} />
        <StatusBadge type="review" value={item.reviewStatus} />
        <StatusBadge type="evidence" value={item.evidenceStatus} />
        {item.kind === "notice" && <StatusBadge type="schedule" value={item.scheduleStatus} />}
        {item.relevance !== "uncertain" && <StatusBadge type="relevance" value={item.relevance} />}
        {item.publishStatus !== "waiting" && <StatusBadge type="publish" value={item.publishStatus} />}
        {item.excluded && <Badge kind="err"><span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>제외됨: {item.excludedReason}</span></Badge>}
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
  const keyboardScroll = useRef(false);
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
      if (t.closest("input, textarea, select, button, a, summary, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".modal-backdrop, dialog[open]")) return;
      const row = rows[focus];
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); keyboardScroll.current = true; setFocus((f) => Math.min(f + 1, rows.length - 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); keyboardScroll.current = true; setFocus((f) => Math.max(f - 1, 0)); }
      else if (e.key === "Enter" && row) guard.confirmLeave(() => navigate(`/items/${cid}/${row.item.id}`));
      else if (e.key === "x" && row) toggle(row.item.id);
      else if (e.key === "e" && row) act(row.item.excluded ? "unexclude" : "exclude", [row.item.id]);
      else if (e.key === "h" && row) act("hold", [row.item.id]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(() => { if (keyboardScroll.current) { refs.current[focus]?.scrollIntoView({ block: "nearest" }); keyboardScroll.current = false; } }, [focus]);

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
