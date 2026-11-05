import { CanvaEditorial } from "../CanvaEditorial";
import { editorialPlanSchema, familyCardCopySchema, pageDesignsSchema } from "@shared/familyDialogue";
import { CategorySelect } from "../CategorySelect";
import { CardCarousel } from "../CardCarousel";
import { CardCopyEditor, type StoredCardCopyResponse } from "../CardCopyEditor";
import { DeliveryActions } from "../DeliveryActions";
import "../contentWorkspace.css";
import type { CardCarousel as CarouselData } from "@shared/carousel";
import { aiProviders, aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { channelAiRoleLabels, channelAiRoles, legacyChannelAiSettings, type ChannelAiRuntime } from "@shared/channelAi";
import { articleAnalysisSchema, aiWorkflowSchema } from "@shared/articleAnalysis";
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
import type { Approval, Channel, ContentItem, ContentRevision, Delivery, SourceDocument } from "@shared/schema";
import { SourceTextEditor } from "../SourceTextEditor";
import { ChatGptLaunch } from "../ChatGptLaunch";
import { itemChatGptPrompt } from "@shared/chatgptLink";
import { readIdea } from "@shared/ideaBank";
import { IdeaDetail } from "./IdeaDetail";
import { collectionUsesArt } from "@shared/cardDesigns";
import { readingProfileForTemplateKey } from "@shared/readingCardProfiles";
import { sourceRecovery } from "@shared/sourceRecovery";
import type { PublicationReadiness } from "@shared/publicationReadiness";
import { deliveryState, deliverySummary, PublicationRuntimeNotice, usePublicationRuntime, type PublicationRuntime } from "../publicationStatus";
import { usePublicationDraft, type PublicationDraft } from "../usePublicationDraft";
import { usePublicationRequestId } from "../usePublicationRequestId";
import { useGenerationRequest } from "../useGenerationRequest";
import { useDraftRecovery } from "../useDraftRecovery";
import { RecoveryNotice } from "../RecoveryNotice";
import { SourceRevisionHistory } from "../SourceRevisionHistory";
import { PublicationDraftControls } from "../PublicationDraftControls";
import { compareSourceRevisions } from "@shared/sourceRevisionHistory";
import { WorkModeControl, type WorkMode } from "../WorkModeControl";

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

type SourceGenerationResult = ContentItem & { generationWarnings?: string[] };
const generationWarnings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((warning): warning is string => typeof warning === "string" && !!warning.trim()).slice(0, 8) : [];
function sourceWorkflow(d: Detail) {
  const parsed = aiWorkflowSchema.safeParse(d.current?.payload.aiWorkflow);
  return parsed.success ? parsed.data : null;
}
function incompleteCardCopy(d: Detail) {
  return !d.current?.payload.cardCopy && !!sourceWorkflow(d)?.warnings.length;
}

const SRC_KIND: Record<string, string> = { naver_web: "네이버 웹문서", opportunity_listing: "공모전·활동 사이트", naver_news: "네이버 뉴스(언론 기사)", naver_blog: "네이버 블로그", google_news_rss: "Google 뉴스 RSS", rss_direct: "언론사 직접 RSS", official: "공식 게시물", manual: "직접 추가 자료", manual_text: "직접 붙여넣은 본문 · 내용 확인 필요" };
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
  const imageGeneration = useGenerationRequest(cid, id, "card-render");
  const sourceChannel = allChannels.find(ch => ch.id === cid);
  const search = useSearch();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(() => entryTab(search) === "delivery");
  const [templateChoice, setTemplateChoice] = useState<string | null>(null);
  const [sourceDraftDirty, setSourceDraftDirty] = useState(false);
  const [sourceTextDirty, setSourceTextDirty] = useState(false);
  const [workMode, setWorkMode] = useState<WorkMode>("auto");
  useEffect(() => { if (sourceDraftDirty || sourceTextDirty) setSourceOpen(true); }, [sourceDraftDirty, sourceTextDirty]);
  const [, navigate] = useLocation();
  useEffect(() => {
    const target = entryTab(search);
    setSourceOpen(target === "source" || target === "edit");
    setDeliveryOpen(target === "delivery");
    if (target === "delivery") window.setTimeout(() => document.getElementById("delivery-panel")?.scrollIntoView({ block: "start" }), 100);
  }, [requestedCid, id, search]);
  useEffect(() => { setTemplateChoice(null); setWorkMode("auto"); }, [requestedCid, id]);
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
      <WorkModeControl mode={workMode} onChange={setWorkMode} />
      <nav className="content-workspace-nav" aria-label="현재 콘텐츠 작업">
        <button className="btn sm" onClick={() => go("publish", "card-panel")} disabled={!d.current}>카드 편집</button>
        <button className="btn sm" onClick={() => go("source", "source-panel")}>자료·초안</button>
        <button className="btn sm" onClick={() => go("publish", "publish-options")} disabled={!d.current}>게시 준비</button>
        <button className="btn sm" onClick={() => go("delivery", "delivery-panel")}>전송 상태</button>
      </nav>
      <details className="content-drawer" open={sourceOpen || !d.current} onToggle={event => { if (event.target === event.currentTarget) setSourceOpen(event.currentTarget.open); }}>
        <summary><strong>자료·초안</strong><span>{sourceDraftDirty || sourceTextDirty ? "저장하지 않은 변경" : d.primary?.fetchStatus === "ok" ? "본문 확보됨" : d.primary?.fetchStatus === "not_fetched" ? "본문 불러오기" : d.primary ? "본문 확인 필요" : "직접 작성"}</span></summary>
        <div className="content-drawer-body stack">
          <CategorySelect channel={sourceChannel?.slug ?? ""} categories={sourceChannel?.categories} value={d.item.subcategory ?? ""} onChange={v => guard.confirmLeave(() => categorize.mutate(v))} disabled={categorize.isPending} />
          {categorize.error && <ErrorBox error={categorize.error} />}
          <DiscoveryNote info={d.item.discovery} />
          <SourcePanel key={d.item.id} d={d} cid={cid} onDirtyChange={setSourceTextDirty} />
          <EditPanel key={`${cid}-${d.item.id}`} d={d} cid={cid} templateKey={templateChoice} onTemplateChange={setTemplateChoice} onDirtyChange={setSourceDraftDirty} workMode={workMode} imageGeneration={imageGeneration} />
        </div>
      </details>
      <CardApprovePanel key={`${cid}-${d.item.id}`} d={d} cid={cid} sourceDirty={sourceDraftDirty || sourceTextDirty} templateChoice={templateChoice} onTemplateChange={setTemplateChoice} onApproved={() => go("delivery", "delivery-panel")} runtime={runtime.data} workMode={workMode} imageGeneration={imageGeneration} />
      <details className="content-drawer" open={deliveryOpen} onToggle={event => setDeliveryOpen(event.currentTarget.open)}>
        <summary><strong>전송 내역</strong><span>{d.deliveries.length ? `${d.deliveries.length}건 · 예약 취소·재전송` : "승인 후 상태 확인"}</span></summary>
        <ItemDeliveryPanel d={d} cid={cid} runtime={runtime.data} runtimeError={runtime.error} refresh={() => { q.refetch(); runtime.refetch(); }} refreshing={q.isFetching || runtime.isFetching} />
      </details>
      <details className="content-drawer"><summary><strong>버전 기록</strong><span>{d.revisions.length}개</span></summary><SourceRevisionHistory key={`${cid}-${d.item.id}`} channelId={cid} itemId={d.item.id} itemVersion={d.item.version} current={d.current} revisions={d.revisions} onRestored={() => setTemplateChoice(null)} /></details>
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
  const analysisResult = articleAnalysisSchema.safeParse(d.current?.payload.articleAnalysis);
  const analysis = analysisResult.success ? analysisResult.data : null;
  const analysisSources = new Map([...(p ? [p] : []), ...d.linked.map(({ doc }) => doc)].map(doc => [doc.id, doc]));
  const claimLabels = { reported_fact: "기사에서 확인한 사실", attributed_claim: "발언·주장", forecast: "전망·예측", interpretation: "해석" };
  const articleTypes = { report: "보도", interview: "인터뷰", opinion: "의견·칼럼", research: "연구", announcement: "발표·공고", mixed: "복합" };
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
        {analysis && <details className="content-options" data-testid="article-analysis"><summary>기사 분석 · 사실과 주장 구분</summary><div className="stack">
          <p className="small muted">기사 유형: {articleTypes[analysis.articleType]} · AI가 원문에 근거해 정리한 구분입니다. 발언·전망의 출처와 조건을 함께 확인해 주세요.</p>
          <p><strong>핵심 내용</strong><br />{analysis.centralEvent}</p>
          <ol className="list">{analysis.claims.map(claim => {
            const doc = analysisSources.get(claim.source_id);
            const finalUrl = doc && typeof doc.meta?.finalUrl === "string" ? doc.meta.finalUrl : doc?.originalUrl;
            const href = finalUrl && /^https?:\/\//i.test(finalUrl) ? finalUrl : null;
            return <li key={claim.id} className="stack" style={{ gap: 6 }}>
              <div className="row"><Badge>{claimLabels[claim.kind]}</Badge>{claim.speaker && <span className="small">발언자: {claim.speaker}</span>}</div>
              <p style={{ margin: 0 }}>{claim.statement}</p>
              <blockquote className="quote" style={{ margin: 0 }}>{claim.quote}</blockquote>
              <span className="small muted">원문 근거 · {href ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{doc?.title || `자료 #${claim.source_id}`}</a> : `자료 #${claim.source_id} · 연결된 원문 확인 필요`}</span>
            </li>;
          })}</ol>
          {!!analysis.limitations.length && <div><h3>확인 범위와 한계</h3><ul className="small">{analysis.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></div>}
          {!!analysis.keyConcepts.length && <div><h3>기사의 핵심 개념</h3><dl className="small">{analysis.keyConcepts.map((concept, index) => <div key={index}><dt><strong>{concept.term}</strong></dt><dd>{concept.meaning}</dd></div>)}</dl></div>}
        </div></details>}
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

export function EditPanel({ d, cid, templateKey, onTemplateChange, onDirtyChange, workMode = "auto", imageGeneration }: { d: Detail; cid: number; templateKey?: string | null; onTemplateChange?: (key: string) => void; onDirtyChange?: (dirty: boolean) => void; workMode?: WorkMode; imageGeneration?: ReturnType<typeof useGenerationRequest> }) {
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
  const recovery = useDraftRecovery<Record<string, any> | null>({
    recoveryKey: `item:${cid}:${d.item.id}:source`, label: "초안", version, serverValue: base, value: draft, dirty,
    ready: !!base, parse: value => value && typeof value === "object" && !Array.isArray(value) ? sourceFields(value as Record<string, any>) : null,
    onRestore: value => { setDraft(value); setSaved(false); },
  });
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
      if (recovery.pending) throw new Error("이 기기의 초안 복구본을 먼저 확인해 주세요.");
      submittedDraft.current = draft;
      return api<ContentItem>(`/channels/${cid}/items/${d.item.id}`, { method: "PATCH", body: { version, payload: cleanPayload(draft!), title: (draft?.title || draft?.key_question || d.item.title).toString().slice(0, 200) } });
    },
    onSuccess: async (it) => {
      setBase(submittedDraft.current); // Do not erase edits made while saving.
      setVersion(it.version);
      setConflict(null);
      setMergeConflict(null);
      setSaved(true);
      if (JSON.stringify(draftRef.current) === JSON.stringify(submittedDraft.current)) recovery.clear();
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
    guard.setDirty(`item-${d.item.id}`, dirty || save.isPending || !!recovery.pending, doSave, () => { recovery.clear(); setDraft(base); setConflict(null); setMergeConflict(null); });
    if (dirty) setSaved(false);
    return () => guard.setDirty(`item-${d.item.id}`, false);
  }, [dirty, save.isPending, recovery.pending, doSave, guard, d.item.id, base]);
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

  const ai = useQuery({ queryKey: ["status"], queryFn: () => api<{ integrations: Record<AiProvider, boolean> }>("/status") });
  const { allChannels } = useChannel();
  const aiChannel = allChannels.find(channel => channel.id === cid) as (Channel & Partial<ChannelAiRuntime>) | undefined;
  const roleAi = aiChannel?.effectiveAiSettings ?? legacyChannelAiSettings(aiChannel?.aiSettings);
  const [providerChoice, setProviderChoice] = useState<{ cid: number; provider: AiProvider } | null>(null);
  const overrideProvider = providerChoice?.cid === cid ? providerChoice.provider : undefined;
  const provider = overrideProvider ?? roleAi.summary.provider;
  const summaryModel = provider === roleAi.summary.provider ? roleAi.summary.model : aiChannel?.aiDefaultModels?.[provider];
  const workflow = sourceWorkflow(d);
  const [partialGeneration, setPartialGeneration] = useState<{ version: number; warnings: string[] } | null>(null);
  const workflowWarnings = workflow?.warnings.length ? workflow.warnings : partialGeneration && partialGeneration.version >= d.item.version ? partialGeneration.warnings : [];
  const templates = useTemplates(cid);
  const [localTemplate, setLocalTemplate] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const preferredTemplate = templateKey ?? localTemplate ?? d.current?.payload.cardCopy?.templateKey ?? templates.data?.current ?? "builtin:classic";
  const draftTemplate = !d.current && workMode === "auto" && !templateKey && !localTemplate && preferredTemplate.startsWith("set:") && !collectionUsesArt(preferredTemplate.slice(4)) ? "set:n03" : preferredTemplate;
  const sourceReady = !d.primary || (d.primary.fetchStatus === "ok" && !!d.primary.fetchedText?.trim());
  const generation = useGenerationRequest(cid, d.item.id, "draft");
  const [generationStep, setGenerationStep] = useState<"draft" | "image" | null>(null);
  const [autoImageError, setAutoImageError] = useState<Error | null>(null);
  const gen = useMutation({
    mutationFn: async () => {
      setAutoImageError(null); setGenerationStep("draft");
      const generated = await generation.run<SourceGenerationResult>(`/channels/${cid}/items/${d.item.id}/generate`, { version: d.item.version, ...(overrideProvider ? { provider: overrideProvider } : {}), templateKey: draftTemplate });
      const warnings = generationWarnings(generated.generationWarnings);
      setPartialGeneration(warnings.length ? { version: generated.version, warnings } : null);
      // The v2 source pipeline already creates the cover once. Its saved text
      // must be reviewed before an explicit Canva export, not sent to the legacy
      // /card AI renderer as an automatic second image request.
      if (familyCardCopySchema.safeParse(generated.edited?.cardCopy).success) return generated;
      // A selected full set must never fall through to the legacy five-page
      // renderer, including partial notice drafts or a preserved older copy.
      if (readingProfileForTemplateKey(draftTemplate)) return generated;
      // A saved summary is a partial success when copy creation fails. Do not
      // spend on an image of an incomplete deck or imply it is ready to approve.
      if (warnings.length) return generated;
      // The first automatic creation continues to an actual saved image. A
      // revision already being edited is regenerated through explicit proposals.
      if (!d.current && workMode === "auto") {
        await qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
        const latest = qc.getQueryData<Detail>(["ch", cid, "item", d.item.id]);
        if (latest && (latest.item.version !== generated.version || sourceWorkflow(latest)?.warnings.length)) return generated;
        const acceptedCopy = latest?.current?.payload.cardCopy ?? generated.edited?.cardCopy;
        if ((acceptedCopy as { version?: unknown } | undefined)?.version !== 1) return generated;
        setGenerationStep("image");
        try {
          const imageBody = {
            version: generated.version, templateKey: draftTemplate,
            coverMode: draftTemplate.startsWith("set:") && !collectionUsesArt(draftTemplate.slice(4)) ? "typography" : "ai",
          };
          if (imageGeneration && imageBody.coverMode === "ai") await imageGeneration.run(`/channels/${cid}/items/${d.item.id}/card`, imageBody);
          else await api(`/channels/${cid}/items/${d.item.id}/card`, { method: "POST", body: { ...imageBody, ...(imageBody.coverMode === "ai" ? { requestId: crypto.randomUUID() } : {}) } });
        } catch (error) { setAutoImageError(error as Error); }
      }
      return generated;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["ch", cid] }); void qc.invalidateQueries({ queryKey: ["studio"] }); },
    onSettled: () => setGenerationStep(null),
  });
  useEffect(() => { onDirtyChange?.(dirty || save.isPending || gen.isPending || !!mergeConflict || !!recovery.pending); }, [dirty, save.isPending, gen.isPending, mergeConflict, recovery.pending, onDirtyChange]);
  const savedFamilyDraft = familyCardCopySchema.safeParse(d.current?.payload.cardCopy).success;
  const familyCoverReady = (d.current?.payload.pageDesigns as { cover?: { background?: { kind?: unknown; assetId?: unknown } } } | undefined)?.cover?.background;

  return (
    <section className="panel stack" id="edit-panel" tabIndex={-1}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>초안 작성</h2>
      </div>
      <RecoveryNotice recovery={recovery} formatValue={value => compareSourceRevisions(value, value ?? {}).filter(field => field.section === "source").map(field => `${field.label}\n${field.current}`).join("\n\n")} />
      <div hidden={workMode !== "auto" && !generation.unresolved}><details className="studio-more" open><summary>자동 제작 · 원고와 카드 이미지</summary>
        <label className="field">기사 요약 AI<select aria-label="기사 요약 AI" value={provider} disabled={gen.isPending || generation.unresolved} onChange={e => setProviderChoice({ cid, provider: e.target.value as AiProvider })}>{aiProviders.map(p => <option key={p} value={p}>{aiProviderLabels[p]}</option>)}</select><span className="hint">{overrideProvider ? "이번 요약에만 선택한 AI를 사용합니다." : "이 콘텐츠가 속한 채널의 요약 AI를 사용합니다."} 문구와 이미지는 각각의 채널 설정을 따릅니다.</span></label>
        {overrideProvider && <div><button className="btn sm ghost" disabled={gen.isPending || generation.unresolved} onClick={() => setProviderChoice(null)}>채널 기본 AI로 되돌리기</button></div>}
        <details className="content-options" data-testid="source-role-models"><summary>사용 중인 모델 · 요약 {aiProviderLabels[provider]} · 문구 {aiProviderLabels[roleAi.copy.provider]} · 이미지 OpenAI</summary><div className="stack small" style={{ overflowWrap: "anywhere" }}>
          <dl>{channelAiRoles.map(role => <div key={role}><dt><strong>{channelAiRoleLabels[role]}</strong></dt><dd>{role === "summary" ? aiProviderLabels[provider] : role === "image" ? "ChatGPT 이미지 · OpenAI API" : aiProviderLabels[roleAi[role].provider]} · {role === "summary" ? summaryModel || "서버 기본 모델" : roleAi[role].model || "서버 기본 모델"}{role === "summary" && overrideProvider ? " · 이번 작업에서 선택" : ""}</dd></div>)}</dl>
          {workflow && <p className="small muted">현재 원고를 만든 모델: 요약 {workflow.summary.model}{workflow.copy ? ` · 문구 ${workflow.copy.model}` : ""}</p>}
          <GuardedLink href="/settings">채널별 AI 설정 변경 →</GuardedLink>
        </div></details>
        <button className="btn sm" disabled={gen.isPending} aria-expanded={showTemplates} onClick={() => setShowTemplates(value => !value)}>문구를 작성할 템플릿: {templates.data?.items.find(t => t.key === draftTemplate || t.colors?.some(color => color.key === draftTemplate))?.name ?? "기본"} ▾</button>
        {showTemplates && templates.data && <TemplatePicker cid={cid} value={draftTemplate} items={templates.data.items} disabled={gen.isPending} onChange={key => { setLocalTemplate(key); onTemplateChange?.(key); }} />}
        {readingProfileForTemplateKey(draftTemplate) && <p className="notice small">선택한 풀세트는 표지부터 마지막 장까지 8장으로 만듭니다. 기존 카드 원고가 있으면 아래 편집기에서 새 8장 제안을 비교한 뒤 전환하세요. 선택만으로 생성하거나 기존 내용을 덮어쓰지 않습니다.</p>}
        <p className="hint">요약 AI가 원문을 분석하고, 문구 AI가 선택한 디자인에 맞게 카드를 작성합니다. 아래 카드 편집기에서 세부 문구를 고치거나 다시 제안받을 수 있어요.</p>
        <AiUsageGuide provider={provider} />
        {ai.data?.integrations[provider] === false && <p className="notice warn small">선택한 AI의 키가 없습니다. <GuardedLink href={`/connections?service=${provider}`}>API 키 입력 →</GuardedLink></p>}
        {!sourceReady && <p className="notice small">먼저 위에서 본문을 불러오거나 직접 붙여넣어 저장해 주세요.</p>}
        <button className="btn sm" onClick={() => gen.mutate()} disabled={!!recovery.pending || gen.isPending || (!generation.unresolved && (dirty || !sourceReady || !ai.data?.integrations[provider]))} title={dirty && !generation.unresolved ? "저장 후 사용할 수 있습니다" : undefined}>
          {gen.isPending ? generationStep === "image" ? "이미지 만드는 중…" : "원고 만드는 중…" : generation.unresolved ? "기존 AI 작업 결과 확인" : !d.current ? "원고·이미지 자동 만들기" : d.item.kind === "notice" ? `${aiProviderLabels[provider]}로 원문 추출` : `${aiProviderLabels[provider]}로 초안 생성`}
        </button>
        {generation.unresolved && <div className="stack"><p className="small muted">같은 요청의 결과를 확인합니다. 응답이 없어도 새 유료 작업을 자동으로 시작하지 않습니다. 직접 입력은 계속할 수 있습니다.</p><div><button className="btn sm" disabled={generation.cancelling} onClick={() => void generation.cancel()}>{generation.cancelling ? "중단 확인 중…" : "AI 요청 중단"}</button></div></div>}
        {generation.cancelled && <p className="notice small" role="status">AI 요청을 중단했습니다. 기존 원고를 직접 편집하거나 새로 요청할 수 있습니다.</p>}
        {generation.cancelError && <ErrorBox error={generation.cancelError} />}
      </details></div>
      <div hidden={workMode !== "manual"}><details className="content-options" open><summary>수동 · 외부에서 초안 가져오기</summary><ChatGptLaunch prompt={itemChatGptPrompt({ title: d.item.title, kind: d.item.kind, channelSlug: aiChannel?.slug, source: d.primary ? {
        title: d.primary.title ?? d.item.title, url: d.primary.originalUrl,
        text: d.primary.fetchStatus === "ok" ? d.primary.fetchedText ?? "" : "", snippet: d.primary.snippet ?? "",
        quotes: Array.isArray(d.primary.meta.quotes) ? d.primary.meta.quotes.filter((q): q is string => typeof q === "string") : [],
      } : null })} />
      <p className="small muted">API 한도나 연결 문제로 자동 제작을 사용할 수 없을 때 이용하세요. 받은 초안은 아래 편집 칸에 옮겨 저장합니다.</p></details></div>
      {d.current && (
        <p className="small muted">
          현재 버전 r{d.current.revisionNo} · {d.current.author === "operator" ? "운영자 편집본" : d.current.author === "llm" ? `자동 추출/초안 (${d.current.model ?? ""})` : "시스템"}
          {d.current.note ? ` · ${d.current.note}` : ""}
        </p>
      )}
      {d.item.version > version && dirty && <div className="notice warn">서버에 새 초안이 있습니다. 직접 입력한 내용은 유지했습니다. <button className="btn sm" onClick={() => guard.confirmLeave(() => { setBase(incoming); setDraft(incoming); setVersion(d.item.version); })}>새 초안 불러오기</button></div>}
      {gen.error && <ErrorBox error={gen.error} retry={generation.unresolved || (!dirty && sourceReady && !!ai.data?.integrations[provider]) ? () => gen.mutate() : undefined} />}
      {!!workflowWarnings.length && <div className="notice warn stack" role="alert" data-testid="source-generation-warnings"><strong>{savedFamilyDraft ? "8장 원고는 저장했습니다. 남은 작업을 확인해 주세요." : "기사 요약은 저장했습니다. 카드 제작을 마무리해 주세요."}</strong><ul className="small">{workflowWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><p className="small">{savedFamilyDraft ? "카드 편집기에서 해당 문구·배경을 확인하고 필요한 부분만 다시 제안받거나 직접 수정·저장하세요. 요약을 다시 생성할 필요는 없습니다. 확인을 마치면 아래 ‘8장 디자인 완성’에서 완성 이미지를 만드세요." : "아래 카드 편집기의 ‘AI로 문구 다듬기’에서 문구만 다시 제안받거나 직접 수정·저장하세요. 요약을 다시 생성할 필요는 없습니다. 문구를 완성한 뒤 이미지를 갱신하고 게시 준비를 진행하세요."}</p></div>}
      {gen.isSuccess && !workflowWarnings.length && (savedFamilyDraft ? <div className="notice ok small stack" data-testid="family-generation-next-step"><strong>{familyCoverReady?.kind === "image" && typeof familyCoverReady.assetId === "number" ? "8장 원고와 표지 배경을 저장했습니다." : "8장 원고를 저장했습니다."}</strong><p>아래에서 원문·문구·표지를 검토하고 세부 수정을 저장한 뒤 ‘8장 디자인 완성’에서 이미지를 만드세요. 검토와 승인은 별도로 진행합니다.</p><p>편집기의 문구 배치 미리보기는 현재 입력의 스튜디오 초안입니다. 게시 전에는 완성된 8장의 문구와 이미지가 저장한 원고와 맞는지 확인해 주세요.</p></div> : <div className="notice ok small">새 버전을 만들었습니다. 생성 성공은 검토 완료가 아닙니다 — 내용을 확인하세요.</div>)}
      {autoImageError && <div className="notice warn stack" role="alert"><strong>원고는 저장했습니다. 이미지 생성은 완료를 확인하지 못했습니다.</strong><p className="small">{autoImageError.message}</p><p className="small">아래 카드 편집에서 저장된 이미지와 연결 상태를 확인하세요. 원고를 다시 생성할 필요는 없습니다.</p><GuardedLink href="/connections?service=openai">이미지 AI 연결 확인</GuardedLink></div>}
      {generationStep === "image" && imageGeneration?.unresolved && <button className="btn" disabled={imageGeneration.cancelling} onClick={() => void imageGeneration.cancel()}>{imageGeneration.cancelling ? "중단 확인 중…" : "이미지 요청 중단"}</button>}
      {!draft ? (
        <div className="stack" hidden={workMode !== "manual"}><p className="muted">AI 없이도 초안을 시작할 수 있습니다. 확보한 원문을 보면서 직접 쓰거나 외부 초안을 옮겨 적으세요.</p><div><button className="btn primary" disabled={beginDraft.isPending || (gen.isPending && !generation.cancelled)} onClick={() => beginDraft.mutate()}>{beginDraft.isPending ? "초안 여는 중…" : "직접 초안 작성"}</button></div>{beginDraft.error && <ErrorBox error={beginDraft.error} />}</div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending && !mergeConflict && !recovery.pending) save.mutate();
          }}
        >
          <fieldset disabled={!!recovery.pending} style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}><PayloadEditor kind={d.item.kind} value={draft} onChange={setDraft} /></fieldset>
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
            <button type="button" className="btn" disabled={!dirty} onClick={() => { recovery.clear(); setDraft(base); }}>
              되돌리기
            </button>
            <button className="btn primary" disabled={!dirty || save.isPending || !!mergeConflict || !!recovery.pending}>
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

