import { z } from "zod";
import { aiStageProvenanceSchema } from "./aiProvenance";
import { FAMILY_PAGE_COLORS } from "./familyDialogueTheme";
import { familyDisplayOverridesSchema } from "./familyDisplay";
import { FAMILY_ENDING_ASSET_IDS } from "./characterVariantAssets";

export const FAMILY_FORMAT_ID = "family_dialogue_8" as const;
export const FAMILY_SCHEMA_VERSION = "family-dialogue-v2.1";
export const FAMILY_PAGE_IDS = ["cover", "news_summary", "implication", "discussion", "perspectives", "concept", "activity", "outro"] as const;
export type FamilyPageId = typeof FAMILY_PAGE_IDS[number];
export const FAMILY_PAGE_LABELS: Record<FamilyPageId, string> = { cover: "표지", news_summary: "뉴스 요약", implication: "뉴스의 의미", discussion: "중심 질문", perspectives: "두 가지 시선", concept: "개념 다듬기", activity: "작은 활동", outro: "닫는 표지" };
export const FAMILY_CLAIM_TYPES = ["reported_event", "research_finding", "attributed_statement", "forecast", "editorial_interpretation", "hypothetical", "question"] as const;
export const FAMILY_THINKING_SKILLS = ["evidence", "assumptions", "causes", "counterexample", "variables", "measurement", "uncertainty", "perspectives"] as const;
const identifier = z.string().min(1).max(160);
const text = (max: number, required = true) => z.string().refine(value => !required || value.trim().length > 0, "문구를 입력해 주세요.").refine(value => [...value].length <= max, `${max}자 이내로 입력해 주세요.`);
const optionalText = (max: number) => text(max).nullable();
export const reviewFlagSchema = z.object({ path: z.string().max(240), code: z.string().min(1).max(100), message: z.string().min(1).max(1000) }).strict();
export type ReviewFlag = z.infer<typeof reviewFlagSchema>;
export type StageResult<T> = { status: "ready" | "needs_source" | "needs_review"; data: T | null; reviewFlags: ReviewFlag[] };
export const stageResultSchema = <T extends z.ZodType>(schema: T) => z.object({ status: z.enum(["ready", "needs_source", "needs_review"]), data: schema.nullable(), reviewFlags: z.array(reviewFlagSchema).max(50) }).strict().refine(value => {
  const result = value as unknown as { status: string; data: unknown };
  return result.status !== "ready" || result.data !== null;
}, "완료 상태에는 실제 결과가 필요합니다.");

export const evidenceBindingSchema = z.object({ evidenceSetId: identifier, sourceSnapshotId: identifier, sourceAnalysisId: identifier, resourceResearchId: identifier.nullable() }).strict();
export type EvidenceBinding = z.infer<typeof evidenceBindingSchema>;
export const claimRefSchema = z.object({ fieldPath: z.string().min(1).max(240), claimType: z.enum(FAMILY_CLAIM_TYPES), factIds: z.array(z.string().regex(/^F[1-9][0-9]*$/)).max(12), resourceIds: z.array(z.string().regex(/^R[1-9][0-9]*$/)).max(12) }).strict();
export type ClaimRef = z.infer<typeof claimRefSchema>;

