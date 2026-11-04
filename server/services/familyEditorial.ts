import { randomUUID } from "node:crypto";
import { preserveFamilyDisplayOverrides } from "../../shared/familyDisplay";
import { z } from "zod";
import type { DB } from "../db";
import type { Channel, ContentItem } from "../../shared/schema";
import { channelAiTaskRoles } from "../../shared/channelAi";
import {
  FAMILY_FORMAT_ID, FAMILY_PAGE_IDS, FAMILY_SCHEMA_VERSION, claimRefSchema,
  familyCardCopyAiSchema, familyCardCopySchema, familyDialogueMetadataSchema,
  familyFieldDescriptors, familyFieldValue, editorialPlanSchema, parentGuideSchema,
  aiCaptionPackageSchema, captionPackageSchema, editorialReviewSchema, visualBriefSchema, defaultPageDesigns,
  type CardCopyV2, type FamilyDialogueMetadata, type FamilyPageId, type ReviewFlag,
  type CaptionPackage, type EditorialPlan, type ParentGuide, type GenerationRun,
} from "../../shared/familyDialogue";
import { sourceAnalysisSchema, type FamilyEvidenceBundle, type FamilyEvidenceView, type SourceAnalysis, type SourceSnapshot, type VerifiedResource } from "../../shared/familyEvidence";
import { channelAiExecutionPlan } from "./channelAi";
import type { AiExecutionPlan } from "../../shared/aiProvenance";
import { LlmBudget } from "./llm";
import { HttpError } from "../routes/util";
import { captureFamilySourceSnapshot, createFamilyEvidenceSet, familyEvidenceView, familyHash, familyPublicSourceUrl, loadFamilyEvidence, putFamilyEvidence, validateFamilyEvidenceReferences, validateFamilySourceAnalysis } from "./familyEvidence";
import { runFamilyEditorialStage, type FamilyStageContext } from "./familyEditorialStages";
import { researchFamilyResources } from "./familyResourceResearch";
import { FAMILY_EDITORIAL_PROMPTS, FAMILY_PROMPT_VERSION } from "./familyEditorialPrompts";
import { currentGenerationSignal } from "./generationContext";
import { channelBrandName } from "../../shared/branding";
import { generateFamilyCoverArtwork } from "./familyEditorialImage";

export const FAMILY_METADATA_KEYS = ["editorialPlan", "evidenceBinding", "pageDesigns", "parentGuide", "captionPackage", "visualBriefs", "editorialReview", "fieldLocks", "generationRuns", "dependencies"] as const;
export const familyGenerateSchema = z.object({
  version: z.number().int().positive(), requestId: z.string().uuid(), formatId: z.literal(FAMILY_FORMAT_ID), templateKey: z.string().min(1).max(120),
  scope: z.enum(["all", "page", "field", "caption", "image_brief", "review"]).default("all"), baseRevision: z.number().int().positive(), pageId: z.enum(FAMILY_PAGE_IDS).optional(),
  allowedFieldPaths: z.array(z.string().min(1).max(240)).max(40).optional(), targetFieldHash: z.string().min(1).max(160).optional(), instructions: z.string().trim().max(2000).optional(),
}).strict();
export type FamilyGenerateInput = z.infer<typeof familyGenerateSchema>;
export type FamilyProposal = Partial<FamilyDialogueMetadata> & {
  version: number; revisionId: number; copy: CardCopyV2 | null; status: "ready" | "needs_source" | "needs_review"; reviewFlags: ReviewFlag[];
  scope: FamilyGenerateInput["scope"]; baseRevision: number; targetFieldHash?: string; patches?: FamilyFieldPatch[]; affectedDependents?: string[]; lateResult: boolean;
  sourceAnalysis?: SourceAnalysis; evidence?: FamilyEvidenceView;
};
export function familyMetadataFromPayload(payload: Record<string, unknown>): FamilyDialogueMetadata | null {
  const parsed = familyDialogueMetadataSchema.safeParse(Object.fromEntries(FAMILY_METADATA_KEYS.map(key => [key, payload[key]])));
  return parsed.success ? parsed.data : null;
}
export function familyExecutionPlan(channel: Channel, revisionId: number, snapshotId: string | null = null): AiExecutionPlan {
  return channelAiExecutionPlan(channel, { sourceSnapshotId: snapshotId, contentRevision: revisionId, schemaVersion: FAMILY_SCHEMA_VERSION,
    promptVersions: Object.fromEntries(channelAiTaskRoles.map(role => [role, FAMILY_PROMPT_VERSION])) });
}
const patchSchema = z.object({ path: z.string().min(1).max(240), value: z.union([z.string().max(1000), z.array(z.string().max(1000)).max(3), z.null()]), claimRefs: z.array(claimRefSchema).max(20) }).strict();
export type FamilyFieldPatch = z.infer<typeof patchSchema>;
const partialOutputSchema = z.object({ patches: z.array(patchSchema).min(1).max(40) }).strict();
const draftSchema = z.object({ editorialPlan: editorialPlanSchema, cardCopy: familyCardCopyAiSchema, parentGuide: parentGuideSchema, coverTitleCandidates: z.array(z.string().min(1).max(100)).min(1).max(3) }).strict();
const captionDraftSchema = aiCaptionPackageSchema.omit({ contentRevision: true, sourceCredit: true, fullCaption: true, origin: true });
const flag = (path: string, code: string, message: string): ReviewFlag => ({ path, code, message });
const copyOf = (payload: Record<string, unknown>) => { const parsed = familyCardCopySchema.safeParse(payload.cardCopy); return parsed.success ? parsed.data : null; };

