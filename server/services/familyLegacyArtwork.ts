import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, contentRevisions, mediaAssets, type ContentItem } from "../../shared/schema";
import { CARD_PAGE_ARTWORK_KIND, normalizeCardPageArtwork } from "./cardPageArtwork";
import { assertGenerationActive } from "./generationContext";
import { sha256 } from "./text";
import { HttpError } from "../routes/util";

const sourceIdentity = (payload: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "cardCopy").sort(([a], [b]) => a.localeCompare(b))));

/** Promote only this item's original illustration, never a flattened finished
 * card. The v1 asset remains immutable; v2 receives a scoped page-art copy. */
export async function reuseLegacyFamilyCover(db: DB, item: ContentItem, revision: { id: number; payload: Record<string, unknown> }): Promise<number | null> {
  const candidates = await db.select({ id: mediaAssets.id, payload: contentRevisions.payload }).from(mediaAssets)
    .innerJoin(contentRevisions, eq(contentRevisions.id, mediaAssets.revisionId))
    .where(and(eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.channelId, item.channelId), eq(mediaAssets.kind, "cover_art"))).orderBy(desc(mediaAssets.id)).limit(30);
  const expected = sourceIdentity(revision.payload), match = candidates.find(candidate => sourceIdentity(candidate.payload) === expected);
  if (!match) return null;
  const [original] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, match.id), eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.channelId, item.channelId), eq(mediaAssets.kind, "cover_art")));
  if (!original || original.sha256 !== sha256(original.bytes)) throw new HttpError(409, "저장된 표지 원본이 달라졌습니다. 기존 원고와 이미지는 유지했습니다.");
  const normalized = await normalizeCardPageArtwork(original.bytes), hash = sha256(normalized.bytes);
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.channelId, item.channelId))).for("update");
    await assertGenerationActive(tx as unknown as DB);
    if (!locked || locked.version !== item.version || locked.currentRevisionId !== revision.id) throw new HttpError(409, "8장 제안 중 원고가 변경됐습니다. 기존 이미지와 최신 입력은 유지했습니다.");
    await tx.insert(mediaAssets).values({ channelId: item.channelId, contentItemId: item.id, revisionId: revision.id, kind: CARD_PAGE_ARTWORK_KIND, source: original.source, templateKey: original.templateKey, sha256: hash, ...normalized }).onConflictDoNothing({ target: [mediaAssets.revisionId, mediaAssets.sha256] });
    const [copy] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.revisionId, revision.id), eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.channelId, item.channelId), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND), eq(mediaAssets.sha256, hash)));
    if (!copy) throw new HttpError(409, "기존 표지를 8장 편집기에 연결하지 못했습니다. 원본은 그대로 보관했습니다.");
    return copy.id;
  });
}
