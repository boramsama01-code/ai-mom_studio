import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, contentSources, sourceDocuments } from "../../shared/schema";

export function itemSourceIdSql() {
  return sql<number>`coalesce((select ${contentSources.sourceDocumentId} from ${contentSources} where ${contentSources.contentItemId} = ${contentItems.id} and ${contentSources.role} = 'manual_primary' order by ${contentSources.id} desc limit 1), ${contentItems.primarySourceId})`;
}

/** Keep the collected primary ID for deduplication; pasted text belongs to this item only. */
export async function itemPrimarySource(db: DB, item: { id: number; primarySourceId: number | null }) {
  const [manual] = await db.select({ doc: sourceDocuments }).from(contentSources)
    .innerJoin(sourceDocuments, eq(contentSources.sourceDocumentId, sourceDocuments.id))
    .where(and(eq(contentSources.contentItemId, item.id), eq(contentSources.role, "manual_primary")));
  if (manual) return manual.doc;
  return item.primarySourceId ? (await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId)))[0] ?? null : null;
}
