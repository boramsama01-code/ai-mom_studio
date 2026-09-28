import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, GuardedLink, Loading, Pager, StatusBadge } from "../ui";
import { NOTICE_CATEGORIES, CONTENT_KIND_LABEL, type ContentKind } from "@shared/domain";
import type { ContentItem } from "@shared/schema";

export type ListRow = {
  item: ContentItem;
  source: { id: number; kind: string; url: string; publishedAt: string | null; publishedPrecision: string | null; fetchStatus: string; snippet: string } | null;
  channelSlug: string;
  channelName: string;
};
type ListResp = { total: number; page: number; pageSize: number; items: ListRow[] };

const SOURCE_KIND: Record<string, string> = { naver_news: "뉴스", naver_blog: "블로그", official: "공식", manual: "직접 추가" };

export function InboxPage() {
  const { selected, current } = useChannel();
  const params = new URLSearchParams(useSearch());
  const [f, setF] = useState({
    q: params.get("q") ?? "",
    review: params.get("review") ?? "",
    schedule: params.get("schedule") ?? "",
    evidence: params.get("evidence") ?? "",
    category: params.get("category") ?? "",
    view: (params.get("view") as "inbox" | "excluded" | "all") ?? "inbox",
  });
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState(f.q);
  const query = useQuery({
    queryKey: ["ch", selected, "items", f, page],
    queryFn: () => api<ListResp>(`/items?${qs({ channelId: selected, ...f, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
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
              <option value="inbox">수집함(제외 제외)</option>
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
          조건에 맞는 자료가 없습니다.{" "}
          {f.view === "inbox" && !f.q && !f.review && !f.evidence ? "검색 설정에서 키워드를 켜고 수집을 요청하거나, 시험 검색 결과를 저장해 보세요." : "필터를 바꿔 보세요."}
        </Empty>
      ) : (
        <div className="stack" aria-busy={query.isFetching}>
          <ItemList rows={query.data.items} showChannel={selected === "all"} />
          <Pager page={page} pageSize={20} total={query.data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}

export function ItemList({ rows, showChannel }: { rows: ListRow[]; showChannel: boolean }) {
  return (
    <ul className="list">
      {rows.map(({ item, source, channelName }) => (
        <li key={item.id} className="list-item">
          <GuardedLink href={`/items/${item.channelId}/${item.id}`} className="title">
            {item.title}
          </GuardedLink>
          <div className="meta">
            {showChannel && <span>{channelName}</span>}
            <span>{CONTENT_KIND_LABEL[item.kind as ContentKind]}</span>
            {item.category && <span>{item.category}</span>}
            {source && <span>{SOURCE_KIND[source.kind] ?? source.kind} · 게시 {fmtDate(source.publishedAt, source.publishedPrecision)}</span>}
            <span>수집 {fmtDate(item.createdAt as unknown as string)}</span>
          </div>
          <div className="row">
            {item.isSample && <Badge kind="sample">샘플 · 실제 정보 아님</Badge>}
            <StatusBadge type="review" value={item.reviewStatus} />
            <StatusBadge type="evidence" value={item.evidenceStatus} />
            {item.kind === "notice" && <StatusBadge type="schedule" value={item.scheduleStatus} />}
            {item.relevance !== "uncertain" && <StatusBadge type="relevance" value={item.relevance} />}
            {item.publishStatus !== "waiting" && <StatusBadge type="publish" value={item.publishStatus} />}
            {item.excluded && <Badge kind="err">제외됨: {item.excludedReason}</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}
