import { CoverCropPreview } from "./CoverCropPreview";
import { ManualFamilyInitializer } from "./ManualFamilyInitializer";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { aiProviders, aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { cardCopyLimits, cardCopySchema, cardPageBackgroundSchema, NEWS_EDITORIAL_LABELS, NEWS_EDITORIAL_ROLES, type CardCopy, type CardPageBackground } from "@shared/cardCopy";
import type { AiSelection } from "@shared/channelAi";
import { newsEditorialResourceSchema } from "@shared/newsEditorialResource";
import { api, apiBlob, ApiError } from "./api";
import { useDirtyGuard } from "./state";
import { ErrorBox, GuardedLink, Loading } from "./ui";
import "./cardCopy.css";
import { useGenerationRequest } from "./useGenerationRequest";
import { z } from "zod";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import { PageBackgroundEditor, type PageArtworkResult } from "./PageBackgroundEditor";
import type { StoredCardCopy } from "@shared/storedCardCopy";
import { familyDialogueMetadataSchema, type FamilyDialogueMetadata } from "@shared/familyDialogue";
import { FamilyDialogueEditor, familyCopyText, type FamilyDialogueResponse, type FamilyProposal } from "./FamilyDialogueEditor";
import { readingProfileForTemplateKey } from "@shared/readingCardProfiles";
import { collectionUsesArt } from "@shared/cardDesigns";

export type CardCopyResponse = { version: number; revisionId: number; copy: CardCopy; hasSavedCopy: boolean; recoveryNotice?: string; recommendedStoryFormat?: "discussion8" | "family_dialogue_8" | null; ai?: Record<"summary" | "copy" | "image", AiSelection> };
export type StoredCardCopyResponse = Omit<CardCopyResponse, "copy"> & { copy: StoredCardCopy } & Partial<FamilyDialogueMetadata>;
type AiStatus = { defaultProvider: AiProvider; text: Record<AiProvider, boolean>; image?: boolean };
type Proposal = Omit<CardCopyResponse, "hasSavedCopy"> & { model?: string; selectedPage?: number; scope?: "all" | "page"; jobId?: number };
export type CardCopyEditorProps = {
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
  onSaved?: (saved: StoredCardCopyResponse) => void;
  onSaveAndRender?: (saved: StoredCardCopyResponse) => Promise<unknown>;
  onApplyCaption?: (caption: string) => void;
  onEditCaption?: () => void;
  /** Internal dispatcher guard for a remote schema-version change. */
  formatConflict?: boolean;
  renderLabel?: string;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const chars = (text: string) => [...text].length;
const copyText = (copy: CardCopy) => [
  `템플릿: ${cardCopyLimits(copy.templateKey, copy.storyFormat).templateName} (${copy.templateKey})`,
  `표지\n${copy.cover.title}\n${copy.cover.subtitle}`,
  ...copy.pages.map((page, i) => `${page.role ? `${i + 2}페이지 · ${NEWS_EDITORIAL_LABELS[page.role]}` : `${i + 1}번째 본문`}\n${page.title}\n${page.subtitle}\n${page.body}${page.columns ? `\n${page.columns.map(col => `${col.title}\n${col.body}`).join("\n\n")}` : ""}${page.resource ? `\n함께 볼 자료: ${page.resource.title}\n${page.resource.url}` : ""}${page.background ? `\n배경 이미지 #${page.background.assetId}` : ""}`),
].join("\n\n");
// Checkpoint incomplete edits too. Save-time nonempty/length checks remain in cardCopySchema.
const recoveryCopySchema = z.object({
  version: z.literal(1), templateKey: z.string(), storyFormat: z.literal("discussion8").optional(),
  cover: z.object({ title: z.string(), subtitle: z.string(), background: cardPageBackgroundSchema.optional() }),
  pages: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string(), body: z.string(), role: z.enum(NEWS_EDITORIAL_ROLES).optional(), columns: z.array(z.object({ title: z.string(), body: z.string() })).length(2).optional(), sourceIds: z.array(z.number().int().positive()).max(12).optional(), resource: newsEditorialResourceSchema.optional(), background: cardPageBackgroundSchema.optional() })).min(1).max(9),
});
const parseRecoveryCopy = (value: unknown): CardCopy | null => { const parsed = recoveryCopySchema.safeParse(value); return parsed.success ? parsed.data : null; };

