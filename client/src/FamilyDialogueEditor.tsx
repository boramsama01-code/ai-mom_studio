import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { familyCardCopySchema, familyDialogueMetadataSchema, familyFieldDescriptors, familyFieldValue, FAMILY_PAGE_LABELS, type CardCopyV2, type FamilyDialogueMetadata, type FamilyFieldDescriptor, type FamilyPage, type FamilyPageId, type PageDesign, type ReviewFlag } from "@shared/familyDialogue";
import type { AiSelection } from "@shared/channelAi";
import type { FamilyEvidenceView } from "@shared/familyEvidence";
import { api, apiBlob, ApiError } from "./api";
import { ErrorBox, fmtDate } from "./ui";
import { useDirtyGuard } from "./state";
import { useDraftRecovery } from "./useDraftRecovery";
import { RecoveryNotice } from "./RecoveryNotice";
import { useGenerationRequest } from "./useGenerationRequest";
import { PageBackgroundEditor, type PageArtworkResult } from "./PageBackgroundEditor";
import type { CardCopyEditorProps, StoredCardCopyResponse } from "./CardCopyEditor";
import "./familyDialogue.css";

export type FamilyDialogueResponse = FamilyDialogueMetadata & { version: number; revisionId: number; copy: CardCopyV2; hasSavedCopy: boolean; ai?: Record<"summary" | "copy" | "image", AiSelection>; recoveryNotice?: string; evidence?: FamilyEvidenceView };
export type FamilyProposal = Partial<FamilyDialogueMetadata> & { copy: CardCopyV2 | null; version: number; revisionId?: number; baseRevision?: number; jobId?: number; fieldPath?: string; targetFieldHash?: string; scope?: string; model?: string; status: "ready" | "needs_source" | "needs_review"; reviewFlags: ReviewFlag[]; lateResult?: boolean; evidence?: FamilyEvidenceView };
type Preview = { url: string; signature: string };
const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const metadataKeys = ["editorialPlan", "evidenceBinding", "pageDesigns", "parentGuide", "captionPackage", "visualBriefs", "editorialReview", "fieldLocks", "generationRuns", "dependencies"] as const;
function editable(value: FamilyDialogueResponse) {
  return { copy: value.copy, ...Object.fromEntries(metadataKeys.map(key => [key, value[key]])) };
}
function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (typeof value === "object") return Object.entries(value).filter(([key]) => !["mode", "resourceId", "logoAssetId"].includes(key)).map(([, value]) => textOf(value)).filter(Boolean).join("\n");
  return String(value);
}
export const familyCopyText = (copy: CardCopyV2) => copy.pages.map(page => `${page.page}. ${FAMILY_PAGE_LABELS[page.id]}\n${textOf(page.fields)}`).join("\n\n");
const copyText = familyCopyText;
function pageValue(page: FamilyPage, path: string): unknown { return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, page); }
function replacePageField(page: FamilyPage, path: string, value: unknown): FamilyPage {
  const next = structuredClone(page), segments = path.split(".");
  let cursor: any = next;
  for (const segment of segments.slice(0, -1)) { if (["__proto__", "prototype", "constructor"].includes(segment)) throw new Error("수정할 칸을 확인해 주세요."); cursor = cursor[segment]; }
  cursor[segments.at(-1)!] = value;
  next.claimRefs = next.claimRefs.filter(ref => {
    const local = ref.fieldPath.replace(`pages.${page.id}.`, "");
    return local !== path && !local.startsWith(`${path}.`) && !path.startsWith(`${local}.`);
  });
  return next;
}
function invalidateDerived(value: FamilyDialogueResponse): FamilyDialogueResponse {
  return { ...value, dependencies: { caption: value.captionPackage ? "needs_review" : "not_generated", visuals: Object.keys(value.visualBriefs).length ? "needs_review" : "not_generated", review: value.editorialReview ? "needs_review" : "not_generated", render: "needs_review" } };
}
function validFieldLocks(copy: CardCopyV2, locks: Record<string, boolean>) {
  return Object.fromEntries(Object.entries(locks).filter(([path, enabled]) => enabled && familyFieldValue(copy, path) !== undefined));
}
function removedFieldLocks(copy: CardCopyV2, locks: Record<string, boolean>) {
  return Object.entries(locks).filter(([path, enabled]) => enabled && familyFieldValue(copy, path) === undefined).length;
}
const sourceScopeLabels: Record<FamilyEvidenceView["sources"][number]["scope"], string> = { article_body: "기사 본문", primary_body: "1차 자료 본문", abstract: "논문 초록", provided_document: "제공 문서", manual_paste: "직접 붙여넣은 본문", web_page: "웹페이지 본문", search_result: "검색 결과 요약" };
const claimTypeLabels: Record<FamilyEvidenceView["facts"][number]["claimType"], string> = { reported_event: "보도된 사건", research_finding: "연구 결과", attributed_statement: "발언·주장", forecast: "전망·예측", editorial_interpretation: "편집자의 해석", hypothetical: "가정한 상황" };
function externalEvidenceUrl(value: string | null | undefined) {
  try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function FamilyEvidenceDetails({ draft }: { draft: FamilyDialogueResponse }) {
  const evidence = draft.evidence;
  if (!evidence || evidence.evidenceSetId !== draft.evidenceBinding.evidenceSetId) return <p className="notice warn small" data-testid="family-evidence-stale">현재 원고에 연결된 근거 상세를 확인해야 합니다. 문구를 저장한 뒤 다시 열어 주세요. 이전 근거를 현재 자료로 표시하지 않습니다.</p>;
  const activity = draft.copy.pages.find(page => page.id === "activity");
  const resourceIds = activity ? [...new Set([activity.fields.homeActivity.resourceId, activity.fields.optionalActivity?.resourceId].filter((id): id is string => !!id))] : [];
  return <div className="family-evidence-details stack" data-testid="family-evidence-details">
    <h4>카드에 연결된 사실·발언</h4>
    {evidence.facts.map(fact => <div key={fact.id} className="family-evidence-entry"><strong>{fact.id} · {claimTypeLabels[fact.claimType]} · {fact.statement}</strong>{fact.speaker && <p className="small">발언자: {fact.speaker}</p>}<blockquote>{fact.evidenceExcerpt}</blockquote><p className="hint">읽은 범위: {sourceScopeLabels[fact.sourceScope]}{fact.verificationStatus === "article_only" ? " · 기사에 기재된 내용" : fact.verificationStatus === "primary_checked" ? " · 1차 자료 대조" : " · 추가 확인 필요"}</p>{!!fact.conditions.length && <p className="small">조건: {fact.conditions.join(" · ")}</p>}</div>)}
    {!!resourceIds.length && <><h4>선택한 추가 활동의 실제 자료</h4>{resourceIds.map(id => {
      const resource = evidence.resources.find(value => value.id === id);
      if (!resource) return <p key={id} className="notice warn small">선택한 자료 {id}의 확인 기록이 없습니다. 활동과 근거를 다시 확인해 주세요.</p>;
      const url = externalEvidenceUrl(resource.url);
      return <div key={id} className="family-evidence-entry" data-testid="family-selected-resource"><strong>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{resource.title} ↗</a> : resource.title}</strong>{resource.publisher && <p className="small">{resource.publisher}</p>}<p className="small">읽은 범위: {sourceScopeLabels[resource.scope]} · 확인: {fmtDate(resource.checkedAt)} (한국 시간)</p><p className="small">읽어볼 부분: {resource.readingTarget}</p><p className="small">이 카드와의 연결: {resource.connectionReason}</p>{resource.evidenceExcerpt && <blockquote>{resource.evidenceExcerpt}</blockquote>}{!url && <p className="hint">확인할 수 있는 웹 주소가 없어 링크를 표시하지 않았습니다.</p>}{!resource.recommendationEligible && <p className="notice warn small">추천 조건을 다시 확인해야 하는 자료입니다.</p>}</div>;
    })}</>}
    <h4>확인한 출처</h4>
    {evidence.sources.map(source => { const url = externalEvidenceUrl(source.url); return <div key={source.id} className="family-evidence-entry"><span>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a> : source.title}</span><p className="hint">읽은 범위: {sourceScopeLabels[source.scope]} · 수집: {fmtDate(source.fetchedAt)} (한국 시간)</p></div>; })}
  </div>;
}