function writablePaths(copy: CardCopyV2, metadata: FamilyDialogueMetadata, input: FamilyGenerateInput): string[] {
  if (!input.pageId) throw new HttpError(400, "수정할 페이지를 선택해 주세요.");
  const page = copy.pages.find(value => value.id === input.pageId)!;
  const descriptors = familyFieldDescriptors(page).filter(descriptor => !descriptor.systemOwned);
  const requested = input.allowedFieldPaths ?? descriptors.map(descriptor => descriptor.fieldPath);
  const accepts = (path: string) => descriptors.some(descriptor => descriptor.fieldPath === path || descriptor.kind === "array" && new RegExp(`^${descriptor.fieldPath.replace(/\./g, "\\.")}\\.[0-2]$`).test(path));
  if (!requested.length || requested.some(path => !accepts(path) || familyFieldValue(copy, path) === undefined)) throw new HttpError(400, "현재 페이지의 실제 문구 칸만 선택해 주세요.");
  const paths = [...new Set(requested)].filter(path => !Object.entries(metadata.fieldLocks).some(([locked, enabled]) => enabled && (path === locked || path.startsWith(`${locked}.`) || locked.startsWith(`${path}.`))));
  if (!paths.length) throw new HttpError(409, "선택한 문구는 잠겨 있습니다. 잠금을 풀거나 다른 칸을 선택해 주세요.");
  if (input.scope === "field" && paths.length !== 1) throw new HttpError(400, "한 칸 자동 수정에서는 문구 칸 하나를 선택해 주세요.");
  return paths;
}
export function familyTargetHash(copy: CardCopyV2, metadata: FamilyDialogueMetadata, paths: string[]) {
  return familyHash({ evidenceBinding: metadata.evidenceBinding, fields: [...paths].sort().map(path => ({ path, value: familyFieldValue(copy, path), refs: copy.pages.find(page => path.startsWith(`pages.${page.id}.`))!.claimRefs.filter(ref => { const full = ref.fieldPath.startsWith("pages.") ? ref.fieldPath : `pages.${path.split(".")[1]}.${ref.fieldPath}`; return full === path || full.startsWith(`${path}.`) || path.startsWith(`${full}.`); }) })) });
}
/** Locks address actual semantic leaves, including facts.0; descriptors may only
 * describe their parent array and cannot be used as the authority for a lock. */
