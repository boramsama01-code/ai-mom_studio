import { z } from "zod";
import { notionInteriorTemplates } from "./notionPageTemplates";

/** Presentation choices are independent of the saved manuscript and its evidence. */
export const editorialInteriorFields = {
  interiorTemplate: z.enum(notionInteriorTemplates).optional(),
  emphasis: z.string().max(160).optional(),
  footnote: z.string().max(1000).optional(),
};
export const editorialInteriorBody = z.string().max(10000).optional();