function pageSchema(ai: boolean) {
  const t = (budget: number, required = true) => text(ai ? budget : 1000, required);
  const o = (budget: number) => t(budget).nullable();
  const view = z.object({ label: t(10), body: t(45) }).strict();
  const activity = z.object({ label: t(18), action: t(60), resourceId: z.string().regex(/^R[1-9][0-9]*$/).nullable() }).strict();
  const base = { page: z.number().int().min(1).max(8), layout: z.string().min(1).max(80), claimRefs: z.array(claimRefSchema).max(40), displayOverrides: familyDisplayOverridesSchema.optional() };
  const page = <Id extends FamilyPageId, T extends z.ZodType>(id: Id, fields: T) => z.object({ ...base, id: z.literal(id), type: z.literal(id), fields }).strict();
  return z.discriminatedUnion("id", [
    page("cover", z.object({ headline: t(24), subtitle: t(36, false) }).strict()),
    page("news_summary", z.object({ title: t(18), facts: z.array(t(35)).min(2).max(3), caveat: o(35) }).strict()),
    page("implication", z.object({ title: t(18), takeaway: t(60) }).strict()),
    page("discussion", z.object({ title: t(18), scenario: o(45), question: t(45) }).strict()),
    page("perspectives", z.object({ title: t(18), viewA: view, viewB: view }).strict()),
    page("concept", z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("value_definition"), title: t(18), concept: t(30), definitionA: t(25), definitionB: t(25), boundaryCase: t(35), fillIn: t(30) }).strict(),
      z.object({ mode: z.literal("scientific_explanation"), title: t(18), concept: t(30), acceptedDefinition: t(45), exampleOrNonExample: t(35), fillIn: t(30) }).strict(),
    ])),
    page("activity", z.object({ title: t(18), homeActivity: activity, optionalActivity: activity.nullable() }).strict()),
    page("outro", z.object({ brandName: t(80), parentBrand: t(80), brandLine: t(120), cta: t(35), handle: t(80, false), logoAssetId: identifier.nullable() }).strict()),
  ]);
}
export const familyPageSchema = pageSchema(false);
export type FamilyPage = z.infer<typeof familyPageSchema>;
export type PageFields = { [Id in FamilyPageId]: Extract<FamilyPage, { id: Id }>['fields'] };
const makeCardSchema = (ai: boolean) => z.object({ version: z.literal(2), formatId: z.literal(FAMILY_FORMAT_ID), templateKey: z.string().min(1).max(120), pages: z.array(pageSchema(ai)).length(8) }).strict().superRefine((copy, ctx) => {
  copy.pages.forEach((page, index) => {
    if (ai && page.displayOverrides !== undefined) ctx.addIssue({ code: "custom", path: ["pages", index, "displayOverrides"], message: "표시 문구 수정값은 AI가 생성하지 않습니다. 기존 운영자 수정값을 유지해 주세요." });
    if (page.id !== FAMILY_PAGE_IDS[index] || page.type !== page.id || page.page !== index + 1) ctx.addIssue({ code: "custom", path: ["pages", index], message: "8장 카드의 고정 ID·역할·페이지 순서를 유지해 주세요." });
    for (const [refIndex, ref] of page.claimRefs.entries()) {
      if (!familyFieldExists(page, ref.fieldPath)) ctx.addIssue({ code: "custom", path: ["pages", index, "claimRefs", refIndex, "fieldPath"], message: "근거 연결이 현재 페이지의 실제 문구 필드를 가리켜야 합니다." });
    }
  });
});
export const familyCardCopySchema = makeCardSchema(false);
export const familyCardCopyAiSchema = makeCardSchema(true);
export type CardCopyV2 = z.infer<typeof familyCardCopySchema>;

