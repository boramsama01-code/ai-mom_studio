import { z } from "zod";

export const EXPERIENCE_MAX_FILES = 12;
export const EXPERIENCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const EXPERIENCE_VIDEO_BYTES = 25 * 1024 * 1024;
export const EXPERIENCE_TOTAL_BYTES = 100 * 1024 * 1024;
export const experiencePageSchema = z.object({
  mediaId: z.number().int().positive().nullable(), title: z.string().trim().max(70), body: z.string().max(300),
  fit: z.enum(["contain", "cover"]).default("contain"),
  altText: z.string().max(1000).default(""),
}).strict();
export const experienceSchema = z.object({
  event: z.string().max(160).default(""), place: z.string().max(160).default(""),
  date: z.string().refine(v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, "방문일을 확인하세요.").default(""),
  notes: z.string().max(8000).default(""), takeaway: z.string().max(2000).default(""), tips: z.string().max(2000).default(""),
  tone: z.enum(["담백한 기록", "아이와 나눈 대화", "실용적인 방문 팁"]).default("담백한 기록"),
  pageCount: z.number().int().min(3).max(10).default(5),
  layout: z.enum(["photo", "journal"]).default("photo"),
  media: z.array(z.object({ id: z.number().int().positive(), note: z.string().max(500).default("") }).strict()).max(EXPERIENCE_MAX_FILES).default([])
    .refine(v => new Set(v.map(m=>m.id)).size === v.length, "같은 자료를 중복 선택할 수 없습니다."),
  coverId: z.number().int().positive().nullable().default(null),
  coverAltText: z.string().max(1000).default(""),
  pages: z.array(experiencePageSchema).max(9).default([]),
  questions: z.array(z.string().max(300)).max(8).default([]),
}).strict();
export type Experience = z.infer<typeof experienceSchema>;
export type ExperiencePage = z.infer<typeof experiencePageSchema>;
export type ExperienceMedia = { id: number; cardId: number; name: string; kind: "photo" | "video"; mimeType: string; size: number; hasPreview: boolean; frameTime: number | null; createdAt: string };
export const emptyExperience = (): Experience => experienceSchema.parse({});
export const experienceMediaUrl = (id: number, preview = false) => `/api/studio/media/${id}${preview ? "/preview" : ""}`;
export const experienceImageUrl = (id: number) => experienceMediaUrl(id, true);
export function experienceInput(content: { title: string; experience?: Experience | null }) {
  const e = content.experience;
  if (!e) return "";
  return JSON.stringify({ title: content.title, event: e.event, place: e.place, date: e.date, notes: e.notes, takeaway: e.takeaway, tips: e.tips, tone: e.tone, pageCount: e.pageCount, media: e.media });
}