export function validateFamilyLockedFields(previous: CardCopyV2, next: CardCopyV2, locks: Record<string, boolean>): ReviewFlag[] {
  return Object.entries(locks).filter(([, enabled]) => enabled).flatMap(([path]) => {
    const before = familyFieldValue(previous, path), after = familyFieldValue(next, path);
    return before === undefined || after === undefined || familyHash(before) !== familyHash(after)
      ? [flag(path, "locked_field_changed", "잠긴 문구를 바꾸거나 삭제한 제안은 적용하지 않았습니다. 해당 칸을 유지해 다시 요청해 주세요.")] : [];
  });
}
/** Apply only an explicit, existing semantic field and its evidence references together. */
export function applyFamilyFieldPatches(copy: CardCopyV2, patches: FamilyFieldPatch[], allowed: string[], locks: Record<string, boolean>): CardCopyV2 {
  const next = structuredClone(copy), seen = new Set<string>();
  for (const patch of patches) {
    if (!allowed.includes(patch.path) || seen.has(patch.path) || Object.entries(locks).some(([path, enabled]) => enabled && (path === patch.path || patch.path.startsWith(`${path}.`) || path.startsWith(`${patch.path}.`)))) throw new HttpError(422, "AI 제안이 허용 범위 또는 잠금 필드를 벗어났습니다. 기존 문구를 유지했습니다.");
    seen.add(patch.path);
    const [, pageId, ...segments] = patch.path.split(".");
    const page = next.pages.find(value => value.id === pageId);
    if (!page || familyFieldValue(next, patch.path) === undefined || segments.some(segment => ["__proto__", "prototype", "constructor"].includes(segment))) throw new HttpError(422, "제안이 현재 카드에 없는 필드를 가리킵니다.");
    const relative = segments.join(".");
    if (patch.claimRefs.some(ref => ![relative, patch.path].includes(ref.fieldPath))) throw new HttpError(422, "수정한 문구와 근거 연결의 범위가 다릅니다.");
    let target: any = page;
    for (const segment of segments.slice(0, -1)) target = target[segment];
    target[segments.at(-1)!] = patch.value;
    // Keep refs for untouched sibling fields; a parent array replacement replaces all its child refs.
    page.claimRefs = page.claimRefs.filter(ref => { const full = ref.fieldPath.startsWith("pages.") ? ref.fieldPath : `pages.${pageId}.${ref.fieldPath}`; return full !== patch.path && !full.startsWith(`${patch.path}.`) && !patch.path.startsWith(`${full}.`); });
    page.claimRefs.push(...patch.claimRefs.map(ref => ({ ...ref, fieldPath: relative })));
  }
  const parsed = familyCardCopySchema.safeParse(next);
  if (!parsed.success) throw new HttpError(422, "제안이 현재 카드의 필수 문구·페이지 구조와 맞지 않습니다. 기존 원고를 유지했습니다.");
  return parsed.data;
}

