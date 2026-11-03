import { CategorySelect } from "../CategorySelect";
import { CardCarousel } from "../CardCarousel";
import { CardCopyEditor, type CardCopyResponse } from "../CardCopyEditor";
import { DeliveryActions } from "../DeliveryActions";
import "../contentWorkspace.css";
import type { CardCarousel as CarouselData } from "@shared/carousel";
import { aiProviders, aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { AiUsageGuide } from "../AiUsageGuide";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../toast";
import { DiscoveryNote } from "../discovery";
import { TemplatePicker, useTemplates } from "./Design";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { api, ApiError } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { Badge, ErrorBox, fmtDate, GuardedLink, Loading, StatusBadge } from "../ui";
import { cleanPayload, FIELD_LABEL, PayloadEditor } from "./editors";
import { CONTENT_KIND_LABEL, type ContentKind } from "@shared/domain";
import { studioKey } from "@shared/channelKeys";
import type { Approval, ContentItem, ContentRevision, Delivery, SourceDocument } from "@shared/schema";
import { SourceTextEditor } from "../SourceTextEditor";
import { ChatGptLaunch } from "../ChatGptLaunch";
import { itemChatGptPrompt } from "@shared/chatgptLink";
import { readIdea } from "@shared/ideaBank";
import { IdeaDetail } from "./IdeaDetail";
import { collectionUsesArt } from "@shared/cardDesigns";
import { sourceRecovery } from "@shared/sourceRecovery";
import type { PublicationReadiness } from "@shared/publicationReadiness";
import { deliveryState, deliverySummary, PublicationRuntimeNotice, usePublicationRuntime, type PublicationRuntime } from "../publicationStatus";
import { usePublicationDraft, type PublicationDraft } from "../usePublicationDraft";
import { usePublicationRequestId } from "../usePublicationRequestId";
import { useGenerationRequest } from "../useGenerationRequest";

type Detail = {
  imageAiAvailable?: boolean;
  publicationReadiness?: PublicationReadiness;
  publicationDraft?: PublicationDraft;
  canonicalStudioCardId?: number | null;
  item: ContentItem;
  primary: SourceDocument | null;
  linked: Array<{ link: { role: string }; doc: SourceDocument }>;
  revisions: Array<Pick<ContentRevision, "id" | "revisionNo" | "author" | "model" | "promptVersion" | "note"> & { createdAt: string; usage: { inputTokens: number; outputTokens: number } | null }>;
  current: (ContentRevision & { payload: Record<string, any> }) | null;
  cards: Array<{ id: number; revisionId: number; sha256: string; createdAt: string; cloudinaryUrl: string | null; source?: string; templateKey?: string | null; carousel?: CarouselData | null }>;
  approvals: Approval[];
  deliveries: Array<{ d: Delivery; dest: { label: string; platform: string } }>;
  similar: Array<{ id: number; title: string; reviewStatus: string }>;
  defaultCaptions: { instagram: string; telegram: string } | null;
};

const SRC_KIND: Record<string, string> = { naver_news: "네이버 뉴스(언론 기사)", naver_blog: "네이버 블로그", google_news_rss: "Google 뉴스 RSS", rss_direct: "언론사 직접 RSS", official: "공식 게시물", manual: "직접 추가 자료", manual_text: "직접 붙여넣은 본문 · 내용 확인 필요" };
type ItemTab = "source" | "edit" | "publish" | "delivery" | "history";
const entryTab = (search: string): ItemTab => {
  const value = new URLSearchParams(search).get("tab");
  return value && ["source", "edit", "publish", "delivery", "history"].includes(value) ? value as ItemTab : "publish";
};

export function ItemDetailPage({ cid: requestedCid, id, fromStudio = false }: { cid: number; id: number; fromStudio?: boolean }) {
  const { allChannels } = useChannel();
  const q = useQuery({ queryKey: ["ch", requestedCid, "item", id], queryFn: () => api<Detail>(`/channels/${requestedCid}/items/${id}`), refetchInterval: query => query.state.data?.deliveries.some(({ d }) => ["scheduled", "processing"].includes(d.status)) ? 5000 : false });
  const runtime = usePublicationRuntime();
  const cid = q.data?.item.channelId ?? requestedCid;
  const sourceChannel = allChannels.find(ch => ch.id === cid);
  const search = useSearch();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(() => entryTab(search) === "delivery");
  const [templateChoice, setTemplateChoice] = useState<string | null>(null);
  const [sourceDraftDirty, setSourceDraftDirty] = useState(false);
  const [sourceTextDirty, setSourceTextDirty] = useState(false);
  const [, navigate] = useLocation();
  useEffect(() => {
    const target = entryTab(search);
    setSourceOpen(target === "source" || target === "edit");
    setDeliveryOpen(target === "delivery");
    if (target === "delivery") window.setTimeout(() => document.getElementById("delivery-panel")?.scrollIntoView({ block: "start" }), 100);
  }, [requestedCid, id, search]);
  useEffect(() => { setTemplateChoice(null); }, [requestedCid, id]);
  useEffect(() => { if (q.data && q.data.item.channelId !== requestedCid) navigate(`/items/${q.data.item.channelId}/${id}${search ? `?${search}` : ""}`, { replace: true }); }, [q.data?.item.channelId, requestedCid, id, search, navigate]);
  useEffect(() => {
    if (!fromStudio && q.data?.item.origin === "studio" && q.data.canonicalStudioCardId) navigate(`/studio/${q.data.canonicalStudioCardId}`, { replace: true });
  }, [fromStudio, q.data?.item.origin, q.data?.canonicalStudioCardId, navigate]);
  const guard = useDirtyGuard();
  const qc = useQueryClient();
  const categorize = useMutation({
    mutationFn: (subcategory: string) => api(`/channels/${cid}/items/${id}/subcategory`, { method: "PATCH", body: { version: q.data!.item.version, subcategory: subcategory || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ch"] }); qc.invalidateQueries({ queryKey: ["collection"] }); },
  });
  if (q.isLoading) return <Loading lines={5} />;
  // A failed background refresh must never unmount the editor or lose typed copy.
  if (!q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const idea = readIdea(d.item.edited);
  if (d.item.origin === "idea" && idea && sourceChannel) return <IdeaDetail item={d.item} idea={idea} channel={sourceChannel.slug} />;
  const go = (t: ItemTab, anchor: string) => {
    if (t === "source" || t === "edit") setSourceOpen(true);
    if (t === "delivery") setDeliveryOpen(true);
    window.setTimeout(() => {
      const node = document.getElementById(anchor);
      for (let parent = node?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (node instanceof HTMLDetailsElement) node.open = true;
      node?.scrollIntoView({ behavior: "smooth", block: "start" }); node?.focus({ preventScroll: true });
    }, 30);
  };
  return (
    <div className="content-workspace">
      <div className="page-head content-workspace-heading">
        <div style={{ minWidth: 0 }}>
          <GuardedLink href={fromStudio ? "/" : "/inbox"} className="small">
            ← {fromStudio ? "내 콘텐츠" : "수집함"}
          </GuardedLink>
          <h1 style={{ overflowWrap: "anywhere" }}>{d.item.title}</h1>
          <div className="row">
            {d.item.isSample && <Badge kind="sample">샘플 모드 · 실제 정보 아님</Badge>}
            <Badge>{CONTENT_KIND_LABEL[d.item.kind as ContentKind]}</Badge>
            <span className="small muted">{sourceChannel?.name} · 원고 {d.current ? `r${d.current.revisionNo}` : "아직 없음"}</span>
            <StatusBadge type="review" value={d.item.reviewStatus} />
            {d.item.publishStatus !== "waiting" && <StatusBadge type="publish" value={d.item.publishStatus} />}
            {d.item.excluded && <Badge kind="err">제외됨: {d.item.excludedReason}</Badge>}
          </div>
        </div>
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      <nav className="content-workspace-nav" aria-label="현재 콘텐츠 작업">
        <button className="btn sm" onClick={() => go("publish", "card-panel")} disabled={!d.current}>카드 편집</button>
        <button className="btn sm" onClick={() => go("source", "source-panel")}>자료·초안</button>
        <button className="btn sm" onClick={() => go("publish", "publish-options")} disabled={!d.current}>게시 준비</button>
        <button className="btn sm" onClick={() => go("delivery", "delivery-panel")}>전송 상태</button>
      </nav>
      <details className="content-drawer" open={sourceOpen || !d.current} onToggle={event => setSourceOpen(event.currentTarget.open)}>
        <summary><strong>자료·초안</strong><span>{sourceDraftDirty || sourceTextDirty ? "저장하지 않은 변경" : d.primary?.fetchStatus === "ok" ? "본문 확보됨" : d.primary?.fetchStatus === "not_fetched" ? "본문 불러오기" : d.primary ? "본문 확인 필요" : "직접 작성"}</span></summary>
        <div className="content-drawer-body stack">
          <CategorySelect channel={sourceChannel?.slug ?? ""} value={d.item.subcategory ?? ""} onChange={v => guard.confirmLeave(() => categorize.mutate(v))} disabled={categorize.isPending} />
          {categorize.error && <ErrorBox error={categorize.error} />}
          <DiscoveryNote info={d.item.discovery} />
          <SourcePanel key={d.item.id} d={d} cid={cid} onDirtyChange={setSourceTextDirty} />
          <EditPanel key={`${cid}-${d.item.id}`} d={d} cid={cid} templateKey={templateChoice} onTemplateChange={setTemplateChoice} onDirtyChange={setSourceDraftDirty} />
        </div>
      </details>
      <CardApprovePanel d={d} cid={cid} sourceDirty={sourceDraftDirty || sourceTextDirty} templateChoice={templateChoice} onTemplateChange={setTemplateChoice} onApproved={() => go("delivery", "delivery-panel")} runtime={runtime.data} />
      <details className="content-drawer" open={deliveryOpen} onToggle={event => setDeliveryOpen(event.currentTarget.open)}>
        <summary><strong>전송 내역</strong><span>{d.deliveries.length ? `${d.deliveries.length}건 · 예약 취소·재전송` : "승인 후 상태 확인"}</span></summary>
        <ItemDeliveryPanel d={d} cid={cid} runtime={runtime.data} runtimeError={runtime.error} refresh={() => { q.refetch(); runtime.refetch(); }} refreshing={q.isFetching || runtime.isFetching} />
      </details>
      <details className="content-drawer"><summary><strong>버전 기록</strong><span>{d.revisions.length}개</span></summary><HistoryPanel d={d} /></details>
    </div>
  );
}

/* ───────────── 원문·근거 ───────────── */
function SourcePanel({ d, cid, onDirtyChange }: { d: Detail; cid: number; onDirtyChange?: (dirty: boolean) => void }) {
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
  const attempted = useRef<number | null>(null);
  useEffect(() => {
    if (!p || p.fetchStatus !== "not_fetched" || p.isSample || attempted.current === p.id) return;
    attempted.current = p.id;
    refetch.mutate();
  }, [p?.id, p?.fetchStatus]);
  const recovery = p ? sourceRecovery(p) : null;
  const sourceUrl = p && typeof p.meta.finalUrl === "string" && /^https?:\/\//.test(p.meta.finalUrl) ? p.meta.finalUrl : p?.originalUrl;
  const evidence: Array<{ field: string; source_id: number; quote: string }> = d.current?.payload?.evidence ?? [];
  const pastedQuotes = p?.kind === "manual_text" && Array.isArray(p.meta.quotes) ? p.meta.quotes.filter((q): q is string => typeof q === "string") : [];
  return (
    <div className="stack" id="source-panel" tabIndex={-1}>
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
              <span>{p.kind === "manual_text" ? `직접 저장 ${fmtDate(String(p.meta.savedAt ?? ""))}` : `확인 ${fmtDate(p.lastFetchedAt as unknown as string)}`}</span>
            </div>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>
              {p.title || p.originalUrl}
            </a>
            {["naver_news", "google_news_rss", "rss_direct"].includes(p.kind) && <p className="small muted">언론 기사입니다. 학교·기관의 공식 공고와 다를 수 있으니 공식 원문을 함께 확인하세요.</p>}
            {p.snippet && <div className="quote">{p.snippet}</div>}
            <div className="row">
              <Badge kind={p.fetchStatus === "ok" ? "ok" : p.fetchStatus === "not_fetched" ? "" : "err"}>
                {p.kind === "manual_text" ? "본문 직접 저장됨" : `원문 확보: ${{ ok: "성공", not_fetched: "아직 안 함", failed: "실패", unsupported: "지원 안 되는 형식", blocked: "차단됨" }[p.fetchStatus] ?? p.fetchStatus}`}
              </Badge>
              {p.kind !== "manual_text" && <button className="btn sm" onClick={() => refetch.mutate()} disabled={refetch.isPending}>
                {refetch.isPending ? "본문 불러오는 중…" : p.fetchStatus === "not_fetched" ? "본문 불러오기" : "본문 다시 불러오기"}
              </button>}
            </div>
            {refetch.isPending && <p className="notice small" role="status">선택한 자료의 원문을 불러오고 있어요. 다른 항목의 본문은 요청하지 않습니다.</p>}
            {!refetch.isPending && recovery && p.fetchStatus !== "ok" && <div className="notice warn small" data-testid="source-recovery">
              <strong>{recovery.label}</strong><p>{recovery.reason}</p><p>{recovery.nextStep}</p>
              <div className="row">{recovery.links.map(link => <a key={link.url} className="btn sm" href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}</div>
            </div>}
            {refetch.error && p.kind !== "manual_text" && <ErrorBox error={refetch.error} retry={() => refetch.mutate()} />}
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
              <details open>
                <summary>확보한 원문 텍스트 보기 ({p.fetchedText.length.toLocaleString()}자)</summary>
                <div className="source-text">{p.fetchedText}</div>
              </details>
            )}
          </>
        )}
        <SourceTextEditor key={d.item.id} cid={cid} itemId={d.item.id} version={d.item.version} source={p} onDirtyChange={onDirtyChange} />
      </section>

      <section className="panel stack">
        <h2>근거 구절</h2>
        <p className="small muted">본문 발췌와 자동 추출값의 근거를 표시합니다. 직접 저장한 구절은 본문과 일치하는지 확인하며, 사실 여부나 신청 가능 여부를 자동 확정하지 않습니다.</p>
        {!!pastedQuotes.length && <ul className="list">{pastedQuotes.map((quote, i) => <li key={i} className="stack" style={{ gap: 4 }}><span className="small muted">직접 저장한 본문 발췌 · 자료 #{p!.id}</span><div className="quote">{quote}</div></li>)}</ul>}
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
          !pastedQuotes.length && <p className="muted small">아직 근거 구절이 없습니다. 위에서 본문을 붙여넣고 구절을 선택해 저장할 수 있습니다.</p>
        )}
      </section>

      <section className="panel stack">
        <h2>함께 연결된 자료</h2>
        {d.linked.some(({ link }) => link.role !== "manual_primary") ? (
          <ul className="small">
            {d.linked.filter(({ link }) => link.role !== "manual_primary").map(({ link, doc }) => (
              <li key={doc.id}>
                <Badge kind={link.role === "official" ? "ok" : ""}>{link.role === "official" ? "공식" : link.role === "previous_manual" ? "이전 붙여넣기" : "보조"}</Badge>{" "}
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
function sourceFields(payload: Record<string, any> | null | undefined) {
  if (!payload) return null;
  const { cardCopy: _cardCopy, ...fields } = payload;
  return fields;
}

export function EditPanel({ d, cid, templateKey, onTemplateChange, onDirtyChange }: { d: Detail; cid: number; templateKey?: string | null; onTemplateChange?: (key: string) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const incoming = useMemo(() => sourceFields(d.current?.payload), [d.current]);
  const [base, setBase] = useState<Record<string, any> | null>(incoming);
  const submittedDraft = useRef<Record<string, any> | null>(null);
  const [draft, setDraft] = useState<Record<string, any> | null>(base);
  const [version, setVersion] = useState(d.item.version);
  const [conflictMsg, setConflict] = useState<string | null>(null);
  const [mergeConflict, setMergeConflict] = useState<{ server: Record<string, any>; merged: Record<string, any>; version: number; fields: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => {
    // Compare edits with the accepted baseline, never with the newly arrived AI payload.
    if (!dirty && d.item.version >= version) {
      setBase(incoming);
      setDraft(incoming);
      setVersion(d.item.version);
    }
  }, [incoming, d.item.version, dirty, version]);

  const save = useMutation({
    mutationFn: () => {
      submittedDraft.current = draft;
      return api<ContentItem>(`/channels/${cid}/items/${d.item.id}`, { method: "PATCH", body: { version, payload: cleanPayload(draft!), title: (draft?.title || draft?.key_question || d.item.title).toString().slice(0, 200) } });
    },
    onSuccess: async (it) => {
      setBase(submittedDraft.current); // Do not erase edits made while saving.
      setVersion(it.version);
      setConflict(null);
      setMergeConflict(null);
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
      return JSON.stringify(draftRef.current) === JSON.stringify(submittedDraft.current);
    } catch {
      return false;
    }
  }, [save]);
  useEffect(() => {
    guard.setDirty(`item-${d.item.id}`, dirty || save.isPending, doSave, () => { setDraft(base); setConflict(null); setMergeConflict(null); });
    if (dirty) setSaved(false);
    return () => guard.setDirty(`item-${d.item.id}`, false);
  }, [dirty, save.isPending, doSave, guard, d.item.id, base]);
  useEffect(() => { onDirtyChange?.(dirty || save.isPending || !!mergeConflict); }, [dirty, save.isPending, mergeConflict, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const beginDraft = useMutation({
    mutationFn: () => api(`/channels/${cid}/items/${d.item.id}/draft`, { method: "POST", body: { version: d.item.version } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
      void qc.invalidateQueries({ queryKey: ["studio"] });
    },
  });
  async function compareLatest() {
    try {
      const fresh = await api<Detail>(`/channels/${cid}/items/${d.item.id}`);
      const server = sourceFields(fresh.current?.payload);
      if (!server || !draft || !base) throw new Error("최신 초안을 확인할 수 없습니다. 입력은 유지했습니다.");
      const changed = [...new Set([...Object.keys(base), ...Object.keys(draft)])].filter(key => JSON.stringify(base[key]) !== JSON.stringify(draft[key]));
      const conflicting = changed.filter(key => JSON.stringify(base[key]) !== JSON.stringify(server[key]) && JSON.stringify(draft[key]) !== JSON.stringify(server[key]));
      const merged = { ...server };
      for (const key of changed) {
        if (key in draft) merged[key] = draft[key];
        else delete merged[key];
      }
      if (conflicting.length) {
        setMergeConflict({ server, merged, version: fresh.item.version, fields: conflicting });
        setConflict("같은 항목이 다른 곳에서도 수정됐습니다. 두 내용을 비교하고 사용할 초안을 선택해 주세요.");
      } else {
        setBase(server); setDraft(merged); setVersion(fresh.item.version); setMergeConflict(null);
        setConflict("서로 다른 필드의 변경을 합쳤습니다. 내 수정과 최신 초안을 확인한 뒤 저장해 주세요. 카드 문구는 변경하지 않습니다.");
      }
      qc.setQueryData(["ch", cid, "item", d.item.id], fresh);
    } catch (error) { setConflict((error as Error).message); }
  }

  const ai = useQuery({ queryKey: ["status"], queryFn: () => api<{ integrations: { aiProvider: AiProvider } & Record<AiProvider, boolean> }>("/status") });
  const [providerChoice, setProviderChoice] = useState<AiProvider | null>(null);
  const provider = providerChoice ?? ai.data?.integrations.aiProvider ?? "gemini";
  const templates = useTemplates(cid);
  const [localTemplate, setLocalTemplate] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const draftTemplate = templateKey ?? localTemplate ?? d.current?.payload.cardCopy?.templateKey ?? templates.data?.current ?? "builtin:classic";
  const sourceReady = !d.primary || (d.primary.fetchStatus === "ok" && !!d.primary.fetchedText?.trim());
  const generation = useGenerationRequest(cid, d.item.id, "draft");
  const gen = useMutation({
    mutationFn: () => generation.run(`/channels/${cid}/items/${d.item.id}/generate`, { version: d.item.version, provider, templateKey: draftTemplate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", cid] }),
  });

  return (
    <section className="panel stack" id="edit-panel" tabIndex={-1}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>초안 작성</h2>
      </div>
      <details className="studio-more" open><summary>API 자동 작성 · Gemini·GPT</summary>
        <label className="field">작성 AI<select value={provider} disabled={gen.isPending || generation.unresolved} onChange={e => setProviderChoice(e.target.value as AiProvider)}>{aiProviders.map(p => <option key={p} value={p}>{aiProviderLabels[p]}</option>)}</select></label>
        <button className="btn sm" disabled={gen.isPending} aria-expanded={showTemplates} onClick={() => setShowTemplates(value => !value)}>문구를 작성할 템플릿: {templates.data?.items.find(t => t.key === draftTemplate || t.colors?.some(color => color.key === draftTemplate))?.name ?? "기본"} ▾</button>
        {showTemplates && templates.data && <TemplatePicker cid={cid} value={draftTemplate} items={templates.data.items} disabled={gen.isPending} onChange={key => { setLocalTemplate(key); onTemplateChange?.(key); }} />}
        <p className="hint">원고를 요약하고 선택한 템플릿에 맞는 제목·부제·본문을 함께 작성합니다. 아래 카드 편집기에서 바로 고칠 수 있어요.</p>
        <AiUsageGuide provider={provider} />
        {ai.data?.integrations[provider] === false && <p className="notice warn small">선택한 AI의 키가 없습니다. <GuardedLink href={`/connections?service=${provider}`}>API 키 입력 →</GuardedLink></p>}
        {!sourceReady && <p className="notice small">먼저 위에서 본문을 불러오거나 직접 붙여넣어 저장해 주세요.</p>}
        <button className="btn sm" onClick={() => gen.mutate()} disabled={gen.isPending || (!generation.unresolved && (dirty || !sourceReady || !ai.data?.integrations[provider]))} title={dirty && !generation.unresolved ? "저장 후 사용할 수 있습니다" : undefined}>
          {gen.isPending ? "생성 중…" : generation.unresolved ? "기존 AI 작업 결과 확인" : d.item.kind === "notice" ? `${aiProviderLabels[provider]}로 원문 추출` : `${aiProviderLabels[provider]}로 초안 생성`}
        </button>
        {generation.unresolved && <div className="stack"><p className="small muted">같은 요청의 결과를 확인합니다. 응답이 없어도 새 유료 작업을 자동으로 시작하지 않습니다. 직접 입력은 계속할 수 있습니다.</p><div><button className="btn sm" disabled={generation.cancelling} onClick={() => void generation.cancel()}>{generation.cancelling ? "중단 확인 중…" : "AI 요청 중단"}</button></div></div>}
        {generation.cancelled && <p className="notice small" role="status">AI 요청을 중단했습니다. 기존 원고를 직접 편집하거나 새로 요청할 수 있습니다.</p>}
        {generation.cancelError && <ErrorBox error={generation.cancelError} />}
      </details>
      <details className="content-options"><summary>ChatGPT에서 초안 가져오기</summary><ChatGptLaunch prompt={itemChatGptPrompt({ title: d.item.title, kind: d.item.kind, source: d.primary ? {
        title: d.primary.title ?? d.item.title, url: d.primary.originalUrl,
        text: d.primary.fetchStatus === "ok" ? d.primary.fetchedText ?? "" : "", snippet: d.primary.snippet ?? "",
        quotes: Array.isArray(d.primary.meta.quotes) ? d.primary.meta.quotes.filter((q): q is string => typeof q === "string") : [],
      } : null })} />
      <p className="small muted">저장한 원문·근거로 초안을 요청합니다. 받은 초안은 아래 편집 칸에 옮겨 같은 화면에서 계속 작성하세요.</p></details>
      {d.current && (
        <p className="small muted">
          현재 버전 r{d.current.revisionNo} · {d.current.author === "operator" ? "운영자 편집본" : d.current.author === "llm" ? `자동 추출/초안 (${d.current.model ?? ""})` : "시스템"}
          {d.current.note ? ` · ${d.current.note}` : ""}
        </p>
      )}
      {d.item.version > version && dirty && <div className="notice warn">서버에 새 초안이 있습니다. 직접 입력한 내용은 유지했습니다. <button className="btn sm" onClick={() => guard.confirmLeave(() => { setBase(incoming); setDraft(incoming); setVersion(d.item.version); })}>새 초안 불러오기</button></div>}
      {gen.error && <ErrorBox error={gen.error} retry={generation.unresolved || (!dirty && sourceReady && !!ai.data?.integrations[provider]) ? () => gen.mutate() : undefined} />}
      {gen.isSuccess && <div className="notice ok small">새 버전을 만들었습니다. 생성 성공은 검토 완료가 아닙니다 — 내용을 확인하세요.</div>}
      {!draft ? (
        <div className="stack"><p className="muted">AI 없이도 초안을 시작할 수 있습니다. 확보한 원문을 보면서 직접 쓰거나 ChatGPT 초안을 옮겨 적으세요.</p><div><button className="btn primary" disabled={beginDraft.isPending || (gen.isPending && !generation.cancelled)} onClick={() => beginDraft.mutate()}>{beginDraft.isPending ? "초안 여는 중…" : "직접 초안 작성"}</button></div>{beginDraft.error && <ErrorBox error={beginDraft.error} />}</div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending && !mergeConflict) save.mutate();
          }}
        >
          <PayloadEditor kind={d.item.kind} value={draft} onChange={setDraft} />
          {conflictMsg && (
            <div className="notice err" role="alert">
              {conflictMsg}{" "}
              <button
                type="button"
                className="btn sm"
                disabled={save.isPending}
                onClick={() => void compareLatest()}
              >
                최신 불러오기
              </button>
            </div>
          )}
          {mergeConflict && <div className="notice warn stack"><strong>함께 수정된 항목: {mergeConflict.fields.map(key => FIELD_LABEL[key] ?? key).join(", ")}</strong><div className="card-copy-compare"><div><h4>최신 저장본</h4><pre>{JSON.stringify(mergeConflict.server, null, 2)}</pre></div><div><h4>내 변경을 합친 초안</h4><pre>{JSON.stringify(mergeConflict.merged, null, 2)}</pre></div></div><div className="row"><button type="button" className="btn sm" onClick={() => { setBase(mergeConflict.server); setDraft(mergeConflict.server); setVersion(mergeConflict.version); setMergeConflict(null); setConflict(null); }}>최신 초안 사용</button><button type="button" className="btn sm" onClick={() => { setBase(mergeConflict.server); setDraft(mergeConflict.merged); setVersion(mergeConflict.version); setMergeConflict(null); setConflict("내 변경을 합쳤습니다. 확인한 뒤 초안을 저장하세요."); }}>내 변경을 합친 초안 사용</button></div></div>}
          {save.error && !conflictMsg && <ErrorBox error={save.error} />}
          <div className="savebar">
            {saved && !dirty && <span className="small muted" role="status" style={{ marginRight: "auto" }}>저장됨 — 새 버전으로 기록했습니다.</span>}
            {dirty && <span className="small" style={{ marginRight: "auto", color: "var(--warning)" }}>저장하지 않은 변경</span>}
            <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(base)}>
              되돌리기
            </button>
            <button className="btn primary" disabled={!dirty || save.isPending || !!mergeConflict}>
              {save.isPending ? "저장 중…" : "새 버전으로 저장"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ───────────── 검토 ───────────── */
function ReviewPanel({ d, cid, pendingChanges = false }: { d: Detail; cid: number; pendingChanges?: boolean }) {
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
    <section className="panel stack" id="review-panel" tabIndex={-1}>
      <h3>내용 확인</h3>
      <p className="small muted">검토 완료는 내용 확인 표시이며, 게시에는 별도의 최종 승인이 필요합니다.</p>
      <div className="row">
        <button className="btn" disabled={pendingChanges || m.isPending || d.item.reviewStatus === "reviewed"} onClick={() => m.mutate("reviewed")}>
          {d.item.reviewStatus === "reviewed" ? "내용 검토 완료됨" : "내용 확인 · 검토 완료"}
        </button>
      </div>
      <details className="content-options"><summary>검토 상태 변경</summary><div className="row">
        <button className="btn" disabled={m.isPending || d.item.reviewStatus === "held"} onClick={() => m.mutate("held")}>
          보류
        </button>
        <button className="btn" disabled={m.isPending || d.item.reviewStatus === "pending"} onClick={() => m.mutate("pending")}>
          검토 대기로
        </button>
        <button className="btn danger" disabled={ex.isPending} onClick={() => ex.mutate(!d.item.excluded)}>
          {d.item.excluded ? "제외 해제" : "수집함에서 제외"}
        </button>
      </div></details>
      {(m.error || ex.error) && <ErrorBox error={m.error || ex.error} />}
    </section>
  );
}

/* ───────────── 카드·승인 ───────────── */
function toLocalInput(date: Date) {
  const k = new Date(date.getTime() + 9 * 3600_000).toISOString();
  return k.slice(0, 16);
}

function CardApprovePanel({ d, cid, sourceDirty = false, templateChoice, onTemplateChange, onApproved, runtime }: { d: Detail; cid: number; sourceDirty?: boolean; templateChoice?: string | null; onTemplateChange?: (key: string) => void; onApproved: () => void; runtime?: PublicationRuntime }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const toast = useToast();
  const [coverChoice, setCoverChoice] = useState<"reuse" | "ai" | "typography" | null>(null);
  const revCards = d.cards.filter((c) => c.revisionId === d.current?.id);
  const [altDirty,setAltDirty]=useState(false);
  const [copyDirty, setCopyDirty] = useState(true);
  const [pickedCard, setPickedCard] = useState<number | null>(null);
  const heldCard = useRef<Detail["cards"][number] | null>(null);
  const currentCard = altDirty && heldCard.current ? heldCard.current : revCards.find((c) => c.id === pickedCard) ?? revCards[0] ?? null;
  useEffect(() => { heldCard.current = currentCard; }, [currentCard]);
  const staleArtifact = !!currentCard && currentCard.revisionId !== d.current?.id;
  const altVersion = useQuery<{ version: number }>({ queryKey: ["card-alt", currentCard?.id], enabled: false }).data?.version;
  const publicationRequestId = usePublicationRequestId();
  const currentApprovalIds = new Set(d.approvals.filter(approval => approval.revisionId === d.current?.id).map(approval => approval.id));
  const existingDeliveryState = d.deliveries.some(({ d: delivery }) => delivery.needsReconciliation) ? "unknown" : (["unknown", "processing", "succeeded", "scheduled"] as const).find(status => d.deliveries.some(({ d: delivery }) => (status === "unknown" || status === "processing" || currentApprovalIds.has(delivery.approvalId)) && delivery.status === status));
  const existingDeliveryMessage = existingDeliveryState ? {
    scheduled: "이미 전송 예약이 있습니다. 예약 변경은 전송 상태에서 기존 예약을 취소한 뒤 다시 승인해 주세요.",
    processing: "이 콘텐츠의 전송을 처리 중입니다. 이전 버전을 포함한 전송 상태에서 결과를 확인해 주세요.",
    succeeded: "이 버전은 이미 게시됐습니다. 전송 상태에서 게시물을 확인해 주세요.",
    unknown: "이 콘텐츠의 이전 게시 여부를 먼저 확인해야 합니다. 전송 상태에서 실제 게시물을 확인해 주세요.",
  }[existingDeliveryState] : null;
  const captionDraft = usePublicationDraft(cid, d.item.id, d.publicationDraft ?? { version: 0, captions: d.defaultCaptions ?? { instagram: "", telegram: "" } });
  const caps = captionDraft.captions;
  const destinations = d.publicationReadiness?.destinations ?? [];
  const [pickedDestinations, setPickedDestinations] = useState<number[] | null>(null);
  const defaultInstagram = destinations.filter(destination => destination.platform === "instagram" && destination.configured);
  const destinationIds = (pickedDestinations ?? (defaultInstagram.length === 1 ? [defaultInstagram[0].id] : [])).filter(id => destinations.some(destination => destination.id === id && destination.configured));
  const destinationsKey = destinationIds.join(",");
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [timing, setTiming] = useState<"now" | "later">("now");
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const tpls = useTemplates(cid);
  const [tpl, setTpl] = useState<string | null>(null);
  const templateKey = templateChoice ?? tpl ?? currentCard?.templateKey ?? tpls.data?.current ?? "builtin:classic";
  const chooseTemplate = (key: string) => { setTpl(key); onTemplateChange?.(key); };
  const typographyOnly = templateKey.startsWith("set:") && !collectionUsesArt(templateKey.slice(4));
  const coverMode = typographyOnly ? "typography" : coverChoice ?? (d.cards.length ? "reuse" : "typography");
  const [showTpl, setShowTpl] = useState(false);
  const canva = useQuery({ queryKey: ["canva-status"], queryFn: () => api<{ connected: boolean }>("/canva/status") });
  const { channels } = useChannel();
  const ch = channels.find((c) => c.id === cid);
  useEffect(() => {
    setPickedCard(null);
  }, [d.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const render = useMutation({
    mutationFn: (saved: CardCopyResponse) => api<{ id: number; carousel: CarouselData; studioCardId: number }>(`/channels/${cid}/items/${d.item.id}/card`, { method: "POST", body: { version: saved.version, templateKey: saved.copy.templateKey, coverMode } }),
    onSuccess: (a) => {
      setPickedCard(a.id);
      toast("ok", `${a.carousel.pages.length}장에 수정 내용을 반영했습니다. 아래에서 게시할 글과 시점을 확인하세요.`);
      setPublishOpen(true);
      setConfirmed(false);
      window.setTimeout(() => document.getElementById("publish-options")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      qc.invalidateQueries({ queryKey: ["studio"] });
      qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
    },
  });
  const canvaMake = useMutation({
    mutationFn: () => api<{ editUrl: string | null; usedFields: string[]; unusedTemplateFields: string[] }>(`/channels/${cid}/items/${d.item.id}/canva`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      toast("ok", `Canva 디자인을 만들었습니다(채운 칸: ${r.usedFields.join(", ")}).`);
      qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const canvaImport = useMutation({
    mutationFn: () => api<{ assetId: number; aspectWarning: string | null }>(`/channels/${cid}/items/${d.item.id}/canva/import`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      setPickedCard(r.assetId);
      toast(r.aspectWarning ? "info" : "ok", r.aspectWarning ?? "Canva 디자인을 카드로 가져왔습니다.");
      qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const approve = useMutation({
    mutationFn: () => {
      if (sourceDirty || copyDirty || altDirty || staleArtifact || captionDraft.needsSave || captionDraft.saving || captionDraft.conflict || !destinationIds.length || !confirmed) throw new Error("변경 내용을 저장하고 이미지·캡션·게시 계정을 다시 확인해 주세요.");
      const intent = { revisionId: d.current!.id, mediaAssetId: currentCard!.id, altTextVersion: altVersion, publicationDraftVersion: captionDraft.version, captions: caps, destinationIds: [...destinationIds].sort((a, b) => a - b), timing, ...(timing === "later" ? { scheduledAt: `${when}:00+09:00` } : {}) };
      return api<{ destinations: number }>(`/channels/${cid}/items/${d.item.id}/approve`, {
        method: "POST",
        body: { ...intent, requestId: publicationRequestId({ ...intent, cancelledApprovals: d.approvals.filter(approval => approval.status === "cancelled").map(approval => approval.id).sort((a, b) => a - b) }) },
      });
    },
    onSuccess: async (result) => {
      publicationRequestId.complete();
      toast(result.destinations === 0 ? "info" : "ok", result.destinations === 0 ? "전송할 계정을 확인해 주세요." : timing === "later" ? "예약했습니다. 전송 내역에서 취소할 수 있어요." : "바로 게시하도록 요청했습니다. 전송 내역에서 결과를 확인하세요.");
      await qc.invalidateQueries({ queryKey: ["ch", cid] });
      onApproved();
    },
  });
  const len = (s: string) => [...s].length;
  const cd = d.item.canvaDesign;
  const SRC: Record<string, string> = { builtin: "기본 템플릿", custom: "내 배경 템플릿", canva: "Canva" };
  const pendingChanges = sourceDirty || copyDirty || altDirty || staleArtifact || captionDraft.needsSave || captionDraft.saving || !!captionDraft.conflict || len(caps.instagram) > 2200 || len(caps.telegram) > 1024;
  useEffect(() => { setConfirmed(false); }, [currentCard?.id, d.current?.id, caps, timing, when, copyDirty, altDirty, altVersion, sourceDirty, captionDraft.version, destinationsKey]);
  const futureSchedule = timing === "now" || (!!when && Number.isFinite(Date.parse(`${when}:00+09:00`)) && Date.parse(`${when}:00+09:00`) > Date.now());
  return (
    <section className="stack content-card-editor" id="card-panel" tabIndex={-1}>
      {!d.current ? (
        <p className="notice">위의 자료·초안에서 본문을 확인하고 초안을 만들면 카드 편집기가 열립니다.</p>
      ) : (
        <>
          <div className="content-editor-toolbar"><h2>카드 편집</h2><span className="small muted">문구를 고치고, 디자인을 확인하세요.</span></div>
          <details className="content-options"><summary>표지·이미지 설정</summary><label className="field">표지 이미지<select value={coverMode} disabled={render.isPending || typographyOnly} onChange={e => setCoverChoice(e.target.value as "reuse" | "ai" | "typography")}><option value="reuse">저장된 표지 그림 유지</option><option value="ai" disabled={!d.imageAiAvailable}>주제에 맞는 AI 일러스트</option><option value="typography">글자 중심 · 선택한 배경 템플릿</option></select><span className="hint">{typographyOnly ? "이 디자인은 타이포그래피 전용입니다. 이미지 생성 비용 없이 만듭니다." : coverMode === "ai" ? "OpenAI 이미지 API 비용이 발생합니다. 같은 원고로 다시 만들면 저장된 표지를 재사용합니다." : coverMode === "reuse" ? "글자만 수정해도 저장된 그림을 유지합니다. 저장된 그림이 없으면 글자 중심으로 만들며 이미지 생성 비용은 발생하지 않습니다." : "이미지 생성 비용 없이 만듭니다."}</span></label>
          {!d.imageAiAvailable && !typographyOnly && <p className="small muted">AI 표지는 <GuardedLink href="/connections?service=openai">OpenAI 이미지 연결</GuardedLink> 후 선택할 수 있어요.</p>}</details>
          <div className="row">
            <button className="btn" disabled={render.isPending} onClick={() => setShowTpl((v) => !v)} aria-expanded={showTpl}>
              템플릿: {tpls.data?.items.find((t) => t.key === templateKey || t.colors?.some(color => color.key === templateKey))?.name ?? "기본"} ▾
            </button>
            {currentCard && (
              <a className="btn" aria-disabled={copyDirty || altDirty} tabIndex={copyDirty || altDirty ? -1 : undefined} href={copyDirty || altDirty ? undefined : `/api/channels/${cid}/media/${currentCard.id}?download=1`}>
                표지 JPEG 다운로드
              </a>
            )}
          </div>
          {showTpl && tpls.data && (
            <TemplatePicker cid={cid} value={templateKey} onChange={chooseTemplate} items={tpls.data.items} version={ch?.accentColor} disabled={render.isPending} />
          )}
          {sourceDirty && <p className="notice warn small" role="status">자료·초안에 저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 이미지를 갱신하고 게시 준비를 완료해 주세요.</p>}
          <CardCopyEditor key={`${cid}-${d.item.id}`} channelId={cid} itemId={d.item.id} itemVersion={d.item.version} templateKey={templateChoice ?? tpl} onTemplateChange={chooseTemplate} coverMode={coverMode} disabled={render.isPending || altDirty} renderDisabled={sourceDirty} onDirtyChange={setCopyDirty} onSaveAndRender={saved => render.mutateAsync(saved)} renderLabel="게시 준비" />
          {render.isPending && <p className="notice small" role="status">{coverMode === "ai" ? "표지 일러스트와 각 페이지를 만들고 있어요. 몇 분 정도 걸릴 수 있습니다." : "원고를 페이지로 나누고 보드에 저장하고 있어요."}</p>}
          {render.error && <ErrorBox error={render.error} />}
          {render.data && <p className="small muted" role="status">{render.data.carousel.pages.length}장 이미지에 수정 내용을 반영했어요.</p>}

          {canva.data?.connected && (
            <details className="content-options"><summary>Canva로 작업하기</summary><div className="stack">
              <span className="small muted">Canva 자동 채우기에는 ‘초안 편집’의 원문 요약 필드를 사용합니다.</span>
              {!ch?.canvaBrandTemplateId ? (
                <span className="small muted">
                  <GuardedLink href="/design">카드 디자인</GuardedLink>에서 Canva 브랜드 템플릿을 먼저 고르세요.
                </span>
              ) : (
                <div className="row">
                  <button className="btn sm" onClick={() => canvaMake.mutate()} disabled={canvaMake.isPending || copyDirty}>
                    {canvaMake.isPending ? "Canva에서 만드는 중…" : cd && cd.revisionId === d.current.id ? "Canva 디자인 다시 만들기" : "Canva로 디자인 만들기"}
                  </button>
                  {cd?.editUrl && cd.revisionId === d.current.id && (
                    <>
                      <a className="btn sm" href={cd.editUrl} target="_blank" rel="noopener noreferrer">
                        Canva에서 열기 ↗
                      </a>
                      <button className="btn sm primary" onClick={() => canvaImport.mutate()} disabled={canvaImport.isPending || copyDirty}>
                        {canvaImport.isPending ? "가져오는 중…" : "다듬은 디자인을 카드로 가져오기"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {cd && cd.revisionId !== d.current.id && <span className="small" style={{ color: "var(--warning)" }}>내용이 바뀌어 이전 Canva 디자인은 쓸 수 없습니다. 다시 만드세요.</span>}
            </div></details>
          )}

          <details className="content-drawer publish-drawer" id="publish-options" open={publishOpen} onToggle={event => setPublishOpen(event.currentTarget.open)}><summary><strong>게시 준비</strong><span>캡션 · 지금 게시 · 예약</span></summary><div className="content-drawer-body stack">
          <fieldset className="publication-destinations stack"><legend>게시 계정</legend>{destinations.map(destination => <label className="check" key={destination.id}><input type="checkbox" checked={destinationIds.includes(destination.id)} disabled={!destination.configured || approve.isPending} onChange={event => setPickedDestinations(event.target.checked ? [...destinationIds, destination.id] : destinationIds.filter(id => id !== destination.id))} /><span>{destination.label} · {destination.platform === "instagram" ? "Instagram" : destination.platform === "telegram" ? "Telegram" : destination.platform}{!destination.configured && " · 연결 확인 필요"}</span></label>)}{!destinations.length && <p className="notice warn small">연결한 게시 계정이 없습니다. <GuardedLink href="/instagram">게시 계정 연결</GuardedLink></p>}<p className="small muted">선택한 {destinationIds.length}개 계정에만 전송합니다. {destinations.filter(destination => destinationIds.includes(destination.id)).map(destination => destination.label).join(", ")}</p></fieldset>
          {revCards.length > 1 && (
            <div className="row" role="group" aria-label="승인할 카드 고르기">
              {revCards.map((c, i) => (
                <button key={c.id} className="tpl" style={{ width: 96, padding: 4 }} aria-pressed={currentCard?.id === c.id} onClick={() => { if (currentCard?.id !== c.id) guard.confirmLeave(() => setPickedCard(c.id), currentCard ? [`card-alt-${currentCard.id}`] : []); }}>
                  <img src={`/api/channels/${cid}/media/${c.id}`} alt={`카드 후보 ${i + 1}`} />
                  <span className="tpl-desc">{SRC[c.source ?? "builtin"] ?? c.source}</span>
                </button>
              ))}
            </div>
          )}
          {!currentCard && <p className="small muted">현재 버전(r{d.current.revisionNo})으로 만든 카드가 없습니다.</p>}
          {currentCard && <p className="small muted">게시 이미지: {staleArtifact ? "이전 원고" : `원고 r${d.current.revisionNo}`} · 이미지 #{currentCard.id}{copyDirty || sourceDirty || staleArtifact ? " · 수정 내용을 저장하고 이미지를 다시 만들어야 합니다" : " · 저장된 원고 반영"}</p>}
          {staleArtifact && <div className="notice warn small">원고가 다른 곳에서 변경됐습니다. 이전 이미지에 입력한 설명을 보존했습니다. <button className="btn sm" onClick={() => guard.confirmLeave(() => { heldCard.current = null; setAltDirty(false); setPickedCard(null); }, [`card-alt-${currentCard!.id}`])}>설명 정리 후 최신 이미지 보기</button></div>}

          {currentCard && <CardCarousel key={currentCard.id} channelId={cid} assetId={currentCard.id} pages={currentCard.carousel?.pages ?? [{ id: currentCard.id, title: d.item.title }]} credit={currentCard.carousel?.cover.credit} onDirtyChange={setAltDirty} downloadDisabled={copyDirty || staleArtifact} />}
          <details className="content-options"><summary>외부 편집 도구로 문구 복사</summary><CopyFields cid={cid} itemId={d.item.id} revisionId={d.current.id} /></details>

          <h3 style={{ margin: "8px 0 0" }}>게시물 캡션 (카드 이미지 밖의 글)</h3>
          <label className="field">
            인스타그램 캡션
            <span className="hint">
              {len(caps.instagram)} / 2200자 · 인스타그램 캡션의 URL은 클릭되는 링크가 아닙니다.
            </span>
            <textarea rows={8} value={caps.instagram} aria-label="인스타그램 캡션" onChange={(e) => captionDraft.setCaptions({ ...caps, instagram: e.target.value })} />
          </label>
          {currentCard && (
            <details>
              <summary className="small">인스타그램에서 보이는 모습 미리보기</summary>
              <div className="ig-preview">
                <div className="ig-head">
                  <span className="ig-avatar" style={{ background: ch?.accentColor }} aria-hidden />
                  {ch?.name.replace(/\s+/g, "") ?? "우주펭귄상회"}
                </div>
                <img src={`/api/channels/${cid}/media/${currentCard.id}`} alt="" />
                <div className="ig-cap">{caps.instagram}</div>
              </div>
            </details>
          )}
          <details className="content-options"><summary>텔레그램 캡션</summary><label className="field">
            텔레그램 캡션
            <span className="hint">{len(caps.telegram)} / 1024자 (사진 캡션 제한)</span>
            <textarea rows={6} value={caps.telegram} aria-label="텔레그램 캡션" onChange={(e) => captionDraft.setCaptions({ ...caps, telegram: e.target.value })} />
          </label>
          </details>
          <div className="row publication-draft-save"><span className="small" role="status">{captionDraft.saving ? "캡션 저장 중…" : captionDraft.conflict ? "캡션 저장 충돌 · 입력 유지됨" : captionDraft.error ? "캡션 저장 실패 · 입력 유지됨" : captionDraft.needsSave ? "캡션을 저장해 주세요" : `캡션 저장됨 · v${captionDraft.version}`}</span><button className="btn" disabled={captionDraft.saving || !captionDraft.needsSave || !!captionDraft.conflict || len(caps.instagram) > 2200 || len(caps.telegram) > 1024} onClick={() => { void captionDraft.save().catch(() => {}); }}>캡션 저장</button></div>
          {(len(caps.instagram) > 2200 || len(caps.telegram) > 1024) && <p className="notice warn small">캡션 글자 수를 줄인 뒤 저장해 주세요.</p>}
          {captionDraft.error && <ErrorBox error={captionDraft.error} />}
          {captionDraft.conflict && <div className="notice warn stack"><strong>다른 곳에서 저장한 캡션이 있습니다. 내 입력은 유지했습니다.</strong><details><summary>최신 캡션과 비교</summary><div className="card-copy-compare"><div><h4>최신 저장본</h4><pre>{captionDraft.conflict.captions.instagram}</pre><pre>{captionDraft.conflict.captions.telegram}</pre></div><div><h4>내 입력</h4><pre>{caps.instagram}</pre><pre>{caps.telegram}</pre></div></div><div className="row"><button className="btn sm" disabled={captionDraft.saving} onClick={captionDraft.acceptServer}>최신 캡션 사용</button><button className="btn sm" disabled={captionDraft.saving} onClick={() => { void captionDraft.saveMine().catch(() => {}); }}>내 캡션으로 다시 저장</button></div></details></div>}
          <fieldset className="publish-timing"><legend>언제 게시할까요?</legend><div className="row">
            <label className={`publish-timing-option ${timing === "now" ? "selected" : ""}`}><input type="radio" name={`publish-timing-${d.item.id}`} checked={timing === "now"} onChange={() => setTiming("now")} /><span><strong>지금 게시</strong><small>승인하면 바로 전송 요청</small></span></label>
            <label className={`publish-timing-option ${timing === "later" ? "selected" : ""}`}><input type="radio" name={`publish-timing-${d.item.id}`} checked={timing === "later"} onChange={() => setTiming("later")} /><span><strong>예약 게시</strong><small>원하는 날짜·시간 선택</small></span></label>
          </div></fieldset>
          {timing === "later" && <label className="field">예약 시각 (한국 시간)<input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={e => setWhen(e.target.value)} /><span className="hint">전송 시작 전에는 취소할 수 있습니다. 예약 시각 이후 처리되며 서버 휴면·재시작 시 지연될 수 있습니다. 발행함에서 실제 결과를 확인하세요.</span>{!futureSchedule && <span className="card-copy-error">현재보다 뒤의 시간을 선택해 주세요.</span>}</label>}
          <ReviewPanel d={d} cid={cid} pendingChanges={pendingChanges} />
          <PublicationRuntimeNotice runtime={runtime} />
          {d.publicationReadiness && !d.publicationReadiness.ready && <div className="notice warn" role="alert"><strong>게시 전에 확인할 항목</strong><ul>{d.publicationReadiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><div className="row"><GuardedLink href="/instagram">인스타그램 연결 확인 →</GuardedLink><GuardedLink href="/connections">API 연결 확인 →</GuardedLink></div></div>}
          {existingDeliveryMessage && <div className="notice warn"><p className="small">{existingDeliveryMessage}</p><button className="btn sm" onClick={onApproved}>전송 상태 확인</button></div>}
          {pendingChanges && <p className="notice warn small" role="status">저장하지 않은 변경을 먼저 저장해 주세요. 초안·카드 문구를 바꿨다면 게시 이미지도 다시 준비해야 합니다.</p>}
          <label className="check publish-confirm"><input type="checkbox" checked={confirmed} disabled={approve.isPending || !currentCard || pendingChanges || !destinationIds.length} onChange={event => setConfirmed(event.target.checked)} />이미지 전체·저장된 캡션·선택한 게시 계정을 확인했습니다.</label>
          <div className="row">
            <button className="btn primary" onClick={() => approve.mutate()} disabled={approve.isPending || !confirmed || !futureSchedule || pendingChanges || !destinationIds.length || !currentCard || d.item.reviewStatus !== "reviewed" || d.publicationReadiness?.ready === false || !!existingDeliveryState}>
              {approve.isPending ? "전송 요청 중…" : timing === "later" ? "승인하고 예약 게시" : "승인하고 지금 게시"}
            </button>
          </div>
          {d.item.reviewStatus !== "reviewed" && <p className="small muted">먼저 ‘검토 완료’로 표시해야 최종 승인할 수 있습니다.</p>}
          {approve.error && <ErrorBox error={approve.error} />}
          </div></details>
        </>
      )}
    </section>
  );
}

function ItemDeliveryPanel({ d, cid, runtime, runtimeError, refresh, refreshing }: { d: Detail; cid: number; runtime?: PublicationRuntime; runtimeError?: unknown; refresh: () => void; refreshing: boolean }) {
  const qc = useQueryClient();
  return <section className="panel stack" id="delivery-panel" tabIndex={-1} aria-label="전송 상태">
    <div className="row between"><h2 style={{ margin: 0 }}>전송 상태</h2><button className="btn sm" onClick={refresh} disabled={refreshing}>{refreshing ? "상태 확인 중…" : "상태 새로고침"}</button></div>
    <p className="small muted">승인은 이미지·캡션·예약을 저장한 기록입니다. 실제 게시 결과는 아래 목적지별 전송 상태에서 확인하세요. 대기·처리 중인 건은 자동으로 갱신됩니다.</p>
    <PublicationRuntimeNotice runtime={runtime} error={runtimeError} retry={refresh} />
    {d.publicationReadiness && !d.publicationReadiness.ready && <div className="notice warn"><strong>현재 전송 준비 상태</strong><ul>{d.publicationReadiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><GuardedLink href="/instagram">인스타그램 연결 확인 →</GuardedLink></div>}
    {!d.approvals.length ? <div className="notice">아직 승인·전송 기록이 없습니다. 카드와 캡션을 확인하고 최종 승인하면 여기에 기록됩니다.</div> : <ul className="list" aria-live="polite">
      {d.approvals.map(a => {
        const deliveries = d.deliveries.filter(({ d: delivery }) => delivery.approvalId === a.id);
        return <li key={a.id} className="list-item stack">
          <div className="row between"><strong className="small">승인 #{a.id} · r{d.revisions.find(r => r.id === a.revisionId)?.revisionNo ?? "?"}</strong><Badge kind={a.status === "completed" ? "ok" : ""}>{{ active: "승인 저장됨", invalidated: "승인 무효 · 재승인 필요", cancelled: "승인 취소됨", completed: "전송 완료된 승인" }[a.status] ?? a.status}</Badge></div>
          <span className="small muted">예약 {fmtDate(a.scheduledAt as unknown as string)} (한국 시간)</span>
          {!!deliveries.length && <p className="small" role="status">{deliverySummary(deliveries.map(row => row.d))}</p>}
          {a.invalidatedReason && <p className="small muted">{a.invalidatedReason}</p>}
          {!deliveries.length && (a.status === "active" ? <div className="notice warn"><strong>전송 예약이 없습니다</strong><p className="small">승인 기록에 연결된 전송 건이 없습니다. 게시 계정·목적지를 확인한 뒤 위의 게시 준비에서 다시 승인해 주세요.</p><GuardedLink href="/instagram">게시 계정 연결 확인 →</GuardedLink></div> : <p className="small muted">이전 승인에 연결된 전송 내역이 없습니다.</p>)}
          {deliveries.map(({ d: delivery, dest }) => {
            const state = deliveryState(delivery.status, a.scheduledAt, Date.now(), delivery.outcomeSource);
            return <div key={delivery.id} className={`notice ${state.tone}`}>
              <div className="row between"><strong>{dest.label}</strong><Badge kind={state.tone}>{state.label}</Badge></div>
              <p className="small">{state.detail}</p>
              {delivery.lastError && <p className="small" role={delivery.status === "failed" ? "alert" : undefined}><strong>처리 사유: </strong>{delivery.lastError}</p>}
              {delivery.completedAt && <p className="small muted">처리 기록 {fmtDate(delivery.completedAt as unknown as string)}</p>}
              {delivery.externalUrl && <a href={delivery.externalUrl} target="_blank" rel="noopener noreferrer">게시물 보기 ↗</a>}
              <DeliveryActions channelId={cid} approvalId={a.id} approvalStatus={a.status} delivery={delivery} contentHref={d.canonicalStudioCardId ? `/studio/${d.canonicalStudioCardId}` : `/items/${cid}/${d.item.id}?tab=publish`} canRetry={d.publicationReadiness?.ready !== false} onChanged={refresh} />
            </div>;
          })}
          {!deliveries.length && a.status === "active" && <DeliveryActions channelId={cid} approvalId={a.id} approvalStatus={a.status} onChanged={refresh} />}
        </li>;
      })}
    </ul>}
    <div className="row"><GuardedLink href="/publish">발행함 전체 보기 →</GuardedLink><GuardedLink href="/runs">실행 기록 보기 →</GuardedLink></div>
  </section>;
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
                  {r.author === "operator" ? "운영자" : r.author === "llm" ? `AI ${r.model ?? ""}` : "시스템"}
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

/* ───────────── 글자 복사(망고보드·Canva 직접 편집용) ───────────── */
function CopyFields({ cid, itemId, revisionId }: { cid: number; itemId: number; revisionId: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["ch", cid, "fields", itemId, revisionId], queryFn: () => api<{ fields: Array<{ key: string; label: string; value: string }> }>(`/channels/${cid}/items/${itemId}/fields`), enabled: open });
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("ok", `'${label}'을(를) 복사했습니다.`);
    } catch {
      toast("err", "복사하지 못했습니다. 글자를 직접 선택해 복사하세요.");
    }
  };
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="small">원문 요약 복사 — 망고보드·Canva로 옮길 때</summary>
      {q.isLoading ? (
        <Loading lines={2} />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data ? (
        <div className="copy-list">
          <div>
            <button className="btn sm" onClick={() => copy(q.data!.fields.filter((f) => f.value).map((f) => `${f.label}: ${f.value}`).join("\n"), "전체")}>
              전체 복사
            </button>
          </div>
          {q.data.fields.map((f) => (
            <div key={f.key} className="copy-row">
              <span className="k">
                {f.label}
                <br />
                <code>{f.key}</code>
              </span>
              <span className="v">{f.value || <span className="muted">(비어 있음)</span>}</span>
              <button className="btn sm" onClick={() => copy(f.value, f.label)} disabled={!f.value}>
                복사
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}