type CoverRedrawDraft = { regenerateCover: boolean; coverInstruction: string };
type CardRenderResponse = { id: number; itemVersion?: number; revisionId?: number; carousel: CarouselData; studioCardId: number };
const emptyCoverRedraw: CoverRedrawDraft = { regenerateCover: false, coverInstruction: "" };
function parseCoverRedraw(value: unknown): CoverRedrawDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<CoverRedrawDraft>;
  return typeof draft.regenerateCover === "boolean" && typeof draft.coverInstruction === "string" && draft.coverInstruction.length <= 2000
    ? { regenerateCover: draft.regenerateCover, coverInstruction: draft.coverInstruction } : null;
}
const coverRedrawText = (draft: CoverRedrawDraft) => `${draft.regenerateCover ? "표지 1장 다시 그리기 선택" : "새 그림 요청 안 함"}\n${draft.coverInstruction || "상세 요청 없음"}`;

function CardApprovePanel({ d, cid, sourceDirty = false, templateChoice, onTemplateChange, onApproved, runtime, workMode = "auto", imageGeneration }: { d: Detail; cid: number; sourceDirty?: boolean; templateChoice?: string | null; onTemplateChange?: (key: string) => void; onApproved: () => void; runtime?: PublicationRuntime; workMode?: WorkMode; imageGeneration: ReturnType<typeof useGenerationRequest> }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const toast = useToast();
  const copyIncomplete = incompleteCardCopy(d);
  const familyCopy = familyCardCopySchema.safeParse(d.current?.payload.cardCopy);
  const savedPageDesigns = pageDesignsSchema.safeParse(d.current?.payload.pageDesigns);
  const familyPlan = editorialPlanSchema.safeParse(d.current?.payload.editorialPlan);
  const captionCoreQuestion = familyPlan.success ? familyPlan.data.coreQuestion : "";
  const [coverChoice, setCoverChoice] = useState<"reuse" | "ai" | "typography" | null>(null);
  const [coverDraft, setCoverDraft] = useState<CoverRedrawDraft>(emptyCoverRedraw);
  const coverDraftRef = useRef(coverDraft); coverDraftRef.current = coverDraft;
  const [coverOptionsOpen, setCoverOptionsOpen] = useState(false);
  const renderedIntent = useRef<{ coverMode: unknown; templateKey: unknown; redraw: CoverRedrawDraft | null } | null>(null);
  const revCards = d.cards.filter((c) => c.revisionId === d.current?.id);
  const latestImages = useRef({ itemVersion: d.item.version, revisionId: d.current?.id, newestAssetId: Math.max(0, ...revCards.map(card => card.id)) });
  latestImages.current = { itemVersion: d.item.version, revisionId: d.current?.id, newestAssetId: Math.max(0, ...revCards.map(card => card.id)) };
  const olderRender = (result: CardRenderResponse) => (typeof result.itemVersion === "number" && result.itemVersion < latestImages.current.itemVersion)
    || (typeof result.revisionId === "number" && result.revisionId !== latestImages.current.revisionId)
    || result.id < latestImages.current.newestAssetId;
  const [altDirty,setAltDirty]=useState(false);
  const [copyDirty, setCopyDirty] = useState(true);
  const [pickedCard, setPickedCard] = useState<number | null>(null);
  const heldCard = useRef<Detail["cards"][number] | null>(null);
  const currentCard = altDirty && heldCard.current ? heldCard.current : revCards.find((c) => c.id === pickedCard) ?? revCards[0] ?? null;
  useEffect(() => { heldCard.current = currentCard; }, [currentCard]);
  const staleArtifact = !!currentCard && currentCard.revisionId !== d.current?.id;
  const altVersion = useQuery<{ version: number }>({ queryKey: ["card-alt", currentCard?.id], queryFn: () => api(`/channels/${cid}/media/${currentCard!.id}/alt-text`), enabled: false }).data?.version;
  const publicationRequestId = usePublicationRequestId();
  const currentApprovalIds = new Set(d.approvals.filter(approval => approval.revisionId === d.current?.id).map(approval => approval.id));
  const existingDeliveryState = d.deliveries.some(({ d: delivery }) => delivery.needsReconciliation) ? "unknown" : (["unknown", "processing", "succeeded", "scheduled"] as const).find(status => d.deliveries.some(({ d: delivery }) => (status === "unknown" || status === "processing" || currentApprovalIds.has(delivery.approvalId)) && delivery.status === status));
  const existingDeliveryMessage = existingDeliveryState ? {
    scheduled: "이미 전송 예약이 있습니다. 예약 변경은 전송 상태에서 기존 예약을 취소한 뒤 다시 승인해 주세요.",
    processing: "이 콘텐츠의 전송을 처리 중입니다. 이전 버전을 포함한 전송 상태에서 결과를 확인해 주세요.",
    succeeded: "이 버전은 이미 게시됐습니다. 전송 상태에서 게시물을 확인해 주세요.",
    unknown: "이 콘텐츠의 이전 게시 여부를 먼저 확인해야 합니다. 전송 상태에서 실제 게시물을 확인해 주세요.",
  }[existingDeliveryState] : null;
  const destinations = d.publicationReadiness?.destinations ?? [];
  const defaultInstagram = destinations.filter(destination => destination.platform === "instagram" && destination.configured);
  const captionDraft = usePublicationDraft(cid, d.item.id, d.publicationDraft ?? { version: 0, captions: d.defaultCaptions ?? { instagram: "", telegram: "" } }, {
    destinationIds: defaultInstagram.length === 1 ? [defaultInstagram[0].id] : [], timing: "now", scheduledAtKst: "",
  });
  const caps = captionDraft.captions;
  const captionIncludesQuestion = !!captionCoreQuestion && caps.instagram.includes(captionCoreQuestion);
  const { destinationIds, timing, scheduledAtKst: when } = captionDraft.options;
  const setPickedDestinations = (ids: number[]) => captionDraft.setOptions({ ...captionDraft.options, destinationIds: ids });
  const setTiming = (timing: "now" | "later") => captionDraft.setOptions({ ...captionDraft.options, timing });
  const setWhen = (scheduledAtKst: string) => captionDraft.setOptions({ ...captionDraft.options, scheduledAtKst });
  const unavailableDestinations = destinationIds.filter(id => !destinations.some(destination => destination.id === id && destination.configured));
  const destinationsKey = destinationIds.join(",");
  const [publishOpen, setPublishOpen] = useState(false);
  const [manualCaptionOpen, setManualCaptionOpen] = useState(false), [manualCaptionConfirmed, setManualCaptionConfirmed] = useState(false);
  const captionInput = useRef<HTMLTextAreaElement>(null);
  const captionSignature = JSON.stringify(caps);
  const manualCaptionState = useRef({ version: d.item.version, revisionId: d.current?.id, captions: caps, blocked: sourceDirty || copyDirty || altDirty, confirmed: manualCaptionConfirmed });
  manualCaptionState.current = { version: d.item.version, revisionId: d.current?.id, captions: caps, blocked: sourceDirty || copyDirty || altDirty, confirmed: manualCaptionConfirmed };
  useEffect(() => { setManualCaptionConfirmed(false); }, [d.item.version, d.current?.id, captionSignature, sourceDirty, copyDirty, altDirty]);
  function openManualCaption() {
    setPublishOpen(true); setManualCaptionOpen(true);
    window.setTimeout(() => { captionInput.current?.scrollIntoView({ behavior: "smooth", block: "center" }); captionInput.current?.focus(); }, 30);
  }
  const confirmManualCaption = useMutation({
    mutationFn: async () => {
      const snapshot = manualCaptionState.current;
      if (!familyCopy.success || !snapshot.confirmed || snapshot.blocked || !snapshot.captions.instagram.trim()) throw new Error("카드 문구를 저장하고 현재 8장과 캡션을 대조해 주세요.");
      if (!captionCoreQuestion || !snapshot.captions.instagram.includes(captionCoreQuestion)) throw new Error("현재 카드의 중심 질문을 캡션에 포함한 뒤 대조해 주세요.");
      const preparation = await captionDraft.save();
      const latest = manualCaptionState.current;
      if (!latest.confirmed || latest.blocked || latest.version !== snapshot.version || latest.revisionId !== snapshot.revisionId || JSON.stringify(latest.captions) !== JSON.stringify(snapshot.captions) || JSON.stringify(preparation.captions) !== JSON.stringify(snapshot.captions)) throw new Error("대조 확인 중 카드나 캡션이 바뀌었습니다. 새 입력은 유지했으니 확인 표시를 다시 선택해 주세요.");
      return api<StoredCardCopyResponse & { canvaOutputReused?: boolean; retainedOutputAssetId?: number }>(`/channels/${cid}/items/${d.item.id}/card-copy/caption-confirm`, { method: "POST", body: { version: snapshot.version, publicationDraftVersion: preparation.version, textConfirmed: true } });
    },
    onSuccess: async result => {
      setManualCaptionConfirmed(false);
      qc.setQueryData<StoredCardCopyResponse>(["card-copy", cid, d.item.id], previous => !previous || previous.version <= result.version ? result : previous);
      await qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
      void qc.invalidateQueries({ queryKey: ["studio"] });
      toast("ok", result.canvaOutputReused ? "수동 캡션을 저장하고 기존 8장 출력을 유지했습니다. 검토·승인을 다시 진행해 주세요." : "수동 캡션을 현재 카드와 함께 저장했습니다. 완성 이미지를 다시 만든 뒤 검토·승인해 주세요.");
    },
  });
  useEffect(() => { if (captionDraft.recovery.pending) setPublishOpen(true); }, [captionDraft.recovery.pending]);
  const [confirmed, setConfirmed] = useState(false);
  const tpls = useTemplates(cid);
  const [tpl, setTpl] = useState<string | null>(null);
  const templateKey = templateChoice ?? tpl ?? d.current?.payload.cardCopy?.templateKey ?? currentCard?.templateKey ?? tpls.data?.current ?? "builtin:classic";
  const templateKeyRef = useRef(templateKey); templateKeyRef.current = templateKey;
  const chooseTemplate = (key: string) => { setTpl(key); onTemplateChange?.(key); };
  const typographyOnly = templateKey.startsWith("set:") && !collectionUsesArt(templateKey.slice(4));
  // Manual work never starts a paid request, even if an earlier automatic redraw is still drafted.
  const coverMode = typographyOnly ? "typography" : workMode === "manual" ? coverChoice === "typography" ? "typography" : "reuse" : coverDraft.regenerateCover ? "ai" : coverChoice ?? "ai";
  const coverDirty = coverDraft.regenerateCover || !!coverDraft.coverInstruction;
  const coverRecovery = useDraftRecovery<CoverRedrawDraft>({
    recoveryKey: `item:${cid}:${d.item.id}:cover-redraw`, label: "표지 다시 그리기 요청",
    version: `${d.current?.id ?? 0}:${currentCard?.id ?? 0}:${templateKey}`, serverValue: emptyCoverRedraw,
    value: coverDraft, dirty: coverDirty, ready: !!d.current, parse: parseCoverRedraw,
    onRestore: value => { setCoverDraft(value); setCoverOptionsOpen(true); },
  });
  // Old v1 directions remain recoverable but are not an active v2 image intent.
  const coverPending = !familyCopy.success && (coverDirty || !!coverRecovery.pending);
  const [showTpl, setShowTpl] = useState(false);
  const canva = useQuery({ queryKey: ["canva-status"], queryFn: () => api<{ connected: boolean }>("/canva/status") });
  const { channels } = useChannel();
  const ch = channels.find((c) => c.id === cid);
  useEffect(() => {
    setPickedCard(null);
  }, [d.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const render = useMutation({
    mutationFn: (saved: StoredCardCopyResponse | null) => {
      if (!saved && !imageGeneration.unresolved) throw new Error("이미지에 반영할 문구를 먼저 저장해 주세요.");
      if (saved && imageGeneration.unresolved) throw new Error("이전 이미지 요청의 결과를 먼저 확인해 주세요.");
      if (saved && saved.copy.version !== 2 && coverRecovery.pending) throw new Error("표지 요청의 기기 복구본을 먼저 확인해 주세요.");
      const redraw = !!saved && saved.copy.version !== 2 && workMode === "auto" && coverDraft.regenerateCover;
      if (redraw && (coverMode !== "ai" || !d.imageAiAvailable)) throw new Error("표지를 다시 그리려면 그림이 있는 디자인과 이미지 AI 연결을 확인해 주세요.");
      const body = saved ? { version: saved.version, templateKey: saved.copy.templateKey, coverMode: saved.copy.version === 2 ? "reuse" : coverMode, ...(redraw ? { regenerateCover: true, coverInstruction: coverDraft.coverInstruction.trim() } : {}) } : imageGeneration.pendingBody ?? {};
      renderedIntent.current = { coverMode: body.coverMode, templateKey: body.templateKey, redraw: body.regenerateCover === true ? { regenerateCover: true, coverInstruction: typeof body.coverInstruction === "string" ? body.coverInstruction : "" } : null };
      if (saved && body.coverMode !== "ai") return api<CardRenderResponse>(`/channels/${cid}/items/${d.item.id}/card`, { method: "POST", body });
      return imageGeneration.run<CardRenderResponse>(`/channels/${cid}/items/${d.item.id}/card`, body);
    },
    onSuccess: (a) => {
      if (olderRender(a)) {
        toast("info", "이전 이미지 요청의 완료를 확인했습니다. 더 최신 원고·이미지와 현재 표지 요청은 유지했습니다.");
        qc.invalidateQueries({ queryKey: ["studio"] });
        qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
        return;
      }
      const submitted = renderedIntent.current;
      const current = coverRecovery.pending?.value ?? coverDraftRef.current;
      // A replay may finish an older request while a newer direction is already being drafted.
      if (submitted?.redraw && current.regenerateCover && current.coverInstruction.trim() === submitted.redraw.coverInstruction && templateKeyRef.current === submitted.templateKey) {
        coverRecovery.clear(); setCoverDraft(emptyCoverRedraw);
      }
      setPickedCard(a.id);
      toast("ok", `${a.carousel.pages.length}장 이미지를 저장했습니다. 미리보기를 확인한 뒤 게시 준비를 열어 주세요.`);
      setConfirmed(false);
      qc.invalidateQueries({ queryKey: ["studio"] });
      qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
    },
  });
  useEffect(() => {
    const key = `cover-redraw-${cid}-${d.item.id}`;
    guard.setDirty(key, coverPending, async () => {
      toast("info", "표지 다시 그리기 요청을 먼저 적용하거나 ‘요청 비우기’로 정리해 주세요.");
      return false; // Leaving or saving text must never authorize a paid image call.
    }, () => { coverRecovery.clear(); setCoverDraft(emptyCoverRedraw); });
    return () => guard.setDirty(key, false);
  }, [cid, d.item.id, coverPending, coverDraft, coverRecovery.pending, guard]);
  const localRender = useMutation({ mutationFn: async () => {
    await api(`/channels/${cid}/items/${d.item.id}/canva/use-local`, { method: "POST", body: { version: d.item.version } });
    const saved = await api<StoredCardCopyResponse>(`/channels/${cid}/items/${d.item.id}/card-copy`);
    await qc.invalidateQueries({ queryKey: ["ch", cid, "item", d.item.id] });
    return render.mutateAsync(saved);
  } });
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
      if (copyIncomplete) throw new Error("기사 요약은 저장됐지만 카드 문구를 완성하지 못했습니다. 문구를 수정·저장하고 이미지를 갱신한 뒤 승인해 주세요.");
      if (sourceDirty || copyDirty || altDirty || coverPending || render.isPending || imageGeneration.unresolved || staleArtifact || captionDraft.needsSave || captionDraft.saving || captionDraft.conflict || captionDraft.recovery.pending || unavailableDestinations.length || !destinationIds.length || !confirmed) throw new Error("변경 내용을 저장하고 이미지·캡션·게시 계정을 다시 확인해 주세요.");
      const intent = { revisionId: d.current!.id, mediaAssetId: currentCard!.id, altTextVersion: altVersion, publicationDraftVersion: captionDraft.version, captions: caps, destinationIds: [...destinationIds].sort((a, b) => a - b), timing, ...(timing === "later" ? { scheduledAt: `${when}:00+09:00` } : {}) };
      return api<{ destinations: number; timing: "now" | "later" }>(`/channels/${cid}/items/${d.item.id}/approve`, {
        method: "POST",
        body: { ...intent, requestId: publicationRequestId({ ...intent, cancelledApprovals: d.approvals.filter(approval => approval.status === "cancelled").map(approval => approval.id).sort((a, b) => a - b) }) },
      });
    },
    onSuccess: async (result) => {
      publicationRequestId.complete();
      toast(result.destinations === 0 ? "info" : "ok", result.destinations === 0 ? "전송할 계정을 확인해 주세요." : result.timing === "later" ? "예약했습니다. 전송 내역에서 취소할 수 있어요." : "바로 게시하도록 요청했습니다. 전송 내역에서 결과를 확인하세요.");
      await qc.invalidateQueries({ queryKey: ["ch", cid] });
      onApproved();
    },
  });
  const len = (s: string) => [...s].length;
  const cd = d.item.canvaDesign;
  const SRC: Record<string, string> = { builtin: "기본 템플릿", custom: "내 배경 템플릿", canva: "Canva" };
  const pendingChanges = copyIncomplete || sourceDirty || copyDirty || altDirty || coverPending || render.isPending || imageGeneration.unresolved || staleArtifact || captionDraft.needsSave || captionDraft.saving || confirmManualCaption.isPending || !!captionDraft.conflict || !!captionDraft.recovery.pending || len(caps.instagram) > 2200 || len(caps.telegram) > 1024;
  useEffect(() => { setConfirmed(false); }, [currentCard?.id, d.current?.id, caps, timing, when, copyDirty, copyIncomplete, altDirty, altVersion, sourceDirty, coverPending, coverDraft, captionDraft.version, destinationsKey]);
  const futureSchedule = timing === "now" || (!!when && Number.isFinite(Date.parse(`${when}:00+09:00`)) && Date.parse(`${when}:00+09:00`) > Date.now());
  return (
    <section className="stack content-card-editor" id="card-panel" tabIndex={-1}>
      {!d.current ? (
        <p className="notice">위의 자료·초안에서 본문을 확인하고 초안을 만들면 카드 편집기가 열립니다.</p>
      ) : (
        <>
          <div className="content-editor-toolbar"><h2>카드 편집</h2><span className="small muted">문구를 고치고, 디자인을 확인하세요.</span></div>
          {copyIncomplete && <p className="notice warn small" role="status">저장된 기사 요약을 바탕으로 카드 문구를 마무리해 주세요. ‘AI로 문구 다듬기’에서 문구만 다시 제안받거나 직접 수정해 저장하면 이미지 제작과 게시 준비를 이어갈 수 있습니다.</p>}
          {!familyCopy.success && workMode === "auto" && typographyOnly && <div className="notice small"><span>현재 디자인은 글자 중심입니다. 그림이 필요한 콘텐츠는 일러스트 디자인으로 바꿔 주세요.</span> <button className="btn sm" disabled={render.isPending} onClick={() => { chooseTemplate("builtin:classic"); setCoverChoice("ai"); }}>그림이 있는 디자인 사용</button></div>}
          {!familyCopy.success && <details className="content-options" open={coverOptionsOpen || !!coverRecovery.pending} onToggle={event => {
            if (event.target !== event.currentTarget) return;
            if (coverRecovery.pending && !event.currentTarget.open) event.currentTarget.open = true;
            setCoverOptionsOpen(event.currentTarget.open);
          }}><summary>표지·이미지 설정</summary><div className="stack">
            <RecoveryNotice recovery={coverRecovery} formatValue={coverRedrawText} />
            <label className="field">표지 이미지<select value={coverMode} disabled={render.isPending || !!coverRecovery.pending || typographyOnly || (workMode === "auto" && coverDraft.regenerateCover)} onChange={e => setCoverChoice(e.target.value as "reuse" | "ai" | "typography")}><option value="reuse">저장된 표지 그림 유지</option><option value="ai" disabled={!d.imageAiAvailable || workMode === "manual"}>주제에 맞는 AI 일러스트</option><option value="typography">글자 중심 · 선택한 배경 템플릿</option></select><span className="hint">{typographyOnly ? "이 디자인은 타이포그래피 전용입니다. 이미지 생성 비용 없이 만듭니다." : coverMode === "ai" ? "저장된 표지가 있으면 재사용합니다. 새 그림이 필요할 때만 아래의 다시 그리기를 선택하세요. 첫 그림 생성에는 OpenAI 이미지 API 비용이 발생합니다." : coverMode === "reuse" ? "글자만 수정해도 저장된 그림을 유지합니다. 저장된 그림이 없으면 글자 중심으로 만들며 이미지 생성 비용은 발생하지 않습니다." : "이미지 생성 비용 없이 만듭니다."}</span></label>
            <label className="check"><input type="checkbox" aria-label="표지 그림 새로 그리기" checked={coverDraft.regenerateCover} disabled={render.isPending || !!coverRecovery.pending || (!coverDraft.regenerateCover && (workMode === "manual" || typographyOnly || !d.imageAiAvailable))} onChange={event => setCoverDraft(current => ({ ...current, regenerateCover: event.target.checked }))} /><span>표지 그림 새로 그리기 · 유료 이미지 1장</span></label>
            {(coverDraft.regenerateCover || !!coverDraft.coverInstruction) && <>
              <label className="field">표지 그림 상세 요청<textarea aria-label="표지 그림 상세 요청" rows={4} maxLength={2000} value={coverDraft.coverInstruction} disabled={render.isPending || !!coverRecovery.pending} onChange={event => setCoverDraft(current => ({ ...current, coverInstruction: event.target.value }))} placeholder="예: 배경은 밝은 실험실, 중심 사물은 크게, 글자가 놓일 위쪽은 비워 주세요." /><span className="hint">{coverDraft.coverInstruction.length} / 2000자 · 표지 그림 1장에만 적용합니다. 본문 페이지의 글과 배치는 유지합니다.</span></label>
              <p className="small muted">{workMode === "manual" ? "자동 작업의 표지 요청을 보관하고 있습니다. 수동으로 이미지를 저장하면 기존 그림을 유지하며 새 유료 그림을 요청하지 않습니다." : coverDraft.regenerateCover ? "‘표지 1장 다시 그리기 · 이미지 갱신’을 누르면 저장된 표지 대신 새 그림 1장을 요청합니다. 입력한 문구는 함께 저장됩니다." : "상세 요청은 보관 중입니다. 적용하려면 다시 그리기를 선택하거나 요청을 비워 주세요."}</p>
              {workMode === "auto" && coverDraft.regenerateCover && typographyOnly && <p className="notice warn small">현재 디자인은 글자 중심입니다. 그림이 있는 디자인으로 바꾸거나 다시 그리기 선택을 해제해 주세요.</p>}
              <div><button type="button" className="btn sm" disabled={render.isPending || !!coverRecovery.pending} onClick={() => { coverRecovery.clear(); setCoverDraft(emptyCoverRedraw); }}>요청 비우기</button></div>
            </>}
          </div>
          </details>}
          {!familyCopy.success && !d.imageAiAvailable && !typographyOnly && coverMode === "ai" && <p className="notice warn small">자동 일러스트를 만들려면 <GuardedLink href="/connections?service=openai">이미지 AI 연결</GuardedLink>을 확인해 주세요. 문구 수정과 저장은 계속할 수 있습니다. 연결 문제일 때는 수동 작업이나 표지 설정의 글자 중심 디자인을 이용하세요.</p>}
          <div className="row">
            {!familyCopy.success && <button className="btn" disabled={render.isPending} onClick={() => setShowTpl((v) => !v)} aria-expanded={showTpl}>
              템플릿: {tpls.data?.items.find((t) => t.key === templateKey || t.colors?.some(color => color.key === templateKey))?.name ?? "기본"} ▾
            </button>}
            {currentCard && (
              <a className="btn" aria-disabled={copyDirty || altDirty} tabIndex={copyDirty || altDirty ? -1 : undefined} href={copyDirty || altDirty ? undefined : `/api/channels/${cid}/media/${currentCard.id}?download=1`}>
                표지 JPEG 다운로드
              </a>
            )}
          </div>
          {!familyCopy.success && showTpl && tpls.data && (
            <TemplatePicker cid={cid} value={templateKey} onChange={chooseTemplate} items={tpls.data.items} version={ch?.accentColor} disabled={render.isPending} />
          )}
          {sourceDirty && <p className="notice warn small" role="status">자료·초안에 저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 이미지를 갱신하고 게시 준비를 완료해 주세요.</p>}
          <CardCopyEditor key={`${cid}-${d.item.id}`} channelId={cid} itemId={d.item.id} itemVersion={d.item.version} templateKey={templateKey} onTemplateChange={chooseTemplate} coverMode={coverMode} previewRevision={`${currentCard?.id ?? ""}:${render.data && !olderRender(render.data) ? render.data.id : ""}`} showAi={workMode === "auto"} disabled={render.isPending || altDirty} renderDisabled={sourceDirty || imageGeneration.unresolved || !familyCopy.success && (!!coverRecovery.pending || workMode === "auto" && coverDraft.regenerateCover && (typographyOnly || !d.imageAiAvailable))} onDirtyChange={setCopyDirty} onApplyCaption={text => captionDraft.setCaptions({ ...caps, instagram: text })} onEditCaption={openManualCaption} onSaveAndRender={saved => render.mutateAsync(saved)} renderLabel={workMode === "auto" ? coverDraft.regenerateCover ? "표지 1장 다시 그리기 · 이미지 갱신" : "이미지 생성·갱신" : "카드 이미지 저장"} />
          {familyCopy.success && d.current && <CanvaEditorial key={`canva-${cid}-${d.item.id}`} channelId={cid} itemId={d.item.id} version={d.item.version} revisionId={d.current.id} copy={familyCopy.data} pageDesigns={savedPageDesigns.success ? savedPageDesigns.data : undefined} disabled={sourceDirty || copyDirty || altDirty || render.isPending || localRender.isPending || confirmManualCaption.isPending || imageGeneration.unresolved} onLocalRender={() => localRender.mutate()} />}
          {localRender.error && <ErrorBox error={localRender.error} />}
          {render.isPending && <p className="notice small" role="status">{renderedIntent.current?.redraw ? "새 표지 그림 1장을 요청하고 있습니다. OpenAI 이미지 API 비용이 발생하며, 완료한 그림으로 카드 이미지를 갱신합니다." : renderedIntent.current?.coverMode === "ai" ? "표지 일러스트와 각 페이지를 만들고 있어요. 몇 분 정도 걸릴 수 있습니다." : "원고를 페이지로 나누고 보드에 저장하고 있어요."}</p>}
          {render.error && <ErrorBox error={render.error} />}
          {imageGeneration.unresolved && <div className="notice warn stack" role="status"><strong>이미지 요청의 결과를 확인하고 있습니다.</strong><p className="small">저장된 문구는 유지합니다. 결과 확인은 같은 요청 ID를 사용하며 새 이미지 작업을 중복 시작하지 않습니다.</p><div className="row"><button className="btn" disabled={render.isPending} onClick={() => render.mutate(null)}>이전 이미지 결과 확인</button><button className="btn" disabled={imageGeneration.cancelling} onClick={() => void imageGeneration.cancel()}>{imageGeneration.cancelling ? "중단 확인 중…" : "이미지 요청 중단"}</button></div></div>}
          {imageGeneration.cancelError && <ErrorBox error={imageGeneration.cancelError} />}
          {render.data && <p className="small muted" role="status">{olderRender(render.data) ? "이전 이미지 요청의 완료를 확인했습니다. 현재의 더 최신 이미지와 표지 요청은 유지했습니다." : `${render.data.carousel.pages.length}장 이미지에 수정 내용을 반영했어요.`}</p>}
          {currentCard && <section className="stack generated-image-preview" aria-label="승인 전 완성 이미지 미리보기"><div className="row between"><h3>완성 이미지 미리보기</h3><span className="small muted">최종 승인 전</span></div><p className="hint">생성한 모든 장을 먼저 확인하세요. 문구·색상·그림을 수정하고 다시 만들 수 있습니다.</p>
          {currentCard && <CardCarousel key={currentCard.id} channelId={cid} assetId={currentCard.id} pages={currentCard.carousel?.pages ?? [{ id: currentCard.id, title: d.item.title }]} credit={currentCard.carousel?.cover.credit} onDirtyChange={setAltDirty} downloadDisabled={copyDirty || staleArtifact} />}
          </section>}
          {currentCard && <button className="btn primary" disabled={copyIncomplete || sourceDirty || copyDirty || altDirty || coverPending || imageGeneration.unresolved || staleArtifact || render.isPending} onClick={() => { setPublishOpen(true); window.setTimeout(() => document.getElementById("publish-options")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }}>이미지 확인 · 게시 준비 열기</button>}

          {!familyCopy.success && canva.data?.connected && (
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

          <details className="content-drawer publish-drawer" id="publish-options" open={publishOpen || !!captionDraft.recovery.pending} onToggle={event => {
            if (event.target !== event.currentTarget) return;
            if (captionDraft.recovery.pending && !event.currentTarget.open) event.currentTarget.open = true;
            setPublishOpen(event.currentTarget.open);
          }}><summary><strong>게시 준비</strong><span>{captionDraft.recovery.pending ? "미저장 입력 복구 필요" : "캡션 · 지금 게시 · 예약"}</span></summary><div className="content-drawer-body stack">
          <fieldset className="publication-destinations stack"><legend>게시 계정</legend>{destinations.map(destination => <label className="check" key={destination.id}><input type="checkbox" checked={destinationIds.includes(destination.id)} disabled={!destination.configured || approve.isPending || !!captionDraft.recovery.pending} onChange={event => setPickedDestinations(event.target.checked ? [...destinationIds, destination.id] : destinationIds.filter(id => id !== destination.id))} /><span>{destination.label} · {destination.platform === "instagram" ? "Instagram" : ["telegram", "telegram_channel"].includes(destination.platform) ? "Telegram" : destination.platform}{!destination.configured && " · 연결 확인 필요"}</span></label>)}{!destinations.length && <p className="notice warn small">연결한 게시 계정이 없습니다. <GuardedLink href="/instagram">게시 계정 연결</GuardedLink></p>}<p className="small muted">선택한 {destinationIds.length}개 계정에만 전송합니다. {destinations.filter(destination => destinationIds.includes(destination.id)).map(destination => destination.label).join(", ")}</p></fieldset>
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

          <details className="content-options"><summary>외부 편집 도구로 문구 복사</summary><CopyFields cid={cid} itemId={d.item.id} revisionId={d.current.id} /></details>

          <h3 style={{ margin: "8px 0 0" }}>게시물 캡션 (카드 이미지 밖의 글)</h3>
          <label className="field">
            인스타그램 캡션
            <span className="hint">
              {len(caps.instagram)} / 2200자 · 인스타그램 캡션의 URL은 클릭되는 링크가 아닙니다.
            </span>
            <textarea ref={captionInput} rows={8} value={caps.instagram} disabled={approve.isPending || !!captionDraft.recovery.pending} aria-label="인스타그램 캡션" onChange={(e) => captionDraft.setCaptions({ ...caps, instagram: e.target.value })} />
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
            <textarea rows={6} value={caps.telegram} disabled={approve.isPending || !!captionDraft.recovery.pending} aria-label="텔레그램 캡션" onChange={(e) => captionDraft.setCaptions({ ...caps, telegram: e.target.value })} />
          </label>
          </details>
          {familyCopy.success && <details className="content-options" data-testid="family-manual-caption" open={manualCaptionOpen} onToggle={event => { if (event.target === event.currentTarget) setManualCaptionOpen(event.currentTarget.open); }}>
            <summary>수동 · 현재 카드와 캡션 대조</summary>
            <div className="stack">
              <p className="small muted">AI 한도나 연결 오류일 때 위의 캡션을 직접 수정하세요. 아래 확인은 현재 8장과 중심 질문·사실·출처가 맞는지 직접 읽고 대조했다는 기록입니다. AI는 호출하지 않습니다.</p>
              {captionCoreQuestion ? <div className="notice small"><strong>현재 카드의 중심 질문</strong><p>{captionCoreQuestion}</p>{!captionIncludesQuestion && <><p>같은 질문 문장을 위 캡션에도 포함해 주세요. 기존 문구는 유지합니다.</p><button type="button" className="btn sm" disabled={confirmManualCaption.isPending || captionDraft.saving || approve.isPending || !!captionDraft.recovery.pending} onClick={() => captionDraft.setCaptions({ ...caps, instagram: `${caps.instagram}${caps.instagram.trim() ? "\n\n" : ""}${captionCoreQuestion}` })}>중심 질문을 캡션에 추가</button></>}</div> : <p className="notice warn small">저장된 중심 질문을 확인할 수 없습니다. 카드 원고를 저장하고 다시 열어 주세요.</p>}
              <label className="check"><input type="checkbox" checked={manualCaptionConfirmed} disabled={sourceDirty || copyDirty || altDirty || confirmManualCaption.isPending || captionDraft.saving || !!captionDraft.conflict || !!captionDraft.recovery.pending || !caps.instagram.trim() || !captionIncludesQuestion} onChange={event => setManualCaptionConfirmed(event.target.checked)} /><span>현재 8장의 문구·중심 질문·출처와 위 캡션을 대조했습니다.</span></label>
              <button className="btn" disabled={!manualCaptionConfirmed || !captionIncludesQuestion || sourceDirty || copyDirty || altDirty || approve.isPending || confirmManualCaption.isPending || captionDraft.saving || !!captionDraft.conflict || !!captionDraft.recovery.pending || !caps.instagram.trim() || len(caps.instagram) > 2200 || len(caps.telegram) > 1024} onClick={() => confirmManualCaption.mutate()}>{confirmManualCaption.isPending ? "캡션과 대조 기록 저장 중…" : "캡션 저장 · 현재 카드와 대조 확정"}</button>
              <p className="hint">게시 준비를 먼저 저장하고, 현재 카드와 연결한 새 원고 버전으로 기록합니다. 문구·배경이 같은 기존 Canva 출력은 보존하며, 검토·승인은 다시 진행합니다.</p>
              {confirmManualCaption.error && <ErrorBox error={confirmManualCaption.error} />}
              {confirmManualCaption.isSuccess && <p className="notice ok small" role="status">{confirmManualCaption.data.canvaOutputReused ? "수동 대조를 저장하고 기존 8장 출력을 유지했습니다. 검토·승인을 다시 진행해 주세요." : "수동 대조를 저장했습니다. 현재 원고로 8장 이미지를 다시 만들고 검토·승인해 주세요."}</p>}
            </div>
          </details>}

          {(len(caps.instagram) > 2200 || len(caps.telegram) > 1024) && <p className="notice warn small">캡션 글자 수를 줄인 뒤 저장해 주세요.</p>}
          <fieldset className="publish-timing"><legend>언제 게시할까요?</legend><div className="row">
            <label className={`publish-timing-option ${timing === "now" ? "selected" : ""}`}><input type="radio" name={`publish-timing-${d.item.id}`} checked={timing === "now"} disabled={approve.isPending || !!captionDraft.recovery.pending} onChange={() => setTiming("now")} /><span><strong>지금 게시</strong><small>승인하면 바로 전송 요청</small></span></label>
            <label className={`publish-timing-option ${timing === "later" ? "selected" : ""}`}><input type="radio" name={`publish-timing-${d.item.id}`} checked={timing === "later"} disabled={approve.isPending || !!captionDraft.recovery.pending} onChange={() => setTiming("later")} /><span><strong>예약 게시</strong><small>원하는 날짜·시간 선택</small></span></label>
          </div></fieldset>
          {timing === "later" && <label className="field">예약 시각 (한국 시간)<input type="datetime-local" value={when} disabled={approve.isPending || !!captionDraft.recovery.pending} min={toLocalInput(new Date())} onChange={e => setWhen(e.target.value)} /><span className="hint">전송 시작 전에는 취소할 수 있습니다. 예약 시각 이후 처리되며 서버 휴면·재시작 시 지연될 수 있습니다. 발행함에서 실제 결과를 확인하세요.</span>{!futureSchedule && <span className="card-copy-error">현재보다 뒤의 시간을 선택해 주세요.</span>}</label>}
          {!!unavailableDestinations.length && <div className="notice warn small">저장한 게시 계정 중 사용할 수 없는 계정이 있습니다. 계정을 다시 연결하거나 선택을 해제해 주세요. <button type="button" className="btn sm" disabled={approve.isPending} onClick={() => setPickedDestinations(destinationIds.filter(id => !unavailableDestinations.includes(id)))}>사용할 수 없는 계정 선택 해제</button></div>}
          {captionDraft.dirty && existingDeliveryState === "scheduled" && <p className="notice warn small">게시 준비를 저장하면 기존 대기 예약이 해제됩니다. 저장한 내용을 확인한 뒤 다시 승인해 주세요.</p>}
          <PublicationDraftControls draft={captionDraft} destinations={destinations} disabled={approve.isPending || len(caps.instagram) > 2200 || len(caps.telegram) > 1024} />
          <ReviewPanel d={d} cid={cid} pendingChanges={pendingChanges} />
          <PublicationRuntimeNotice runtime={runtime} />
          {d.publicationReadiness && !d.publicationReadiness.ready && <div className="notice warn" role="alert"><strong>게시 전에 확인할 항목</strong><ul>{d.publicationReadiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><div className="row"><GuardedLink href="/instagram">인스타그램 연결 확인 →</GuardedLink><GuardedLink href="/connections">API 연결 확인 →</GuardedLink></div></div>}
          {existingDeliveryMessage && <div className="notice warn"><p className="small">{existingDeliveryMessage}</p><button className="btn sm" onClick={onApproved}>전송 상태 확인</button></div>}
          {coverPending && <p className="notice warn small" role="status">표지 다시 그리기 요청이 남아 있습니다. 자동 작업에서 표지를 갱신하거나 요청을 비운 뒤 게시 이미지를 확인해 주세요.</p>}
          {copyIncomplete && <p className="notice warn small" role="status">카드 문구를 먼저 완성해 저장한 뒤 이미지를 갱신해 주세요. 현재는 요약 저장까지만 완료됐습니다.</p>}
          {pendingChanges && !coverPending && !copyIncomplete && <p className="notice warn small" role="status">저장하지 않은 변경을 먼저 저장해 주세요. 초안·카드 문구를 바꿨다면 게시 이미지도 다시 준비해야 합니다.</p>}
          <label className="check publish-confirm"><input type="checkbox" checked={confirmed} disabled={approve.isPending || !currentCard || pendingChanges || !destinationIds.length} onChange={event => setConfirmed(event.target.checked)} />이미지 전체·저장된 캡션·선택한 게시 계정을 확인했습니다.</label>
          <div className="row">
            <button className="btn primary" onClick={() => approve.mutate()} disabled={approve.isPending || !confirmed || !futureSchedule || pendingChanges || !destinationIds.length || !!unavailableDestinations.length || !currentCard || d.item.reviewStatus !== "reviewed" || d.publicationReadiness?.ready === false || !!existingDeliveryState}>
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
            const state = deliveryState(delivery.status, a.scheduledAt, Date.now(), delivery.outcomeSource, delivery.needsReconciliation);
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