const percent = z.number().min(0).max(100);
export const outroPresentationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("template") }).strict(),
  z.object({ mode: z.literal("full_image"), assetId: z.enum(FAMILY_ENDING_ASSET_IDS) }).strict(),
]);
export const pageDesignSchema = z.object({
  alignment: z.enum(["center", "left"]),
  background: z.object({ kind: z.enum(["none", "brand", "image"]), assetId: z.number().int().positive().optional(), inheritCover: z.boolean().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), fit: z.enum(["cover", "contain"]), focalX: percent, focalY: percent, brightness: z.number().min(0).max(200), overlay: percent }).strict().refine(value => value.kind !== "image" || value.assetId !== undefined, "이미지 배경에는 저장된 자산이 필요합니다."),
  previousAssetIds: z.array(z.number().int().positive()).max(20).optional(),
  // Omitted in historical drafts. Complete artwork never replaces editable copy.
  outroPresentation: outroPresentationSchema.optional(),
}).strict();
export type PageDesign = z.infer<typeof pageDesignSchema>;
export const pageDesignsSchema = z.record(z.enum(FAMILY_PAGE_IDS), pageDesignSchema).superRefine((designs, ctx) => {
  for (const id of FAMILY_PAGE_IDS) if (id !== "outro" && designs[id].outroPresentation !== undefined) {
    ctx.addIssue({ code: "custom", path: [id, "outroPresentation"], message: "엔딩 이미지 선택은 마지막 장에서만 사용할 수 있습니다." });
  }
});
export type PageDesigns = z.infer<typeof pageDesignsSchema>;
export function defaultPageDesigns(): PageDesigns {
  const designs = {} as PageDesigns;
  for (const id of FAMILY_PAGE_IDS) designs[id] = { alignment: "center", background: { kind: "brand", color: FAMILY_PAGE_COLORS[id], fit: "cover", focalX: 50, focalY: 50, brightness: 100, overlay: 45 }, previousAssetIds: [] };
  return designs;
}

