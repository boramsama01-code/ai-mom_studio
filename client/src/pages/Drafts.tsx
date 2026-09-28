import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Empty, ErrorBox, Loading, Pager } from "../ui";
import { ItemList, type ListRow } from "./Inbox";
import { CURRENT_EDITORIAL_TOPICS, SCIENCE_EVERGREEN_TOPICS } from "@shared/domain";
import type { ContentItem } from "@shared/schema";

export function DraftsPage() {
  const { selected, current } = useChannel();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [review, setReview] = useState("");
  const [title, setTitle] = useState("");
  const list = useQuery({
    queryKey: ["ch", selected, "drafts", review, page],
    queryFn: () => api<{ total: number; items: ListRow[] }>(`/items?${qs({ channelId: selected, view: "drafts", review, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });
  const create = useMutation({
    mutationFn: (t: { title: string; origin?: string }) => api<ContentItem>(`/channels/${selected}/items`, { method: "POST", body: t }),
    onSuccess: (it) => {
      qc.invalidateQueries({ queryKey: ["ch", selected] });
      navigate(`/items/${it.channelId}/${it.id}`);
    },
  });
  const ideas = current?.contentType === "science_dialogue" ? SCIENCE_EVERGREEN_TOPICS : current?.contentType === "current_dialogue" ? CURRENT_EDITORIAL_TOPICS : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>콘텐츠 초안</h1>
          <p className="small muted">초안이 있는 항목입니다. 편집·보류·검토 완료 후 카드 작업으로 이어집니다.</p>
        </div>
      </div>
      {selected !== "all" && (
        <section className="panel stack" style={{ marginBottom: 16 }}>
          <h2>직접 작성</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate({ title: title.trim() });
            }}
          >
            <label className="field" style={{ flex: "1 1 260px" }}>
              <span className="sr-only">제목 또는 주제</span>
              <input placeholder={current?.contentType === "notice" ? "공고 제목" : "주제 또는 핵심 질문"} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <button className="btn primary" disabled={create.isPending || !title.trim()}>
              새 초안 만들기
            </button>
          </form>
          {ideas.length > 0 && (
            <div className="stack">
              <span className="small muted">{current?.contentType === "science_dialogue" ? "상시 주제 예시 — 근거 자료를 연결한 뒤 초안을 생성하세요" : "편집 주제 예시 — 시사 초안은 원문이 확보된 자료가 있어야 생성됩니다"}</span>
              <div className="row">
                {ideas.map((t) => (
                  <button key={t} className="btn sm" onClick={() => create.mutate({ title: t, origin: "evergreen" })} disabled={create.isPending}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {create.error && <ErrorBox error={create.error} />}
        </section>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="field">
          검토 상태
          <select value={review} onChange={(e) => { setReview(e.target.value); setPage(1); }}>
            <option value="">전체</option>
            <option value="pending,review_required">검토 대기·재검토</option>
            <option value="reviewed">검토 완료</option>
            <option value="held">보류</option>
          </select>
        </label>
      </div>
      {list.isLoading ? (
        <Loading lines={3} />
      ) : list.error ? (
        <ErrorBox error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <Empty>초안이 있는 항목이 없습니다.</Empty>
      ) : (
        <div className="stack">
          <ItemList rows={list.data.items} showChannel={selected === "all"} />
          <Pager page={page} pageSize={20} total={list.data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}
