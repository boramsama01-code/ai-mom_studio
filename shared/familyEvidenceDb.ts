import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { channels, contentItems, contentRevisions } from "./schema";

/** Append-only evidence. Snapshot IDs are never retargeted when sources or AI settings change. */
export const familyEvidenceRecords = pgTable("family_evidence_records", {
  id: text("id").primaryKey(), channelId: integer("channel_id").notNull().references(() => channels.id), contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
  kind: text("kind").notNull(), fingerprint: text("fingerprint").notNull(), sourceSnapshotId: text("source_snapshot_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("family_evidence_record_fingerprint").on(table.contentItemId, table.kind, table.fingerprint), index("family_evidence_record_owner").on(table.channelId, table.contentItemId)]);

/** Completed stage outputs can be reused. A failed paid attempt is retained, never automatically replayed. */
export const familyEditorialStages = pgTable("family_editorial_stages", {
  id: text("id").primaryKey(), channelId: integer("channel_id").notNull().references(() => channels.id), contentItemId: integer("content_item_id").notNull().references(() => contentItems.id),
  stage: text("stage").notNull(), inputHash: text("input_hash").notNull(), requestId: text("request_id").notNull(), baseRevision: integer("base_revision").references(() => contentRevisions.id),
  status: text("status").notNull(), result: jsonb("result").$type<Record<string, unknown>>().notNull(), provenance: jsonb("provenance").$type<Record<string, unknown> | null>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(), finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
}, table => [index("family_editorial_stage_cache").on(table.contentItemId, table.stage, table.inputHash), index("family_editorial_stage_request").on(table.contentItemId, table.requestId), uniqueIndex("family_editorial_stage_running").on(table.contentItemId, table.stage, table.inputHash).where(sql`${table.status} = 'running'`)]);
