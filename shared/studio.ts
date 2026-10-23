import { z } from "zod";

export const studioChannels = ["penguin", "highway", "fryday", "news"] as const;
export const studioFormats = ["웹툰", "카드뉴스", "릴스", "브랜드", "기타"] as const;
export const studioExportDesigns = ["editorial", "spotlight", "minimal"] as const;
export const studioOutputFormats = ["웹툰", "카드뉴스"] as const;
export const studioOutputDescription = (format: string) => format === "웹툰" ? "네컷 이미지 1장 · 1080 × 1350 PNG" : format === "카드뉴스" ? "표지 + 본문 4장 + 마무리 · 1080 × 1350 PNG 6장 (ZIP)" : "기획용 형식 · 이미지·영상 내보내기 미지원";
export const studioStages = ["idea", "writing", "making", "review", "done"] as const;
export const studioCharacters = ["pengpeng", "pempem", "penguin", "pengki"] as const;
export const studioChannelLabels = { penguin: "우주펭귄상회", highway: "Highway", fryday: "Fryday", news: "시사 채널 · 이름 미정" };
export const studioStageLabels = { idea: "아이디어", writing: "원고", making: "제작", review: "검토", done: "완료" };
export type StudioChannel = string;
export type StudioCharacter = typeof studioCharacters[number];
export type StudioFormat = typeof studioFormats[number];
export type StudioStage = typeof studioStages[number];
export type StudioProvider = "openai" | "anthropic";

const date = z.string().refine(v => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v), "올바른 날짜를 입력하세요.");
export const studioPanelSchema = z.object({ scene: z.string().max(4000), dialogue: z.string().max(3000), imageId: z.number().int().positive().nullable().default(null) }).strict();
export const studioContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  channel: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).default("penguin"),
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
  title: studioContentSchema.shape.title.optional(),
  channel: studioContentSchema.shape.channel.unwrap().optional(),
  format: studioContentSchema.shape.format.unwrap().optional(),
  stage: studioContentSchema.shape.stage.unwrap().optional(),
  dueDate: studioContentSchema.shape.dueDate.unwrap().optional(),
  memo: studioContentSchema.shape.memo.unwrap().optional(),
  script: studioContentSchema.shape.script.unwrap().optional(),
  caption: studioContentSchema.shape.caption.unwrap().optional(),
  exportDesign: studioContentSchema.shape.exportDesign.unwrap().optional(),
  sourceLabel: studioContentSchema.shape.sourceLabel.unwrap().optional(),
  panels: studioContentSchema.shape.panels.unwrap().optional(),
  characters: studioContentSchema.shape.characters.unwrap().optional(),
  imagePath: studioContentSchema.shape.imagePath.unwrap().optional(),
  version: z.number().int().positive(),
}).strict();
export const studioGenerationSchema = z.object({
  version: z.number().int().positive(), kind: z.enum(["text", "image"]),
  provider: z.enum(["openai", "anthropic"]).default("openai"),
  instruction: z.string().trim().min(1).max(8000), panelIndex: z.number().int().min(0).max(3).optional(),
  requestId: z.string().uuid(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === "image" && v.panelIndex === undefined) ctx.addIssue({ code: "custom", path: ["panelIndex"], message: "다시 그릴 컷을 선택하세요." });
  if (v.kind === "image" && v.provider !== "openai") ctx.addIssue({ code: "custom", path: ["provider"], message: "그림 생성은 OpenAI를 사용합니다." });
});
export type StudioPanel = z.infer<typeof studioPanelSchema>;
export type StudioContent = z.infer<typeof studioContentSchema>;
export type StudioCardInput = StudioContent;
export type StudioCard = StudioContent & { id: number; version: number; sourceItemId: number | null; createdAt: string; updatedAt: string };
export type StudioRevision = { id: number; cardId: number; version: number; snapshot: StudioContent; instruction: string; provider: string | null; model: string | null; applied: boolean; createdAt: string };
export type StudioJob = { id: number; status: string; lastError: string | null; result: Record<string, unknown> | null; createdAt: string; finishedAt: string | null };
export type StudioAiStatus = { defaultProvider: StudioProvider; text: { openai: boolean; anthropic: boolean }; image: boolean };
export type StudioBoard = { cards: StudioCard[]; notes: string; notesVersion: number; ai: StudioAiStatus };
export type StudioCardDetail = { card: StudioCard; revisions: StudioRevision[]; jobs: StudioJob[] };
export type StudioExportCheck = { errors: Array<{ field: string; message: string }>; warnings: string[]; pageCount: number };
export function emptyStudioCard(): StudioContent { return studioContentSchema.parse({ title: "새 콘텐츠" }); }