/** The preview uses the same renderer as the saved images. Caption/alt text are separate. */
export function CardCopyEditor(props: CardCopyEditorProps) {
  const loaded = useQuery({ queryKey: ["card-copy", props.channelId, props.itemId], queryFn: () => api<StoredCardCopyResponse>(`/channels/${props.channelId}/items/${props.itemId}/card-copy`), retry: false });
  const guard = useDirtyGuard(), dirtyRef = useRef(false), formatRef = useRef<1 | 2 | null>(null), snapshots = useRef<Partial<Record<1 | 2, StoredCardCopyResponse>>>({});
  const callbacks = useRef(props); callbacks.current = props; const [, rerender] = useState(0);
  const onDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; callbacks.current.onDirtyChange?.(dirty); }, []);
  const onSaved = useCallback((saved: StoredCardCopyResponse) => {
    // An explicit conversion save is the only dirty-edit path that changes the
    // editor implementation. A passive refetch must not unmount an active draft.
    if (formatRef.current !== saved.copy.version) { formatRef.current = saved.copy.version; dirtyRef.current = false; }
    callbacks.current.onSaved?.(saved);
  }, []);
  if (loaded.data) {
    snapshots.current[loaded.data.copy.version] = loaded.data;
    if (formatRef.current === null || !dirtyRef.current) formatRef.current = loaded.data.copy.version;
  }
  const active = formatRef.current ?? 1, snapshot = snapshots.current[active], formatConflict = !!loaded.data && loaded.data.copy.version !== active;
  const safeProps = { ...props, onDirtyChange: onDirty, onSaved, formatConflict };
  let editor;
  if (active === 2 && snapshot?.copy.version === 2) {
    const metadata = familyDialogueMetadataSchema.safeParse(Object.fromEntries(Object.keys(familyDialogueMetadataSchema.shape).map(key => [key, (snapshot as Record<string, unknown>)[key]])));
    editor = metadata.success ? <FamilyDialogueEditor {...safeProps} initial={{ ...snapshot, ...metadata.data, copy: snapshot.copy } as FamilyDialogueResponse} refresh={() => loaded.refetch()} />
      : <ErrorBox error={new Error("8장 원고의 저장 정보를 불러오지 못했습니다. 기존 데이터를 유지했습니다. 최신 저장본을 다시 확인해 주세요.")} retry={() => loaded.refetch()} />;
  } else editor = <LegacyCardCopyEditor {...safeProps} loaded={{ ...loaded, data: snapshot } as UseQueryResult<CardCopyResponse, Error>} />;
  return <>{formatConflict && <div className="notice warn stack" role="alert"><strong>다른 곳에서 카드 형식을 바꿔 저장했습니다. 현재 입력은 이 화면에 유지했습니다.</strong><p>현재 내용을 확인한 뒤 새 저장본을 불러오세요. 입력을 버릴지는 이동 확인에서 선택합니다.</p><button className="btn" onClick={() => guard.confirmLeave(() => { dirtyRef.current = false; formatRef.current = loaded.data!.copy.version; rerender(value => value + 1); })}>새 형식의 저장본 확인·불러오기</button></div>}{editor}</>;
}

