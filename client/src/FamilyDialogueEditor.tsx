import { CoverCropPreview } from "./CoverCropPreview";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultPageDesigns, familyCardCopySchema, familyDialogueMetadataSchema, familyFieldDescriptors, familyFieldValue, FAMILY_PAGE_LABELS, type CardCopyV2, type ClaimRef, type FamilyDialogueMetadata, type FamilyFieldDescriptor, type FamilyPage, type FamilyPageId, type PageDesign, type ReviewFlag } from "@shared/familyDialogue";
import type { AiSelection } from "@shared/channelAi";
import { familyDisplayContext, familyDisplayDescriptors, familyReadingTextValues, preserveFamilyDisplayOverrides, resolveFamilyDisplay, type FamilyDisplayKey } from "@shared/familyDisplay";
import { resolvedReadingPageDesigns } from "@shared/readingPageImages";
import { READING_CARD_PROFILES, READING_PROFILE_LOGO_ID, readingProfileForTemplateKey, readingProfileDesigns, readingDisplayDescriptors, readingImageSlot, readingArtworkPages } from "@shared/readingCardProfiles";
import { familyCollectionDesign, familyCollectionPageDesigns } from "@shared/familyCollectionDesigns";
import { FAMILY_PROFILE_ASSET, FAMILY_ENDING_ASSETS, FAMILY_ENDING_FIXED_TEXT, REGISTERED_PROFILE_ASSETS, isRegisteredProfileAssetId, familyEndingAsset, selectedFamilyEnding } from "@shared/characterVariantAssets";
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

export type FamilyDialogueResponse = FamilyDialogueMetadata & { version: number; revisionId: number; copy: CardCopyV2; hasSavedCopy: boolean; ai?: Record<"summary" | "copy" | "image", AiSelection>; recoveryNotice?: string; evidence?: FamilyEvidenceView; artworkCredits?: Record<string, string> };
export type FamilyProposal = Partial<FamilyDialogueMetadata> & { copy: CardCopyV2 | null; version: number; revisionId?: number; baseRevision?: number; jobId?: number; fieldPath?: string; targetFieldHash?: string; scope?: string; model?: string; status: "ready" | "needs_source" | "needs_review"; reviewFlags: ReviewFlag[]; lateResult?: boolean; evidence?: FamilyEvidenceView; artworkCredits?: Record<string, string> };
type Preview = { url: string; signature: string };
type PreviewImages = { preview: Preview | null; thumbs: Record<string, Preview>; retired: string[] };
const previewUrls = (value: Pick<PreviewImages, "preview" | "thumbs">) => new Set([value.preview?.url, ...Object.values(value.thumbs).map(image => image.url)].filter((url): url is string => !!url));

