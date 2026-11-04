import { eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, contentSources, sourceDocuments } from "../../shared/schema";
import type { CardCopy } from "../../shared/cardCopy";
import { validateNewsEditorialResource } from "../../shared/newsEditorialResource";
import { itemPrimarySource } from "./itemSources";
import type { LlmSource } from "./llm";
import { HttpError } from "../routes/util";

type ContentItem = typeof contentItems.$inferSelect;

/** Same primary/manual-source exclusion rules as source generation. Reads current owned sources only. */
export async function loadNewsEditorialSources(db: DB, item: ContentItem): Promise<LlmSource[]> {
  const primary = await itemPrimarySource(db, item);
  const links = await db.select().from(contentSources).where(eq(contentSources.contentItemId, item.id));
  const ids = new Set<number>(primary ? [primary.id] : []);
  links.filter(link => link.role !== "previous_manual" && (primary?.kind !== "manual_text" || (link.sourceDocumentId !== item.primarySourceId && link.role !== "merged_primary"))).forEach(link => ids.add(link.sourceDocumentId));
  const docs = ids.size ? await db.select().from(sourceDocuments).where(inArray(sourceDocuments.id, [...ids])) : [];
  return docs.filter(doc => doc.fetchStatus === "ok" && doc.fetchedText).map(doc => ({ source_id: doc.id, kind: doc.kind, url: doc.originalUrl, title: doc.title, published: doc.publishedRaw, text: doc.fetchedText! }));
}

/** Used by save/preview/render; readonly UI fields alone cannot establish canonical metadata. */
export async function assertNewsEditorialResources(db: DB, item: ContentItem, copy: CardCopy): Promise<void> {
  const referenced = copy.pages.filter(page => page.resource);
  if (!referenced.length) return;
  const sources = await loadNewsEditorialSources(db, item);
  for (const page of referenced) {
    if (page.role !== "activity") throw new HttpError(400, "참고자료는 추가 활동 카드에서만 사용할 수 있습니다.");
    const error = validateNewsEditorialResource(page.resource, sources);
    if (error) throw new HttpError(409, error);
  }
}