function LegacyCardCopyEditor({ loaded, channelId, itemId, itemVersion, templateKey, coverMode = "reuse", previewRevision, showAi = true, disabled = false, renderDisabled = false, formatConflict = false, onTemplateChange, onDirtyChange, onSaved, onSaveAndRender, renderLabel = "카드뉴스 만들기" }: CardCopyEditorProps & { loaded: UseQueryResult<CardCopyResponse, Error> }) {
  const path = `/channels/${channelId}/items/${itemId}/card-copy`;
  const queryKey = ["card-copy", channelId, itemId];
  const qc = useQueryClient(), guard = useDirtyGuard(), uid = useId();
  const [base, setBase] = useState<CardCopyResponse | null>(null), baseRef = useRef<CardCopyResponse | null>(null);
  const [copy, setCopy] = useState<CardCopy | null>(null), copyRef = useRef<CardCopy | null>(null);
  const [selected, setSelected] = useState(0);
  const [manualConversion, setManualConversion] = useState(false);
  const [saving, setSaving] = useState(false), [rendering, setRendering] = useState(false), [generating, setGenerating] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null), [aiError, setAiError] = useState<Error | null>(null);
  const [conflicting, setConflicting] = useState<CardCopyResponse | null>(null), [conflictLoading, setConflictLoading] = useState(false);
  const [proposal, setProposal] = useState<(Proposal & { source: string; selectedPage: number }) | null>(null);
  const [familyProposal, setFamilyProposal] = useState<(FamilyProposal & { source: string }) | null>(null), [familyApplying, setFamilyApplying] = useState(false);
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
  // A visual choice is not a schema conversion. Keep the editable v1 draft and
  // its real renderer until the operator applies the separately reviewed v2 proposal.
  const pendingFamilyTemplate = readingProfileForTemplateKey(templateKey);

  function put(next: CardCopy) { copyRef.current = next; setCopy(next); }
  function adopt(next: CardCopyResponse, preserveTemplate = false) {
    const nextCopy = preserveTemplate && templateKey && !readingProfileForTemplateKey(templateKey) ? { ...next.copy, templateKey } : next.copy;
    baseRef.current = next; setBase(next); put(nextCopy);
    appliedProposal.current = null;
    setSaveError(null); setConflicting(null); setProposal(null);
    if (!pendingFamilyTemplate) callbacks.current.onTemplateChange?.(nextCopy.templateKey);
  }
  const recovery = useDraftRecovery<CardCopy | null>({
    recoveryKey: `item:${channelId}:${itemId}:card-copy`, label: "카드 문구", version: base?.version ?? 0,
    value: copy, serverValue: base?.copy ?? null, dirty, ready: !!base && !!copy,
    parse: parseRecoveryCopy, onRestore: next => { if (next) { put(next); setProposal(null); setSaveError(null); if (!pendingFamilyTemplate) callbacks.current.onTemplateChange?.(next.templateKey); } },
  });
  const busy = disabled || !!recovery.pending || rendering || familyApplying || (generating && !generation.cancelled);
  const locked = busy || saving || conflictLoading || backgroundBusy || formatConflict;
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
    if (readingProfileForTemplateKey(templateKey)) { setProposal(null); setFamilyProposal(null); return; }
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
    if (formatConflict) throw new Error("다른 형식으로 저장된 원고를 먼저 확인해 주세요. 현재 입력은 유지했습니다.");
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
    if (!onSaveAndRender || renderDisabled || pendingFamilyTemplate || locked || conflicting || action.current) return;
    action.current = "render";
    setRendering(true); setSaveError(null);
    try { const saved = await saveNow(); await onSaveAndRender(saved); }
    catch (error) { setSaveError(error as Error); }
    finally { action.current = null; setRendering(false); }
  }
  async function generate(rebuild = false): Promise<void> {
    if (generation.unresolved && generation.pendingBody?.formatId === "family_dialogue_8") return generateFamily();
    if (pendingFamilyTemplate && !generation.unresolved) return generateFamily();
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
  async function generateFamily(): Promise<void> {
    if (generation.unresolved && generation.pendingBody?.formatId !== "family_dialogue_8") return generate();
    if (locked || conflicting || action.current) return;
    action.current = "generate"; setGenerating(true); setAiError(null); setFamilyProposal(null);
    try {
      const saved = generation.unresolved ? baseRef.current! : await saveNow();
      const source = JSON.stringify(saved.copy);
      const result = await generation.run<FamilyProposal>(`${path}/generate`, { version: saved.version, baseRevision: saved.revisionId, formatId: "family_dialogue_8", templateKey: pendingFamilyTemplate?.templateKey ?? saved.copy.templateKey, scope: "all", ...(instructions.trim() ? { instructions: instructions.trim() } : {}) });
      if (!result.copy) throw new Error(result.reviewFlags?.map(flag => flag.message).join("\n") || "원문 또는 근거가 더 필요합니다. 기존 문구는 유지했습니다.");
      setFamilyProposal({ ...result, source });
    } catch (error) { setAiError(error as Error); }
    finally { action.current = null; setGenerating(false); }
  }
  async function applyFamilyProposal() {
    // The selection may have returned to the saved V1 design while this paid
    // proposal was running. Its unchanged copy/version alone is not consent to
    // adopt the former eight-page selection.
    if (!familyProposal?.copy || familyProposal.lateResult || familyProposal.version !== baseRef.current?.version || familyProposal.source !== JSON.stringify(copyRef.current) || familyProposal.copy.templateKey !== (templateKey ?? copyRef.current?.templateKey) || locked || action.current) return;
    action.current = "render"; setFamilyApplying(true); setSaveError(null);
    try {
      const saved = await api<FamilyDialogueResponse>(path, { method: "PATCH", body: { version: baseRef.current!.version, copy: familyProposal.copy, pageDesigns: familyProposal.pageDesigns, fieldLocks: familyProposal.fieldLocks ?? {}, parentGuide: familyProposal.parentGuide, captionPackage: familyProposal.captionPackage, proposalJobId: familyProposal.jobId } });
      recovery.clear(); callbacks.current.onSaved?.(saved); callbacks.current.onTemplateChange?.(saved.copy.templateKey);
      qc.setQueryData(queryKey, saved); void qc.invalidateQueries({ queryKey: ["ch", channelId, "item", itemId] }); void qc.invalidateQueries({ queryKey: ["studio"] });
    } catch (error) { setSaveError(error as Error); if (error instanceof ApiError && error.status === 409) await loadConflict(); }
    finally { action.current = null; setFamilyApplying(false); }
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
    if (!current || (current.storyFormat !== "discussion8" && result.pageId !== "cover") || baseline?.version !== result.version) return false;
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
  const canApplyFamilyProposal = !!familyProposal?.copy && !familyProposal.lateResult && familyProposal.version === base.version && familyProposal.source === JSON.stringify(copy) && familyProposal.copy.templateKey === (templateKey ?? copy.templateKey);
  return <section className="card-copy-editor stack" aria-labelledby={`${uid}-heading`}>
    <div className="card-copy-heading"><div><h3 id={`${uid}-heading`}>문구·미리보기</h3><p className="small muted">카드를 선택해서 글을 고치세요. 게시물 캡션과 별도로 저장합니다.</p></div><span className={`badge ${dirty ? "warn" : "ok"}`} role="status">{saving ? "문구 저장 중…" : dirty ? "저장하지 않은 수정" : base.hasSavedCopy ? "문구 저장됨" : "원고에서 가져온 문구"}</span></div>
    <RecoveryNotice recovery={recovery} formatValue={value => value ? copyText(value) : ""} />
    {(base.recommendedStoryFormat === "family_dialogue_8" || pendingFamilyTemplate || copy.storyFormat === "discussion8") && <details className="content-options" open={manualConversion}>
      <summary>AI 없이 8장 원고 직접 작성·전환</summary>
      {manualConversion ? <ManualFamilyInitializer channelId={channelId} channelName={qc.getQueryData<Array<{id:number;name:string}>>(["channels"])?.find(value => value.id === channelId)?.name ?? "채널 이름"} initialTitle={copy.cover.title} templateKey={templateKey ?? copy.templateKey} existing={{itemId,version:base.version}} onBack={() => setManualConversion(false)} onSaved={() => { setManualConversion(false); void loaded.refetch(); }} /> : <div className="stack"><p className="small">제공 자료와 8장 문구를 직접 대조해 새 버전으로 전환합니다. 현재 원고와 이전 버전은 보존하며 AI는 호출하지 않습니다.</p><button type="button" className="btn" disabled={locked || dirty || !!conflicting} onClick={() => setManualConversion(true)}>제공 자료로 8장 직접 작성 시작</button>{dirty&&<p className="hint">지금 입력한 문구를 먼저 저장한 뒤 새 구성을 작성해 주세요.</p>}</div>}
    </details>}
    {base.recoveryNotice && <p className="notice warn small" role="status">{base.recoveryNotice} 문구를 저장하기 전까지 기존 저장 내용은 바뀌지 않습니다.</p>}
    {pendingFamilyTemplate && <div className="notice small stack" role="status"><strong>{pendingFamilyTemplate.label} · 8장 전환 준비</strong><p>선택한 풀세트는 새 8장 편집 형식을 사용합니다. 지금 입력한 원고와 이미지는 유지하며, 아래에서 새 제안을 확인하고 적용하면 선택한 디자인으로 전환됩니다. 디자인 선택만으로 AI를 호출하지 않습니다.</p>{!showAi && <p>자동 작업으로 바꾼 뒤 8장 제안을 요청할 수 있습니다. 현재 원고는 계속 직접 수정하고 저장할 수 있어요.</p>}</div>}
    {showAi && (pendingFamilyTemplate || base.recommendedStoryFormat || copy.storyFormat === "discussion8") && <div className="card-copy-story-action"><div><strong>{base.hasSavedCopy ? "새 8장 편집기로 전환 제안" : "기사 한 편으로 8장 대화 만들기"}</strong><p className="hint">현재 입력을 먼저 저장하고 새 8장 구성을 제안합니다. 기존 원고는 새 제안을 확인하고 저장하기 전까지 유지됩니다. 요약·문구·이미지 등 채널에 설정한 AI의 API 요금과 한도가 적용됩니다.</p></div><button className="btn primary" disabled={locked || invalid || !!conflicting} onClick={() => void generateFamily()}>{familyApplying ? "새 버전 저장 중…" : generating ? "원문에서 새 구성 제안 중…" : base.hasSavedCopy ? "새 8장 형식 자동 제안" : "8장 카드뉴스 자동 만들기"}</button></div>}
    {showAi && (base.recommendedStoryFormat === "discussion8" || copy.storyFormat === "discussion8") && <details className="card-copy-legacy-tools"><summary>이전 카드 형식을 유지하는 도구</summary><div className="card-copy-story-action"><div><strong>뉴스 한 편에서 시작하는 8장 대화</strong><p className="hint">표지 → 요약 → 의미 → 질문 → 두 시선 → 개념 정의 → 활동 → 닫는 표지</p><p className="hint">기사 요약 {aiProviderLabels[summaryProvider]} · 문구 {aiProviderLabels[provider]} · <GuardedLink href="/settings">채널별 AI 설정</GuardedLink></p></div><button className="btn primary" disabled={locked || invalid || !!conflicting || ((!aiReady || !summaryReady) && !generation.unresolved)} onClick={() => void generate(true)}>{generating ? "원문을 확인하고 8장 구성 중…" : generation.unresolved ? "기존 AI 작업 결과 확인" : "8장 뉴스 대화로 다시 구성"}</button>{(!aiReady || !summaryReady) && <p className="hint">선택한 요약·문구 AI를 연결한 뒤 사용할 수 있습니다. 기존 문구는 직접 편집하고 저장할 수 있어요.</p>}</div></details>}
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
    {familyProposal?.copy && <div className="notice card-copy-proposal stack"><strong>새 8장 형식 제안 · 기존 원고는 유지 중</strong><div className="card-copy-compare"><div><h4>기존 원고</h4><pre>{copyText(copy)}</pre></div><div><h4>새 8장 원고</h4><pre>{familyCopyText(familyProposal.copy, familyProposal)}</pre></div></div>{familyProposal.reviewFlags?.map((flag, i) => <p className="hint" key={i}>{flag.message}</p>)}<div className="row"><button className="btn primary" disabled={locked || !canApplyFamilyProposal} onClick={() => void applyFamilyProposal()}>새 8장 원고로 저장·전환</button><button className="btn ghost" onClick={() => setFamilyProposal(null)}>기존 원고 유지</button></div><p className="hint">새 콘텐츠 버전으로 저장하며 이전 저장 원고는 이력에 남습니다. 전환 후 각 칸을 직접 수정할 수 있습니다.</p>{!canApplyFamilyProposal && <p role="alert">제안 뒤 원고나 선택한 디자인이 달라졌습니다. 현재 작업을 유지하고 최신 원고로 다시 제안받아 주세요.</p>}</div>}
    {proposal && <div className="notice card-copy-proposal stack"><strong>AI 문구 제안 · 아직 카드에 반영하지 않았어요</strong><details open><summary>{proposal.copy.pages.length + 1}장 제안 전체 보기</summary><pre>{copyText(proposal.copy)}</pre></details><div className="row">{proposal.scope !== "all" && <button className="btn primary sm" disabled={locked || !canApplyProposal || proposal.copy.storyFormat !== copy.storyFormat || (proposal.selectedPage > 0 && !proposal.copy.pages[proposal.selectedPage - 1])} onClick={() => {
      const index = proposal.selectedPage;
      appliedProposal.current = proposal.jobId ?? null;
      put(index === 0 ? { ...copy, cover: proposal.copy.cover } : { ...copy, pages: copy.pages.map((page, i) => i === index - 1 ? { ...proposal.copy.pages[i], id: page.id } : page) });
      setSelected(index); setProposal(null);
    }}>{proposal.selectedPage === 0 ? "표지에만 제안 적용" : `${proposal.selectedPage}번째 카드에만 제안 적용`}</button>}<button className={`btn sm ${proposal.scope === "all" ? "primary" : ""}`} disabled={locked || !canApplyProposal} onClick={() => { appliedProposal.current = proposal.jobId ?? null; put(proposal.copy); setProposal(null); setSelected(0); }}>{proposal.scope === "all" && proposal.copy.storyFormat === "discussion8" ? "8장 제안을 편집기에 적용" : "제안 문구로 바꾸기"}</button><button className="btn ghost sm" onClick={() => setProposal(null)}>제안 닫기</button></div><p className="hint">{proposal.scope === "all" ? "전체 구성을 편집기에 불러옵니다. 직접 수정한 뒤 저장하면 새 버전으로 기록됩니다." : "한 카드에만 적용하면 다른 카드의 문구는 유지합니다. ‘제안 문구로 바꾸기’는 전체 문구를 바꿉니다."}</p>{!canApplyProposal && <p className="small">제안 이후 문구나 저장 버전이 바뀌었습니다. 현재 입력은 유지되며 새 제안을 받아 적용할 수 있어요.</p>}</div>}
    {conflicting && <div className="notice warn stack" role="alert"><strong>다른 곳에서 먼저 저장한 내용이 있어요. 입력한 문구는 유지했습니다.</strong><details><summary>최신 저장본과 현재 입력 비교하기</summary><div className="card-copy-compare"><div><h4>최신 저장본</h4><pre>{copyText(conflicting.copy)}</pre></div><div><h4>현재 입력</h4><pre>{copyText(copy)}</pre></div></div><div className="row"><button className="btn sm" disabled={locked} onClick={() => { recovery.clear(); adopt(conflicting); }}>최신 저장본으로 바꾸기</button><button className="btn sm" disabled={locked || invalid} onClick={() => { const latest = conflicting; appliedProposal.current = null; baseRef.current = latest; setBase(latest); setConflicting(null); void saveNow().catch(() => {}); }}>현재 입력으로 최신 버전에 저장</button></div></details></div>}
    <nav className="card-copy-pages" aria-label="문구를 편집할 페이지"><button className="btn sm" disabled={pageIndex === 0} onClick={() => setSelected(pageIndex - 1)}>← 이전</button><div className="card-copy-dots" role="group" aria-label="페이지 선택">{[copy.cover, ...copy.pages].map((p, i) => <button key={i === 0 ? "cover" : copy.pages[i - 1].id} aria-label={i === 0 ? "표지 문구 편집" : copy.pages[i - 1].role ? `${i + 1}페이지 ${NEWS_EDITORIAL_LABELS[copy.pages[i - 1].role!]} 문구 편집` : `${i}번째 본문 문구 편집 · ${p.title}`} aria-current={i === pageIndex ? "step" : undefined} onClick={() => setSelected(i)}><span aria-hidden="true">{copy.storyFormat === "discussion8" ? i + 1 : i === 0 ? "표지" : `${i}장`}</span></button>)}</div><button className="btn sm" disabled={pageIndex === copy.pages.length} onClick={() => setSelected(pageIndex + 1)}>다음 →</button></nav>
    <div className="card-copy-workspace">
      <div className="card-copy-preview-column"><div className="row between small"><strong>{pageLabel}</strong><span className="muted">전체 {copy.pages.length + 1}장</span></div>{pageIndex === 0 ? <CoverCropPreview src={preview?.url} alt={`${pageLabel} 실제 렌더링 미리보기${previewCurrent ? "" : " · 수정 반영 전"}`} busy={previewBusy} stale={!previewCurrent} onError={() => setPreviewError(new Error("미리보기 이미지를 불러오지 못했습니다."))} placeholder="제목·부제·본문을 카드에 배치하고 있어요." status={previewBusy || !previewCurrent ? previewBusy ? "수정 내용 반영 중…" : invalid ? "입력 안내를 확인해 주세요" : previewError ? "수정 내용 반영 전" : "미리보기 준비 중…" : undefined} /> : <figure className={`card-copy-preview ${previewCurrent ? "" : "is-stale"}`} aria-busy={previewBusy}>{preview && <img src={preview.url} alt={`${pageLabel} 실제 렌더링 미리보기${previewCurrent ? "" : " · 수정 반영 전"}`} onError={() => setPreviewError(new Error("미리보기 이미지를 불러오지 못했습니다."))} />}{!preview && <div className="card-copy-placeholder">제목·부제·본문을 카드에 배치하고 있어요.</div>}{(previewBusy || !previewCurrent) && <figcaption role="status">{previewBusy ? "수정 내용 반영 중…" : invalid ? "입력 안내를 확인해 주세요" : previewError ? "수정 내용 반영 전" : "미리보기 준비 중…"}</figcaption>}</figure>}{coverMode === "ai" && !copy.cover.background && <p className="hint">새 AI 표지 그림은 ‘{renderLabel}’를 누르면 생성됩니다. 저장된 그림은 문구를 수정해도 유지하며, 생성이 끝나면 이 미리보기에 반영합니다.</p>}{previewError && <ErrorBox error={previewError} retry={() => setPreviewRetry(value => value + 1)} />}</div>
      <div className="card-copy-fields">
        <label className="field" htmlFor={`${uid}-title`}><span className="row between"><strong>{pageIndex === 0 ? "표지 제목" : "본문 제목"}</strong><span className="hint">{chars(page.title)}자 · {pageIndex === 0 ? limits.recommended.coverTitle : limits.recommended.title}자 권장</span></span><textarea ref={titleRef} id={`${uid}-title`} rows={2} value={page.title} disabled={busy} aria-invalid={!!issue("title")} aria-describedby={`${uid}-title-help`} onChange={event => update("title", event.target.value)} /><span id={`${uid}-title-help`} className={issue("title") ? "card-copy-error" : "hint"}>{issue("title") ?? `카드에서 가장 크게 보이는 제목입니다. 최대 ${pageIndex === 0 ? limits.max.coverTitle : limits.max.title}자까지 입력할 수 있어요.`}</span></label>
        <label className="field" htmlFor={`${uid}-subtitle`}><span className="row between"><strong>{pageIndex === 0 ? "표지 부제" : "본문 부제"} <span className="muted small">선택</span></strong><span className="hint">{chars(page.subtitle)}자 · {limits.recommended.subtitle}자 권장</span></span><textarea ref={subtitleRef} id={`${uid}-subtitle`} rows={2} value={page.subtitle} disabled={busy} aria-invalid={!!issue("subtitle")} aria-describedby={`${uid}-subtitle-help`} onChange={event => update("subtitle", event.target.value)} /><span id={`${uid}-subtitle-help`} className={issue("subtitle") ? "card-copy-error" : "hint"}>{issue("subtitle") ?? "제목을 보충하는 짧은 문장입니다. 비워 두면 표시하지 않습니다."}</span></label>
        {bodyText !== null && <label className="field" htmlFor={`${uid}-body`}><span className="row between"><strong>카드 본문</strong><span className="hint">{chars(bodyText)}자 · {limits.recommended.body}자 권장</span></span><textarea ref={bodyRef} id={`${uid}-body`} rows={6} value={bodyText} disabled={busy} aria-invalid={!!issue("body")} aria-describedby={`${uid}-body-help`} onChange={event => update("body", event.target.value)} /><span id={`${uid}-body-help`} className={issue("body") ? "card-copy-error" : "hint"}>{issue("body") ?? (chars(bodyText) > limits.recommended.body ? `${limits.recommended.body}자를 넘었습니다. 글자가 잘리지 않도록 미리보기와 저장 안내를 확인해 주세요. 입력한 내용은 자동으로 자르지 않습니다.` : "이미지 안에 들어가는 본문입니다. 캡션·대체텍스트와 별도로 저장합니다.")}</span></label>}
        {editorialPage?.columns && <fieldset className="card-copy-columns"><legend>{editorialPage.role === "concept" ? "서로 다른 정의의 예시" : "두 가지 시선"}</legend>{editorialPage.columns.map((column, index) => <div className="stack" key={index}><label className="field">{index + 1}번 칸 제목<input id={`${uid}-column-${index}-title`} value={column.title} disabled={busy} onChange={event => updateColumn(index, "title", event.target.value)} /></label><label className="field">{index + 1}번 칸 설명<textarea id={`${uid}-column-${index}-body`} rows={4} value={column.body} disabled={busy} onChange={event => updateColumn(index, "body", event.target.value)} /><span className="hint">{chars(column.body)}자 · 100자 권장</span></label></div>)}</fieldset>}
        {(copy.storyFormat === "discussion8" || pageIndex === 0 && (!copy.templateKey.startsWith("set:") || collectionUsesArt(copy.templateKey.slice(4)) || !!page.background)) && <PageBackgroundEditor key={`${channelId}:${itemId}`} channelId={channelId} itemId={itemId} pageIndex={pageIndex} background={page.background} disabled={busy || saving || conflictLoading || !!conflicting || invalid} showAi={showAi && (copy.storyFormat === "discussion8" || !copy.templateKey.startsWith("set:") || collectionUsesArt(copy.templateKey.slice(4)))} imageReady={!!status.data?.image} imageModel={base.ai?.image.model} save={saveNow} onApply={applyBackground} onChange={next => setBackground(pageIndex, next)} onBusyChange={setBackgroundBusy} />}
        {editorialPage?.resource && <div className="notice small stack"><strong>함께 볼 자료 · 확보한 원문</strong><a href={editorialPage.resource.url} target="_blank" rel="noreferrer">{editorialPage.resource.title}</a><p className="hint">이 콘텐츠에 연결된 자료의 실제 제목과 주소입니다. 방문 일정·이용 조건은 원문에서 확인하세요.</p><button className="btn ghost sm" disabled={busy} onClick={() => put({ ...copy, pages: copy.pages.map((p, i) => i === pageIndex - 1 ? { ...p, resource: undefined } : p) })}>이 참고자료 빼기</button></div>}
      </div>
    </div>
    {invalid && <p className="notice warn small" role="alert">제목과 본문은 비울 수 없습니다. 제목·부제·본문의 글자 수 안내를 확인한 뒤 저장해 주세요. 입력한 내용은 그대로 유지됩니다.</p>}
    {saveError && <ErrorBox error={saveError} />}
    <div className="card-copy-savebar"><p className="small muted">{dirty ? "수정 내용을 저장하고 이미지에 반영하세요." : "작성한 글은 이 카드에만 반영돼요."}</p><div className="row"><button className="btn" disabled={locked || invalid || !!conflicting || (!dirty && base.hasSavedCopy)} onClick={() => void saveNow().catch(() => {})}>{saving ? "저장 중…" : "문구 저장"}</button>{onSaveAndRender && <button className="btn primary" disabled={generating || renderDisabled || !!pendingFamilyTemplate || locked || invalid || !!conflicting} onClick={() => void saveAndRender()}>{rendering ? "카드뉴스 만드는 중…" : `${dirty || !base.hasSavedCopy ? "저장하고 " : ""}${renderLabel}`}</button>}</div></div>
  </section>;
}
