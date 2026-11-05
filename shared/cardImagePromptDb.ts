import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { channels, contentItems, contentRevisions } from "./schema";
import type { CardImagePromptView } from "./studioImagePrompt";

/** Operator-owned image directions; saving these never approves or publishes content. */
export const cardImagePrompts = pgTable("card_image_prompts", {
  contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
  channelId: integer("channel_id").notNull().references(() => channels.id),
  pageId: text("page_id").notNull(),
  prompt: text("prompt"),
  instruction: text("instruction").notNull().default(""),
  version: integer("version").notNull().default(0),
  basedOnRevisionId: integer("based_on_revision_id").references(() => contentRevisions.id),
  lastGeneration: jsonb("last_generation").$type<CardImagePromptView["lastGeneration"]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.contentItemId, table.pageId] })]);
