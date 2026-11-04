import { z } from "zod";

/** Explicit IDs for v1 and v2; arbitrary names must never select another page. */
export const cardPageArtworkIdSchema = z.union([
  z.literal("cover"),
  z.string().regex(/^body-[1-9]$/),
  z.enum(["news_summary", "implication", "discussion", "perspectives", "concept", "activity", "outro"]),
]);

export const isCardPageArtworkId = (value: unknown): value is string => cardPageArtworkIdSchema.safeParse(value).success;
