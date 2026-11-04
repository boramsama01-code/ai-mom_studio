import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aiProviders, aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { cardCopyLimits, cardCopySchema, cardPageBackgroundSchema, NEWS_EDITORIAL_LABELS, NEWS_EDITORIAL_ROLES, type CardCopy, type CardPageBackground } from "@shared/cardCopy";
import type { AiSelection } from "@shared/channelAi";
import { api, apiBlob, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import { ErrorBox, GuardedLink, Loading } from "./ui";
import "./cardCopy.css";
import { useGenerationRequest } from "./useGenerationRequest";
import { z } from "zod";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import { PageBackgroundEditor, type PageArtworkResult } from "./PageBackgroundEditor";

export type CardCopyResponse = { version: number; revisionId: number; copy: CardCopy; hasSavedCopy: boolean; recoveryNotice?: string; recommendedStoryFormat?: "discussion8" | null; ai?: Record<"summary" | "copy" | "image", AiSelection> };
type AiStatus = { defaultProvider: AiProvider; text: Record<AiProvider, boolean>; image?: boolean };
type Proposal = Omit<CardCopyResponse, "hasSavedCopy"> & { model?: string; selectedPage?: number; scope?: "all" | "page"; jobId?: number };
type Props = {
  channelId: number;
  itemId: number;
  itemVersion?: number;
  templateKey?: string | null;
  coverMode?: "reuse" | "ai" | "typography";
  previewRevision?: number | string;
  showAi?: boolean;
  disabled?: boolean;
  renderDisabled?: boolean;
  onTemplateChange?: (key: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (saved: CardCopyResponse) => void;
  onSaveAndRender?: (saved: CardCopyResponse) => Promise<unknown>;
  renderLabel?: string;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const chars = (text: string) => [...text].length;
const copyText = (copy: CardCopy) => [
  `템플릿: ${cardCopyLimits(copy.templateKey, copy.storyFormat).templateName} (${copy.templateKey})`,
  `표지\n${copy.cover.title}\n${copy.cover.subtitle}`,
  ...copy.pages.map((page, i) => `${page.role ? `${i + 2}페이지 · ${NEWS_EDITORIAL_LABELS[page.role]}` : `${i + 1}번째 본문`}\n${page.title}\n${page.subtitle}\n${page.body}${page.columns ? `\n${page.columns.map(col => `${col.title}\n${col.body}`).join("\n\n")}` : ""}${page.background ? `\n배경 이미지 #${page.background.assetId}` : ""}`),
].join("\n\n");
// Checkpoint incomplete edits too. Save-time nonempty/length checks remain in cardCopySchema.
const recoveryCopySchema = z.object({
  version: z.literal(1), templateKey: z.string(), storyFormat: z.literal("discussion8").optional(),
  cover: z.object({ title: z.string(), subtitle: z.string(), background: cardPageBackgroundSchema.optional() }),
  pages: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string(), body: z.string(), role: z.enum(NEWS_EDITORIAL_ROLES).optional(), columns: z.array(z.object({ title: z.string(), body: z.string() })).length(2).optional(), sourceIds: z.array(z.number().int().positive()).max(12).optional(), background: cardPageBackgroundSchema.optional() })).min(1).max(9),
});
const parseRecoveryCopy = (value: unknown): CardCopy | null => { const parsed = recoveryCopySchema.safeParse(value); return parsed.success ? parsed.data : null; };

/** The preview uses the same renderer as the saved images. Caption/alt text are separate. */
export function CardCopyEditor({ channelId, itemId, itemVersion, templateKey, coverMode = "reuse", previewRevision, showAi = true, disabled = false, renderDisabled = false, onTemplateChange, onDirtyChange, onSaved, onSaveAndRender, renderLabel = "카드뉴스 만들기" }: Props) {
  const path = `/channels/${channelId}/items/${itemId}/card-copy`;
  const queryKey = ["card-copy", channelId, itemId];
  const qc = useQueryClient(), guard = useDirtyGuard(), uid = useId();
  const loaded = useQuery({ queryKey, queryFn: () => api<CardCopyResponse>(path), retry: false });
  const [base, setBase] = useState<CardCopyResponse | null>(null), baseRef = useRef<CardCopyResponse | null>(null);
  const [copy, setCopy] = useState<CardCopy | null>(null), copyRef = useRef<CardCopy | null>(null);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false), [rendering, setRendering] = useState(false), [generating, setGenerating] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null), [aiError, setAiError] = useState<Error | null>(null);
  const [conflicting, setConflicting] = useState<CardCopyResponse | null>(null), [conflictLoading, setConflictLoading] = useState(false);
  const [proposal, setProposal] = useState<(Proposal & { source: string; selectedPage: number }) | null>(null);
  const appliedProposal = useRef<number | null>(null);
  const [instructions, setInstructions] = useState("");
  const [providerChoice, setProviderChoice] = useState<AiProvider | null>(null);
  const status = useQuery({ queryKey: ["studio-ai-status"], queryFn: () => api<AiStatus>("/studio/ai-status"), retry: false, staleTime: 30_000 });
  const provider = providerChoice ?? base?.ai?.copy.provider ?? loaded.data?.ai?.copy.provider ?? "openai", aiReady = !!status.data?.text[provider];
  const summaryProvider = base?.ai?.summary.provider ?? "gemini", summaryReady = !!status.data?.text[summaryProvider];
  const [preview, setPreview] = useState<{ url: string; signature: string } | null>(null), previewUrl = useRef<string | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null), [previewBusy, setPreviewBusy] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const serial = useRef<Promise<CardCopyResponse> | null>(null);
  const action = useRef<"generate" | "render" | null>(null);
  const generation = useGenerationRequest(channelId, itemId, "card-copy");
  const generationSource = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null), subtitleRef = useRef<HTMLTextAreaElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !!copy && !!base && !same(copy, base.copy);
  const valid = copy ? cardCopySchema.safeParse(copy) : null;
  const invalid = valid?.success === false;
  const pageIndex = Math.min(selected, copy?.pages.length ?? 0);
  const page = copy ? (pageIndex === 0 ? copy.cover : copy.pages[pageIndex - 1]) : null;
  const signature = JSON.stringify({ copy, version: base?.version, page: pageIndex, coverMode, previewRevision });
  const previewCurrent = preview?.signature === signature;
  const callbacks = useRef({ onSaved, onTemplateChange });
  callbacks.current = { onSaved, onTemplateChange };

  function put(next: CardCopy) { copyRef.current = next; setCopy(next); }
  function adopt(next: CardCopyResponse, preserveTemplate = false) {
    const nextCopy = preserveTemplate && templateKey ? { ...next.copy, templateKey } : next.copy;
    baseRef.current = next; setBase(next); put(nextCopy);
    appliedProposal.current = null;
    setSaveError(null); setConflicting(null); setProposal(null);
    callbacks.current.onTemplateChange?.(nextCopy.templateKey);
  }
  const recovery = useDraftRecovery<CardCopy | null>({
    recoveryKey: `item:${channelId}:${itemId}:card-copy`, label: "카드 문구", version: base?.version ?? 0,
    value: copy, serverValue: base?.copy ?? null, dirty, ready: !!base && !!copy,
    parse: parseRecoveryCopy, onRestore: next => { if (next) { put(next); setProposal(null); setSaveError(null); callbacks.current.onTemplateChange?.(next.templateKey); } },
  });
  const busy = disabled || !!recovery.pending || rendering || (generating && !generation.cancelled);
  const locked = busy || saving || conflictLoading || backgroundBusy;
  useEffect(() => {
    const next = loaded.data;
    if (!next || (baseRef.current && next.version <= baseRef.current.version)) return;
    if (!baseRef.current || same(copyRef.current, baseRef.current.copy)) adopt(next, !baseRef.current);
    else setConflicting(next);
  }, [loaded.data]);
  useEffect(() => {
    if (itemVersion && baseRef.current && itemVersion > baseRef.current.version) void loaded.refetch();
  }, [itemVersion]);
  useEffect(() => {
    if (!templateKey || !copyRef.current || copyRef.current.templateKey === templateKey) return;
    put({ ...copyRef.current, templateKey }); setProposal(null); setSaveError(null);
  }, [templateKey, !!copy]);
  useEffect(() => { setSelected(value => Math.min(value, copy?.pages.length ?? 0)); }, [copy?.pages.length]);

  async function loadConflict() {
    setConflictLoading(true);
    try { setConflicting(await api<CardCopyResponse>(path)); }
    catch (error) { setSaveError(error as Error); }
    finally { setConflictLoading(false); }
  }
  async function saveNow(): Promise<CardCopyResponse> {
    if (recovery.pending) throw new Error("기기 복구본을 먼저 불러오거나 버려 주세요.");
    if (serial.current) { await serial.current; return saveNow(); }
    const current = baseRef.current, snapshot = copyRef.current;
    if (!current || !snapshot) throw new Error("카드 문구를 불러온 뒤 저장해 주세요.");
    const parsed = cardCopySchema.safeParse(snapshot);
    if (!parsed.success) throw new Error("제목·부제·본문의 입력 안내를 확인해 주세요.");
    if (current.hasSavedCopy && same(snapshot, current.copy)) return current;
    setSaving(true); setSaveError(null);
    const request = api<CardCopyResponse>(path, { method: "PATCH", body: { version: current.version, copy: snapshot, ...(appliedProposal.current ? { proposalJobId: appliedProposal.current } : {}) } });
    serial.current = request;
    try {
      const saved = { ...current, ...await request };
      appliedProposal.current = null;
      baseRef.current = saved; setBase(saved);
      if (same(copyRef.current, snapshot)) { recovery.clear(); put(saved.copy); }
      setConflicting(null); setProposal(null);
      qc.setQueryData(queryKey, saved);
      void qc.invalidateQueries({ queryKey: ["ch", channelId, "item", itemId] });
      void qc.invalidateQueries({ queryKey: ["studio"] });
      callbacks.current.onSaved?.(saved);
      return saved;
    } catch (error) {
      setSaveError(error as Error);
      if (error instanceof ApiError && error.status === 409) await loadConflict();
      throw error;
    } finally { serial.current = null; setSaving(false); }
  }
  const saveRef = useRef(saveNow); saveRef.current = saveNow;
  useEffect(() => {
    const key = `card-copy-${channelId}-${itemId}`;
    guard.setDirty(key, dirty || !!recovery.pending || saving || rendering || backgroundBusy || (generating && !generation.cancelled), async () => {
      if (recovery.pending || rendering || backgroundBusy || (generating && !generation.cancelled) || conflicting) return false;
      try { await saveRef.current(); return same(copyRef.current, baseRef.current?.copy); } catch { return false; }
    }, () => {
      recovery.clear();
      if (baseRef.current) put(baseRef.current.copy);
    });
    return () => guard.setDirty(key, false);
  }, [channelId, itemId, dirty, recovery.pending, saving, rendering, backgroundBusy, generating, generation.cancelled, conflicting, guard]);
  useEffect(() => { onDirtyChange?.(dirty || locked || !base || invalid || !!conflicting); }, [dirty, locked, base, invalid, conflicting, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!copy || !base || invalid) { setPreviewBusy(false); return; }
    const controller = new AbortController(); let live = true;
    setPreviewBusy(true); setPreviewError(null);
    const timer = window.setTimeout(async () => {
      try {
        const blob = await apiBlob(`${path}/preview`, "image/jpeg", { method: "POST", body: { version: base.version, copy, page: pageIndex, coverMode }, signal: controller.signal });
        if (!live) return;
        const url = URL.createObjectURL(blob);
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url; setPreview({ url, signature });
      } catch (error) { if (live && !controller.signal.aborted) setPreviewError(error as Error); }
      finally { if (live) setPreviewBusy(false); }
    }, 450);
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [signature, invalid, previewRetry]);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  async function saveAndRender() {
    if (!onSaveAndRender || renderDisabled || locked || conflicting || action.current) return;
    action.current = "render";
    setRendering(true); setSaveError(null);
    try { const saved = await saveNow(); await onSaveAndRender(saved); }
    catch (error) { setSaveError(error as Error); }
    finally { action.current = null; setRendering(false); }
  }
  async function generate(rebuild = false) {
    if (((!aiReady || (rebuild && !summaryReady)) && !generation.unresolved) || locked || conflicting || action.current) return;
    action.current = "generate";
    setGenerating(true); setAiError(null); setProposal(null);
    try {
      const recovering = generation.unresolved;
      const saved = recovering ? baseRef.current! : await saveNow();
      if (!recovering) generationSource.current = JSON.stringify(saved.copy);
      const selectedPage = pageIndex;
      const next = await generation.run<Proposal>(`${path}/generate`, { version: saved.version, templateKey: saved.copy.templateKey, ...(providerChoice ? { provider: providerChoice } : {}), ...(instructions.trim() ? { instructions: instructions.trim() } : {}), ...(rebuild ? { storyFormat: "discussion8", refreshAnalysis: true } : { selectedPage, ...(saved.copy.storyFormat ? { storyFormat: saved.copy.storyFormat } : {}) }) });
      // The same server version proves the saved baseline on a restored tab;
      // unsaved local changes still fail canApplyProposal's snapshot comparison.
      setProposal({ ...next, source: generationSource.current ?? (next.version === saved.version ? JSON.stringify(saved.copy) : ""), selectedPage: next.selectedPage ?? selectedPage });
    } catch (error) { setAiError(error as Error); }
    finally { action.current = null; setGenerating(false); }
  }
  function update(field: "title" | "subtitle" | "body", value: string) {
    const current = copyRef.current; if (!current) return;
    if (pageIndex === 0 && field !== "body") put({ ...current, cover: { ...current.cover, [field]: value } });
    else if (pageIndex > 0) put({ ...current, pages: current.pages.map((p, i) => i === pageIndex - 1 ? { ...p, [field]: value } : p) });
    setSaveError(null);
  }
  function updateColumn(index: number, field: "title" | "body", value: string) {
    const current = copyRef.current; if (!current || pageIndex === 0) return;
    put({ ...current, pages: current.pages.map((p, i) => i === pageIndex - 1 ? { ...p, columns: p.columns?.map((col, n) => n === index ? { ...col, [field]: value } : col) } : p) });
    setSaveError(null);
  }
  function setBackground(index: number, background?: CardPageBackground) {
    const current = copyRef.current; if (!current) return;
    if (index === 0) put({ ...current, cover: { ...current.cover, background } });
    else put({ ...current, pages: current.pages.map((p, i) => i === index - 1 ? { ...p, background } : p) });
    setSaveError(null);
  }
  function applyBackground(result: PageArtworkResult, priorAssetId: number | null) {
    const current = copyRef.current, baseline = baseRef.current;
    if (!current || current.storyFormat !== "discussion8" || baseline?.version !== result.version) return false;
    const index = result.pageId === "cover" ? 0 : current.pages.findIndex(p => p.id === result.pageId) + 1;
    if (result.pageId !== "cover" && index === 0) return false;
    const target = index === 0 ? current.cover : current.pages[index - 1];
    if ((target.background?.assetId ?? null) !== priorAssetId) return false;
    setBackground(index, { assetId: result.assetId, opacity: target.background?.opacity ?? 100 });
    return true;
  }
  function issue(field: "title" | "subtitle" | "body") {
    if (!valid || valid.success) return undefined;
    const key = pageIndex === 0 ? `cover.${field}` : `pages.${pageIndex - 1}.${field}`;
    return valid.error.issues.find(error => error.path.join(".") === key)?.message;
  }
  function focus(field: "title" | "subtitle" | "body") {
    const node = field === "title" ? titleRef.current : field === "subtitle" ? subtitleRef.current : bodyRef.current;
    node?.focus(); node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (!base || !copy || !page) return <section className="card-copy-editor stack" aria-label="카드에 들어갈 문구">{loaded.error ? <ErrorBox error={loaded.error} retry={() => loaded.refetch()} /> : <Loading lines={4} label="카드 문구 불러오는 중" />}</section>;
  const limits = cardCopyLimits(copy.templateKey, copy.storyFormat);
  const bodyText = pageIndex > 0 ? copy.pages[pageIndex - 1].body : null;
  const editorialPage = pageIndex > 0 ? copy.pages[pageIndex - 1] : null;
  const pageLabel = pageIndex === 0 ? "표지" : editorialPage?.role ? `${pageIndex + 1}페이지 · ${NEWS_EDITORIAL_LABELS[editorialPage.role]}` : `${pageIndex}번째 본문`;
  const canApplyProposal = !!proposal && proposal.version === base.version && proposal.source === JSON.stringify(copy);
  return <section className="card-copy-editor stack" aria-labelledby={`${uid}-heading`}>
    <div className="card-copy-heading"><div><h3 id={`${uid}-heading`}>문구·미리보기</h3><p className="small muted">카드를 선택해서 글을 고치세요. 게시물 캡션과 별도로 저장합니다.</p></div><span className={`badge ${dirty ? "warn" : "ok"}`} role="status">{saving ? "문구 저장 중…" : dirty ? "저장하지 않은 수정" : base.hasSavedCopy ? "문구 저장됨" : "원고에서 가져온 문구"}</span></div>
    <RecoveryNotice recovery={recovery} formatValue={value => value ? copyText(value) : ""} />
    {base.recoveryNotice && <p className="notice warn small" role="status">{base.recoveryNotice} 문구를 저장하기 전까지 기존 저장 내용은 바뀌지 않습니다.</p>}
    {showAi && (base.recommendedStoryFormat === "discussion8" || copy.storyFormat === "discussion8") && <div className="card-copy-story-action"><div><strong>뉴스 한 편에서 시작하는 8장 대화</strong><p className="hint">표지 → 요약 → 의미 → 질문 → 두 시선 → 개념 정의 → 활동 → 닫는 표지</p><p className="hint">기사 요약 {aiProviderLabels[summaryProvider]} · 문구 {aiProviderLabels[provider]} · <GuardedLink href="/settings">채널별 AI 설정</GuardedLink></p></div><button className="btn primary" disabled={locked || invalid || !!conflicting || ((!aiReady || !summaryReady) && !generation.unresolved)} onClick={() => void generate(true)}>{generating ? "원문을 확인하고 8장 구성 중…" : generation.unresolved ? "기존 AI 작업 결과 확인" : "8장 뉴스 대화로 다시 구성"}</button>{(!aiReady || !summaryReady) && <p className="hint">선택한 요약·문구 AI를 연결한 뒤 사용할 수 있습니다. 기존 문구는 직접 편집하고 저장할 수 있어요.</p>}</div>}
    <div hidden={!showAi && !generation.unresolved}><details className="card-copy-ai-tools"><summary>AI로 문구 다듬기</summary><div className="card-copy-ai"><label className="field">문구 작성 AI<select value={provider} disabled={locked || generation.unresolved} onChange={event => setProviderChoice(event.target.value as AiProvider)}>{aiProviders.map(p => <option key={p} value={p}>{aiProviderLabels[p]}{status.data && !status.data.text[p] ? " · 연결 필요" : ""}</option>)}</select></label><div><button className="btn" disabled={generating || locked || (!aiReady && !generation.unresolved) || invalid || !!conflicting} onClick={() => void generate()}>{generating ? "템플릿에 맞춰 작성 중…" : generation.unresolved ? "기존 AI 작업 결과 확인" : dirty || !base.hasSavedCopy ? "문구 저장 후 AI 제안받기" : "AI로 템플릿 문구 제안받기"}</button><p className="hint">선택한 템플릿에 맞는 제목·부제·본문을 제안합니다. 확인 후 적용하며, 선택한 AI의 API 요금·한도가 적용됩니다.</p></div></div>
    {providerChoice && <button className="btn ghost sm" disabled={locked || generation.unresolved} onClick={() => setProviderChoice(null)}>채널 기본 AI로 되돌리기</button>}
    {status.error && <ErrorBox error={status.error} retry={() => status.refetch()} />}
    <label className="field">어떻게 수정할까요?<textarea rows={3} maxLength={1500} value={instructions} disabled={locked || generation.unresolved} placeholder="예: 선택한 카드의 제목을 더 짧게, 본문은 핵심 숫자를 유지하고 쉬운 말로 바꿔 줘." onChange={event => setInstructions(event.target.value)} /><span className="hint">현재 저장한 문구와 요청을 함께 전달합니다. 생성 결과는 먼저 비교하며, 적용한 뒤에도 직접 수정할 수 있습니다.</span></label>
    {status.data && !aiReady && <p className="small muted">직접 입력·저장은 바로 사용할 수 있어요. AI 작성은 <GuardedLink href={`/connections?service=${provider}`}>AI 연결 설정</GuardedLink> 후 사용할 수 있습니다.</p>}
    </details></div>
    {aiError && <ErrorBox error={aiError} retry={generation.unresolved ? () => void generate() : undefined} />}
    {generation.unresolved && <div className="stack"><p className="small muted">기존 요청의 결과를 확인합니다. 응답이 없어도 새 유료 작업을 자동으로 시작하지 않습니다.</p><div><button className="btn sm" disabled={generation.cancelling} onClick={() => void generation.cancel()}>{generation.cancelling ? "중단 확인 중…" : "AI 요청 중단"}</button></div></div>}
    {generation.cancelled && <p className="notice small" role="status">AI 요청을 중단했습니다. 직접 편집·저장을 계속할 수 있습니다.</p>}
    {generation.cancelError && <ErrorBox error={generation.cancelError} />}
    {proposal && <div className="notice card-copy-proposal stack"><strong>AI 문구 제안 · 아직 카드에 반영하지 않았어요</strong><details open><summary>{proposal.copy.pages.length + 1}장 제안 전체 보기</summary><pre>{copyText(proposal.copy)}</pre></details><div className="row">{proposal.scope !== "all" && <button className="btn primary sm" disabled={locked || !canApplyProposal || proposal.copy.storyFormat !== copy.storyFormat || (proposal.selectedPage > 0 && !proposal.copy.pages[proposal.selectedPage - 1])} onClick={() => {
      const index = proposal.selectedPage;
      appliedProposal.current = proposal.jobId ?? null;
      put(index === 0 ? { ...copy, cover: proposal.copy.cover } : { ...copy, pages: copy.pages.map((page, i) => i === index - 1 ? { ...proposal.copy.pages[i], id: page.id } : page) });
      setSelected(index); setProposal(null);
    }}>{proposal.selectedPage === 0 ? "표지에만 제안 적용" : `${proposal.selectedPage}번째 카드에만 제안 적용`}</button>}<button className={`btn sm ${proposal.scope === "all" ? "primary" : ""}`} disabled={locked || !canApplyProposal} onClick={() => { appliedProposal.current = proposal.jobId ?? null; put(proposal.copy); setProposal(null); setSelected(0); }}>{proposal.scope === "all" && proposal.copy.storyFormat === "discussion8" ? "8장 제안을 편집기에 적용" : "제안 문구로 바꾸기"}</button><button className="btn ghost sm" onClick={() => setProposal(null)}>제안 닫기</button></div><p className="hint">{proposal.scope === "all" ? "전체 구성을 편집기에 불러옵니다. 직접 수정한 뒤 저장하면 새 버전으로 기록됩니다." : "한 카드에만 적용하면 다른 카드의 문구는 유지합니다. ‘제안 문구로 바꾸기’는 전체 문구를 바꿉니다."}</p>{!canApplyProposal && <p className="small">제안 이후 문구나 저장 버전이 바뀌었습니다. 현재 입력은 유지되며 새 제안을 받아 적용할 수 있어요.</p>}</div>}
    {conflicting && <div className="notice warn stack" role="alert"><strong>다른 곳에서 먼저 저장한 내용이 있어요. 입력한 문구는 유지했습니다.</strong><details><summary>최신 저장본과 현재 입력 비교하기</summary><div className="card-copy-compare"><div><h4>최신 저장본</h4><pre>{copyText(conflicting.copy)}</pre></div><div><h4>현재 입력</h4><pre>{copyText(copy)}</pre></div></div><div className="row"><button className="btn sm" disabled={locked} onClick={() => { recovery.clear(); adopt(conflicting); }}>최신 저장본으로 바꾸기</button><button className="btn sm" disabled={locked || invalid} onClick={() => { const latest = conflicting; appliedProposal.current = null; baseRef.current = latest; setBase(latest); setConflicting(null); void saveNow().catch(() => {}); }}>현재 입력으로 최신 버전에 저장</button></div></details></div>}
    <nav className="card-copy-pages" aria-label="문구를 편집할 페이지"><button className="btn sm" disabled={pageIndex === 0} onClick={() => setSelected(pageIndex - 1)}>← 이전</button><div className="card-copy-dots" role="group" aria-label="페이지 선택">{[copy.cover, ...copy.pages].map((p, i) => <button key={i === 0 ? "cover" : copy.pages[i - 1].id} aria-label={i === 0 ? "표지 문구 편집" : copy.pages[i - 1].role ? `${i + 1}페이지 ${NEWS_EDITORIAL_LABELS[copy.pages[i - 1].role!]} 문구 편집` : `${i}번째 본문 문구 편집 · ${p.title}`} aria-current={i === pageIndex ? "step" : undefined} onClick={() => setSelected(i)}><span aria-hidden="true">{copy.storyFormat === "discussion8" ? i + 1 : i === 0 ? "표지" : `${i}장`}</span></button>)}</div><button className="btn sm" disabled={pageIndex === copy.pages.length} onClick={() => setSelected(pageIndex + 1)}>다음 →</button></nav>
    <div className="card-copy-workspace">
      <div className="card-copy-preview-column"><div className="row between small"><strong>{pageLabel}</strong><span className="muted">전체 {copy.pages.length + 1}장</span></div><figure className={`card-copy-preview ${previewCurrent ? "" : "is-stale"}`} aria-busy={previewBusy}>{preview && <img src={preview.url} alt={`${pageLabel} 실제 렌더링 미리보기${previewCurrent ? "" : " · 수정 반영 전"}`} onError={() => setPreviewError(new Error("미리보기 이미지를 불러오지 못했습니다."))} />}{!preview && <div className="card-copy-placeholder">제목·부제·본문을 카드에 배치하고 있어요.</div>}{(previewBusy || !previewCurrent) && <figcaption role="status">{previewBusy ? "수정 내용 반영 중…" : invalid ? "입력 안내를 확인해 주세요" : previewError ? "수정 내용 반영 전" : "미리보기 준비 중…"}</figcaption>}</figure>{coverMode === "ai" && !copy.cover.background && <p className="hint">새 AI 표지 그림은 ‘{renderLabel}’를 누르면 생성됩니다. 저장된 그림은 문구를 수정해도 유지하며, 생성이 끝나면 이 미리보기에 반영합니다.</p>}{previewError && <ErrorBox error={previewError} retry={() => setPreviewRetry(value => value + 1)} />}</div>
      <div className="card-copy-fields">
        <label className="field" htmlFor={`${uid}-title`}><span className="row between"><strong>{pageIndex === 0 ? "표지 제목" : "본문 제목"}</strong><span className="hint">{chars(page.title)}자 · {pageIndex === 0 ? limits.recommended.coverTitle : limits.recommended.title}자 권장</span></span><textarea ref={titleRef} id={`${uid}-title`} rows={2} value={page.title} disabled={busy} aria-invalid={!!issue("title")} aria-describedby={`${uid}-title-help`} onChange={event => update("title", event.target.value)} /><span id={`${uid}-title-help`} className={issue("title") ? "card-copy-error" : "hint"}>{issue("title") ?? `카드에서 가장 크게 보이는 제목입니다. 최대 ${pageIndex === 0 ? limits.max.coverTitle : limits.max.title}자까지 입력할 수 있어요.`}</span></label>
        <label className="field" htmlFor={`${uid}-subtitle`}><span className="row between"><strong>{pageIndex === 0 ? "표지 부제" : "본문 부제"} <span className="muted small">선택</span></strong><span className="hint">{chars(page.subtitle)}자 · {limits.recommended.subtitle}자 권장</span></span><textarea ref={subtitleRef} id={`${uid}-subtitle`} rows={2} value={page.subtitle} disabled={busy} aria-invalid={!!issue("subtitle")} aria-describedby={`${uid}-subtitle-help`} onChange={event => update("subtitle", event.target.value)} /><span id={`${uid}-subtitle-help`} className={issue("subtitle") ? "card-copy-error" : "hint"}>{issue("subtitle") ?? "제목을 보충하는 짧은 문장입니다. 비워 두면 표시하지 않습니다."}</span></label>
        {bodyText !== null && <label className="field" htmlFor={`${uid}-body`}><span className="row between"><strong>카드 본문</strong><span className="hint">{chars(bodyText)}자 · {limits.recommended.body}자 권장</span></span><textarea ref={bodyRef} id={`${uid}-body`} rows={6} value={bodyText} disabled={busy} aria-invalid={!!issue("body")} aria-describedby={`${uid}-body-help`} onChange={event => update("body", event.target.value)} /><span id={`${uid}-body-help`} className={issue("body") ? "card-copy-error" : "hint"}>{issue("body") ?? (chars(bodyText) > limits.recommended.body ? `${limits.recommended.body}자를 넘었습니다. 글자가 잘리지 않도록 미리보기와 저장 안내를 확인해 주세요. 입력한 내용은 자동으로 자르지 않습니다.` : "이미지 안에 들어가는 본문입니다. 캡션·대체텍스트와 별도로 저장합니다.")}</span></label>}
        {editorialPage?.columns && <fieldset className="card-copy-columns"><legend>{editorialPage.role === "concept" ? "서로 다른 정의의 예시" : "두 가지 시선"}</legend>{editorialPage.columns.map((column, index) => <div className="stack" key={index}><label className="field">{index + 1}번 칸 제목<input id={`${uid}-column-${index}-title`} value={column.title} disabled={busy} onChange={event => updateColumn(index, "title", event.target.value)} /></label><label className="field">{index + 1}번 칸 설명<textarea id={`${uid}-column-${index}-body`} rows={4} value={column.body} disabled={busy} onChange={event => updateColumn(index, "body", event.target.value)} /><span className="hint">{chars(column.body)}자 · 100자 권장</span></label></div>)}</fieldset>}
        {copy.storyFormat === "discussion8" && <PageBackgroundEditor key={`${channelId}:${itemId}`} channelId={channelId} itemId={itemId} pageIndex={pageIndex} background={page.background} disabled={busy || saving || conflictLoading || !!conflicting || invalid} showAi={showAi} imageReady={!!status.data?.image} imageModel={base.ai?.image.model} save={saveNow} onApply={applyBackground} onChange={next => setBackground(pageIndex, next)} onBusyChange={setBackgroundBusy} />}
      </div>
    </div>
    {invalid && <p className="notice warn small" role="alert">제목과 본문은 비울 수 없습니다. 제목·부제·본문의 글자 수 안내를 확인한 뒤 저장해 주세요. 입력한 내용은 그대로 유지됩니다.</p>}
    {saveError && <ErrorBox error={saveError} />}
    <div className="card-copy-savebar"><p className="small muted">{dirty ? "수정 내용을 저장하고 이미지에 반영하세요." : "작성한 글은 이 카드에만 반영돼요."}</p><div className="row"><button className="btn" disabled={locked || invalid || !!conflicting || (!dirty && base.hasSavedCopy)} onClick={() => void saveNow().catch(() => {})}>{saving ? "저장 중…" : "문구 저장"}</button>{onSaveAndRender && <button className="btn primary" disabled={generating || renderDisabled || locked || invalid || !!conflicting} onClick={() => void saveAndRender()}>{rendering ? "카드뉴스 만드는 중…" : `${dirty || !base.hasSavedCopy ? "저장하고 " : ""}${renderLabel}`}</button>}</div></div>
  </section>;
}