function brandFor(channel: Channel, existing: CardCopyV2 | null) {
  const prior = existing?.pages.find(page => page.id === "outro");
  if (prior?.id === "outro") { const { cta: _cta, ...brand } = prior.fields; return brand; }
  const name = channelBrandName(channel), news = /all+igodang|알리고당/i.test(name);
  return { brandName: news ? "ALLligodang" : name, parentBrand: "우주펭귄상회", brandLine: news ? "오늘, 서로의 어떤 생각을 발견했나요?" : channel.description || name, handle: "", logoAssetId: "brand:space-penguin-company:20261101" };
}
function canonicalQuestion(copy: CardCopyV2, metadata: FamilyDialogueMetadata) {
  const discussion = copy.pages.find(page => page.id === "discussion")!, concept = copy.pages.find(page => page.id === "concept")!;
  const question = discussion.id === "discussion" ? discussion.fields.question : metadata.editorialPlan.coreQuestion;
  return { ...metadata, editorialPlan: { ...metadata.editorialPlan, coreQuestion: question, ...(concept.id === "concept" ? { keyConcept: concept.fields.concept, conceptMode: concept.fields.mode } : {}) }, parentGuide: metadata.parentGuide ? { ...metadata.parentGuide, coreQuestion: question } : null };
}
export const synchronizeFamilyQuestion = canonicalQuestion;
export function selectedFamilyResources(copy: CardCopyV2, resources: VerifiedResource[]): VerifiedResource[] {
  const ids = new Set(copy.pages.flatMap(page => page.claimRefs.flatMap(ref => ref.resourceIds)));
  const activity = copy.pages.find(page => page.id === "activity");
  if (activity?.id === "activity") for (const value of [activity.fields.homeActivity.resourceId, activity.fields.optionalActivity?.resourceId]) if (value) ids.add(value);
  return resources.filter(resource => ids.has(resource.id));
}
export function familySourceCredits(snapshot: SourceSnapshot, resources: VerifiedResource[] = []): CaptionPackage["sourceCredit"] {
  const source = snapshot.sources.find(value => value.id === snapshot.primarySourceId)!;
  const credits = [{ title: source.title, publisher: source.publisher, url: familyPublicSourceUrl(source.finalUrl) }, ...resources.map(resource => ({ title: resource.title, publisher: resource.publisher, url: familyPublicSourceUrl(resource.url) }))];
  return credits.filter((credit, index) => !credits.slice(0, index).some(previous => credit.url ? previous.url === credit.url : previous.title === credit.title && previous.publisher === credit.publisher));
}
export function composeFamilyCaption(draft: z.infer<typeof captionDraftSchema>, snapshot: SourceSnapshot, revisionId: number, resources: VerifiedResource[] = []): CaptionPackage {
  const sourceCredit = familySourceCredits(snapshot, resources);
  const fullCaption = [draft.hook, draft.newsSummary, draft.coreQuestion, draft.conversationGuide, draft.parentLine, draft.optionalFollowup, draft.cta, draft.hashtags.join(" "), sourceCredit.map(source => `출처: ${source.title}${source.publisher ? ` · ${source.publisher}` : ""}${source.url ? `\n${source.url}` : " · 직접 제공한 원문"}`).join("\n")].filter(Boolean).join("\n\n");
  return captionPackageSchema.parse({ ...draft, sourceCredit, contentRevision: revisionId, fullCaption });
}
function validateCaption(draft: z.infer<typeof captionDraftSchema>, metadata: FamilyDialogueMetadata): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (draft.coreQuestion !== metadata.editorialPlan.coreQuestion) flags.push(flag("captionPackage.coreQuestion", "question_mismatch", "캡션은 저장된 카드와 같은 중심 질문을 사용해야 합니다."));
  if (draft.hashtags.length < 3) flags.push(flag("captionPackage.hashtags", "hashtags", "주제와 연결된 해시태그 3~5개를 사용해 주세요."));
  if (!/2\s*분/.test(draft.conversationGuide) || !/4\s*분/.test(draft.conversationGuide) || !/3\s*분/.test(draft.conversationGuide) || !/1\s*분/.test(draft.conversationGuide)) flags.push(flag("captionPackage.conversationGuide", "timing_mismatch", "읽기 2분·질문 4분·비교 3분·마무리 1분을 유지해 주세요."));
  return flags;
}
export function validateFamilyReviewScope(review: z.infer<typeof editorialReviewSchema>): ReviewFlag[] {
  return review.reviewScope.some(scope => scope === "images" || scope === "render") || review.checks.some(check => check.status !== "not_checked" && /이미지|렌더|\brender\b|\bimages?\b/i.test(check.name) && !/브리프|brief|프롬프트|prompt/i.test(check.name)) ? [flag("editorialReview.reviewScope", "unseen_visuals", "실제 이미지를 전달하지 않은 텍스트 검수에서 이미지·최종 렌더를 확인했다고 표시할 수 없습니다.")] : [];
}
function failure(input: FamilyGenerateInput, revisionId: number, status: FamilyProposal["status"], reviewFlags: ReviewFlag[], extra: Partial<FamilyDialogueMetadata> & { sourceAnalysis?: SourceAnalysis } = {}): FamilyProposal {
  return { version: input.version, revisionId, copy: null, status, reviewFlags, scope: input.scope, baseRevision: revisionId, lateResult: false, ...extra };
}

