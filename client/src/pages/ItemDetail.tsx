import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { Badge, ErrorBox, fmtDate, GuardedLink, Loading, StatusBadge } from "../ui";
import { cleanPayload, FIELD_LABEL, PayloadEditor } from "./editors";
import { CONTENT_KIND_LABEL, PUBLISH_LABEL, type ContentKind } from "@shared/domain";
import type { Approval, ContentItem, ContentRevision, Delivery, SourceDocument } from "@shared/schema";

type Detail = {
  item: ContentItem;
  primary: SourceDocument | null;
  linked: Array<{ link: { role: string }; doc: SourceDocument }>;
  revisions: Array<Pick<ContentRevision, "id" | "revisionNo" | "author" | "model" | "promptVersion" | "note"> & { createdAt: string; usage: { inputTokens: number; outputTokens: number } | null }>;
  current: (ContentRevision & { payload: Record<string, any> }) | null;
  cards: Array<{ id: number; revisionId: number; sha256: string; createdAt: string; cloudinaryUrl: string | null }>;
  approvals: Approval[];
  deliveries: Array<{ d: Delivery; dest: { label: string; platform: string } }>;
  similar: Array<{ id: number; title: string; reviewStatus: string }>;
  defaultCaptions: { instagram: string; telegram: string } | null;
};

const SRC_KIND: Record<string, string> = { naver_news: "네이버 뉴스(언론 기사)", naver_blog: "네이버 블로그", official: "공식 게시물", manual: "직접 추가 자료" };