/** v2 has eight semantic pages. The v1 editor remains independent and lossless. */
export function FamilyDialogueEditor(props: CardCopyEditorProps & { initial: FamilyDialogueResponse; refresh: () => Promise<unknown> }) {
  const { channelId, itemId, initial, itemVersion, onDirtyChange, onSaved, onSaveAndRender, onApplyCaption, onEditCaption, disabled = false, showAi = true, renderDisabled = false, formatConflict = false, templateKey, onTemplateChange, previewRevision } = props;
  const path = `/channels/${channelId}/items/${itemId}/card-copy`, queryKey = ["card-copy", channelId, itemId], uid = useId();
  const qc = useQueryClient(), guard = useDirtyGuard();
  const aiStatus = useQuery({ queryKey: ["studio-ai-status"], queryFn: () => api<{ text: Record<string, boolean>; image?: boolean }>("/studio/ai-status"), retry: false, staleTime: 30_000 });
  const [base, setBase] = useState(initial), baseRef = useRef(initial), [draft, setDraft] = useState(initial), draftRef = useRef(initial);
  const [selected, setSelected] = useState(0), [selectedField, setSelectedField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [rendering, setRendering] = useState(false), [generating, setGenerating] = useState(false), [backgroundBusy, setBackgroundBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null), [aiError, setAiError] = useState<Error | null>(null), [conflict, setConflict] = useState<StoredCardCopyResponse | null>(null);
  const [instructions, setInstructions] = useState(""), [proposal, setProposal] = useState<{ result: FamilyProposal; baseline: string; baseVersion: number } | null>(null), [reviewFlags, setReviewFlags] = useState<ReviewFlag[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null), [thumbs, setThumbs] = useState<Record<string, Preview>>({}), [previewError, setPreviewError] = useState<Error | null>(null), [previewBusy, setPreviewBusy] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const [designHistory, setDesignHistory] = useState<Partial<Record<FamilyPageId, PageDesign[]>>>({});
  const [structureNotice, setStructureNotice] = useState<string | null>(null);
  const modeDrafts = useRef<Record<string, FamilyPage["fields"]>>({}), urls = useRef(new Set<string>()), serial = useRef<Promise<FamilyDialogueResponse> | null>(null), appliedProposal = useRef<number | null>(null), action = useRef(false);
  const modeLockDrafts = useRef<Record<string, Record<string, boolean>>>({});
  const aiPanel = useRef<HTMLDetailsElement>(null);
  const generation = useGenerationRequest(channelId, itemId, "card-copy");
  const dirty = !same(editable(base), editable(draft)), parsed = familyCardCopySchema.safeParse(draft.copy), invalid = !parsed.success;
  const page = draft.copy.pages[selected], design = draft.pageDesigns[page.id];
  const signatureFor = (value: FamilyDialogueResponse, index: number) => stable({ page: value.copy.pages[index], design: value.pageDesigns[value.copy.pages[index].id], template: value.copy.templateKey, version: value.version, previewRevision });
  const signature = signatureFor(draft, selected), previewCurrent = preview?.signature === signature;
  const recovery = useDraftRecovery<FamilyDialogueResponse>({
    recoveryKey: `item:${channelId}:${itemId}:family-dialogue`, label: "8장 문구와 페이지 디자인", version: base.version, serverValue: base, value: draft, dirty, ready: true,
    // Recovery includes incomplete input. Only known structure is accepted;
    // normal save validation still rejects empty required fields.
    parse: value => {
      if (!value || typeof value !== "object") return null;
      const candidate = value as FamilyDialogueResponse, copyCheck = familyCardCopySchema.safeParse(candidate.copy);
      const meta = Object.fromEntries(metadataKeys.map(key => [key, candidate[key]])), metadataCheck = familyDialogueMetadataSchema.safeParse(meta);
      const onlyIncompleteText = (check: { success: boolean; error?: { issues: Array<{ code: string; message: string }> } }) => check.success || check.error?.issues.every(issue => issue.code === "custom" && issue.message === "문구를 입력해 주세요.");
      return onlyIncompleteText(copyCheck) && onlyIncompleteText(metadataCheck) ? { ...baseRef.current, ...meta, copy: candidate.copy } as FamilyDialogueResponse : null;
    },
    onRestore: value => { put(value); setProposal(null); setSaveError(null); },
  });
  const busy = disabled || saving || rendering || backgroundBusy || !!recovery.pending || formatConflict, aiBusy = generating && !generation.cancelled;
  function put(value: FamilyDialogueResponse) { draftRef.current = value; setDraft(value); }
  function adopt(value: FamilyDialogueResponse) { baseRef.current = value; setBase(value); put(value); appliedProposal.current = null; modeDrafts.current = {}; modeLockDrafts.current = {}; setStructureNotice(null); setConflict(null); setProposal(null); setSaveError(null); }
  useEffect(() => {
    if (initial.version <= baseRef.current.version) return;
    if (same(editable(draftRef.current), editable(baseRef.current))) adopt(initial); else setConflict(initial);
  }, [initial]);
  useEffect(() => { if (itemVersion && itemVersion > baseRef.current.version) void props.refresh(); }, [itemVersion]);
  useEffect(() => {
    if (!templateKey || templateKey === draftRef.current.copy.templateKey) return;
    put(invalidateDerived({ ...draftRef.current, copy: { ...draftRef.current.copy, templateKey } })); setProposal(null);
  }, [templateKey]);
  useEffect(() => { setSelectedField(null); }, [selected]);
  async function loadConflict() { try { setConflict(await api<StoredCardCopyResponse>(path)); } catch (error) { setSaveError(error as Error); } }
  async function saveNow(): Promise<FamilyDialogueResponse> {
    if (formatConflict) throw new Error("다른 형식으로 저장된 원고를 먼저 확인해 주세요. 현재 입력은 유지했습니다.");
    if (recovery.pending) throw new Error("기기 복구본을 먼저 확인해 주세요.");
    if (serial.current) { await serial.current; return saveNow(); }
    const snapshot = draftRef.current, current = baseRef.current;
    if (!familyCardCopySchema.safeParse(snapshot.copy).success) throw new Error("비어 있는 필수 칸과 입력 안내를 확인해 주세요. 입력 내용은 유지했습니다.");
    if (current.hasSavedCopy && same(editable(snapshot), editable(current))) return current;
    setSaving(true); setSaveError(null);
    const request = api<FamilyDialogueResponse>(path, { method: "PATCH", body: { version: current.version, copy: snapshot.copy, pageDesigns: snapshot.pageDesigns, fieldLocks: snapshot.fieldLocks, parentGuide: snapshot.parentGuide, captionPackage: snapshot.captionPackage, ...(appliedProposal.current ? { proposalJobId: appliedProposal.current } : {}) } });
    serial.current = request;
    try {
      const saved = { ...snapshot, ...await request };
      baseRef.current = saved; setBase(saved); appliedProposal.current = null; setConflict(null);
      if (same(editable(draftRef.current), editable(snapshot))) { recovery.clear(); put(saved); }
      qc.setQueryData(queryKey, saved); void qc.invalidateQueries({ queryKey: ["ch", channelId, "item", itemId] }); void qc.invalidateQueries({ queryKey: ["studio"] }); onSaved?.(saved);
      return saved;
    } catch (error) { setSaveError(error as Error); if (error instanceof ApiError && error.status === 409) await loadConflict(); throw error; }
    finally { serial.current = null; setSaving(false); }
  }
  const saveRef = useRef(saveNow); saveRef.current = saveNow;
  useEffect(() => {
    const key = `family-dialogue-${channelId}-${itemId}`;
    guard.setDirty(key, dirty || busy || aiBusy, async () => {
      if (recovery.pending || rendering || backgroundBusy || aiBusy || conflict) return false;
      try { await saveRef.current(); return same(editable(draftRef.current), editable(baseRef.current)); } catch { return false; }
    }, () => { recovery.clear(); put(baseRef.current); });
    return () => guard.setDirty(key, false);
  }, [dirty, busy, aiBusy, conflict, channelId, itemId, guard]);
  useEffect(() => { onDirtyChange?.(dirty || busy || aiBusy || invalid || !!conflict); }, [dirty, busy, aiBusy, invalid, conflict, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (invalid) { setPreviewBusy(false); return; }
    let live = true; const controller = new AbortController(); setPreviewBusy(true); setPreviewError(null);
    const timer = window.setTimeout(async () => {
      try {
        const blob = await apiBlob(`${path}/preview`, "image/jpeg", { method: "POST", body: { version: base.version, copy: draft.copy, pageDesigns: draft.pageDesigns, page: selected, ...(appliedProposal.current ? { proposalJobId: appliedProposal.current } : {}) }, signal: controller.signal });
        if (!live) return;
        const url = URL.createObjectURL(blob); urls.current.add(url); const value = { url, signature };
        setPreview(value); setThumbs(current => ({ ...current, [page.id]: value }));
      } catch (error) { if (live && !controller.signal.aborted) setPreviewError(error as Error); }
      finally { if (live) setPreviewBusy(false); }
    }, 450);
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [signature, invalid, previewRetry]);
  // Thumbnails are local raster previews, loaded serially only for a saved
  // draft. Typing refreshes the selected page, never eight paid image jobs.
  useEffect(() => {
    if (dirty || invalid) return;
    let live = true; const controller = new AbortController(), snapshot = draft;
    const timer = window.setTimeout(async () => {
      for (let index = 0; index < snapshot.copy.pages.length && live; index++) {
        const id = snapshot.copy.pages[index].id, expected = signatureFor(snapshot, index);
        if (index === selected || thumbs[id]?.signature === expected) continue;
        try {
          const blob = await apiBlob(`${path}/preview`, "image/jpeg", { method: "POST", body: { version: base.version, copy: snapshot.copy, pageDesigns: snapshot.pageDesigns, page: index }, signal: controller.signal });
          if (!live) return;
          const url = URL.createObjectURL(blob); urls.current.add(url); setThumbs(current => ({ ...current, [id]: { url, signature: expected } }));
        } catch { if (controller.signal.aborted) return; /* Selecting that page exposes its actionable error. */ }
      }
    }, 1200);
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [base.version, dirty, invalid, selected, previewRevision]);
  useEffect(() => {
    const retained = new Set([preview?.url, ...Object.values(thumbs).map(value => value.url)]);
    for (const url of urls.current) if (!retained.has(url)) { URL.revokeObjectURL(url); urls.current.delete(url); }
  }, [preview, thumbs]);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  function updateField(descriptor: FamilyFieldDescriptor, value: string | null | string[]) {
    const current = draftRef.current, index = current.copy.pages.findIndex(value => value.id === descriptor.pageId);
    let next = invalidateDerived({ ...current, copy: { ...current.copy, pages: current.copy.pages.map((oldPage, i) => i === index ? replacePageField(oldPage, descriptor.path, value) : oldPage) } });
    if (descriptor.fieldPath === "pages.discussion.fields.question" && typeof value === "string") next = { ...next, editorialPlan: { ...next.editorialPlan, coreQuestion: value }, parentGuide: next.parentGuide ? { ...next.parentGuide, coreQuestion: value } : null };
    if (Array.isArray(value)) {
      const removed = removedFieldLocks(next.copy, current.fieldLocks);
      next.fieldLocks = validFieldLocks(next.copy, current.fieldLocks);
      setStructureNotice(removed ? `사실 칸을 빼면서 사라진 칸의 잠금 ${removed}개를 해제했습니다. 남은 칸의 문구와 잠금은 유지합니다.` : null);
    }
    put(next); setSaveError(null);
  }
  function lockField(fieldPath: string, lock: boolean) { const current = draftRef.current, fieldLocks = { ...current.fieldLocks }; if (lock) fieldLocks[fieldPath] = true; else delete fieldLocks[fieldPath]; put({ ...current, fieldLocks }); }
  function updateDesign(id: FamilyPageId, next: PageDesign, keepHistory = true) {
    const current = draftRef.current;
    if (same(current.pageDesigns[id], next)) return;
    if (keepHistory) setDesignHistory(history => ({ ...history, [id]: [...(history[id] ?? []), structuredClone(current.pageDesigns[id])].slice(-20) }));
    put({ ...current, pageDesigns: { ...current.pageDesigns, [id]: next }, dependencies: { ...current.dependencies, render: "needs_review", review: current.editorialReview ? "needs_review" : "not_generated" } });
  }
  function selectAsset(id: FamilyPageId, assetId?: number) {
    const old = draftRef.current.pageDesigns[id], previousAssetIds = [...new Set([...(old.previousAssetIds ?? []), ...(old.background.assetId ? [old.background.assetId] : []), ...(assetId ? [assetId] : [])])].slice(-20);
    const { assetId: _removed, ...background } = old.background;
    updateDesign(id, { ...old, previousAssetIds, background: { ...background, kind: assetId ? "image" : "brand", ...(assetId ? { assetId } : {}) } });
  }
  function applyBackground(result: PageArtworkResult, prior: number | null): boolean {
    const id = result.pageId as FamilyPageId, current = draftRef.current.pageDesigns[id];
    if (!current || baseRef.current.version !== result.version || (current.background.kind === "image" ? current.background.assetId ?? null : null) !== prior) return false;
    selectAsset(id, result.assetId); return true;
  }
  function changeMode(mode: "value_definition" | "scientific_explanation") {
    const current = draftRef.current, concept = current.copy.pages.find(value => value.id === "concept");
    if (!concept || concept.id !== "concept" || concept.fields.mode === mode) return;
    modeDrafts.current[concept.fields.mode] = structuredClone(concept.fields);
    const conceptLocks = Object.fromEntries(Object.entries(current.fieldLocks).filter(([path, enabled]) => enabled && path.startsWith("pages.concept.fields.")));
    modeLockDrafts.current[concept.fields.mode] = conceptLocks;
    const fields = modeDrafts.current[mode] ?? (mode === "value_definition" ? { mode, title: concept.fields.title, concept: concept.fields.concept, definitionA: "", definitionB: "", boundaryCase: "", fillIn: "나는 ___라고 정의한다." } : { mode, title: concept.fields.title, concept: concept.fields.concept, acceptedDefinition: "", exampleOrNonExample: "", fillIn: "내 말로 설명하면 ___" });
    const copy = { ...current.copy, pages: current.copy.pages.map(value => value.id === "concept" ? { ...value, fields, claimRefs: [] } as FamilyPage : value) };
    const incomingLocks = modeLockDrafts.current[mode] ?? conceptLocks;
    const fieldLocks = validFieldLocks(copy, { ...Object.fromEntries(Object.entries(current.fieldLocks).filter(([path]) => !path.startsWith("pages.concept.fields."))), ...incomingLocks });
    const removed = removedFieldLocks(copy, conceptLocks), restored = Object.entries(incomingLocks).filter(([path, enabled]) => enabled && fieldLocks[path] && !current.fieldLocks[path]).length;
    setStructureNotice([removed ? `개념 방식을 바꾸면서 사라진 칸의 잠금 ${removed}개를 현재 원고에서 해제했습니다. 이 화면에서 이전 방식으로 돌아가면 문구와 잠금도 복구합니다.` : "", restored ? `이전 방식의 문구와 잠금 ${restored}개를 복구했습니다.` : ""].filter(Boolean).join(" ") || null);
    put(invalidateDerived({ ...current, editorialPlan: { ...current.editorialPlan, conceptMode: mode }, copy, fieldLocks }));
  }
  function removeOptionalActivity() {
    const current = draftRef.current;
    const copy = { ...current.copy, pages: current.copy.pages.map(value => value.id === "activity" ? { ...value, fields: { ...value.fields, optionalActivity: null }, claimRefs: value.claimRefs.filter(ref => !ref.fieldPath.includes("optionalActivity")) } : value) };
    const removed = removedFieldLocks(copy, current.fieldLocks);
    setStructureNotice(removed ? `추가 활동을 빼면서 사라진 칸의 잠금 ${removed}개를 해제했습니다. 집 활동과 다른 칸의 잠금은 유지합니다.` : null);
    put(invalidateDerived({ ...current, copy, fieldLocks: validFieldLocks(copy, current.fieldLocks) }));
  }
  async function generate(stage: "card_copy" | "all" | "caption" | "editorial_review" = "card_copy") {
    if (busy || aiBusy || conflict || action.current) return;
    action.current = true; setGenerating(true); setAiError(null); setReviewFlags([]);
    try {
      const saved = generation.unresolved ? baseRef.current : await saveNow();
      const baseline = stable(editable(saved));
      const fieldPath = stage === "card_copy" ? selectedField : null;
      const response = await generation.run<FamilyProposal>(`${path}/generate`, {
        version: saved.version, baseRevision: saved.revisionId, formatId: "family_dialogue_8", templateKey: saved.copy.templateKey,
        scope: stage === "caption" ? "caption" : stage === "editorial_review" ? "review" : stage === "all" ? "all" : fieldPath ? "field" : "page",
        ...(stage === "card_copy" ? { pageId: page.id } : {}),
        ...(fieldPath ? { allowedFieldPaths: [fieldPath] } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
      setReviewFlags(response.reviewFlags ?? []);
      if (response.copy || response.captionPackage || response.editorialReview) setProposal({ result: response,
        baseline: response.version === saved.version && response.baseRevision === saved.revisionId ? baseline : "",
        baseVersion: response.version,
      });
    } catch (error) { setAiError(error as Error); }
    finally { action.current = false; setGenerating(false); }
  }
  const canApply = !!proposal && !proposal.result.lateResult && proposal.baseVersion === base.version && proposal.result.baseRevision === base.revisionId && proposal.baseline === stable(editable(draft));
  function applyProposal() {
    if (!proposal || !canApply) return;
    const current = draftRef.current, result = proposal.result;
    const next = { ...current, ...Object.fromEntries(metadataKeys.filter(key => result[key] !== undefined).map(key => [key, result[key]])), ...(result.evidence ? { evidence: result.evidence } : {}), copy: result.copy ?? current.copy } as FamilyDialogueResponse;
    appliedProposal.current = result.jobId ?? null; put(next); setProposal(null); setSaveError(null); onTemplateChange?.(next.copy.templateKey);
  }
  async function saveAndRender() {
    if (!onSaveAndRender || busy || aiBusy || conflict || renderDisabled || action.current) return;
    action.current = true; setRendering(true); setSaveError(null);
    try { await onSaveAndRender(await saveNow()); } catch (error) { setSaveError(error as Error); }
    finally { setRendering(false); action.current = false; }
  }
  const field = (descriptor: FamilyFieldDescriptor, path = descriptor.path, label = descriptor.label) => {
    const d = { ...descriptor, path, fieldPath: `pages.${page.id}.${path}` }, value = pageValue(page, path), text = typeof value === "string" ? value : "", count = [...text].length, id = `${uid}-${path}`;
    const systemOwned = !!descriptor.systemOwned, locked = !!draft.fieldLocks[d.fieldPath];
    return <div className="family-field" key={path}>
      <label className="field" htmlFor={id}><span className="row between"><strong>{label}{!d.required && " · 선택"}</strong><span className={count > d.initialBudget ? "family-budget-over" : "muted"}>{count} / 권장 {d.initialBudget}자</span></span>
        <textarea id={id} rows={d.initialBudget > 36 ? 3 : 2} value={text} readOnly={systemOwned} disabled={disabled || !!recovery.pending} onFocus={() => setSelectedField(d.fieldPath)} onChange={event => updateField(d, event.target.value || (["fields.caveat", "fields.scenario"].includes(path) ? null : ""))} aria-invalid={d.required && !text.trim() || count > d.manualMax} />
      </label>
      {systemOwned ? <p className="hint">채널에 저장한 브랜드 정보입니다. 채널 설정에서 변경할 수 있습니다.</p> : <div className="family-field-actions"><label><input type="checkbox" checked={locked} disabled={disabled || !!recovery.pending} onChange={event => lockField(d.fieldPath, event.target.checked)} />자동 재작성에서 이 칸 유지</label>{showAi && <button type="button" className="btn sm ghost" disabled={busy || aiBusy || locked} aria-pressed={selectedField === d.fieldPath} onClick={() => { setSelectedField(d.fieldPath); if (aiPanel.current) { aiPanel.current.open = true; aiPanel.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); } }}>이 칸 재작성 선택</button>}</div>}
      {count > d.initialBudget && <p className="hint">권장 길이를 넘었습니다. 저장은 가능하며 실제 배치에서 넘치는 칸을 확인할 수 있습니다.</p>}
      {count > d.manualMax && <p className="card-copy-error" role="alert">저장 한도 {d.manualMax}자를 넘었습니다. 붙여넣은 내용은 그대로 유지했습니다. 이 칸을 나눠 정리한 뒤 저장해 주세요.</p>}
    </div>;
  };
  const caption = draft.captionPackage, captionCurrent = !!caption && caption.contentRevision === base.revisionId && draft.dependencies.caption === "current" && !dirty && caption.coreQuestion === draft.editorialPlan.coreQuestion;
  const sourceAssets = [...new Set(Object.values(draft.pageDesigns).flatMap(value => [...(value.previousAssetIds ?? []), ...(value.background.assetId ? [value.background.assetId] : [])]))];
  return <section className="card-copy-editor family-dialogue-editor stack" aria-label="가족 대화 8장 카드 편집기">
    <div className="card-copy-heading"><div><span className="card-copy-kicker">가족 대화 · 8장</span><h3>카드 안의 문구와 디자인</h3><p>뉴스에서 출발해 한 가지 질문을 나눕니다. 선택한 장을 자세히 수정하고, 자동 제안은 확인한 뒤 적용하세요.</p></div><span className={`badge ${dirty ? "warn" : "ok"}`}>{saving ? "저장 중" : saveError ? "저장 실패" : dirty ? "미저장 변경" : `저장됨 · 버전 ${base.version}`}</span></div>
    <RecoveryNotice recovery={recovery} formatValue={value => copyText(value.copy)} />
    {structureNotice && <div className="notice small row between" role="status"><span>{structureNotice}</span><button className="btn sm ghost" onClick={() => setStructureNotice(null)}>안내 닫기</button></div>}
    {saveError && <ErrorBox error={saveError} />}
    {conflict && <div className="notice warn stack" role="alert"><strong>다른 곳에서 저장한 버전이 있습니다. 현재 입력은 유지했습니다.</strong><details><summary>저장본과 현재 입력 비교</summary><div className="card-copy-compare"><pre>{conflict.copy.version === 2 ? copyText(conflict.copy) : "다른 형식으로 저장된 원고입니다."}</pre><pre>{copyText(draft.copy)}</pre></div><button className="btn" disabled={busy} onClick={() => { if (conflict.copy.version === 2) { recovery.clear(); adopt(conflict as FamilyDialogueResponse); } else { recovery.clear(); qc.setQueryData(queryKey, conflict); } }}>서버 저장본 불러오기</button></details></div>}
    <nav className="family-page-strip" aria-label="카드 페이지 선택">{draft.copy.pages.map((value, index) => {
      const thumb = thumbs[value.id], current = thumb?.signature === signatureFor(draft, index);
      return <button key={value.id} type="button" aria-current={selected === index ? "step" : undefined} aria-label={`${index + 1}페이지 · ${FAMILY_PAGE_LABELS[value.id]}`} onClick={() => setSelected(index)}>
        <span className="family-page-thumb">{thumb ? <img src={thumb.url} alt="" className={current ? "" : "is-stale"} /> : <span>{textOf(value.fields).slice(0, 34)}</span>}</span><strong>{index + 1} · {FAMILY_PAGE_LABELS[value.id]}</strong>{thumb && !current && <span className="hint">배치 갱신 필요</span>}
      </button>;
    })}</nav>
    <div className="card-copy-workspace">
      <div className="card-copy-fields">
        <h4>{page.page}페이지 · {FAMILY_PAGE_LABELS[page.id]}</h4>
        {page.id === "concept" && <label className="field">개념을 다루는 방식<select value={page.fields.mode} disabled={disabled || !!recovery.pending} onChange={event => changeMode(event.target.value as "value_definition" | "scientific_explanation")}><option value="value_definition">가치 개념 · 나의 정의 만들기</option><option value="scientific_explanation">과학 개념 · 확인된 정의 설명하기</option></select><span className="hint">과학적 정의는 확인된 근거가 필요합니다. 두 방식의 칸은 서로 다르며 자동으로 바꾸지 않습니다.</span></label>}
        {page.id === "perspectives" && <label className="field">두 시선 배치<select value={page.layout === "columns" ? "columns" : "stacked"} disabled={disabled || !!recovery.pending} onChange={event => put(invalidateDerived({ ...draftRef.current, copy: { ...draftRef.current.copy, pages: draftRef.current.copy.pages.map(value => value.id === "perspectives" ? { ...value, layout: event.target.value } : value) } }))}><option value="stacked">위아래 · 기본</option><option value="columns">좌우 · 짧은 문구에 적합</option></select></label>}
        {familyFieldDescriptors(page).map(descriptor => descriptor.kind === "array" ? <fieldset className="family-facts" key={descriptor.path}><legend>{descriptor.label}</legend>{(pageValue(page, descriptor.path) as string[]).map((_value, index) => field(descriptor, `${descriptor.path}.${index}`, `${descriptor.label} ${index + 1}`))}<div className="row"><button className="btn sm" disabled={busy || (pageValue(page, descriptor.path) as string[]).length >= 3} onClick={() => updateField(descriptor, [...pageValue(page, descriptor.path) as string[], ""])}>사실 한 칸 추가</button><button className="btn sm ghost" disabled={busy || (pageValue(page, descriptor.path) as string[]).length <= 2} onClick={() => updateField(descriptor, (pageValue(page, descriptor.path) as string[]).slice(0, -1))}>마지막 사실 칸 빼기</button></div></fieldset> : field(descriptor))}
        {page.id === "activity" && <div className="notice small">{page.fields.optionalActivity ? <>확인된 추가 자료를 쓰는 선택 활동입니다.<button className="btn sm ghost" disabled={busy} onClick={removeOptionalActivity}>추가 활동 빼기</button></> : "확인된 추가 자료가 없어 집 활동만 표시합니다. 선택 활동 영역은 이미지에서도 완전히 빠집니다."}</div>}
      </div>
      <div className="card-copy-preview-column">
        <div className="row between"><strong>문구 배치 미리보기</strong><span className="badge">스튜디오 초안</span></div>
        <figure className={`card-copy-preview ${previewCurrent ? "" : "is-stale"}`} aria-busy={previewBusy}>
          {preview ? <img src={preview.url} alt={`${page.page}페이지 ${FAMILY_PAGE_LABELS[page.id]} 문구 배치`} /> : <div className="card-copy-placeholder">{invalid ? "필수 칸을 입력하면 배치를 확인할 수 있습니다." : "선택한 장의 실제 배치를 준비하고 있습니다."}</div>}
          {!previewCurrent && preview && <figcaption>{previewBusy ? "현재 입력으로 배치 갱신 중…" : "이전 입력의 미리보기입니다."}</figcaption>}
        </figure>
        <p className="hint">현재 입력의 자체 렌더입니다. 게시할 완성본은 Canva 내보내기 미리보기에서 확인하세요. 미리보기는 유료 이미지 생성을 요청하지 않습니다.</p>
        {previewError && <ErrorBox error={previewError} retry={() => setPreviewRetry(value => value + 1)} />}
        <details className="family-design"><summary>이 페이지 배치·배경 조절</summary><div className="stack">
          <label className="field">문구 정렬<select value={design.alignment} disabled={busy} onChange={event => updateDesign(page.id, { ...design, alignment: event.target.value as "center" | "left" })}><option value="center">중앙 정렬 · 기본</option><option value="left">왼쪽 정렬</option></select></label>
          <label className="field">바탕<select value={design.background.kind} disabled={busy} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, kind: event.target.value as "none" | "brand" | "image" } })}><option value="none">배경 없음 · 흰색</option><option value="brand">브랜드 색상</option>{design.background.assetId && <option value="image">선택한 이미지</option>}</select></label>
          <label className="field">바탕 색상<input type="color" value={design.background.color ?? "#1B2023"} disabled={busy} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, color: event.target.value } })} /></label>
          {design.background.kind === "image" && <><label className="field">그림 배치<select value={design.background.fit} disabled={busy} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, fit: event.target.value as "cover" | "contain" } })}><option value="cover">카드 채우기 · 자르기</option><option value="contain">그림 전체 맞추기</option></select></label>{([['focalX', '가로 초점', 100], ['focalY', '세로 초점', 100], ['brightness', '밝기', 200], ['overlay', '가독성 바탕', 100]] as const).map(([key, label, max]) => <label className="field" key={key}>{label} {design.background[key]}%<input type="range" min={0} max={max} value={design.background[key]} disabled={busy || (key.startsWith("focal") && design.background.fit === "contain")} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, [key]: Number(event.target.value) } })} /></label>)}</>}
          <button className="btn ghost" disabled={busy || !designHistory[page.id]?.length} onClick={() => { const history = designHistory[page.id] ?? []; if (history.length) { updateDesign(page.id, history.at(-1)!, false); setDesignHistory(value => ({ ...value, [page.id]: history.slice(0, -1) })); } }}>이 페이지 디자인 되돌리기</button>
          {!!sourceAssets.length && <details><summary>이 콘텐츠의 이전 이미지 불러오기</summary><div className="family-asset-grid">{sourceAssets.map(id => <button key={id} className="btn" disabled={busy} onClick={() => selectAsset(page.id, id)} aria-label={`저장 이미지 ${id} 선택`}><img src={`/api${path}/background/${id}`} alt="저장한 배경 이미지" /><span>이 페이지에 사용</span></button>)}</div></details>}
        </div></details>
        <PageBackgroundEditor channelId={channelId} itemId={itemId} pageIndex={selected} pageId={page.id} background={design.background.kind === "image" && design.background.assetId ? { assetId: design.background.assetId } : undefined} showOpacityControl={false} disabled={busy || aiBusy || !!conflict} showAi={showAi} imageReady={!!aiStatus.data?.image} imageModel={base.ai?.image.model} save={saveNow} onBusyChange={setBackgroundBusy} onApply={applyBackground} onChange={background => selectAsset(page.id, background?.assetId)} />
      </div>
    </div>
    {showAi && <details ref={aiPanel} className="family-ai"><summary>자동으로 문구 다듬기{aiBusy ? " · 작업 중" : aiError ? " · 확인할 오류 있음" : ""}</summary><div className="stack"><p className="hint">{selectedField ? `선택한 칸: ${familyFieldDescriptors(page).find(value => selectedField.startsWith(value.fieldPath))?.label ?? selectedField}` : `선택한 장: ${FAMILY_PAGE_LABELS[page.id]}`} · 잠근 칸은 자동으로 바꾸지 않습니다.</p><label className="field">고치고 싶은 점<textarea rows={3} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="예: 전망이라는 성격은 유지하고, 일상에서 비교할 수 있는 짧은 문장으로 다듬어 주세요." /></label><div className="row"><button className="btn primary" disabled={busy || aiBusy || !!conflict || !!selectedField && !!draft.fieldLocks[selectedField]} onClick={() => void generate()}>{generation.unresolved ? "이전 요청 결과 확인" : aiBusy ? "자동 제안 중…" : selectedField ? "선택한 칸 자동 제안" : "이 페이지 자동 제안"}</button>{selectedField && <button className="btn ghost" onClick={() => setSelectedField(null)}>페이지 전체 선택</button>}<button className="btn ghost" disabled={busy || aiBusy || !!conflict || generation.unresolved} onClick={() => void generate("all")}>8장 전체 다시 제안</button>{generation.unresolved && <button className="btn ghost" disabled={generation.cancelling} onClick={() => void generation.cancel()}>요청 중단</button>}</div><p className="hint">제안은 원고를 덮어쓰지 않습니다. 결과를 확인하고 직접 적용한 뒤 저장합니다.</p></div></details>}
    {aiError && <ErrorBox error={aiError} />}{generation.cancelError && <ErrorBox error={generation.cancelError} />}
    {!!reviewFlags.length && <div className="notice warn stack" role="status"><strong>현재 작업을 유지했습니다. 다음 내용을 확인해 주세요.</strong>{reviewFlags.map((flag, i) => <p key={`${flag.path}-${i}`}>{flag.message}</p>)}</div>}
    {proposal && <div className="card-copy-proposal notice stack"><strong>자동 제안 · 아직 원고에 적용하지 않았습니다</strong>{proposal.result.scope === "caption" ? <div className="card-copy-compare"><div><h4>현재 캡션 제안</h4><pre>{draft.captionPackage?.fullCaption ?? "없음"}</pre></div><div><h4>새 캡션 제안</h4><pre>{proposal.result.captionPackage?.fullCaption ?? "없음"}</pre></div></div> : proposal.result.scope === "review" ? <div>{proposal.result.editorialReview?.issues.map((issue, i) => <p key={`${issue.path}-${i}`}>{issue.problem}</p>)}{!proposal.result.editorialReview?.issues.length && <p>검수 결과에 등록된 수정 항목이 없습니다. 외부 게시 성공을 확인한 결과는 아닙니다.</p>}</div> : <div className="card-copy-compare"><div><h4>현재 원고</h4><pre>{copyText(draft.copy)}</pre></div><div><h4>제안</h4><pre>{proposal.result.copy ? copyText(proposal.result.copy) : "원고는 유지했습니다."}</pre></div></div>}{!canApply && <p role="alert">요청 뒤 입력 또는 저장 버전이 달라졌습니다. 현재 작업을 보호하기 위해 자동 적용하지 않습니다. 필요한 문구만 복사하거나 최신 원고로 다시 제안받아 주세요.</p>}<div className="row"><button className="btn primary" disabled={!canApply || busy} onClick={applyProposal}>제안을 편집기에 적용</button><button className="btn ghost" onClick={() => setProposal(null)}>현재 원고 유지</button></div></div>}
    <details className="family-parent-guide"><summary>부모를 위한 10분 대화 안내{draft.parentGuide ? "" : " · 아직 없음"}</summary>{draft.parentGuide ? <div className="stack"><ol className="family-timing">{draft.parentGuide.timing.map(step => <li key={step.step}><strong>{({ read: "함께 읽기", question: "중심 질문", compare: "관점·개념", close: "마무리" })[step.step]} · {step.minutes}분</strong><p>{step.instruction}</p></li>)}</ol><p><strong>꼭 나눌 질문</strong><br />{draft.parentGuide.coreQuestion}</p>{draft.parentGuide.optionalFollowup && <p><strong>선택 후속 질문</strong><br />{draft.parentGuide.optionalFollowup}</p>}{draft.parentGuide.optionalDeepening && <p><strong>더 생각하고 싶다면</strong><br />{draft.parentGuide.optionalDeepening}</p>}{([['whenUnsure','모르겠다고 할 때'],['whenDisagree','의견이 다를 때'],['whenMisunderstood','사실을 잘못 이해했을 때'],['whenTired','지쳤거나 원하지 않을 때'],['closingReflection','아이의 말을 되돌려주는 마무리']] as const).map(([key, label]) => <p key={key}><strong>{label}</strong><br />{draft.parentGuide![key]}</p>)}</div> : <p className="hint">8장 자동 제작에서 부모 안내도 함께 제안합니다. 현재 카드 문구는 계속 직접 수정하고 저장할 수 있습니다.</p>}</details>
    <details className="family-caption"><summary>게시물 설명(캡션) 제안 · {captionCurrent ? "저장된 카드와 일치" : caption ? "재검토 필요" : "아직 없음"}</summary><div className="stack"><p className="hint">카드 안의 문구와 별도입니다. 아래 제안을 게시 준비의 캡션 칸에 적용하고 그곳에서 저장하세요.</p>{caption && <><p className="small">카드 원고 #{caption.contentRevision} 기준 · 현재 원고 #{base.revisionId}</p><pre>{caption.fullCaption}</pre>{!captionCurrent && <p className="notice warn">현재 카드 버전 또는 중심 질문이 다릅니다. 최신 저장 원고로 캡션을 다시 제안받거나 직접 고쳐 대조 확인해 주세요.</p>}<button className="btn" disabled={!captionCurrent || !onApplyCaption || busy} onClick={() => onApplyCaption?.(caption.fullCaption)}>게시 준비의 캡션 칸에 적용</button></>}{showAi && <button className="btn" disabled={busy || aiBusy || !!conflict} onClick={() => void generate("caption")}>{aiBusy ? "자동 제안 중…" : "저장된 카드로 캡션 자동 제안"}</button>}{onEditCaption && <div className="stack"><p className="hint">AI 한도나 연결 오류로 자동 제안을 받을 수 없다면 게시 준비의 캡션을 직접 고치고 현재 8장과 대조해 확정할 수 있습니다.</p><button className="btn ghost" disabled={busy || aiBusy || !!conflict} onClick={onEditCaption}>게시 준비에서 캡션 직접 수정</button></div>}</div></details>
    <details className="family-evidence"><summary>원문 근거·검수·생성 기록</summary><div className="stack"><p className="small">중심 질문: {draft.editorialPlan.coreQuestion}</p><p className="small">이 기사와 연결되는 이유: {draft.editorialPlan.connectionReason}</p><FamilyEvidenceDetails draft={draft} />{draft.editorialReview?.issues.map((issue, i) => <p key={`${issue.path}-${i}`} className={issue.severity === "blocking" ? "notice err" : "notice"}>{issue.problem}{issue.evidence && ` · ${issue.evidence}`}</p>)}{showAi && <button className="btn" disabled={busy || aiBusy || !!conflict} onClick={() => void generate("editorial_review")}>저장 원고 자동 검수 제안</button>}<dl className="family-runs">{draft.generationRuns.map(run => <div key={run.id}><dt>{run.stage} · {run.status}</dt><dd>{run.finishedAt ?? run.startedAt}{run.provenance ? ` · ${run.provenance.provider} · ${(run.provenance.actualModel ?? `${run.provenance.requestedModel} (응답 모델 미확인)`)}` : ""}</dd></div>)}</dl></div></details>
    <div className="card-copy-savebar"><p className="hint">{dirty ? "문구·페이지 디자인에 미저장 변경이 있습니다." : `원고 버전 ${base.version}을 저장했습니다.`} {previewError ? "배치 오류를 고친 뒤 완성 이미지를 만들 수 있습니다." : "입력은 페이지를 옮겨도 유지됩니다."}</p><div className="row"><button className="btn primary" disabled={busy || invalid || !!conflict} onClick={() => { void saveNow().catch(() => {}); }}>{saving ? "저장 중…" : "문구·디자인 저장"}</button></div></div>
  </section>;
}
