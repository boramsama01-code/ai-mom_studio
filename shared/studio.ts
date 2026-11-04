import { experienceSchema, type Experience } from "./experience";
import { altTextError } from "./altText";
import { CHANNEL_BRANDS } from "./branding";
import { normalizeStudioChannel } from "./channelKeys";
import { z } from "zod";
import { aiProviders, type AiProvider } from "./aiProviders";
import { PERSISTED_CARD_DESIGNS, CARD_COLOR_VARIANTS } from "./cardDesigns";

/** Built-in examples only; the actual channel directory is loaded from /channels. */
export const builtinStudioChannels = ["penguin", "highscoop", "fryday", "news"] as const;
export const studioChannels = builtinStudioChannels;
export const studioFormats = ["웹툰", "카드뉴스", "릴스", "브랜드", "기타"] as const;
export const studioExportDesigns = ["editorial", "spotlight", "minimal", ...Array.from(new Set([...PERSISTED_CARD_DESIGNS, ...CARD_COLOR_VARIANTS].map(d => `set:${d.id}` as const)))] as const;
export const studioPageCount = (content: { format: string; exportDesign: string; experience?: Experience | null; finishedDeck?: { pages: unknown[] } | null }) => content.finishedDeck ? content.finishedDeck.pages.length : content.experience ? content.experience.pages.length + 1 : content.format === "카드뉴스" ? content.exportDesign.startsWith("set:") ? 5 : 6 : 1;
export const studioOutputFormats = ["웹툰", "카드뉴스"] as const;
export const studioOutputDescription = (format: string, design = "editorial") => format === "웹툰" ? "네컷 이미지 1장 · 1080 × 1350 PNG" : format === "카드뉴스" ? design.startsWith("set:") ? "표지 + 본문 4장 · 1080 × 1350 PNG 5장 (ZIP)" : "표지 + 본문 4장 + 마무리 · 1080 × 1350 PNG 6장 (ZIP)" : "기획용 형식 · 이미지·영상 내보내기 미지원";
export const studioStages = ["idea", "writing", "making", "review", "done"] as const;
export const studioCharacters = ["pengpeng", "pempem", "penguin", "pengki"] as const;
export const studioChannelLabels = { penguin: CHANNEL_BRANDS.penguin.name, highscoop: CHANNEL_BRANDS.highscoop.name, fryday: CHANNEL_BRANDS.fryday.name, news: CHANNEL_BRANDS.news.name };
export const studioStageLabels = { idea: "아이디어", writing: "원고", making: "제작", review: "검토", done: "완료" };
export type StudioChannel = string;
export type StudioCharacter = typeof studioCharacters[number];
export type StudioFormat = typeof studioFormats[number];
export type StudioStage = typeof studioStages[number];
export type StudioProvider = AiProvider;