export function ItemDetailPage({ cid, id }: { cid: number; id: number }) {
  const { selected } = useChannel();
  const q = useQuery({ queryKey: ["ch", cid, "item", id], queryFn: () => api<Detail>(`/channels/${cid}/items/${id}`) });
  const [tab, setTab] = useState<"source" | "edit" | "publish" | "history">("edit");
  if (selected !== "all" && selected !== cid)
    return (
      <div className="notice warn">
        이 항목은 다른 채널의 자료입니다. <GuardedLink href="/inbox">수집함으로 돌아가기</GuardedLink>
      </div>
    );
  if (q.isLoading) return <Loading lines={5} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const tabs: Array<[typeof tab, string]> = [["source", "원문·근거"], ["edit", "편집"], ["publish", "카드·승인"], ["history", "이력"]];
  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <GuardedLink href="/inbox" className="small">
            ← 수집함
          </GuardedLink>
          <h1 style={{ overflowWrap: "anywhere" }}>{d.item.title}</h1>
          <div className="row">
            {d.item.isSample && <Badge kind="sample">샘플 모드 · 실제 정보 아님</Badge>}
            <Badge>{CONTENT_KIND_LABEL[d.item.kind as ContentKind]}</Badge>
            <StatusBadge type="review" value={d.item.reviewStatus} />
            <StatusBadge type="evidence" value={d.item.evidenceStatus} />
            {d.item.kind === "notice" && <StatusBadge type="schedule" value={d.item.scheduleStatus} />}
            <StatusBadge type="relevance" value={d.item.relevance} />
            <StatusBadge type="publish" value={d.item.publishStatus} />
            {d.item.excluded && <Badge kind="err">제외됨: {d.item.excludedReason}</Badge>}
          </div>
        </div>
      </div>
      <div className="tabs only-mobile" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="split">
        <div className={tab === "source" ? "" : "hide-mobile"}>
          <SourcePanel d={d} cid={cid} />
        </div>
        <div className="stack">
          <div className={tab === "edit" ? "" : "hide-mobile"}>
            <EditPanel d={d} cid={cid} />
          </div>
          <div className={tab === "publish" ? "" : "hide-mobile"}>
            <ReviewPanel d={d} cid={cid} />
            <CardApprovePanel d={d} cid={cid} />
          </div>
          <div className={tab === "history" ? "" : "hide-mobile"}>
            <HistoryPanel d={d} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ───────────── 원문·근거 ───────────── */
function SourcePanel({ d, cid }: { d: Detail; cid: number }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const refetch = useMutation({
    mutationFn: () => api<{ changed: boolean }>(`/channels/${cid}/items/${d.item.id}/fetch`, { method: "POST", body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] }),
  });
  const addSource = useMutation({
    mutationFn: () => api(`/channels/${cid}/items/${d.item.id}/sources`, { method: "POST", body: { url } }),
    onSuccess: () => {
      setUrl("");
      qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
    },
  });
  const p = d.primary;
  const evidence: Array<{ field: string; source_id: number; quote: string }> = d.current?.payload?.evidence ?? [];
  return (
    <div className="stack">
      <section className="panel stack">
        <h2>원문</h2>
        {!p ? (
          <p className="muted">연결된 원문이 없습니다(직접 작성 항목). 아래에서 근거 자료를 추가할 수 있습니다.</p>
        ) : (
          <>
            <div className="meta">
              <span>{SRC_KIND[p.kind] ?? p.kind}</span>
              <span>게시 {fmtDate(p.publishedAt as unknown as string, p.publishedPrecision)}</span>
              {p.publishedRaw && <span>원본 날짜값 “{p.publishedRaw}”</span>}
              <span>확인 {fmtDate(p.lastFetchedAt as unknown as string)}</span>
            </div>
            <a href={p.originalUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>
              {p.title || p.originalUrl}
            </a>
            {p.kind === "naver_news" && <p className="small muted">언론 기사입니다. 학교·기관의 공식 공고와 다를 수 있으니 공식 원문을 함께 확인하세요.</p>}
            {p.snippet && <div className="quote">{p.snippet}</div>}
            <div className="row">
              <Badge kind={p.fetchStatus === "ok" ? "ok" : p.fetchStatus === "not_fetched" ? "" : "err"}>
                원문 확보: {{ ok: "성공", not_fetched: "아직 안 함", failed: "실패", unsupported: "지원 안 되는 형식", blocked: "차단됨" }[p.fetchStatus] ?? p.fetchStatus}
              </Badge>
              <button className="btn sm" onClick={() => refetch.mutate()} disabled={refetch.isPending}>
                {refetch.isPending ? "확보 중…" : "원문 다시 확보"}
              </button>
            </div>
            {p.fetchError && <div className="notice warn small">{p.fetchError}</div>}
            {refetch.error && <ErrorBox error={refetch.error} />}
            {refetch.data?.changed && <div className="notice warn small">원문 내용이 이전과 달라졌습니다. 다시 검토하세요.</div>}
            {p.attachments.length > 0 && (
              <div className="stack">
                <h3>첨부</h3>
                <ul className="small">
                  {p.attachments.map((a) => (
                    <li key={a.url}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        {a.name}
                      </a>{" "}
                      <span className="muted">
                        ({a.kind.toUpperCase()} · {{ ok: "텍스트 추출함", pending: "미처리", manual_check: "수동 확인 필요", failed: "실패" }[a.status] ?? a.status}
                        {a.reason ? ` — ${a.reason}` : ""})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.fetchedText && (
              <details>
                <summary>확보한 원문 텍스트 보기 ({p.fetchedText.length.toLocaleString()}자)</summary>
                <div className="source-text">{p.fetchedText}</div>
              </details>
            )}
          </>
        )}
      </section>

      <section className="panel stack">
        <h2>근거 구절</h2>
        <p className="small muted">자동 추출값의 근거입니다. 원문에서 실제로 찾은 구절만 남깁니다.</p>
        {evidence.length ? (
          <ul className="list">
            {evidence.map((e, i) => (
              <li key={i} className="stack" style={{ gap: 4 }}>
                <span className="small muted">
                  {FIELD_LABEL[e.field] ?? e.field} · 자료 #{e.source_id}
                </span>
                <div className="quote">{e.quote}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">근거 구절이 없습니다.</p>
        )}
      </section>

      <section className="panel stack">
        <h2>함께 연결된 자료</h2>
        {d.linked.length ? (
          <ul className="small">
            {d.linked.map(({ link, doc }) => (
              <li key={doc.id}>
                <Badge kind={link.role === "official" ? "ok" : ""}>{link.role === "official" ? "공식" : "보조"}</Badge>{" "}
                <a href={doc.originalUrl} target="_blank" rel="noopener noreferrer">
                  {doc.title || doc.originalUrl}
                </a>{" "}
                <span className="muted">확인 {fmtDate(doc.lastFetchedAt as unknown as string)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">없음</p>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            addSource.mutate();
          }}
        >
          <label className="field">
            근거 자료 URL 추가
            <span className="hint">서버가 실제로 조회해 본문을 확보한 경우에만 연결합니다. 확인된 공식 도메인이면 ‘공식’으로 표시됩니다.</span>
            <input type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>
          <div>
            <button className="btn sm" disabled={addSource.isPending}>
              {addSource.isPending ? "확보 중…" : "조회 후 연결"}
            </button>
          </div>
          {addSource.error && <ErrorBox error={addSource.error} />}
        </form>
      </section>

      {d.similar.length > 0 && (
        <section className="panel stack">
          <h2>비슷한 항목</h2>
          <p className="small muted">같은 기관·학년도·공고 유형입니다. 자동으로 합치지 않습니다.</p>
          <ul className="small">
            {d.similar.map((s) => (
              <li key={s.id}>
                <GuardedLink href={`/items/${cid}/${s.id}`}>{s.title}</GuardedLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ───────────── 편집 ───────────── */
function EditPanel({ d, cid }: { d: Detail; cid: number }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const base = useMemo(() => d.current?.payload ?? null, [d.current]);
  const [draft, setDraft] = useState<Record<string, any> | null>(base);
  const [version, setVersion] = useState(d.item.version);
  const [conflictMsg, setConflict] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useEffect(() => {
    if (!dirty) {
      setDraft(base);
      setVersion(d.item.version);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, d.item.version]);

  const save = useMutation({
    mutationFn: () => api<ContentItem>(`/channels/${cid}/items/${d.item.id}`, { method: "PATCH", body: { version, payload: cleanPayload(draft!), title: (draft?.title || draft?.key_question || d.item.title).toString().slice(0, 200) } }),
    onSuccess: async (it) => {
      setVersion(it.version);
      setConflict(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["ch", cid] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict("다른 곳에서 먼저 수정되었습니다. 입력 내용은 그대로 두었습니다. ‘최신 불러오기’로 확인한 뒤 다시 반영하세요.");
    },
  });
  const doSave = useCallback(async () => {
    try {
      await save.mutateAsync();
      return true;
    } catch {
      return false;
    }
  }, [save]);
  useEffect(() => {
    guard.setDirty(`item-${d.item.id}`, dirty, doSave);
    if (dirty) setSaved(false);
    return () => guard.setDirty(`item-${d.item.id}`, false);
  }, [dirty, doSave, guard, d.item.id]);

  const gen = useMutation({
    mutationFn: () => api(`/channels/${cid}/items/${d.item.id}/generate`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });

  return (
    <section className="panel stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>편집</h2>
        <button className="btn sm" onClick={() => gen.mutate()} disabled={gen.isPending || dirty} title={dirty ? "저장 후 사용할 수 있습니다" : undefined}>
          {gen.isPending ? "생성 중…" : d.item.kind === "notice" ? "원문에서 자동 추출" : "Claude로 초안 생성"}
        </button>
      </div>
      {d.current && (
        <p className="small muted">
          현재 버전 r{d.current.revisionNo} · {d.current.author === "operator" ? "운영자 편집본" : d.current.author === "llm" ? `자동 추출/초안 (${d.current.model ?? ""})` : "시스템"}
          {d.current.note ? ` · ${d.current.note}` : ""}
        </p>
      )}
      {gen.error && <ErrorBox error={gen.error} />}
      {gen.isSuccess && <div className="notice ok small">새 버전을 만들었습니다. 생성 성공은 검토 완료가 아닙니다 — 내용을 확인하세요.</div>}
      {!draft ? (
        <p className="muted">아직 초안이 없습니다. 원문을 확보한 뒤 자동 추출/초안 생성을 누르거나, 직접 작성 항목을 만드세요.</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <PayloadEditor kind={d.item.kind} value={draft} onChange={setDraft} />
          {conflictMsg && (
            <div className="notice err" role="alert">
              {conflictMsg}{" "}
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  await qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
                  const fresh = await api<Detail>(`/channels/${cid}/items/${d.item.id}`);
                  setVersion(fresh.item.version);
                  setConflict("최신 버전 번호를 불러왔습니다. 내 입력을 확인한 뒤 다시 저장하면 새 버전으로 기록됩니다.");
                }}
              >
                최신 불러오기
              </button>
            </div>
          )}
          {save.error && !conflictMsg && <ErrorBox error={save.error} />}
          <div className="savebar">
            {saved && !dirty && <span className="small muted" role="status" style={{ marginRight: "auto" }}>저장됨 — 새 버전으로 기록했습니다.</span>}
            {dirty && <span className="small" style={{ marginRight: "auto", color: "var(--warning)" }}>저장하지 않은 변경</span>}
            <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(base)}>
              되돌리기
            </button>
            <button className="btn primary" disabled={!dirty || save.isPending}>
              {save.isPending ? "저장 중…" : "새 버전으로 저장"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ───────────── 검토 ───────────── */
function ReviewPanel({ d, cid }: { d: Detail; cid: number }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (status: string) => api(`/channels/${cid}/items/${d.item.id}/review`, { method: "POST", body: { version: d.item.version, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });
  const ex = useMutation({
    mutationFn: (excluded: boolean) => api(`/channels/${cid}/items/${d.item.id}/exclude`, { method: "POST", body: { version: d.item.version, excluded } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });
  return (
    <section className="panel stack">
      <h2>검토</h2>
      <p className="small muted">검토 완료는 내용 확인 표시이며, 게시에는 별도의 최종 승인이 필요합니다.</p>
      <div className="row">
        <button className="btn primary" disabled={m.isPending || d.item.reviewStatus === "reviewed"} onClick={() => m.mutate("reviewed")}>
          검토 완료
        </button>
        <button className="btn" disabled={m.isPending || d.item.reviewStatus === "held"} onClick={() => m.mutate("held")}>
          보류
        </button>
        <button className="btn" disabled={m.isPending || d.item.reviewStatus === "pending"} onClick={() => m.mutate("pending")}>
          검토 대기로
        </button>
        <button className="btn danger" disabled={ex.isPending} onClick={() => ex.mutate(!d.item.excluded)}>
          {d.item.excluded ? "제외 해제" : "수집함에서 제외"}
        </button>
      </div>
      {(m.error || ex.error) && <ErrorBox error={m.error || ex.error} />}
    </section>
  );
}

/* ───────────── 카드·승인 ───────────── */
function toLocalInput(date: Date) {
  const k = new Date(date.getTime() + 9 * 3600_000).toISOString();
  return k.slice(0, 16);
}

function CardApprovePanel({ d, cid }: { d: Detail; cid: number }) {
  const qc = useQueryClient();
  const currentCard = d.cards.find((c) => c.revisionId === d.current?.id) ?? null;
  const [caps, setCaps] = useState(d.defaultCaptions ?? { instagram: "", telegram: "" });
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  useEffect(() => {
    if (d.defaultCaptions) setCaps(d.defaultCaptions);
  }, [d.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const render = useMutation({
    mutationFn: () => api(`/channels/${cid}/items/${d.item.id}/card`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] }),
  });
  const approve = useMutation({
    mutationFn: () =>
      api(`/channels/${cid}/items/${d.item.id}/approve`, {
        method: "POST",
        body: { revisionId: d.current!.id, mediaAssetId: currentCard!.id, captions: caps, scheduledAt: `${when}:00+09:00` },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });
  const cancel = useMutation({
    mutationFn: (aid: number) => api(`/channels/${cid}/approvals/${aid}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });
  const retry = useMutation({
    mutationFn: (a: { id: number; confirm?: boolean }) => api(`/channels/${cid}/deliveries/${a.id}/retry`, { method: "POST", body: { confirmNotPosted: a.confirm } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });
  const active = d.approvals.find((a) => a.status === "active");
  const len = (s: string) => [...s].length;
  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
      <h2>카드·최종 승인</h2>
      {!d.current ? (
        <p className="muted">초안이 있어야 카드를 만들 수 있습니다.</p>
      ) : (
        <>
          <div className="row">
            <button className="btn" onClick={() => render.mutate()} disabled={render.isPending}>
              {render.isPending ? "카드 만드는 중…" : currentCard ? "카드 다시 만들기" : "카드 만들기"}
            </button>
            {currentCard && (
              <a className="btn" href={`/api/channels/${cid}/media/${currentCard.id}?download=1`}>
                JPEG 다운로드
              </a>
            )}
          </div>
          {render.error && <ErrorBox error={render.error} />}
          {currentCard ? (
            <img className="card-preview" src={`/api/channels/${cid}/media/${currentCard.id}`} alt={`카드 미리보기: ${d.item.title}`} />
          ) : (
            <p className="small muted">현재 버전(r{d.current.revisionNo})으로 만든 카드가 없습니다.</p>
          )}

          <h3>캡션 (목적지별)</h3>
          <label className="field">
            인스타그램 캡션
            <span className="hint">
              {len(caps.instagram)} / 2200자 · 인스타그램 캡션의 URL은 클릭되는 링크가 아닙니다.
            </span>
            <textarea rows={8} value={caps.instagram} onChange={(e) => setCaps({ ...caps, instagram: e.target.value })} />
          </label>
          <label className="field">
            텔레그램 캡션
            <span className="hint">{len(caps.telegram)} / 1024자 (사진 캡션 제한)</span>
            <textarea rows={6} value={caps.telegram} onChange={(e) => setCaps({ ...caps, telegram: e.target.value })} />
          </label>
          <label className="field">
            예약 시각 (한국 시간)
            <span className="hint">예약 시각 이후 다음 워커 실행에서 처리됩니다(정시 보장 아님).</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary" onClick={() => approve.mutate()} disabled={approve.isPending || !currentCard || d.item.reviewStatus !== "reviewed"}>
              {approve.isPending ? "승인 중…" : "이 버전·카드·캡션으로 최종 승인"}
            </button>
          </div>
          {d.item.reviewStatus !== "reviewed" && <p className="small muted">먼저 ‘검토 완료’로 표시해야 최종 승인할 수 있습니다.</p>}
          {approve.error && <ErrorBox error={approve.error} />}
          {approve.isSuccess && <div className="notice ok small">승인했습니다. 연결된 목적지로 예약되었습니다. (기본 설정은 모의 실행이며 실제 게시하지 않습니다)</div>}
        </>
      )}

      {d.approvals.length > 0 && (
        <>
          <h3>승인·전송 기록</h3>
          <ul className="list">
            {d.approvals.map((a) => (
              <li key={a.id} className="list-item">
                <div className="row between">
                  <span className="small">
                    승인 #{a.id} · r{d.revisions.find((r) => r.id === a.revisionId)?.revisionNo ?? "?"} · 예약 {fmtDate(a.scheduledAt as unknown as string)}
                  </span>
                  <Badge kind={a.status === "active" ? "ok" : a.status === "completed" ? "ok" : ""}>
                    {{ active: "유효", invalidated: "무효(재승인 필요)", cancelled: "취소", completed: "완료" }[a.status] ?? a.status}
                  </Badge>
                </div>
                {a.invalidatedReason && <span className="small muted">{a.invalidatedReason}</span>}
                {d.deliveries
                  .filter((x) => x.d.approvalId === a.id)
                  .map(({ d: del, dest }) => (
                    <div key={del.id} className="row small">
                      <span>{dest.label}</span>
                      <Badge kind={del.status === "succeeded" ? "ok" : del.status === "failed" || del.status === "unknown" ? "err" : del.status === "dry_run" ? "warn" : ""}>{PUBLISH_LABEL[del.status] ?? del.status}</Badge>
                      {del.externalUrl && (
                        <a href={del.externalUrl} target="_blank" rel="noopener noreferrer">
                          게시물 보기
                        </a>
                      )}
                      {del.lastError && <span className="muted">{del.lastError}</span>}
                      {del.status === "failed" && a.status === "active" && (
                        <button className="btn sm" onClick={() => retry.mutate({ id: del.id })}>
                          이 목적지만 재시도
                        </button>
                      )}
                      {del.status === "unknown" && a.status === "active" && (
                        <button className="btn sm" onClick={() => confirm("해당 채널/계정에 실제로 게시되지 않았음을 확인했나요? 중복 게시될 수 있습니다.") && retry.mutate({ id: del.id, confirm: true })}>
                          게시 안 됨 확인 후 재시도
                        </button>
                      )}
                    </div>
                  ))}
                {a.status === "active" && (
                  <div>
                    <button className="btn sm danger" onClick={() => cancel.mutate(a.id)} disabled={cancel.isPending}>
                      승인 취소(처리 시작 전 전송만)
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!active && d.approvals[0]?.status === "invalidated" && <div className="notice warn small">콘텐츠가 바뀌어 기존 승인이 무효가 되었습니다. 카드를 다시 만들고 재승인하세요.</div>}
          {(cancel.error || retry.error) && <ErrorBox error={cancel.error || retry.error} />}
        </>
      )}
    </section>
  );
}

/* ───────────── 이력 ───────────── */
function HistoryPanel({ d }: { d: Detail }) {
  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
      <h2>버전 이력</h2>
      {d.revisions.length ? (
        <table className="simple">
          <thead>
            <tr>
              <th>버전</th>
              <th>작성</th>
              <th>시각</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            {d.revisions.map((r) => (
              <tr key={r.id}>
                <td>
                  r{r.revisionNo}
                  {d.item.currentRevisionId === r.id && " (현재)"}
                </td>
                <td>
                  {r.author === "operator" ? "운영자" : r.author === "llm" ? `Claude ${r.model ?? ""}` : "시스템"}
                  {r.usage && <div className="small muted">토큰 입력 {r.usage.inputTokens} · 출력 {r.usage.outputTokens}</div>}
                </td>
                <td>{fmtDate(r.createdAt)}</td>
                <td className="small">{r.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">버전이 없습니다.</p>
      )}
    </section>
  );
}
