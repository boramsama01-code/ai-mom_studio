import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { approvals, contentItems, deliveries, studioCards } from "../../shared/schema";
import { HttpError } from "../routes/util";

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
  const active = await db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.contentItemId, card.sourceItemId), eq(approvals.status, "active")));
  if (!active.length) return;
  const ids = active.map(a => a.id);
  const [processing] = await db.select({ id: deliveries.id }).from(deliveries).where(and(inArray(deliveries.approvalId, ids), inArray(deliveries.status, ["processing", "unknown"]))).limit(1);
  if (processing) throw new HttpError(409, "발행 중이거나 결과 확인이 필요한 게시물입니다. 발행함에서 결과를 확인한 뒤 수정하세요.");
  await db.update(approvals).set({ status: "invalidated", invalidatedReason: "제작보드 수정 — 재승인 필요", updatedAt: new Date() }).where(inArray(approvals.id, ids));
  await db.update(deliveries).set({ status: "cancelled", lastError: "제작보드 수정 — 재승인 필요", updatedAt: new Date() }).where(and(inArray(deliveries.approvalId, ids), eq(deliveries.status, "scheduled")));
  await db.update(contentItems).set({ reviewStatus: "review_required", publishStatus: "waiting", updatedAt: new Date() }).where(eq(contentItems.id, card.sourceItemId));
}
