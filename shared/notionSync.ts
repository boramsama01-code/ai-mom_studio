import { z } from "zod";

/** The data source inside the existing 콘텐츠 제작 database, not its database ID. */
export const DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID = "e5a4b4f7-f2f6-4fad-b514-1602a2b12b2b";
export const NOTION_CARD_DATA_SOURCE_ID = "58de23b2-4662-40d2-bf3e-d110ba9601e4";
export const NOTION_SOURCE_REFERENCES_PER_PAGE = 4;
export const NOTION_SOURCE_REFERENCES_MAX = 24;
export const NOTION_MANUSCRIPT_MAX_PAGES = 20;
export const NOTION_MAX_OUTPUT_PAGES = NOTION_MANUSCRIPT_MAX_PAGES + Math.ceil(NOTION_SOURCE_REFERENCES_MAX / NOTION_SOURCE_REFERENCES_PER_PAGE) + 2;
export function notionSourceReferencePageCount(references?: readonly unknown[]): number {
  return Math.ceil((references?.length ?? 0) / NOTION_SOURCE_REFERENCES_PER_PAGE);
}
export const notionSourceReferenceSchema = z.object({ title: z.string().min(1).max(200), url: z.string().url().max(2048) });
export const notionTableFieldsSchema = z.object({ subtitle: z.string(), body: z.string(), footnote: z.string(), sourceLabel: z.string() });

export const notionPhotoSchema = z.object({
  key: z.string().min(1), name: z.string(), url: z.string().url(),
});
export const notionDocumentPageSchema = z.object({
  index: z.number().int().min(1).max(30), title: z.string(), body: z.string(),
  headingBlockId: z.string(), bodyBlockIds: z.array(z.string()),
  titleBlockId: z.string().optional(),
  cardRowId: z.string().uuid().optional(), cardFields: notionTableFieldsSchema.optional(),
  infographic: z.enum(['application_steps','admissions_calendar','institution_schedule']).optional(),
  emphasis: z.string().max(100).optional(),
});
export const notionDocumentSummarySchema = z.object({
  pageId: z.string().uuid(), url: z.string().url(), lastEditedAt: z.string(),
  contentKey: z.string(), title: z.string(), coverTitle: z.string(),
  channel: z.string(), category: z.string(), template: z.string(), stage: z.string(),
  verified: z.boolean(),
});
export const notionDocumentSchema = notionDocumentSummarySchema.extend({
  caption: z.string(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(notionDocumentPageSchema).max(30), photos: z.array(notionPhotoSchema).max(12),
  sourceReferences: z.array(notionSourceReferenceSchema).max(NOTION_SOURCE_REFERENCES_MAX).optional(),
  sourceCard: z.object({title:z.string(),body:z.string(),footnote:z.string().optional()}).optional(),
  teaser: z.object({title:z.string().min(1).max(200),body:z.string().min(1).max(1000)}).optional(),
  editorialSource: z.literal("card_table").optional(),
});
export const notionDocumentListSchema = z.object({
  documents: z.array(notionDocumentSummarySchema), hasMore: z.boolean(), nextCursor: z.string().optional(),
});
export const notionDocumentQuerySchema = z.object({
  query: z.string().trim().max(200).optional(), channel: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
}).strict();
export const notionDocumentUpdateSchema = z.object({
  pageId: z.string().min(1).max(2048), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(z.object({ index: z.number().int().min(1).max(30), title: z.string().max(4000), body: z.string().max(30000), cardFields: notionTableFieldsSchema.optional() }).strict()).min(1).max(30),
  coverTitle: z.string().max(4000).optional(), studioUrl: z.string().url().max(2048).optional(),
  outputUrl: z.string().url().max(2048).optional(),
}).strict();
export const notionConnectionStatusSchema = z.object({
  configured: z.boolean(), dataSourceId: z.string(), missing: z.array(z.string()),
});
export type NotionPhoto = z.infer<typeof notionPhotoSchema>;
export type NotionDocumentPage = z.infer<typeof notionDocumentPageSchema>;
export type NotionDocumentSummary = z.infer<typeof notionDocumentSummarySchema>;
export type NotionDocument = z.infer<typeof notionDocumentSchema>;
export type NotionDocumentList = z.infer<typeof notionDocumentListSchema>;
export type NotionDocumentQuery = z.infer<typeof notionDocumentQuerySchema>;
export type NotionDocumentUpdate = z.infer<typeof notionDocumentUpdateSchema>;
export type NotionConnectionStatus = z.infer<typeof notionConnectionStatusSchema>;
