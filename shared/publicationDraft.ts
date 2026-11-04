import { z } from "zod";

export type PublicationCaptions = { instagram: string; telegram: string };

/** A saved editing intention, never an approval or a queued delivery. */
export type PublicationOptions = {
  destinationIds: number[];
  timing: "now" | "later";
  /** The datetime-local value in Korea time, or an unfinished empty input. */
  scheduledAtKst: string;
};

/** Existing caption-only drafts remain readable and writable. */
export type PublicationDraft = {
  version: number;
  captions: PublicationCaptions;
  options?: PublicationOptions;
};

/** Studio keeps its caption in the content revision; only posting options live here. */
export type StudioPublicationDraft = { version: number; options?: PublicationOptions };

/** Parse without depending on the browser/server timezone or normalizing invalid days. */
export function publicationKstDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const roundTrip = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return roundTrip === value ? date : null;
}

export const publicationOptionsSchema = z.object({
  destinationIds: z.array(z.number().int().positive().max(2147483647)).max(20)
    .refine(ids => new Set(ids).size === ids.length, "게시 계정은 중복 선택할 수 없습니다."),
  timing: z.enum(["now", "later"]),
  scheduledAtKst: z.string().max(16).refine(value => value === "" || !!publicationKstDate(value), "예약 시각은 한국 시간의 날짜와 시간으로 입력해 주세요."),
}).strict();

export const publicationDraftSaveSchema = z.object({
  version: z.number().int().min(0),
  captions: z.object({ instagram: z.string().max(5000), telegram: z.string().max(5000) }).strict(),
  // Omission by a caption-only client preserves the already-saved options.
  options: publicationOptionsSchema.optional(),
}).strict();

export const studioPublicationDraftSaveSchema = z.object({
  version: z.number().int().min(0),
  options: publicationOptionsSchema,
}).strict();

export type PublicationDraftSave = z.infer<typeof publicationDraftSaveSchema>;
export type StudioPublicationDraftSave = z.infer<typeof studioPublicationDraftSaveSchema>;

/** A checkbox's display order does not change the selected publication targets. */
export function samePublicationDestinations(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every(id => b.includes(id));
}

export function samePublicationOptions(a: PublicationOptions | undefined, b: PublicationOptions | undefined) {
  if (!a || !b) return a === b;
  return a.timing === b.timing && a.scheduledAtKst === b.scheduledAtKst && samePublicationDestinations(a.destinationIds, b.destinationIds);
}