/** Pure editorial proposal. Only immutable evidence/stage records are persisted here, never content copy. */
export async function proposeFamilyDialogue(db: DB, item: ContentItem, channel: Channel, revision: { id: number; payload: Record<string, unknown> }, input: FamilyGenerateInput, executionPlan: AiExecutionPlan, options: { budget?: LlmBudget; allowPaidRetry?: boolean } = {}): Promise<FamilyProposal> {
  if (revision.id !== input.baseRevision) throw new HttpError(409, "요청한 편집 버전과 현재 원고가 다릅니다. 기존 문구를 유지했습니다.");
  const existing = copyOf(revision.payload), savedMetadata = familyMetadataFromPayload(revision.payload);
  const runs: GenerationRun[] = [], context: FamilyStageContext = { db, itemId: item.id, channelId: channel.id, baseRevision: revision.id, requestId: input.requestId, plan: executionPlan, budget: options.budget ?? new LlmBudget(Math.min(12, Math.max(0, channel.budget.llmCallsPerRun))), runs, allowPaidRetry: options.allowPaidRetry, startedAt: Date.now() };
  let copy: CardCopyV2, metadata: FamilyDialogueMetadata, bundle: FamilyEvidenceBundle;
  const flags: ReviewFlag[] = [];
  if (input.scope === "all") {
    const snapshot = await captureFamilySourceSnapshot(db, item);
    if (!snapshot) return failure(input, revision.id, "needs_source", [flag("articleBody", "full_source_required", "기사 원문 본문을 먼저 확보하거나 붙여넣어 주세요. 제목·RSS 요약만으로 8장 원고를 만들지 않습니다.")]);
    context.plan = { ...executionPlan, sourceSnapshotId: snapshot.id };
    const analysisId = randomUUID();
    const sourceInput = { sourceSnapshotId: snapshot.id, sourceAnalysisId: analysisId, articleBody: snapshot.sources.find(source => source.id === snapshot.primarySourceId)!.text, articleTitle: item.title, sources: snapshot.sources, sourceIdentity: snapshot.identityStatus };
    const analysisResult = await runFamilyEditorialStage(context, { stage: "article_analysis", role: "article_analysis", schema: sourceAnalysisSchema, prompt: FAMILY_EDITORIAL_PROMPTS.analysis, data: sourceInput, cacheData: { snapshot }, validate: data => validateFamilySourceAnalysis(data, snapshot) });
    if (analysisResult.status !== "ready" || !analysisResult.data) return failure(input, revision.id, analysisResult.status === "needs_source" ? "needs_source" : "needs_review", analysisResult.reviewFlags, { generationRuns: runs });
    const { sourceAnalysisId: _modelAssignedId, ...analysisFields } = analysisResult.data;
    // Evidence identities are server-owned and content-addressed; an AI output
    // cannot choose another item's record ID or retarget an earlier fact set.
    let analysis: SourceAnalysis = { ...analysisFields, sourceAnalysisId: `analysis-${familyHash({ snapshot: snapshot.id, analysisFields })}` };
    analysis = await putFamilyEvidence(db, { id: analysis.sourceAnalysisId, itemId: item.id, channelId: channel.id, kind: "source_analysis", sourceSnapshotId: snapshot.id, fingerprint: familyHash({ snapshot: snapshot.id, analysis }), payload: analysis });
    const planned = await runFamilyEditorialStage(context, { stage: "editorial_plan", role: "card_copy", schema: editorialPlanSchema, prompt: FAMILY_EDITORIAL_PROMPTS.plan, data: { sourceAnalysis: analysis, articleBody: sourceInput.articleBody, channelSettings: { name: channel.name, audience: channel.audience, editorialGuide: channel.editorialGuide }, currentQuestion: savedMetadata?.editorialPlan.coreQuestion ?? null, instructions: input.instructions ?? "" } });
    if (planned.status !== "ready" || !planned.data) return failure(input, revision.id, planned.status === "needs_source" ? "needs_source" : "needs_review", planned.reviewFlags, { generationRuns: runs, sourceAnalysis: analysis });
    const researched = await researchFamilyResources(context, { snapshot, analysis, editorialPlan: planned.data, needsDefinition: planned.data.conceptMode === "scientific_explanation" });
    const evidenceSet = await createFamilyEvidenceSet(db, item, snapshot, analysis, researched.data, researched.sources);
    bundle = { snapshot, analysis, research: researched.data, evidenceSet, researchedSources: researched.sources };
    const evidenceBinding = { evidenceSetId: evidenceSet.evidenceSetId, sourceSnapshotId: snapshot.id, sourceAnalysisId: analysis.sourceAnalysisId, resourceResearchId: researched.data.resourceResearchId };
    if (existing && savedMetadata && Object.values(savedMetadata.fieldLocks).some(Boolean) && familyHash(savedMetadata.evidenceBinding) !== familyHash(evidenceBinding)) return failure(input, revision.id, "needs_review", [flag("fieldLocks", "locked_evidence_changed", "원문·근거 버전이 바뀌었습니다. 잠긴 문구의 근거를 바꾸지 않도록 전체 제안을 중단했습니다. 잠금을 유지한 부분 수정 또는 확인 후 잠금 해제를 선택해 주세요.")], { generationRuns: runs });
    const brand = brandFor(channel, existing);
    const generated = await runFamilyEditorialStage(context, { stage: "card_copy", role: "card_copy", schema: draftSchema, prompt: FAMILY_EDITORIAL_PROMPTS.copy,
      data: { articleBody: sourceInput.articleBody, sourceSnapshotId: snapshot.id, evidenceBinding, sourceAnalysis: analysis, editorialPlan: planned.data, resourceResearch: researched.data, visitSettings: context.plan.editorial, channelSettings: brand, brandAssets: [brand.logoAssetId], templateContract: { templateKey: input.templateKey, formatId: FAMILY_FORMAT_ID }, existingCopyAndLocks: existing ? { copy: existing, fieldLocks: savedMetadata?.fieldLocks ?? {} } : null, instructions: input.instructions ?? "" },
      force: !!input.instructions, validate: data => {
        const errors = validateFamilyEvidenceReferences(data.cardCopy, bundle, planned.data!, data.parentGuide);
        if (familyHash(data.editorialPlan) !== familyHash(planned.data)) errors.push(flag("editorialPlan", "plan_changed", "확정한 중심 질문·개념·사고 기능을 문구 단계에서 임의로 바꾸지 않았는지 확인해 주세요."));
        const concept = data.cardCopy.pages.find(page => page.id === "concept")!;
        if (concept.id === "concept" && concept.fields.mode !== planned.data!.conceptMode) errors.push(flag("pages.concept.fields.mode", "concept_changed", "확정한 과학 개념을 가치 정의로 바꿀 수 없습니다."));
        return errors;
      } });
    if (generated.status !== "ready" || !generated.data) return failure(input, revision.id, generated.status === "needs_source" ? "needs_source" : "needs_review", generated.reviewFlags, { editorialPlan: planned.data, evidenceBinding, generationRuns: runs, sourceAnalysis: analysis });
    copy = preserveFamilyDisplayOverrides(generated.data.cardCopy, existing);
    copy.templateKey = input.templateKey;
    const outro = copy.pages.find(page => page.id === "outro")!;
    if (outro.id === "outro") outro.fields = { ...outro.fields, ...brand };
    metadata = { editorialPlan: planned.data, evidenceBinding, parentGuide: generated.data.parentGuide, pageDesigns: savedMetadata?.pageDesigns ?? defaultPageDesigns(), fieldLocks: savedMetadata?.fieldLocks ?? {}, captionPackage: null, visualBriefs: savedMetadata?.visualBriefs ?? {}, editorialReview: null, generationRuns: [], dependencies: { caption: "not_generated", visuals: savedMetadata && Object.keys(savedMetadata.visualBriefs).length ? "needs_review" : "not_generated", review: "not_generated", render: "needs_review" } };
    if (existing && savedMetadata) {
      const lockedChanges = validateFamilyLockedFields(existing, copy, metadata.fieldLocks);
      if (lockedChanges.length) return failure(input, revision.id, "needs_review", lockedChanges, { generationRuns: runs, sourceAnalysis: analysis });
    }
    flags.push(...researched.data.operatorNotes.map(message => flag("resourceResearch", "resource_note", message)));
  } else {
    if (!existing || !savedMetadata) throw new HttpError(409, "먼저 8장 자동 제안을 확인하고 저장해 주세요.");
    copy = existing; metadata = savedMetadata; bundle = await loadFamilyEvidence(db, item, metadata.evidenceBinding);
    context.plan = { ...executionPlan, sourceSnapshotId: bundle.snapshot.id };
  }
  const base = (): FamilyProposal => ({ version: input.version, revisionId: revision.id, copy, ...metadata, sourceAnalysis: bundle.analysis, evidence: familyEvidenceView(bundle), status: flags.length ? "needs_review" : "ready", reviewFlags: flags, scope: input.scope, baseRevision: revision.id, lateResult: false, generationRuns: [...metadata.generationRuns, ...runs].slice(-200) });
  if (input.scope === "page" || input.scope === "field") {
    const allowed = writablePaths(copy, metadata, input), targetFieldHash = familyTargetHash(copy, metadata, allowed);
    if (input.targetFieldHash && input.targetFieldHash !== targetFieldHash) throw new HttpError(409, "선택한 문구가 변경됐습니다. 현재 입력을 유지했으니 최신 저장본으로 다시 요청해 주세요.");
    const result = await runFamilyEditorialStage(context, { stage: "partial_copy", role: "card_copy", schema: partialOutputSchema, prompt: FAMILY_EDITORIAL_PROMPTS.partial,
      data: { baseRevision: revision.id, targetFieldHash, allowedFieldPaths: allowed, editorialPlan: metadata.editorialPlan, evidenceBinding: metadata.evidenceBinding, evidenceSet: bundle.evidenceSet, articleBody: bundle.snapshot.sources.find(source => source.id === bundle.snapshot.primarySourceId)!.text, cardCopy: copy, fieldLocks: metadata.fieldLocks, instructions: input.instructions ?? "" }, force: true });
    if (result.status !== "ready" || !result.data) return { ...base(), copy: null, status: "needs_review", reviewFlags: result.reviewFlags, targetFieldHash };
    const patched = applyFamilyFieldPatches(copy, result.data.patches, allowed, metadata.fieldLocks), nextMetadata = canonicalQuestion(patched, metadata);
    const errors = validateFamilyEvidenceReferences(patched, bundle, nextMetadata.editorialPlan, nextMetadata.parentGuide);
    if (errors.length) return { ...base(), copy: null, status: "needs_review", reviewFlags: errors, targetFieldHash };
    copy = patched; metadata = { ...nextMetadata, dependencies: { caption: metadata.captionPackage ? "needs_review" : "not_generated", visuals: Object.keys(metadata.visualBriefs).length ? "needs_review" : "not_generated", review: metadata.editorialReview ? "needs_review" : "not_generated", render: "needs_review" } };
    return { ...base(), targetFieldHash, patches: result.data.patches, affectedDependents: ["caption", "image_brief", "review", "render"] };
  }
  if (input.scope === "all" || input.scope === "caption") {
    const selectedResources = selectedFamilyResources(copy, bundle.evidenceSet.resources);
    const caption = await runFamilyEditorialStage(context, { stage: "caption", role: "caption", schema: captionDraftSchema, prompt: FAMILY_EDITORIAL_PROMPTS.caption,
      data: { editorialPlan: metadata.editorialPlan, cardCopy: copy, parentGuide: metadata.parentGuide, verifiedSelectedResources: selectedResources, sourceCredit: familySourceCredits(bundle.snapshot, selectedResources), contentRevision: revision.id, instructions: input.scope === "caption" ? input.instructions ?? "" : "" }, force: input.scope === "caption", validate: draft => validateCaption(draft, metadata) });
    if (caption.status === "ready" && caption.data) {
      try { metadata.captionPackage = composeFamilyCaption(caption.data, bundle.snapshot, revision.id, selectedResources); metadata.dependencies.caption = "current"; }
      catch (error) { if (!(error instanceof z.ZodError)) throw error; flags.push(flag("captionPackage", "caption_length", "카드 원고는 보존했습니다. 출처를 포함한 캡션이 길어 자동 캡션을 확정하지 못했으니 게시 준비에서 줄이고 대조 확인해 주세요.")); }
    }
    else flags.push(...caption.reviewFlags);
    if (input.scope === "caption") return base();
  }
  if (input.scope === "all" || input.scope === "image_brief") {
    const pageId = input.pageId ?? "cover";
    if (pageId === "outro") flags.push(flag("visualBriefs.outro", "approved_logo_only", "닫는 표지는 승인된 로고 자산을 사용합니다. 새 로고·마스코트를 생성하지 않았습니다."));
    else {
      const visual = await runFamilyEditorialStage(context, { stage: "image_brief", role: "image_brief", schema: visualBriefSchema, prompt: `${FAMILY_EDITORIAL_PROMPTS.visual}\n알리고당의 새 기본 시각 방향: full-bleed 사진 감각의 절제된 conceptual art, 차콜·딥그린 바탕과 버터옐로(#F4D66A)의 작은 강조. 자연스러운 빛과 미세한 grain, 주 피사체는 하단 또는 측면에 두고 상단·중앙의 제목 안전 영역을 비운다. 과한 3D 스티커와 알록달록한 면분할을 피한다. 기존 사용자가 저장한 색·이미지 취향과 명시 지시가 우선한다. 실제 뉴스 현장 사진처럼 증거를 꾸미지 않으며 글자·로고를 이미지에 굽지 않는다.`,
        data: { editorialPlan: metadata.editorialPlan, cardCopy: copy, page: copy.pages.find(page => page.id === pageId), pageId, pageDesign: metadata.pageDesigns[pageId], referenceAssetIds: metadata.pageDesigns[pageId].background.assetId ? [String(metadata.pageDesigns[pageId].background.assetId)] : [], instructions: input.scope === "image_brief" ? input.instructions ?? "" : "" }, force: input.scope === "image_brief", validate: brief => brief.pageId === pageId ? [] : [flag("visualBriefs", "wrong_page", "선택한 페이지와 이미지 브리프의 페이지가 다릅니다.")] });
      if (visual.status === "ready" && visual.data) { metadata.visualBriefs = { ...metadata.visualBriefs, [pageId]: visual.data }; metadata.dependencies.visuals = "current"; }
      else flags.push(...visual.reviewFlags);
    }
    if (input.scope === "image_brief") return base();
  }
  if (input.scope === "all" || input.scope === "review") {
    currentGenerationSignal()?.throwIfAborted();
    const reviewed = await runFamilyEditorialStage(context, { stage: "editorial_review", role: "editorial_review", schema: editorialReviewSchema, prompt: `${FAMILY_EDITORIAL_PROMPTS.review}\n실제 이미지 바이트와 최종 렌더는 이번 요청에 제공되지 않았다. reviewScope는 source/text/caption/image_brief 중 실제 제공된 범위만 기록하고 images/render 검사는 not_checked로 표시하라.`,
      data: { editorialPlan: metadata.editorialPlan, cardCopy: copy, parentGuide: metadata.parentGuide, captionPackage: metadata.captionPackage, sourceAnalysis: bundle.analysis, sourceSnapshot: bundle.snapshot, resourceResearch: bundle.research, visualBriefs: metadata.visualBriefs, actualImagesProvided: false, finalRenderProvided: false }, force: input.scope === "review", validate: validateFamilyReviewScope });
    if (reviewed.status === "ready" && reviewed.data) { metadata.editorialReview = reviewed.data; metadata.dependencies.review = "current"; if (reviewed.data.mustFixBeforeUse) flags.push(flag("editorialReview", "review_changes_required", "자동 검수에서 사용 전 수정 항목을 찾았습니다. 지적된 문구와 근거를 확인해 주세요.")); }
    else flags.push(...reviewed.reviewFlags);
  }
  if (input.scope === "all" && metadata.pageDesigns.cover.background.kind !== "image" && metadata.visualBriefs.cover) {
    const artwork = await generateFamilyCoverArtwork(context, { version: input.version, brief: metadata.visualBriefs.cover });
    if (artwork.assetId) metadata.pageDesigns = { ...metadata.pageDesigns, cover: { ...metadata.pageDesigns.cover, background: { ...metadata.pageDesigns.cover.background, kind: "image", assetId: artwork.assetId } } };
    else if (artwork.reviewFlag) flags.push(artwork.reviewFlag);
  }
  return base();
}