const date = z.string().refine(v => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v), "올바른 날짜를 입력하세요.");
export const studioPoseReferenceSchema = z.object({ character: z.enum(studioCharacters), pose: z.number().int().min(1).max(100) }).strict();
export const studioPanelSchema = z.object({
  scene: z.string().max(4000), dialogue: z.string().max(3000), imageId: z.number().int().positive().nullable().default(null),
  // Optional in TypeScript for existing callers; Zod fills the default for saved legacy panels.
  poseRefs: z.array(studioPoseReferenceSchema).max(4).refine(refs => new Set(refs.map(ref => ref.character)).size === refs.length, "한 컷에서 같은 캐릭터의 포즈는 하나만 선택하세요.").default([]).optional(),
}).strict();
export const studioContentSchema = z.object({
  finishedDeck: z.object({ pages: z.array(z.object({ imageId: z.number().int().positive(), name: z.string().max(200), altText: z.string().max(1000).default(""), uploadId: z.string().uuid().optional() }).strict()).max(10).refine(pages => new Set(pages.map(p => p.imageId)).size === pages.length, "같은 이미지는 한 번만 넣어 주세요.") }).strict().nullable().default(null),
  altTexts: z.array(z.string().max(1000)).max(10).default([]),
  experience: experienceSchema.nullable().default(null),
  subcategory: z.string().max(40).optional(),
  title: z.string().trim().min(1).max(160),
  channel: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).transform(normalizeStudioChannel).default("penguin"),
  format: z.enum(studioFormats).default("웹툰"),
  stage: z.enum(studioStages).default("idea"),
  dueDate: date.default(""), memo: z.string().max(12000).default(""),
  script: z.string().max(24000).default(""), caption: z.string().max(8000).default(""),
  exportDesign: z.enum(studioExportDesigns).default("editorial"),
  sourceLabel: z.string().trim().max(180).default(""),
  panels: z.array(studioPanelSchema).length(4).default(() => Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null, poseRefs: [] }))),
  characters: z.array(z.enum(studioCharacters)).max(4).default(["penguin"]),
  imagePath: z.union([z.literal(""), z.literal("/studio-assets/webtoon-01.png")]).default(""),
}).strict().superRefine((content, ctx) => {
  content.panels.forEach((panel, panelIndex) => panel.poseRefs?.forEach((ref, refIndex) => {
    if (!content.characters.includes(ref.character)) ctx.addIssue({ code: "custom", path: ["panels", panelIndex, "poseRefs", refIndex, "character"], message: "이 컷에 참고할 캐릭터를 등장인물에서 먼저 선택하세요." });
  }));
});
/** Keep legacy 1,000-character descriptions readable; enforce the new rule on newly submitted fields. */
function studioInputAltIssues(value: { altTexts?: string[]; finishedDeck?: StudioContent["finishedDeck"]; experience?: Experience | null }) {
 const issues: Array<{ path: (string | number)[]; message: string }> = [];
 const check = (text: string, path: (string | number)[]) => {
  const message = altTextError(text, true);
  if (message) issues.push({ path, message });
 };
 value.altTexts?.forEach((text, i) => check(text, ["altTexts", i]));
 value.finishedDeck?.pages.forEach((p, i) => check(p.altText, ["finishedDeck", "pages", i, "altText"]));
 if (value.experience) {
  check(value.experience.coverAltText, ["experience", "coverAltText"]);
  value.experience.pages.forEach((p, i) => check(p.altText, ["experience", "pages", i, "altText"]));
 }
 return issues;
}
export const studioCreateSchema = studioContentSchema.safeExtend({ sourceItemId: z.number().int().positive().optional() }).superRefine((value, ctx) => { for (const issue of studioInputAltIssues(value)) ctx.addIssue({code:"custom",...issue}); });
// Zod 4 applies defaults inside optional fields; unwrap them so a stage-only PATCH cannot erase content.
export const studioPatchSchema = z.object({
  finishedDeck: studioContentSchema.shape.finishedDeck.unwrap().refine(
    value => !value || value.pages.every(page => !altTextError(page.altText, true)),
    "대체텍스트는 1~2문장, 공백 포함 최대 125자로 작성해 주세요.",
  ).optional(),
  experience: studioContentSchema.shape.experience.unwrap().refine(
    value => !value || !altTextError(value.coverAltText, true) && value.pages.every(page => !altTextError(page.altText, true)),
    "대체텍스트는 1~2문장, 공백 포함 최대 125자로 작성해 주세요.",
  ).optional(),
  subcategory: studioContentSchema.shape.subcategory,
  title: studioContentSchema.shape.title.optional(),
  channel: studioContentSchema.shape.channel.unwrap().optional(),
  format: studioContentSchema.shape.format.unwrap().optional(),
  stage: studioContentSchema.shape.stage.unwrap().optional(),
  dueDate: studioContentSchema.shape.dueDate.unwrap().optional(),
  memo: studioContentSchema.shape.memo.unwrap().optional(),
  script: studioContentSchema.shape.script.unwrap().optional(),
  caption: studioContentSchema.shape.caption.unwrap().optional(),
  altTexts: studioContentSchema.shape.altTexts.unwrap().refine(
    values => values.every(value => !altTextError(value, true)),
    "대체텍스트는 1~2문장, 공백 포함 최대 125자로 작성해 주세요.",
  ).optional(),
  exportDesign: studioContentSchema.shape.exportDesign.unwrap().optional(),
  sourceLabel: studioContentSchema.shape.sourceLabel.unwrap().optional(),
  panels: studioContentSchema.shape.panels.unwrap().optional(),
  characters: studioContentSchema.shape.characters.unwrap().optional(),
  imagePath: studioContentSchema.shape.imagePath.unwrap().optional(),
  version: z.number().int().positive(),
}).strict();
export const studioGenerationSchema = z.object({
  version: z.number().int().positive(), kind: z.enum(["text", "image"]),
  provider: z.enum(aiProviders).optional(),
  instruction: z.string().trim().max(8000).default(""), panelIndex: z.number().int().min(0).max(3).optional(),
  panelIndexes: z.array(z.number().int().min(0).max(3)).min(1).max(4).refine(indexes => new Set(indexes).size === indexes.length, "같은 컷은 한 번만 선택해 주세요.").optional(),
  textTarget: z.enum(["rewrite", "fill", "caption", "experience", "panel"]).default("rewrite"),
  requestId: z.string().uuid(),
}).strict().superRefine((v, ctx) => {
  if (v.textTarget === "experience" && (v.kind !== "text" || (v.provider !== undefined && v.provider !== "openai"))) ctx.addIssue({ code: "custom", path: ["provider"], message: "사진·영상 후기는 GPT로 작성합니다." });
  if (v.textTarget === "panel" && (v.kind !== "text" || v.panelIndex === undefined)) ctx.addIssue({ code: "custom", path: ["panelIndex"], message: "문구를 수정할 컷을 선택해 주세요." });
  if (v.kind === "image" && v.panelIndex === undefined && v.panelIndexes === undefined) ctx.addIssue({ code: "custom", path: ["panelIndex"], message: "다시 그릴 컷을 선택하세요." });
  if (v.panelIndex !== undefined && v.panelIndexes !== undefined) ctx.addIssue({ code: "custom", path: ["panelIndexes"], message: "한 컷 선택과 여러 컷 선택을 동시에 보낼 수 없습니다." });
  if (v.kind === "text" && v.panelIndexes !== undefined) ctx.addIssue({ code: "custom", path: ["panelIndexes"], message: "여러 컷 선택은 그림 생성에서만 사용할 수 있습니다." });
  if (v.kind === "image" && v.provider !== undefined && v.provider !== "openai") ctx.addIssue({ code: "custom", path: ["provider"], message: "그림 생성은 OpenAI를 사용합니다." });
  if (v.kind === "text" && v.textTarget === "rewrite" && !v.instruction) ctx.addIssue({ code: "custom", path: ["instruction"], message: "전체 원고를 바꿀 내용을 입력하세요." });
});
export type StudioGeneration = z.infer<typeof studioGenerationSchema>;
export type StudioPanel = z.infer<typeof studioPanelSchema>;
export type StudioPoseReference = z.infer<typeof studioPoseReferenceSchema>;
export type StudioContent = z.infer<typeof studioContentSchema>;
export type StudioCardInput = StudioContent;
export type StudioCard = StudioContent & { id: number; version: number; sourceItemId: number | null; createdAt: string; updatedAt: string; trashedAt?: string | null; sourceReference?: { itemId: number; channelId: number }; sourceOutput?: import("./carousel").SourceOutput };
export type StudioRevision = { id: number; cardId: number; version: number; snapshot: StudioContent; instruction: string; provider: string | null; model: string | null; applied: boolean; createdAt: string };
export type StudioJob = { id: number; status: string; lastError: string | null; result: Record<string, unknown> | null; createdAt: string; finishedAt: string | null };
export type StudioAiStatus = { defaultProvider: StudioProvider; text: Record<StudioProvider, boolean>; image: boolean };
export type StudioBoard = { cards: StudioCard[]; trashCount?: number; notes: string; notesVersion: number; ai: StudioAiStatus };
export type StudioTrashResult = { card: StudioCard; cancelledJobs: number; cancelledDeliveries: number; alreadyProcessing: number };
export type StudioCardDetail = { card: StudioCard; revisions: StudioRevision[]; jobs: StudioJob[] };
export type StudioExportCheck = { errors: Array<{ field: string; message: string }>; warnings: string[]; pageCount: number };
export function emptyStudioCard(): StudioContent { return studioContentSchema.parse({ title: "새 콘텐츠" }); }


