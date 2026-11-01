import { experienceSchema, type Experience } from "./experience";
import { CHANNEL_BRANDS } from "./branding";
import { normalizeStudioChannel } from "./channelKeys";
import { z } from "zod";
import { aiProviders, type AiProvider } from "./aiProviders";
import { PERSISTED_CARD_DESIGNS, CARD_COLOR_VARIANTS } from "./cardDesigns";

export const studioChannels = ["penguin", "highscoop", "fryday", "news"] as const;
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
export const studioPanelSchema = z.object({ scene: z.string().max(4000), dialogue: z.string().max(3000), imageId: z.number().int().positive().nullable().default(null) }).strict();
export const studioContentSchema = z.object({
  finishedDeck: z.object({ pages: z.array(z.object({ imageId: z.number().int().positive(), name: z.string().max(200), altText: z.string().max(1000).default(""), uploadId: z.string().uuid().optional() }).strict()).max(10).refine(pages => new Set(pages.map(p => p.imageId)).size === pages.length, "같은 이미지는 한 번만 넣어 주세요.") }).strict().nullable().default(null),
  altTexts: z.array(z.string().max(1000)).max(10).default([]),
  experience: experienceSchema.nullable().default(null),
  title: z.string().trim().min(1).max(160),
  channel: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).transform(normalizeStudioChannel).default("penguin"),
  format: z.enum(studioFormats).default("웹툰"),
  stage: z.enum(studioStages).default("idea"),
  dueDate: date.default(""), memo: z.string().max(12000).default(""),
  script: z.string().max(24000).default(""), caption: z.string().max(8000).default(""),
  exportDesign: z.enum(studioExportDesigns).default("editorial"),
  sourceLabel: z.string().trim().max(180).default(""),
  panels: z.array(studioPanelSchema).length(4).default(() => Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null }))),
  characters: z.array(z.enum(studioCharacters)).max(4).default(["penguin"]),
  imagePath: z.union([z.literal(""), z.literal("/studio-assets/webtoon-01.png")]).default(""),
}).strict();
export const studioCreateSchema = studioContentSchema.extend({ sourceItemId: z.number().int().positive().optional() });
// Zod 4 applies defaults inside optional fields; unwrap them so a stage-only PATCH cannot erase content.
export const studioPatchSchema = z.object({
  finishedDeck: studioContentSchema.shape.finishedDeck.unwrap().optional(),
  experience: studioContentSchema.shape.experience.unwrap().optional(),
  title: studioContentSchema.shape.title.optional(),
  channel: studioContentSchema.shape.channel.unwrap().optional(),
  format: studioContentSchema.shape.format.unwrap().optional(),
  stage: studioContentSchema.shape.stage.unwrap().optional(),
  dueDate: studioContentSchema.shape.dueDate.unwrap().optional(),
  memo: studioContentSchema.shape.memo.unwrap().optional(),
  script: studioContentSchema.shape.script.unwrap().optional(),
  caption: studioContentSchema.shape.caption.unwrap().optional(),
  altTexts: studioContentSchema.shape.altTexts.unwrap().optional(),
  exportDesign: studioContentSchema.shape.exportDesign.unwrap().optional(),
  sourceLabel: studioContentSchema.shape.sourceLabel.unwrap().optional(),
  panels: studioContentSchema.shape.panels.unwrap().optional(),
  characters: studioContentSchema.shape.characters.unwrap().optional(),
  imagePath: studioContentSchema.shape.imagePath.unwrap().optional(),
  version: z.number().int().positive(),
}).strict();
export const studioGenerationSchema = z.object({
  version: z.number().int().positive(), kind: z.enum(["text", "image"]),
  provider: z.enum(aiProviders).default("openai"),
  instruction: z.string().trim().max(8000).default(""), panelIndex: z.number().int().min(0).max(3).optional(),
  textTarget: z.enum(["rewrite", "fill", "caption", "experience"]).default("rewrite"),
  requestId: z.string().uuid(),
}).strict().superRefine((v, ctx) => {
  if (v.textTarget === "experience" && (v.kind !== "text" || v.provider !== "openai")) ctx.addIssue({ code: "custom", path: ["provider"], message: "사진·영상 후기는 GPT로 작성합니다." });
  if (v.kind === "image" && v.panelIndex === undefined) ctx.addIssue({ code: "custom", path: ["panelIndex"], message: "다시 그릴 컷을 선택하세요." });
  if (v.kind === "image" && v.provider !== "openai") ctx.addIssue({ code: "custom", path: ["provider"], message: "그림 생성은 OpenAI를 사용합니다." });
  if (v.kind === "text" && v.textTarget === "rewrite" && !v.instruction) ctx.addIssue({ code: "custom", path: ["instruction"], message: "전체 원고를 바꿀 내용을 입력하세요." });
});
export type StudioGeneration = z.infer<typeof studioGenerationSchema>;
export type StudioPanel = z.infer<typeof studioPanelSchema>;
export type StudioContent = z.infer<typeof studioContentSchema>;
export type StudioCardInput = StudioContent;
export type StudioCard = StudioContent & { id: number; version: number; sourceItemId: number | null; createdAt: string; updatedAt: string; trashedAt?: string | null; sourceOutput?: import("./carousel").SourceOutput };
export type StudioRevision = { id: number; cardId: number; version: number; snapshot: StudioContent; instruction: string; provider: string | null; model: string | null; applied: boolean; createdAt: string };
export type StudioJob = { id: number; status: string; lastError: string | null; result: Record<string, unknown> | null; createdAt: string; finishedAt: string | null };
export type StudioAiStatus = { defaultProvider: StudioProvider; text: Record<StudioProvider, boolean>; image: boolean };
export type StudioBoard = { cards: StudioCard[]; trashCount?: number; notes: string; notesVersion: number; ai: StudioAiStatus };
export type StudioTrashResult = { card: StudioCard; cancelledJobs: number; cancelledDeliveries: number; alreadyProcessing: number };
export type StudioCardDetail = { card: StudioCard; revisions: StudioRevision[]; jobs: StudioJob[] };
export type StudioExportCheck = { errors: Array<{ field: string; message: string }>; warnings: string[]; pageCount: number };
export function emptyStudioCard(): StudioContent { return studioContentSchema.parse({ title: "새 콘텐츠" }); }