/** Retire only references displaced by a committed state, never future queued URLs. */
export function useFamilyPreviewImages() {
  const [images, setImages] = useState<PreviewImages>({ preview: null, thumbs: {}, retired: [] });
  const owned = useRef(new Set<string>());
  function receive(pageId: string, signature: string, blob: Blob, selected = false) {
    const value = { url: URL.createObjectURL(blob), signature }; owned.current.add(value.url);
    setImages(current => {
      const next = { preview: selected ? value : current.preview, thumbs: { ...current.thumbs, [pageId]: value } };
      const retained = previewUrls(next), retired = new Set(current.retired);
      for (const url of previewUrls(current)) if (!retained.has(url)) retired.add(url);
      return { ...next, retired: [...retired] };
    });
  }
  useEffect(() => {
    if (!images.retired.length) return;
    // This effect belongs to the render which removed these references. A URL
    // created for a later, still queued render is not in this retirement list.
    const retired = new Set(images.retired);
    for (const url of retired) if (owned.current.delete(url)) URL.revokeObjectURL(url);
    setImages(current => {
      const remaining = current.retired.filter(url => !retired.has(url));
      return remaining.length === current.retired.length ? current : { ...current, retired: remaining };
    });
  }, [images.retired]);
  useEffect(() => () => { for (const url of owned.current) URL.revokeObjectURL(url); owned.current.clear(); }, []);
  return { preview: images.preview, thumbs: images.thumbs, receive };
}
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
export type FamilyCopyContext = Partial<Pick<FamilyDialogueResponse, "captionPackage" | "pageDesigns" | "artworkCredits">>;
export const familyCopyText = (copy: CardCopyV2, context: FamilyCopyContext = {}) => {
  const profile = readingProfileForTemplateKey(copy.templateKey);
  if (profile) {
    const designs = context.pageDesigns && resolvedReadingPageDesigns(copy,context.pageDesigns);
    const pageContexts = Object.fromEntries(copy.pages.map(page => { const background = designs?.[page.id].background; return [page.id, { imageCredit: background?.kind === "image" ? context.artworkCredits?.[String(background.assetId)] ?? "배경 이미지" : "" }]; }));
    const values = familyReadingTextValues(copy, familyDisplayContext(copy, context.captionPackage), pageContexts);
    return profile.pages.map(page => {
      const id=copy.pages[page.page-1].id,ending=selectedFamilyEnding(id,context.pageDesigns?.[id]);
      return `${page.page}. ${FAMILY_PAGE_LABELS[id]}\n${ending ? `${ending.label} · 전체 이미지로 적용\n고정 문구: ${FAMILY_ENDING_FIXED_TEXT.join(" · ")}` : page.textBoxes.map(box => values[box.field]).filter(Boolean).join("\n")}`;
    }).join("\n\n");
  }
  return copy.pages.map(page => {
  const ending=selectedFamilyEnding(page.id,context.pageDesigns?.[page.id]);
  if(ending)return `${page.page}. ${FAMILY_PAGE_LABELS[page.id]}\n${ending.label} · 전체 이미지로 적용\n고정 문구: ${FAMILY_ENDING_FIXED_TEXT.join(" · ")}`;
  const background = context.pageDesigns?.[page.id].background;
  const display = resolveFamilyDisplay(page, { ...familyDisplayContext(copy, context.captionPackage), imageCredit: background?.kind === "image" ? context.artworkCredits?.[String(background.assetId)] ?? "배경 이미지" : "" });
  const labels = familyDisplayDescriptors(page).map(field => display[field.key] ? `${field.label}: ${display[field.key]}` : "").filter(Boolean).join("\n");
  return `${page.page}. ${FAMILY_PAGE_LABELS[page.id]}\n${textOf(page.fields)}\n${labels}`;
  }).join("\n\n");
};
const copyText = familyCopyText;
function pageValue(page: FamilyPage, path: string): unknown { return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, page); }
const localRefPath = (page: FamilyPage, ref: ClaimRef) => ref.fieldPath.startsWith(`pages.${page.id}.`) ? ref.fieldPath.slice(`pages.${page.id}.`.length) : ref.fieldPath;
function individualFactRefs(page: FamilyPage): ClaimRef[] {
  return page.claimRefs.flatMap(ref => page.id === "news_summary" && localRefPath(page, ref) === "fields.facts"
    ? page.fields.facts.map((_fact, index) => ({ ...ref, fieldPath: `fields.facts.${index}` })) : [ref]);
}
function replacePageField(page: FamilyPage, path: string, value: unknown): FamilyPage {
  const next = structuredClone(page), segments = path.split(".");
  let cursor: any = next;
  for (const segment of segments.slice(0, -1)) { if (["__proto__", "prototype", "constructor"].includes(segment)) throw new Error("수정할 칸을 확인해 주세요."); cursor = cursor[segment]; }
  cursor[segments.at(-1)!] = value;
  next.claimRefs = individualFactRefs(page).filter(ref => {
    const local = localRefPath(page, ref);
    if (path === "fields.facts" && Array.isArray(value) && /^fields\.facts\.\d+$/.test(local)) {
      // Adding/removing the last row must not erase refs for unchanged siblings.
      const nextText = pageValue(next, local);
      return nextText !== undefined && nextText === pageValue(page, local);
    }
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
function fieldEvidenceOptions(definition: boolean, evidence?: FamilyEvidenceView) {
  const facts = (evidence?.facts ?? []).filter(fact => definition
    ? ["reported_event", "research_finding"].includes(fact.claimType) && !["conflicting", "insufficient"].includes(fact.verificationStatus) && fact.sourceScope !== "search_result"
    : ["reported_event", "research_finding", "attributed_statement", "forecast"].includes(fact.claimType));
  const resources = definition ? (evidence?.resources ?? []).filter(resource => ["definition", "paper", "online"].includes(resource.kind) && resource.scope !== "search_result").sort((a, b) => Number(b.kind === "definition") - Number(a.kind === "definition")) : [];
  return { facts, resources };
}
type EvidenceChoice = { factIds: string[]; resourceIds: string[] };
function FieldEvidence({ page, path, value, evidence, bindingId, disabled, onConfirm, onReload }: {
  page: FamilyPage; path: string; value: string; evidence?: FamilyEvidenceView; bindingId: string; disabled: boolean;
  onConfirm: (choice: EvidenceChoice, text: string, evidenceSetId: string) => boolean; onReload: () => Promise<void>;
}) {
  const definition = page.id === "concept", current = evidence?.evidenceSetId === bindingId;
  const options = fieldEvidenceOptions(definition, current ? evidence : undefined);
  const refs = individualFactRefs(page).filter(ref => localRefPath(page, ref) === path), refSignature = stable(refs);
  const linked = refs.some(ref => ref.factIds.length || ref.resourceIds.length);
  const [choice, setChoice] = useState<EvidenceChoice>({ factIds: [], resourceIds: [] }), [confirmed, setConfirmed] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<Error | null>(null);
  useEffect(() => { setChoice({ factIds: [], resourceIds: [] }); setConfirmed(false); setError(null); }, [value, bindingId, evidence?.evidenceSetId, refSignature]);
  function toggle(kind: keyof EvidenceChoice, id: string, checked: boolean) { setConfirmed(false); setChoice(previous => ({ ...previous, [kind]: checked ? [...previous[kind], id] : previous[kind].filter(value => value !== id) })); }
  const blocked = disabled || loading || !current, hasSelection = choice.factIds.length + choice.resourceIds.length > 0;
  return <details className="family-field-evidence" data-field-path={`pages.${page.id}.${path}`}><summary>원문 근거 확인 · {linked ? "연결됨" : "재연결 필요"}</summary><div className="stack">
    {!linked && <p className="notice warn small" role="status">이 칸의 현재 문구에 근거를 연결해야 저장할 수 있습니다. 다른 칸의 근거는 유지합니다.</p>}
    {!current ? <><p className="notice warn small">현재 원고와 같은 버전의 근거를 불러와야 선택할 수 있습니다. 입력한 문구는 유지합니다.</p><button type="button" className="btn sm" disabled={disabled || loading} onClick={() => { setLoading(true); setError(null); void onReload().catch(setError).finally(() => setLoading(false)); }}>{loading ? "근거 불러오는 중…" : "현재 원문 근거 다시 불러오기"}</button></> : <>
      <p className="hint">{definition ? "확인한 정의·논문·설명 자료에서 현재 문장을 직접 뒷받침하는 근거만 선택하세요. 전망·발언·가정, 검색 요약은 통용 정의의 근거로 선택할 수 없습니다." : "기사에서 확인한 사실·발언을 선택하세요. 발언자·전망의 성격·시점·수치 조건을 현재 카드에도 유지해야 합니다."}</p>
      {options.facts.map(fact => <div className="family-evidence-entry" key={fact.id}><label className="check"><input type="checkbox" data-evidence-id={`fact:${fact.id}`} checked={choice.factIds.includes(fact.id)} disabled={blocked} onChange={event => toggle("factIds", fact.id, event.target.checked)} /><span>{claimTypeLabels[fact.claimType]} · {fact.statement}</span></label>{fact.speaker && <p className="small">발언자: {fact.speaker}</p>}{fact.timeScope && <p className="small">시점·범위: {fact.timeScope}</p>}{!!fact.conditions.length && <p className="small">유지할 조건: {fact.conditions.join(" · ")}</p>}<blockquote>{fact.evidenceExcerpt}</blockquote><p className="hint">읽은 범위: {sourceScopeLabels[fact.sourceScope]}{["conflicting", "insufficient"].includes(fact.verificationStatus) && " · 근거의 충돌·부족을 함께 확인해 주세요."}</p></div>)}
      {options.resources.map(resource => { const url = externalEvidenceUrl(resource.url); return <div className="family-evidence-entry" key={resource.id}><label className="check"><input type="checkbox" data-evidence-id={`resource:${resource.id}`} checked={choice.resourceIds.includes(resource.id)} disabled={blocked} onChange={event => toggle("resourceIds", resource.id, event.target.checked)} /><span>{resource.title}</span></label>{url && <a href={url} target="_blank" rel="noopener noreferrer">확인한 원문 열기 ↗</a>}<blockquote>{resource.evidenceExcerpt}</blockquote><p className="hint">읽은 범위: {sourceScopeLabels[resource.scope]} · 확인: {fmtDate(resource.checkedAt)} (한국 시간)</p><p className="small">읽을 부분: {resource.readingTarget}</p></div>; })}
      {!options.facts.length && !options.resources.length && <p className="notice warn small">이 칸에 연결할 수 있는 확인된 근거가 없습니다. 원문 자료를 보완한 뒤 근거를 다시 확인해 주세요. 임의의 자료 ID나 주소를 만들지 않습니다.</p>}
      <label className="check"><input type="checkbox" data-evidence-confirm checked={confirmed} disabled={blocked || !hasSelection || !value.trim()} onChange={event => setConfirmed(event.target.checked)} /><span>발췌를 읽고 현재 문구가 주체·조건·뜻을 유지하는지 직접 대조했습니다.</span></label>
      <button type="button" className="btn sm" disabled={blocked || !hasSelection || !confirmed || !value.trim()} onClick={() => { if (!onConfirm(choice, value, bindingId)) setError(new Error("문구나 근거 버전이 바뀌었습니다. 현재 입력을 유지했으니 다시 대조해 주세요.")); setConfirmed(false); }}>대조한 근거를 이 칸에 연결</button>
      <p className="hint">연결은 편집 중인 원고에 반영합니다. ‘문구·디자인 저장’을 눌러 확정하세요. AI는 호출하지 않습니다.</p>
    </>}{error && <ErrorBox error={error} />}
  </div></details>;
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

function FamilyRunRecord({ run }: { run: FamilyDialogueResponse["generationRuns"][number] }) {
  const labels = { article_analysis: "원문 분석", editorial_plan: "원고 구성", resource_research: "자료 조사", card_copy: "8장 문구", caption: "게시물 설명(캡션)", image_brief: "이미지 구성", image_generation: "이미지 생성", editorial_review: "원고 검수", partial_copy: "선택 문구" };
  const statuses = { ready: "완료", needs_source: "자료 확인 필요", needs_review: "검토 필요", failed: "실패", cancelled: "취소됨", running: "진행 중" };
  const execution = run.provenance, notCalled = execution?.status === "not_started" && execution.usageStatus === "known" && execution.inputTokens === 0 && execution.outputTokens === 0;
  return <div><dt>{labels[run.stage]} · {notCalled ? "실행 안 됨" : statuses[run.status]}</dt><dd><p>{fmtDate(run.finishedAt ?? run.startedAt)}{execution && ` · ${execution.provider} · ${notCalled ? `${execution.requestedModel} (설정된 모델 · 외부 AI 호출 안 함)` : execution.actualModel ?? `${execution.requestedModel} (응답 모델 미확인)`}`}</p>{run.error && <p className="notice warn small">{run.error} · 현재 원고의 직접 편집과 저장은 계속할 수 있습니다.</p>}</dd></div>;
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
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null), [observedRuns, setObservedRuns] = useState<FamilyDialogueResponse["generationRuns"]>([]);
  const [instructions, setInstructions] = useState(""), [proposal, setProposal] = useState<{ result: FamilyProposal; baseline: string; baseVersion: number } | null>(null), [reviewFlags, setReviewFlags] = useState<ReviewFlag[]>([]);
  const { preview, thumbs, receive: receivePreview } = useFamilyPreviewImages();
  const [previewError, setPreviewError] = useState<Error | null>(null), [previewBusy, setPreviewBusy] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const [designHistory, setDesignHistory] = useState<Partial<Record<FamilyPageId, PageDesign[]>>>({});
  const [structureNotice, setStructureNotice] = useState<string | null>(null);
  const modeDrafts = useRef<Record<string, FamilyPage["fields"]>>({}), serial = useRef<Promise<FamilyDialogueResponse> | null>(null), appliedProposal = useRef<number | null>(null), action = useRef(false);
  const modeLockDrafts = useRef<Record<string, Record<string, boolean>>>({});
  const aiPanel = useRef<HTMLDetailsElement>(null);
  const generation = useGenerationRequest(channelId, itemId, "card-copy");
  const dirty = !same(editable(base), editable(draft)), parsed = familyCardCopySchema.safeParse(draft.copy), invalid = !parsed.success;
  const invalidFields = parsed.success ? [] : parsed.error.issues.map(issue => {
    const index = issue.path[0] === "pages" && typeof issue.path[1] === "number" ? issue.path[1] : null;
    const invalidPage = index === null ? null : draft.copy.pages[index], path = issue.path.slice(2).join(".");
    const label = invalidPage && (familyFieldDescriptors(invalidPage).find(field => field.path === path)?.label
      ?? (path.startsWith("displayOverrides.") ? familyDisplayDescriptors(invalidPage).find(field => field.key === path.slice(17))?.label : null));
    return { index, label: invalidPage ? `${index! + 1}페이지 ${FAMILY_PAGE_LABELS[invalidPage.id]} · ${label ?? "문구·구성"}` : "8장 원고 구성", message: issue.message };
  });
  const page = draft.copy.pages[selected], design = draft.pageDesigns[page.id];
  const selectedEnding = selectedFamilyEnding(page.id, design);
  const readingProfile = readingProfileForTemplateKey(draft.copy.templateKey), readingSlot = readingProfile && readingImageSlot(readingProfile, page.id);
  const collectionPalette = familyCollectionDesign(draft.copy.templateKey);
  const effectiveDesign = resolvedReadingPageDesigns(draft.copy,draft.pageDesigns)[page.id];
  const visibleDisplayFields = readingProfile ? readingDisplayDescriptors(readingProfile, page) : familyDisplayDescriptors(page);
  const retainedDisplayFields = readingProfile ? familyDisplayDescriptors(page).filter(descriptor => !visibleDisplayFields.some(visible => visible.key === descriptor.key) && Object.hasOwn(page.displayOverrides ?? {}, descriptor.key)) : [];
  const display = resolveFamilyDisplay(page, { ...familyDisplayContext(draft.copy, draft.captionPackage), imageCredit: effectiveDesign.background.kind === "image" ? draft.artworkCredits?.[String(effectiveDesign.background.assetId)] ?? "배경 이미지" : "" });
  const fixedOutroDesign = design.alignment === "center" && design.background.kind === "brand" && (design.background.color ?? "#1B2023").toUpperCase() === "#1B2023";
  const signatureFor = (value: FamilyDialogueResponse, index: number) => stable({ page: value.copy.pages[index], design: resolvedReadingPageDesigns(value.copy,value.pageDesigns)[value.copy.pages[index].id], template: value.copy.templateKey, version: value.version, displayContext: familyDisplayContext(value.copy, value.captionPackage), artworkCredits: value.artworkCredits, previewRevision });
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
      if (!onlyIncompleteText(copyCheck) || !onlyIncompleteText(metadataCheck)) return null;
      // Credits are presentation metadata for immutable, item-scoped assets.
      // Keep a newly selected asset's label in a local checkpoint; the server
      // still verifies ownership and obtains canonical credits at save/render.
      const referenced = new Set(Object.values(candidate.pageDesigns).flatMap(design => [design.background.assetId, ...(design.previousAssetIds ?? [])]).filter((id): id is number => typeof id === "number").map(String));
      const inputCredits: unknown = candidate.artworkCredits;
      const recoveredCredits = inputCredits && typeof inputCredits === "object" && !Array.isArray(inputCredits)
        ? Object.fromEntries(Object.entries(inputCredits).filter(([id, value]) => referenced.has(id) && typeof value === "string" && [...value].length <= 300)) as Record<string, string> : {};
      const artworkCredits = { ...baseRef.current.artworkCredits, ...recoveredCredits };
      return { ...baseRef.current, ...meta, copy: candidate.copy, ...(Object.keys(artworkCredits).length ? { artworkCredits } : {}) } as FamilyDialogueResponse;
    },
    onRestore: value => { put(value); setProposal(null); setSaveError(null); },
  });
  const busy = disabled || saving || rendering || backgroundBusy || !!recovery.pending || formatConflict, aiBusy = generating && !generation.cancelled;
  function put(value: FamilyDialogueResponse) { draftRef.current = value; setDraft(value); setSaveFeedback(null); }
  function changeReadingStyle(key: string) {
    const current = draftRef.current, profile = readingProfileForTemplateKey(key), collection = familyCollectionDesign(key);
    if (current.copy.templateKey === key) return;
    const designs = profile ? readingProfileDesigns(profile, current.pageDesigns) : collection ? familyCollectionPageDesigns(key, current.copy.templateKey, current.pageDesigns) : Object.fromEntries(Object.entries(defaultPageDesigns()).map(([id, fallback]) => {
      const previous = current.pageDesigns[id as FamilyPageId];
      return [id, { ...fallback, ...(previous.outroPresentation ? {outroPresentation:previous.outroPresentation} : {}), previousAssetIds: [...new Set([...(previous.previousAssetIds ?? []), ...(previous.background.assetId ? [previous.background.assetId] : [])])], ...(id !== "outro" && previous.background.kind === "image" ? { background: { ...previous.background, color: fallback.background.color } } : {}) }];
    })) as FamilyDialogueResponse["pageDesigns"];
    const copy = { ...current.copy, templateKey: key, pages: current.copy.pages.map(value => value.id === "outro" ? { ...value, fields: { ...value.fields, logoAssetId: isRegisteredProfileAssetId(value.fields.logoAssetId) ? value.fields.logoAssetId : profile ? READING_PROFILE_LOGO_ID : "brand:space-penguin-company:20261101" } } : value) };
    put(invalidateDerived({ ...current, copy, pageDesigns: designs })); setProposal(null); setPreviewError(null); onTemplateChange?.(key);
    setStructureNotice(collection ? `${collection.name}${collection.colorName ? ` · ${collection.colorName}` : ""} 컬러를 8장 전용 배치에 적용했습니다. 8장 구성과 문구·이미지·직접 지정한 배경색은 유지합니다.` : "선택한 스타일의 배치와 색을 적용했습니다. 문구와 이전 이미지는 유지되며, 저장 후에도 같은 스타일로 다시 열립니다.");
  }
  function chooseOutroProfile(assetId: string) {
    if (!isRegisteredProfileAssetId(assetId)) return;
    const current=draftRef.current;
    const copy={...current.copy,pages:current.copy.pages.map(value=>value.id==='outro'?{...value,fields:{...value.fields,logoAssetId:assetId}}:value)};
    put({...current,copy,dependencies:{...current.dependencies,render:'needs_review',review:current.editorialReview?'needs_review':'not_generated'}});
    setPreviewError(null);
  }
  function chooseOutroPresentation(value: string) {
    const ending=familyEndingAsset(value),previous=draftRef.current.pageDesigns.outro;
    if(value!=='template'&&!ending)return;
    updateDesign('outro',{...previous,outroPresentation:ending?{mode:'full_image',assetId:ending.id}:{mode:'template'}});
    setPreviewError(null);
  }
  function adopt(value: FamilyDialogueResponse) { baseRef.current = value; setBase(value); put(value); appliedProposal.current = null; modeDrafts.current = {}; modeLockDrafts.current = {}; setStructureNotice(null); setConflict(null); setProposal(null); setSaveError(null); }
  async function reloadEvidence() {
    const response = await api<StoredCardCopyResponse>(path);
    if (response.copy.version !== 2 || response.version !== baseRef.current.version || response.revisionId !== baseRef.current.revisionId) { setConflict(response); throw new Error("다른 곳에서 저장한 원고가 있습니다. 현재 입력을 유지했으니 저장본과 먼저 비교해 주세요."); }
    const latest = response as FamilyDialogueResponse, current = draftRef.current;
    if (!latest.evidence || latest.evidence.evidenceSetId !== current.evidenceBinding.evidenceSetId) throw new Error("현재 편집 원고와 같은 근거 묶음을 찾을 수 없습니다. 원문·제안 버전을 확인해 주세요.");
    baseRef.current = { ...baseRef.current, evidence: latest.evidence }; setBase(baseRef.current);
    put({ ...current, evidence: latest.evidence });
  }
  function connectFieldEvidence(pageId: FamilyPageId, localPath: string, choice: EvidenceChoice, text: string, bindingId: string): boolean {
    const current = draftRef.current, selectedPage = current.copy.pages.find(value => value.id === pageId);
    if (!selectedPage || current.evidenceBinding.evidenceSetId !== bindingId || current.evidence?.evidenceSetId !== bindingId || pageValue(selectedPage, localPath) !== text || !text.trim()) return false;
    const required = pageId === "news_summary" && /^fields\.facts\.\d+$/.test(localPath) || pageId === "concept" && selectedPage.id === "concept" && selectedPage.fields.mode === "scientific_explanation" && localPath === "fields.acceptedDefinition";
    if (!required) return false;
    const options = fieldEvidenceOptions(pageId === "concept", current.evidence);
    if (!choice.factIds.length && !choice.resourceIds.length || choice.factIds.some(id => !options.facts.some(fact => fact.id === id)) || choice.resourceIds.some(id => !options.resources.some(resource => resource.id === id))) return false;
    const references = new Map<ClaimRef["claimType"], ClaimRef>();
    for (const fact of options.facts.filter(fact => choice.factIds.includes(fact.id))) {
      const ref = references.get(fact.claimType) ?? { fieldPath: localPath, claimType: fact.claimType, factIds: [], resourceIds: [] };
      ref.factIds.push(fact.id); references.set(fact.claimType, ref);
    }
    if (choice.resourceIds.length) {
      const ref = references.get("research_finding") ?? { fieldPath: localPath, claimType: "research_finding", factIds: [], resourceIds: [] };
      ref.resourceIds = options.resources.filter(resource => choice.resourceIds.includes(resource.id)).map(resource => resource.id); references.set(ref.claimType, ref);
    }
    const copy = { ...current.copy, pages: current.copy.pages.map(value => value.id === pageId ? { ...value, claimRefs: [...individualFactRefs(value).filter(ref => localRefPath(value, ref) !== localPath), ...references.values()] } : value) };
    put(invalidateDerived({ ...current, copy })); setSaveError(null); return true;
  }
  useEffect(() => {
    if (initial.version <= baseRef.current.version) return;
    if (same(editable(draftRef.current), editable(baseRef.current))) adopt(initial); else setConflict(initial);
  }, [initial]);
  useEffect(() => { if (itemVersion && itemVersion > baseRef.current.version) void props.refresh(); }, [itemVersion]);
  useEffect(() => {
    if (!templateKey || templateKey === draftRef.current.copy.templateKey) return;
    if (readingProfileForTemplateKey(templateKey) || familyCollectionDesign(templateKey) || readingProfileForTemplateKey(draftRef.current.copy.templateKey)) changeReadingStyle(templateKey);
    else { put(invalidateDerived({ ...draftRef.current, copy: { ...draftRef.current.copy, templateKey } })); setProposal(null); }
  }, [templateKey]);
  useEffect(() => { setSelectedField(null); }, [selected]);
  async function loadConflict() { try { setConflict(await api<StoredCardCopyResponse>(path)); } catch (error) { setSaveError(error as Error); } }
  async function saveNow(): Promise<FamilyDialogueResponse> {
    const reject = (message: string): never => { const error = new Error(message); setSaveError(error); throw error; };
    if (formatConflict) reject("다른 형식으로 저장된 원고를 먼저 확인해 주세요. 현재 입력은 유지했습니다.");
    if (recovery.pending) reject("기기 복구본을 먼저 확인해 주세요.");
    if (serial.current) { await serial.current; return saveNow(); }
    const snapshot = draftRef.current, current = baseRef.current;
    if (!familyCardCopySchema.safeParse(snapshot.copy).success) reject("비어 있는 필수 칸과 입력 안내를 확인해 주세요. 입력 내용은 유지했습니다.");
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
  async function confirmSave() {
    const previous = baseRef.current;
    setSaveFeedback(null); setSaveError(null);
    try {
      const saved = await saveNow();
      setSaveFeedback(saved.version === previous.version && saved.revisionId === previous.revisionId
        ? `변경 내용이 없어 이미 저장된 버전 ${saved.version}을 유지했습니다.`
        : `문구·디자인 저장 완료 · 버전 ${saved.version}`);
    } catch (error) { setSaveError(error as Error); }
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
        receivePreview(page.id, signature, blob, true);
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
          receivePreview(id, expected, blob);
        } catch { if (controller.signal.aborted) return; /* Selecting that page exposes its actionable error. */ }
      }
    }, 1200);
    return () => { live = false; window.clearTimeout(timer); controller.abort(); };
  }, [base.version, dirty, invalid, selected, previewRevision]);
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
  function updateDisplay(key: FamilyDisplayKey, value: string | undefined) {
    const current = draftRef.current;
    const copy = { ...current.copy, pages: current.copy.pages.map(candidate => {
      if (candidate.id !== page.id) return candidate;
      const overrides = { ...candidate.displayOverrides };
      if (value === undefined) delete overrides[key]; else overrides[key] = value;
      const { displayOverrides: _previous, ...rest } = candidate;
      return Object.keys(overrides).length ? { ...rest, displayOverrides: overrides } as FamilyPage : rest as FamilyPage;
    }) };
    put(invalidateDerived({ ...current, copy })); setSelectedField(null); setSaveError(null);
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
    updateDesign(id, { ...old, previousAssetIds, background: { ...background, kind: assetId ? "image" : "brand", inheritCover:false, ...(assetId ? { assetId } : {}) } });
  }
  function useApprovedOutroDesign() {
    const previous = draftRef.current.pageDesigns.outro;
    const previousAssetIds = [...new Set([...(previous.previousAssetIds ?? []), ...(previous.background.assetId ? [previous.background.assetId] : [])])].slice(-20);
    updateDesign("outro", { ...defaultPageDesigns().outro, previousAssetIds });
    setStructureNotice("승인된 닫는 표지 배치를 편집기에 선택했습니다. 저장하면 확정됩니다. 이전 배경 이미지는 기록에 보관했고 문구는 유지했습니다.");
  }
  function applyBackground(result: PageArtworkResult, prior: number | null): boolean {
    const id = result.pageId as FamilyPageId, current = draftRef.current.pageDesigns[id];
    // An older outro request can still be recovered. Keep its image as an
    // explicit proposal for another page instead of altering the fixed close.
    if (id === "outro" || readingProfileForTemplateKey(draftRef.current.copy.templateKey) && readingImageSlot(readingProfileForTemplateKey(draftRef.current.copy.templateKey)!, id)?.kind !== "artwork") return false;
    if (!current || baseRef.current.version !== result.version || (current.background.kind === "image" ? current.background.assetId ?? null : null) !== prior) return false;
    put({ ...draftRef.current, artworkCredits: { ...draftRef.current.artworkCredits, [String(result.assetId)]: result.credit } });
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
      if (response.generationRuns) setObservedRuns(response.generationRuns);
      const relevantStage = response.scope === "caption" ? "caption" : response.scope === "review" ? "editorial_review" : null;
      const lastRun = relevantStage && response.generationRuns?.filter(run => run.stage === relevantStage).at(-1);
      const completedOutput = response.status === "ready" || response.scope === "review" && response.status === "needs_review" && response.reviewFlags.length > 0 && response.reviewFlags.every(flag => flag.code === "review_changes_required");
      const hasResult = relevantStage
        ? completedOutput && (!lastRun || lastRun.status === "ready") && !!(response.scope === "caption" ? response.captionPackage : response.editorialReview)
        : !!response.copy;
      setProposal(null);
      if (hasResult) setProposal({ result: response,
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
    const next = { ...current, ...Object.fromEntries(metadataKeys.filter(key => result[key] !== undefined).map(key => [key, result[key]])), ...(result.evidence ? { evidence: result.evidence } : {}), artworkCredits: { ...current.artworkCredits, ...result.artworkCredits }, copy: result.copy ? preserveFamilyDisplayOverrides(result.copy, current.copy) : current.copy } as FamilyDialogueResponse;
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
        <textarea id={id} rows={d.initialBudget > 36 ? 3 : 2} value={text} disabled={disabled || !!recovery.pending} onFocus={() => setSelectedField(systemOwned ? null : d.fieldPath)} onChange={event => updateField(d, event.target.value || (["fields.caveat", "fields.scenario"].includes(path) ? null : ""))} aria-invalid={d.required && !text.trim() || count > d.manualMax} />
      </label>
      {systemOwned ? <p className="hint">채널 기본값에서 시작한 문구입니다. 여기서 수정하면 현재 콘텐츠에만 저장하고, AI 재작성에서도 유지합니다.</p> : <div className="family-field-actions"><label><input type="checkbox" checked={locked} disabled={disabled || !!recovery.pending} onChange={event => lockField(d.fieldPath, event.target.checked)} />자동 재작성에서 이 칸 유지</label>{showAi && <button type="button" className="btn sm ghost" disabled={busy || aiBusy || locked} aria-pressed={selectedField === d.fieldPath} onClick={() => { setSelectedField(d.fieldPath); if (aiPanel.current) { aiPanel.current.open = true; aiPanel.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); } }}>이 칸 재작성 선택</button>}</div>}
      {count > d.initialBudget && <p className="hint">권장 길이를 넘었습니다. 저장은 가능하며 실제 배치에서 넘치는 칸을 확인할 수 있습니다.</p>}
      {count > d.manualMax && <p className="card-copy-error" role="alert">저장 한도 {d.manualMax}자를 넘었습니다. 붙여넣은 내용은 그대로 유지했습니다. 이 칸을 나눠 정리한 뒤 저장해 주세요.</p>}
      {(page.id === "news_summary" && /^fields\.facts\.\d+$/.test(path) || page.id === "concept" && page.fields.mode === "scientific_explanation" && path === "fields.acceptedDefinition") && <FieldEvidence key={`${page.id}:${path}`} page={page} path={path} value={text} evidence={draft.evidence} bindingId={draft.evidenceBinding.evidenceSetId} disabled={busy || aiBusy || !!conflict} onConfirm={(choice, text, bindingId) => connectFieldEvidence(page.id, path, choice, text, bindingId)} onReload={reloadEvidence} />}
    </div>;
  };
  const caption = draft.captionPackage, captionCurrent = !!caption && caption.contentRevision === base.revisionId && draft.dependencies.caption === "current" && !dirty && caption.coreQuestion === draft.editorialPlan.coreQuestion;
  const runs = [...new Map([...draft.generationRuns, ...observedRuns].map(run => [run.id, run])).values()].slice(-200);
  const pendingScope = ({ caption: "캡션", review: "원고 검수", page: "페이지 문구", field: "선택 문구", all: "8장 전체" } as Record<string, string>)[String(generation.pendingBody?.scope)] ?? "AI";
  const sourceAssets = [...new Set(Object.values(draft.pageDesigns).flatMap(value => [...(value.previousAssetIds ?? []), ...(value.background.assetId ? [value.background.assetId] : [])]))];
  return <section className="card-copy-editor family-dialogue-editor stack" aria-label="가족 대화 8장 카드 편집기">
    <div className="card-copy-heading"><div><span className="card-copy-kicker">가족 대화 · 8장</span><h3>카드 안의 문구와 디자인</h3><p>뉴스에서 출발해 한 가지 질문을 나눕니다. 선택한 장을 자세히 수정하고, 자동 제안은 확인한 뒤 적용하세요.</p></div><span className={`badge ${dirty ? "warn" : "ok"}`}>{saving ? "저장 중" : saveError ? "저장 실패" : dirty ? "미저장 변경" : `저장됨 · 버전 ${base.version}`}</span></div>
    <RecoveryNotice recovery={recovery} formatValue={value => copyText(value.copy, value)} />
    <label className="field">카드뉴스 스타일<select aria-label="카드뉴스 스타일" value={readingProfile?.templateKey ?? (collectionPalette ? draft.copy.templateKey : "legacy")} disabled={busy || aiBusy || !!conflict} onChange={event => changeReadingStyle(event.target.value === "legacy" ? "builtin:classic" : event.target.value)}><option value="legacy">기존 8장 디자인</option>{collectionPalette && <option value={draft.copy.templateKey}>{collectionPalette.name}{collectionPalette.colorName ? ` · ${collectionPalette.colorName}` : ""} · 8장 컬러 적용</option>}{READING_CARD_PROFILES.map(profile => <option key={profile.id} value={profile.templateKey}>{profile.label}{profile.sourceStyleId ? "" : " · 기존"} · 사진 {profile.images.length - 1}장</option>)}</select><span className="hint">{collectionPalette ? "기본 세트에서 선택한 컬러를 8장 전용 배치에 적용합니다. 현재 원고의 8장 구성과 직접 지정한 배경색은 유지합니다." : "1080×1350 · 8장. 새 스타일의 미리보기와 문구 편집은 바로 사용할 수 있으며, Canva 자동 제작은 해당 마스터 검증·등록이 완료된 뒤 가능합니다."}</span></label>
    {structureNotice && <div className="notice small row between" role="status"><span>{structureNotice}</span><button className="btn sm ghost" onClick={() => setStructureNotice(null)}>안내 닫기</button></div>}
    {conflict && <div className="notice warn stack" role="alert"><strong>다른 곳에서 저장한 버전이 있습니다. 현재 입력은 유지했습니다.</strong><details><summary>저장본과 현재 입력 비교</summary><div className="card-copy-compare"><pre>{conflict.copy.version === 2 ? copyText(conflict.copy, conflict) : "다른 형식으로 저장된 원고입니다."}</pre><pre>{copyText(draft.copy, draft)}</pre></div><button className="btn" disabled={busy} onClick={() => { if (conflict.copy.version === 2) { recovery.clear(); adopt(conflict as FamilyDialogueResponse); } else { recovery.clear(); qc.setQueryData(queryKey, conflict); } }}>서버 저장본 불러오기</button></details></div>}
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
        {page.id === "perspectives" && !readingProfile && <label className="field">두 시선 배치<select value={page.layout === "columns" ? "columns" : "stacked"} disabled={disabled || !!recovery.pending} onChange={event => put(invalidateDerived({ ...draftRef.current, copy: { ...draftRef.current.copy, pages: draftRef.current.copy.pages.map(value => value.id === "perspectives" ? { ...value, layout: event.target.value } : value) } }))}><option value="stacked">위아래 · 기본</option><option value="columns">좌우 · 짧은 문구에 적합</option></select></label>}
        {readingProfile && <p className="hint">이 스타일은 뉴스 본문과 STEP 문구를 고정 영역에 배치합니다. 아래 원고의 보조 제목은 보관되며 일부 페이지에서는 표시되지 않습니다. 줄이 넘치면 해당 칸을 알려 드립니다.</p>}
        {page.id==='outro'&&<fieldset className="stack family-outro-picker" data-testid="family-outro-picker"><legend>마지막 장 이미지</legend>
          <label className="field">마지막 장 방식<select aria-label="마지막 장 방식" value={selectedEnding?.id??'template'} disabled={busy||aiBusy||!!conflict} onChange={event=>chooseOutroPresentation(event.target.value)}>
            <option value="template">문구를 편집하는 마무리 · 프로필 이미지 선택</option>
            {FAMILY_ENDING_ASSETS.map(asset=><option key={asset.id} value={asset.id}>{asset.label} · {asset.revision==='latest'?'추천':'이전 수정안'} · 전체 이미지로 적용</option>)}
          </select></label>
          {selectedEnding?<div className="notice small stack" role="status" data-testid="family-outro-full-image-notice"><strong>전체 이미지로 적용 · 이미지 속 문구 고정</strong><p>이 엔딩의 ‘구독’, ‘좋아요’, ‘@spacepenguin.co’는 이미지에 포함되어 수정되지 않습니다. 아래 입력은 보관되며 ‘문구를 편집하는 마무리’로 돌아오면 다시 표시됩니다.</p><p>스튜디오에서 8장 이미지로 출력할 수 있습니다. 현재 Canva 자동 제작은 이 전체 이미지 엔딩을 지원하지 않습니다.</p></div>:<>
            <label className="field">마지막 장 프로필<select aria-label="마지막 장 프로필" value={page.fields.logoAssetId??''} disabled={busy||aiBusy||!!conflict} onChange={event=>chooseOutroProfile(event.target.value)}>
              {!isRegisteredProfileAssetId(page.fields.logoAssetId)&&<option value={page.fields.logoAssetId??''}>프로필 이미지 선택</option>}
              {REGISTERED_PROFILE_ASSETS.map(asset=><option key={asset.id} value={asset.id}>{asset.label}{asset.id===FAMILY_PROFILE_ASSET.id?' · 추천':''}</option>)}
            </select><span className="hint">프로필 이미지는 마지막 장에만 표시됩니다. 아래 브랜드 문구·행동 안내·계정은 계속 직접 수정할 수 있습니다.</span></label>
            {page.fields.logoAssetId===FAMILY_PROFILE_ASSET.id&&<><img src={FAMILY_PROFILE_ASSET.publicUrl} alt={FAMILY_PROFILE_ASSET.alt} width="120" height="120" style={{objectFit:'contain',borderRadius:12}}/><p className="hint">가족 프로필 수정안은 스튜디오 8장 출력에서 사용할 수 있습니다. Canva 자동 제작은 현재 연결된 기본 프로필을 사용합니다.</p></>}
          </>}
        </fieldset>}
        {selectedEnding&&<p className="hint"><strong>보관 중인 템플릿 문구</strong> · 현재 완성 이미지에는 표시되지 않습니다.</p>}
        {familyFieldDescriptors(page).map(descriptor => descriptor.kind === "array" ? <fieldset className="family-facts" key={descriptor.path}><legend>{descriptor.label}</legend>{(pageValue(page, descriptor.path) as string[]).map((_value, index) => field(descriptor, `${descriptor.path}.${index}`, `${descriptor.label} ${index + 1}`))}<div className="row"><button className="btn sm" disabled={busy || (pageValue(page, descriptor.path) as string[]).length >= 3} onClick={() => updateField(descriptor, [...pageValue(page, descriptor.path) as string[], ""])}>사실 한 칸 추가</button><button className="btn sm ghost" disabled={busy || (pageValue(page, descriptor.path) as string[]).length <= 2} onClick={() => updateField(descriptor, (pageValue(page, descriptor.path) as string[]).slice(0, -1))}>마지막 사실 칸 빼기</button></div></fieldset> : field(descriptor))}
        <fieldset className="family-display-fields stack" data-testid="family-display-fields">
          <legend>표시 문구·출처·번호</legend>
          <p className="hint">현재 콘텐츠의 표시 문구를 직접 수정합니다. 빈칸은 표시하지 않습니다. 기본값으로 돌리면 해당 수정만 지웁니다. 본문과 원문 근거는 별도로 유지합니다.</p>
          {[...visibleDisplayFields, ...retainedDisplayFields].map(descriptor => {
            const id = `${uid}-displayOverrides.${descriptor.key}`, text = display[descriptor.key], overridden = Object.hasOwn(page.displayOverrides ?? {}, descriptor.key);
            return <div className="family-field" key={descriptor.key}>
              <label className="field" htmlFor={id}>{descriptor.label}{retainedDisplayFields.includes(descriptor) ? " · 다른 레이아웃의 저장값" : ""}
                <textarea id={id} rows={descriptor.max > 300 ? 3 : 2} value={text} disabled={disabled || !!recovery.pending} onFocus={() => setSelectedField(null)} onChange={event => updateDisplay(descriptor.key, event.target.value)} aria-invalid={[...text].length > descriptor.max} />
              </label>
              <div className="family-field-actions"><span className="hint">{[...text].length} / {descriptor.max}자 · {overridden ? "현재 콘텐츠 수정값" : "기본 표시값"}</span><button type="button" className="btn sm ghost" disabled={busy || !overridden} onClick={() => updateDisplay(descriptor.key, undefined)}>이 표시 문구 기본값으로</button></div>
            </div>;
          })}
          <p className="hint">이 문구를 Canva에도 반영하려면 대응하는 자동 채우기 필드가 필요합니다. 지원하지 않는 마스터는 자동 제작 전에 알려 드립니다.</p>
        </fieldset>
        {page.id === "activity" && <div className="notice small">{page.fields.optionalActivity ? <>확인된 추가 자료를 쓰는 선택 활동입니다.<button className="btn sm ghost" disabled={busy} onClick={removeOptionalActivity}>추가 활동 빼기</button></> : "확인된 추가 자료가 없어 집 활동만 표시합니다. 선택 활동 영역은 이미지에서도 완전히 빠집니다."}</div>}
      </div>
      <div className="card-copy-preview-column">
        <div className="row between"><strong>문구 배치 미리보기</strong><span className="badge">스튜디오 초안</span></div>
        {page.id === "cover" ? <CoverCropPreview src={preview?.url} alt={`${page.page}페이지 ${FAMILY_PAGE_LABELS[page.id]} 문구 배치`} busy={previewBusy} stale={!previewCurrent} placeholder={invalid ? "필수 칸을 입력하면 배치를 확인할 수 있습니다." : "선택한 장의 실제 배치를 준비하고 있습니다."} status={!previewCurrent && preview ? previewBusy ? "현재 입력으로 배치 갱신 중…" : "이전 입력의 미리보기입니다." : undefined} /> : <figure className={`card-copy-preview ${previewCurrent ? "" : "is-stale"}`} aria-busy={previewBusy}>
          {preview ? <img src={preview.url} alt={`${page.page}페이지 ${FAMILY_PAGE_LABELS[page.id]} 문구 배치`} /> : <div className="card-copy-placeholder">{invalid ? "필수 칸을 입력하면 배치를 확인할 수 있습니다." : "선택한 장의 실제 배치를 준비하고 있습니다."}</div>}
          {!previewCurrent && preview && <figcaption>{previewBusy ? "현재 입력으로 배치 갱신 중…" : "이전 입력의 미리보기입니다."}</figcaption>}
        </figure>}
        <p className="hint">{readingProfile?.sourceStyleId ? "현재 입력의 배치 미리보기입니다. 저장한 뒤 ‘8장 디자인 완성’에서 이미지를 만들고 완성된 8장을 확인하세요. 이 미리보기는 유료 이미지 생성을 요청하지 않습니다." : "현재 입력의 자체 렌더입니다. 게시할 완성본은 Canva 내보내기 미리보기에서 확인하세요. 미리보기는 유료 이미지 생성을 요청하지 않습니다."}</p>
        {previewError && <ErrorBox error={previewError} retry={() => setPreviewRetry(value => value + 1)} />}
        {selectedEnding?<div className="notice small"><strong>{selectedEnding.label}</strong><p>{selectedEnding.revision==='latest'?'최근 수정안':'이전 수정안'} · 원본 전체 이미지. 직접 작성한 문구는 보관합니다.</p><a href={selectedEnding.publicUrl} target="_blank" rel="noopener noreferrer">엔딩 원본 보기 ↗</a></div>:page.id === "outro" && readingProfile ? <div className="notice small stack" data-testid="family-reading-outro-design"><strong>공통 마무리 · 선택한 프로필</strong><p>선택한 스타일의 배치와 프로필창을 사용합니다. 프로필은 이 장에만 표시하며 마지막 문구·행동 안내·계정은 왼쪽 입력칸에서 수정할 수 있습니다.</p></div> : page.id === "outro" ? <div className="notice small stack" data-testid="family-outro-fixed-design">
          <strong>승인된 닫는 표지 디자인</strong>
          <p>8장은 승인된 브랜드 마무리로, Canva의 고정 배경·중앙 정렬·기존 로고를 사용합니다. 브랜드명·브랜드 문구·계정·마지막 행동 안내는 현재 콘텐츠의 문구 입력칸에서 수정할 수 있습니다.</p>
          {!fixedOutroDesign && <><p>기존 배경·정렬 설정은 자체 렌더용으로 보관하고 있습니다. Canva로 만들려면 승인된 닫는 표지 배치를 선택하고 저장해 주세요.</p><button className="btn" disabled={busy || aiBusy || !!conflict} onClick={useApprovedOutroDesign}>승인된 닫는 표지 배치 사용</button></>}
          {!!designHistory.outro?.length && <button className="btn ghost" disabled={busy || aiBusy || !!conflict} onClick={() => { const history = designHistory.outro ?? []; if (history.length) { updateDesign("outro", history.at(-1)!, false); setDesignHistory(value => ({ ...value, outro: history.slice(0, -1) })); } }}>이전 닫는 표지 배치 되돌리기</button>}
        </div> : <>
        <p className="hint" data-testid="family-canva-design-scope">{readingProfile ? `문구·사진·포인트색은 선택한 스타일의 배치를 따릅니다. 사진을 교체하거나 자를 수 있으며, 글이 넘치면 해당 문구를 안내합니다. ${readingProfile.sourceStyleId ? "저장한 뒤 ‘8장 디자인 완성’에서 만든 8장 전체를 확인해 주세요." : "Canva에서 내보낸 결과는 완성본에서 확인해 주세요."}` : "Canva는 등록된 템플릿의 정렬·글자색을 사용합니다. 왼쪽 정렬이나 밝은 배경은 자체 렌더 또는 Canva에서 직접 편집해 주세요."}</p>
        {(!readingProfile || readingSlot?.kind === "artwork") && <>
        {readingProfile?.sourceStyleId && readingSlot?.kind==='artwork' && page.id!=='cover' && <div className="notice small stack"><label className="check"><input type="checkbox" aria-label="이 장에서 표지 사진 함께 사용" checked={design.background.inheritCover===true&&design.background.kind!=='image'} disabled={busy||aiBusy||!!conflict} onChange={event=>{const {assetId:oldAsset,...background}=design.background;updateDesign(page.id,{...design,background:{...background,kind:'brand',inheritCover:event.target.checked},previousAssetIds:[...new Set([...(design.previousAssetIds??[]),...(oldAsset?[oldAsset]:[])])].slice(-20)});}}/><span>표지 사진 함께 사용</span></label><p>{design.background.inheritCover ? effectiveDesign.background.kind==='image' ? '표지 사진이 바뀌면 이 장에도 반영됩니다. 이 장의 자르기·밝기는 따로 조절합니다.' : '표지 사진을 만들거나 선택하면 이 장에도 표시됩니다.' : '이 장의 사진을 직접 선택할 수 있습니다. 기존 사진은 이전 이미지 목록에 보관합니다.'}</p></div>}
        <details className="family-design"><summary>이 페이지 배치·배경 조절</summary><div className="stack">
          {!readingProfile && <>
          <label className="field">문구 정렬<select value={design.alignment} disabled={busy} onChange={event => updateDesign(page.id, { ...design, alignment: event.target.value as "center" | "left" })}><option value="center">중앙 정렬 · 기본</option><option value="left">왼쪽 정렬</option></select></label>
          <label className="field">바탕<select value={design.background.kind} disabled={busy} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, kind: event.target.value as "none" | "brand" | "image" } })}><option value="none">배경 없음 · 흰색</option><option value="brand">브랜드 색상</option>{design.background.assetId && <option value="image">선택한 이미지</option>}</select></label>
          <label className="field">바탕 색상<input type="color" value={design.background.color ?? "#1B2023"} disabled={busy} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, color: event.target.value } })} /></label>
          </>}
          {effectiveDesign.background.kind === "image" && <><label className="field">그림 배치<select value={design.background.fit} disabled={busy} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, fit: event.target.value as "cover" | "contain" } })}><option value="cover">카드 채우기 · 자르기</option><option value="contain">그림 전체 맞추기</option></select></label>{([['focalX', '가로 초점', 100], ['focalY', '세로 초점', 100], ['brightness', '밝기', 200], ['overlay', '가독성 바탕', 100]] as const).map(([key, label, max]) => <label className="field" key={key}>{label} {design.background[key]}%<input type="range" min={0} max={max} value={design.background[key]} disabled={busy || (key.startsWith("focal") && design.background.fit === "contain")} onChange={event => updateDesign(page.id, { ...design, background: { ...design.background, [key]: Number(event.target.value) } })} /></label>)}</>}
          <button className="btn ghost" disabled={busy || !designHistory[page.id]?.length} onClick={() => { const history = designHistory[page.id] ?? []; if (history.length) { updateDesign(page.id, history.at(-1)!, false); setDesignHistory(value => ({ ...value, [page.id]: history.slice(0, -1) })); } }}>이 페이지 디자인 되돌리기</button>
          {!!sourceAssets.length && <details><summary>이 콘텐츠의 이전 이미지 불러오기</summary><div className="family-asset-grid">{sourceAssets.map(id => <button key={id} className="btn" disabled={busy} onClick={() => selectAsset(page.id, id)} aria-label={`저장 이미지 ${id} 선택`}><img src={`/api${path}/background/${id}`} alt="저장한 배경 이미지" /><span>이 페이지에 사용</span></button>)}</div></details>}
        </div></details>
        <PageBackgroundEditor channelId={channelId} itemId={itemId} pageIndex={selected} pageId={page.id} background={effectiveDesign.background.kind === "image" && effectiveDesign.background.assetId ? { assetId: effectiveDesign.background.assetId } : undefined} showOpacityControl={false} disabled={busy || aiBusy || !!conflict} showAi={showAi} imageReady={!!aiStatus.data?.image} imageModel={base.ai?.image.model} save={saveNow} onBusyChange={setBackgroundBusy} onApply={applyBackground} onChange={background => selectAsset(page.id, background?.assetId)} />
        </>}
        {readingProfile && !readingSlot && <p className="notice small">이 장은 글과 색으로 구성합니다. 사진은 {readingArtworkPages(readingProfile)}장에서 만들거나 교체할 수 있습니다.</p>}
        </>}
      </div>
    </div>
    {generation.unresolved && <div className="notice warn stack" role="status"><p>이전 {pendingScope} 요청의 결과가 아직 확인되지 않았습니다. 다른 자동 제안을 시작하지 않고 같은 요청의 결과만 확인합니다.</p><button type="button" className="btn" disabled={busy || aiBusy || !!conflict} onClick={() => { if (generation.unresolved) void generate(); }}>이전 요청 결과 확인</button></div>}
    {showAi && <details ref={aiPanel} className="family-ai"><summary>자동으로 문구 다듬기{aiBusy ? " · 작업 중" : aiError ? " · 확인할 오류 있음" : ""}</summary><div className="stack"><p className="hint">{selectedField ? `선택한 칸: ${familyFieldDescriptors(page).find(value => selectedField.startsWith(value.fieldPath))?.label ?? selectedField}` : `선택한 장: ${FAMILY_PAGE_LABELS[page.id]}`} · 잠근 칸은 자동으로 바꾸지 않습니다.</p><label className="field">고치고 싶은 점<textarea rows={3} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="예: 전망이라는 성격은 유지하고, 일상에서 비교할 수 있는 짧은 문장으로 다듬어 주세요." /></label><div className="row"><button className="btn primary" disabled={busy || aiBusy || !!conflict || !!selectedField && !!draft.fieldLocks[selectedField]} onClick={() => void generate()}>{generation.unresolved ? "이전 요청 결과 확인" : aiBusy ? "자동 제안 중…" : selectedField ? "선택한 칸 자동 제안" : "이 페이지 자동 제안"}</button>{selectedField && <button className="btn ghost" onClick={() => setSelectedField(null)}>페이지 전체 선택</button>}<button className="btn ghost" disabled={busy || aiBusy || !!conflict || generation.unresolved} onClick={() => void generate("all")}>8장 전체 다시 제안</button>{generation.unresolved && <button className="btn ghost" disabled={generation.cancelling} onClick={() => void generation.cancel()}>요청 중단</button>}</div><p className="hint">제안은 원고를 덮어쓰지 않습니다. 결과를 확인하고 직접 적용한 뒤 저장합니다.</p></div></details>}
    {aiError && <ErrorBox error={aiError} />}{generation.cancelError && <ErrorBox error={generation.cancelError} />}
    {!!reviewFlags.length && <div className="notice warn stack" role="status"><strong>현재 작업을 유지했습니다. 다음 내용을 확인해 주세요.</strong>{reviewFlags.map((flag, i) => <p key={`${flag.path}-${i}`}>{flag.message}</p>)}</div>}
    {proposal && <div className="card-copy-proposal notice stack"><strong>자동 제안 · 아직 원고에 적용하지 않았습니다</strong>{proposal.result.scope === "caption" ? <div className="card-copy-compare"><div><h4>현재 캡션 제안</h4><pre>{draft.captionPackage?.fullCaption ?? "없음"}</pre></div><div><h4>새 캡션 제안</h4><pre>{proposal.result.captionPackage?.fullCaption ?? "없음"}</pre></div></div> : proposal.result.scope === "review" ? <div>{proposal.result.editorialReview?.issues.map((issue, i) => <p key={`${issue.path}-${i}`}>{issue.problem}</p>)}{!proposal.result.editorialReview?.issues.length && <p>검수 결과에 등록된 수정 항목이 없습니다. 외부 게시 성공을 확인한 결과는 아닙니다.</p>}</div> : <div className="card-copy-compare"><div><h4>현재 원고</h4><pre>{copyText(draft.copy, draft)}</pre></div><div><h4>제안</h4><pre>{proposal.result.copy ? copyText(proposal.result.copy, { ...draft, ...proposal.result, artworkCredits: { ...draft.artworkCredits, ...proposal.result.artworkCredits } }) : "원고는 유지했습니다."}</pre></div></div>}{!canApply && <p role="alert">요청 뒤 입력 또는 저장 버전이 달라졌습니다. 현재 작업을 보호하기 위해 자동 적용하지 않습니다. 필요한 문구만 복사하거나 최신 원고로 다시 제안받아 주세요.</p>}<div className="row"><button className="btn primary" disabled={!canApply || busy} onClick={applyProposal}>제안을 편집기에 적용</button><button className="btn ghost" onClick={() => setProposal(null)}>현재 원고 유지</button></div></div>}
    <details className="family-parent-guide"><summary>부모를 위한 10분 대화 안내{draft.parentGuide ? "" : " · 아직 없음"}</summary>{draft.parentGuide ? <div className="stack"><ol className="family-timing">{draft.parentGuide.timing.map(step => <li key={step.step}><strong>{({ read: "함께 읽기", question: "중심 질문", compare: "관점·개념", close: "마무리" })[step.step]} · {step.minutes}분</strong><p>{step.instruction}</p></li>)}</ol><p><strong>꼭 나눌 질문</strong><br />{draft.parentGuide.coreQuestion}</p>{draft.parentGuide.optionalFollowup && <p><strong>선택 후속 질문</strong><br />{draft.parentGuide.optionalFollowup}</p>}{draft.parentGuide.optionalDeepening && <p><strong>더 생각하고 싶다면</strong><br />{draft.parentGuide.optionalDeepening}</p>}{([['whenUnsure','모르겠다고 할 때'],['whenDisagree','의견이 다를 때'],['whenMisunderstood','사실을 잘못 이해했을 때'],['whenTired','지쳤거나 원하지 않을 때'],['closingReflection','자녀의 말을 되돌려주는 마무리']] as const).map(([key, label]) => <p key={key}><strong>{label}</strong><br />{draft.parentGuide![key]}</p>)}</div> : <p className="hint">8장 자동 제작에서 부모 안내도 함께 제안합니다. 현재 카드 문구는 계속 직접 수정하고 저장할 수 있습니다.</p>}</details>
    <details className="family-caption"><summary>게시물 설명(캡션) 제안 · {captionCurrent ? "저장된 카드와 일치" : caption ? "재검토 필요" : "아직 없음"}</summary><div className="stack"><p className="hint">카드 안의 문구와 별도입니다. 아래 제안을 게시 준비의 캡션 칸에 적용하고 그곳에서 저장하세요.</p>{caption && <><p className="small">카드 원고 #{caption.contentRevision} 기준 · 현재 원고 #{base.revisionId}</p><pre>{caption.fullCaption}</pre>{!captionCurrent && <p className="notice warn">현재 카드 버전 또는 중심 질문이 다릅니다. 최신 저장 원고로 캡션을 다시 제안받거나 직접 고쳐 대조 확인해 주세요.</p>}<button className="btn" disabled={!captionCurrent || !onApplyCaption || busy} onClick={() => onApplyCaption?.(caption.fullCaption)}>게시 준비의 캡션 칸에 적용</button></>}{showAi && <button className="btn" disabled={busy || aiBusy || !!conflict || generation.unresolved} onClick={() => void generate("caption")}>{aiBusy ? "자동 제안 중…" : "저장된 카드로 캡션 자동 제안"}</button>}{onEditCaption && <div className="stack"><p className="hint">AI 한도나 연결 오류로 자동 제안을 받을 수 없다면 게시 준비의 캡션을 직접 고치고 현재 8장과 대조해 확정할 수 있습니다.</p><button className="btn ghost" disabled={busy || aiBusy || !!conflict} onClick={onEditCaption}>게시 준비에서 캡션 직접 수정</button></div>}</div></details>
    <details className="family-evidence"><summary>원문 근거·검수·생성 기록</summary><div className="stack"><p className="small">중심 질문: {draft.editorialPlan.coreQuestion}</p><p className="small">이 기사와 연결되는 이유: {draft.editorialPlan.connectionReason}</p><FamilyEvidenceDetails draft={draft} />{draft.editorialReview?.issues.map((issue, i) => <p key={`${issue.path}-${i}`} className={issue.severity === "blocking" ? "notice err" : "notice"}>{issue.problem}{issue.evidence && ` · ${issue.evidence}`}</p>)}{showAi && <button className="btn" disabled={busy || aiBusy || !!conflict || generation.unresolved} onClick={() => void generate("editorial_review")}>저장 원고 자동 검수 제안</button>}<dl className="family-runs">{runs.map(run => <FamilyRunRecord key={run.id} run={run} />)}</dl></div></details>
    <div className="card-copy-savebar">
      <p className="hint">{dirty ? "문구·페이지 디자인에 미저장 변경이 있습니다." : "원고 버전 " + base.version + "을 저장했습니다."} {previewError ? "배치 오류를 고친 뒤 완성 이미지를 만들 수 있습니다." : "입력은 페이지를 옮겨도 유지됩니다."}</p>
      {!!invalidFields.length && <div className="notice warn stack" role="alert"><strong>저장 전에 다음 칸을 확인해 주세요. 입력한 내용은 유지했습니다.</strong>{invalidFields.map((issue, index) => issue.index === null ? <p key={index}>{issue.label} · {issue.message}</p> : <button type="button" className="btn sm ghost" key={index} onClick={() => setSelected(issue.index!)}>{issue.label} · {issue.message}</button>)}</div>}
      {recovery.pending && <div className="notice warn small">기기에 보관한 입력의 복구 여부를 먼저 선택해 주세요.</div>}
      {(formatConflict || conflict) && <div className="notice warn small">다른 곳에서 저장한 원고와 현재 입력을 먼저 비교해 주세요. 현재 입력은 유지했습니다.</div>}
      {saveError && <ErrorBox error={saveError} />}
      {saveFeedback && !saveError && <div className={`notice ${dirty ? "warn" : "ok"} small`} role="status">{saveFeedback}{dirty && " 이후 입력한 변경은 아직 저장하지 않았습니다."}</div>}
      <div className="row"><button type="button" className="btn primary" disabled={busy || invalid || !!conflict} onClick={() => void confirmSave()}>{saving ? "저장 중…" : "문구·디자인 저장"}</button></div>
    </div>
  </section>;
}
