import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { approvals, contentItems, deliveries, studioCards } from "../../shared/schema";
import { HttpError } from "../routes/util";
import { revokePublicationEligibility } from "./publicationState";

/** Match the publisher's lock order: item first, then Studio card. */
export async function lockStudioPublication(db: DB, cardId: number) {
  const [initial] = await db.select().from(studioCards).where(eq(studioCards.id, cardId));
  if (!initial) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
  if (initial.sourceItemId) await db.select().from(contentItems).where(eq(contentItems.id, initial.sourceItemId)).for("update");
  const [card] = await db.select().from(studioCards).where(eq(studioCards.id, cardId)).for("update");
  // A prepare request may have linked an item while we waited. Retry, never invert locks.
  if (card.sourceItemId !== initial.sourceItemId) throw new HttpError(409, "발행 준비 상태가 변경됐습니다. 새로고침 후 다시 시도하세요.");
  return card;
}

/** Editing a Studio-authored post cancels its pending approval, never a sent post. */
export async function invalidateStudioPublication(db: DB, card: typeof studioCards.$inferSelect) {
  if (!card.sourceItemId || !card.importedMeta?.studioPublication) return;
  const prior = await db.select({ status: deliveries.status, needsReconciliation: deliveries.needsReconciliation }).from(deliveries).innerJoin(approvals, eq(approvals.id, deliveries.approvalId))
    .where(eq(approvals.contentItemId, card.sourceItemId)).orderBy(deliveries.id).for("update", { of: deliveries });
  if (prior.some(row => ["processing", "unknown"].includes(row.status) || row.needsReconciliation)) throw new HttpError(409, "발행 중이거나 결과 확인이 필요한 게시물입니다. 발행함에서 결과를 확인한 뒤 수정하세요.");
  await revokePublicationEligibility(db, card.sourceItemId, "제작보드 수정 — 재승인 필요");
  await db.update(contentItems).set({ reviewStatus: "review_required", publishStatus: "waiting", updatedAt: new Date() }).where(eq(contentItems.id, card.sourceItemId));
}