export const editorialPlanSchema = z.object({
  articleCore: text(600), coreQuestion: text(300), thinkingSkill: z.enum(FAMILY_THINKING_SKILLS), keyConcept: text(100), conceptMode: z.enum(["value_definition", "scientific_explanation"]), connectionReason: text(600),
  essentialConditions: z.array(text(400)).max(12), questionCandidates: z.array(text(300)).min(1).max(3), resourceNeeds: z.array(text(400)).max(6),
}).strict();
export type EditorialPlan = z.infer<typeof editorialPlanSchema>;
export const parentGuideSchema = z.object({
  timing: z.array(z.object({ step: z.enum(["read", "question", "compare", "close"]), minutes: z.number().int().min(1).max(10), instruction: text(400) }).strict()).length(4),
  coreQuestion: text(300), optionalFollowup: optionalText(400), optionalDeepening: optionalText(400), whenUnsure: text(400), whenDisagree: text(400), whenMisunderstood: text(400), whenTired: text(400), closingReflection: text(400),
}).strict().refine(value => value.timing.every((step, index) => step.step === ["read", "question", "compare", "close"][index] && step.minutes === [2, 4, 3, 1][index]), "기본 대화 진행은 읽기 2분·질문 4분·비교 3분·마무리 1분입니다.");
export type ParentGuide = z.infer<typeof parentGuideSchema>;
export const aiCaptionPackageSchema = z.object({
  origin: z.literal("ai").optional(),
  contentRevision: z.number().int().positive(), hook: text(500), newsSummary: text(1000), coreQuestion: text(300), conversationGuide: text(600), parentLine: text(400), optionalFollowup: optionalText(400), cta: text(300), hashtags: z.array(text(60)).max(5),
  sourceCredit: z.array(z.object({ title: text(1000), publisher: optionalText(300), url: z.string().url().max(4000).nullable() }).strict()).min(1).max(12), fullCaption: text(6000),
}).strict();
export const manualCaptionPackageSchema = z.object({
  origin: z.literal("manual"), contentRevision: z.number().int().positive(), coreQuestion: text(300), fullCaption: text(6000), sourceCredit: aiCaptionPackageSchema.shape.sourceCredit,
  confirmation: z.object({ comparedRevision: z.number().int().positive(), publicationDraftVersion: z.number().int().nonnegative(), confirmedAt: z.string().datetime(), captionHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict();
export const captionPackageSchema = z.union([aiCaptionPackageSchema, manualCaptionPackageSchema]);
export type CaptionPackage = z.infer<typeof captionPackageSchema>;
export const visualBriefSchema = z.object({ pageId: z.enum(FAMILY_PAGE_IDS), visualSubject: text(1000), composition: text(1000), mood: text(300), palette: z.array(text(100)).max(8), textSafeArea: text(1000), referenceAssetIds: z.array(identifier).max(12), avoidElements: z.array(text(300)).max(20), imagePrompt: text(6000) }).strict();
export type VisualBrief = z.infer<typeof visualBriefSchema>;
export const editorialReviewSchema = z.object({
  reviewScope: z.array(z.enum(["source", "text", "caption", "image_brief", "images", "render"])).min(1).max(6),
  checks: z.array(z.object({ name: text(150), status: z.enum(["passed", "failed", "not_checked"]), detail: text(1000, false) }).strict()).max(40),
  issues: z.array(z.object({ path: text(240), severity: z.enum(["blocking", "revision", "optional"]), problem: text(1000), evidence: text(1000, false), suggestedReplacement: optionalText(1500) }).strict()).max(40),
  minimumPatches: z.array(z.object({ path: text(240), replacement: text(1500), reason: text(1000) }).strict()).max(40), mustFixBeforeUse: z.boolean(),
}).strict();
export type EditorialReview = z.infer<typeof editorialReviewSchema>;
export const generationRunSchema = z.object({
  id: identifier, stage: z.enum(["article_analysis", "editorial_plan", "resource_research", "card_copy", "caption", "image_brief", "image_generation", "editorial_review", "partial_copy"]),
  status: z.enum(["ready", "needs_source", "needs_review", "failed", "cancelled", "running"]), baseRevision: z.number().int().positive().nullable(), inputHash: z.string().min(1).max(160), startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(), provenance: aiStageProvenanceSchema.nullable(), error: optionalText(1000),
}).strict();
export type GenerationRun = z.infer<typeof generationRunSchema>;
export const familyDependenciesSchema = z.object({ caption: z.enum(["current", "needs_review", "not_generated"]), visuals: z.enum(["current", "needs_review", "not_generated"]), review: z.enum(["current", "needs_review", "not_generated"]), render: z.enum(["current", "needs_review", "not_generated"]) }).strict();
export const familyDialogueMetadataSchema = z.object({
  editorialPlan: editorialPlanSchema, evidenceBinding: evidenceBindingSchema, pageDesigns: pageDesignsSchema,
  parentGuide: parentGuideSchema.nullable(), captionPackage: captionPackageSchema.nullable(),
  visualBriefs: z.partialRecord(z.enum(FAMILY_PAGE_IDS), visualBriefSchema), editorialReview: editorialReviewSchema.nullable(),
  fieldLocks: z.record(z.string().max(240), z.boolean()), generationRuns: z.array(generationRunSchema).max(200), dependencies: familyDependenciesSchema,
}).strict();
export type FamilyDialogueMetadata = z.infer<typeof familyDialogueMetadataSchema>;

export type FamilyFieldDescriptor = { pageId: FamilyPageId; path: string; fieldPath: string; label: string; initialBudget: number; manualMax: number; kind: "text" | "textarea" | "array"; required: boolean; conceptMode?: "value_definition" | "scientific_explanation"; systemOwned?: boolean };
const fd = (pageId: FamilyPageId, path: string, label: string, initialBudget: number, extra: Partial<FamilyFieldDescriptor> = {}): FamilyFieldDescriptor => ({ pageId, path, fieldPath: `pages.${pageId}.${path}`, label, initialBudget, manualMax: 1000, kind: initialBudget > 36 ? "textarea" : "text", required: true, ...extra });
export const FAMILY_FIELD_DESCRIPTORS: Record<FamilyPageId, FamilyFieldDescriptor[]> = {
  cover: [fd("cover", "fields.headline", "표지 제목", 24), fd("cover", "fields.subtitle", "표지 부제", 36, { required: false })],
  news_summary: [fd("news_summary", "fields.title", "뉴스 요약 제목", 18), fd("news_summary", "fields.facts", "확인한 사실", 35, { kind: "array" }), fd("news_summary", "fields.caveat", "조건·한계", 35, { required: false })],
  implication: [fd("implication", "fields.title", "시사점 제목", 18), fd("implication", "fields.takeaway", "뉴스가 시사하는 바", 60)],
  discussion: [fd("discussion", "fields.title", "질문 제목", 18), fd("discussion", "fields.scenario", "가정한 상황", 45, { required: false }), fd("discussion", "fields.question", "중심 질문", 45)],
  perspectives: [fd("perspectives", "fields.title", "두 시선 제목", 18), fd("perspectives", "fields.viewA.label", "첫 번째 기준", 10), fd("perspectives", "fields.viewA.body", "첫 번째 시선", 45), fd("perspectives", "fields.viewB.label", "두 번째 기준", 10), fd("perspectives", "fields.viewB.body", "두 번째 시선", 45)],
  concept: [fd("concept", "fields.title", "개념 제목", 18), fd("concept", "fields.concept", "핵심 개념", 30), fd("concept", "fields.definitionA", "첫 번째 정의 예시", 25, { conceptMode: "value_definition" }), fd("concept", "fields.definitionB", "두 번째 정의 예시", 25, { conceptMode: "value_definition" }), fd("concept", "fields.boundaryCase", "경계 사례", 35, { conceptMode: "value_definition" }), fd("concept", "fields.acceptedDefinition", "통용 정의", 45, { conceptMode: "scientific_explanation" }), fd("concept", "fields.exampleOrNonExample", "예시·비예·조건", 35, { conceptMode: "scientific_explanation" }), fd("concept", "fields.fillIn", "내 말로 정리", 30)],
  activity: [fd("activity", "fields.title", "활동 제목", 18), fd("activity", "fields.homeActivity.label", "집 활동 이름", 18), fd("activity", "fields.homeActivity.action", "집에서 할 일", 60), fd("activity", "fields.optionalActivity.label", "추가 활동 이름", 18, { required: false }), fd("activity", "fields.optionalActivity.action", "추가로 할 일", 60, { required: false })],
  outro: [fd("outro", "fields.brandName", "채널 브랜드", 80, { systemOwned: true }), fd("outro", "fields.parentBrand", "상위 브랜드", 80, { systemOwned: true }), fd("outro", "fields.brandLine", "브랜드 문구", 120, { systemOwned: true }), fd("outro", "fields.cta", "마지막 행동 안내", 35), fd("outro", "fields.handle", "채널 계정", 80, { required: false, systemOwned: true })],
};
export function familyFieldDescriptors(page: FamilyPage): FamilyFieldDescriptor[] {
  return FAMILY_FIELD_DESCRIPTORS[page.id].filter(field => (!field.conceptMode || page.id === "concept" && page.fields.mode === field.conceptMode) && (page.id !== "activity" || page.fields.optionalActivity !== null || !field.path.startsWith("fields.optionalActivity.")));
}
/** Stable semantic paths are independent of array position. claimRefs stay local to their page. */
export function familyFieldExists(page: FamilyPage | { id: FamilyPageId; fields: unknown }, path: string): boolean {
  const local = path.startsWith(`pages.${page.id}.`) ? path.slice(`pages.${page.id}.`.length) : path;
  if (!local.startsWith("fields.")) return false;
  let value: unknown = page;
  for (const segment of local.split(".")) {
    if (!value || typeof value !== "object" || ["__proto__", "prototype", "constructor"].includes(segment)) return false;
    if (!(segment in value)) return false;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" || value === null || Array.isArray(value) && value.every(item => typeof item === "string");
}
export function familyFieldValue(copy: CardCopyV2, fieldPath: string): unknown {
  const [root, pageId, ...rest] = fieldPath.split(".");
  if (root !== "pages") return undefined;
  const page = copy.pages.find(candidate => candidate.id === pageId);
  if (!page || !familyFieldExists(page, rest.join("."))) return undefined;
  return rest.reduce<unknown>((value, segment) => value && typeof value === "object" ? (value as Record<string, unknown>)[segment] : undefined, page);
}
