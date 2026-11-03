import { and, eq, isNotNull, ne, notExists, sql } from "drizzle-orm";
import type { DB } from "../db";
import { appSettings, channels, contentItems, studioCards, studioRevisions } from "../../shared/schema";
import { studioKey } from "../../shared/channelKeys";
import { studioContentSchema } from "../../shared/studio";
import { validSubcategory } from "../../shared/channelCategories";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

/** Index work as soon as a revision exists; rendered media remains a separate artifact. */
export async function ensureSourceWorkspace(tx: Tx, itemId: number) {
  const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId));
  if (!item?.currentRevisionId || item.origin === "studio" || item.isSample || item.excluded) return null;
  const [existing] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
  if (existing) return existing.id;
  const [channel] = await tx.select().from(channels).where(eq(channels.id, item.channelId));
  if (!channel) return null;
  const key = studioKey(channel.slug);
  const content = studioContentSchema.parse({
    title: item.title.slice(0, 160), channel: key, format: "카드뉴스", stage: "writing",
    ...(validSubcategory(key, item.subcategory) ? { subcategory: item.subcategory ?? "" } : {}),
  });
  const [created] = await tx.insert(studioCards).values({
    sourceItemId: item.id, content, importedMeta: { sourceWorkspace: true },
  }).onConflictDoNothing().returning({ id: studioCards.id });
  if (created) await tx.insert(studioRevisions).values({ cardId: created.id, version: 1, snapshot: content, instruction: "원고 작성 시작 · 내 콘텐츠에 추가" });
  return created?.id ?? null;
}

/** One-time, idempotent repair of existing drafts. No rendering, AI or publishing. */
export async function backfillSourceWorkspaces(db: DB) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193204)`);
    const key = "source_workspace_index_v1";
    const [done] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
    if (done?.value === true) return 0;
    const pending = await tx.select({ id: contentItems.id }).from(contentItems).where(and(
      isNotNull(contentItems.currentRevisionId), ne(contentItems.origin, "studio"),
      eq(contentItems.isSample, false), eq(contentItems.excluded, false),
      notExists(tx.select({ id: studioCards.id }).from(studioCards).where(eq(studioCards.sourceItemId, contentItems.id))),
    )).orderBy(contentItems.id);
    let added = 0;
    for (const item of pending) if (await ensureSourceWorkspace(tx, item.id)) added++;
    await tx.insert(appSettings).values({ key, value: true }).onConflictDoUpdate({ target: appSettings.key, set: { value: true, updatedAt: new Date() } });
    return added;
  });
}
