import { and, eq, isNull, sql } from "drizzle-orm";
import { deliveries, deliveryAttemptEvents } from "../../shared/schema";
import type { DB } from "../db";
import { lockDeliveryPublication, recomputePublicationStatus } from "./publicationState";

/** Old adapters could stringify a missing post ID as "undefined". Such rows
 * are evidence gaps, never evidence that a second publish is safe. No API call.
 */
export async function repairLegacyPublicationResults(db: DB) {
  const candidates = await db.select({ id: deliveries.id }).from(deliveries).where(and(
    eq(deliveries.status, "succeeded"), isNull(deliveries.outcomeSource),
    sql`(${deliveries.externalId} in ('undefined', 'null', 'NaN', '') or (${deliveries.externalId} is null and ${deliveries.externalUrl} is null))`,
  )).orderBy(deliveries.id);
  let repaired = 0;
  for (const candidate of candidates) {
    await db.transaction(async tx => {
      const dbtx = tx as unknown as DB, locked = await lockDeliveryPublication(dbtx, candidate.id);
      if (!locked) return;
      const d = locked.delivery;
      if (d.status !== "succeeded" || d.outcomeSource || !(["undefined", "null", "NaN", ""].includes(d.externalId ?? "missing") || (!d.externalId && !d.externalUrl))) return;
      const note = "이전 완료 기록에 유효한 게시물 ID가 없습니다. 실제 계정에서 게시 여부를 확인하세요. 자동 재전송하지 않습니다.";
      await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "legacy_invalid_success", phase: "unknown", status: "unknown", source: "migration", actor: "system", externalId: d.externalId, externalUrl: d.externalUrl, note });
      await tx.update(deliveries).set({ status: "unknown", phase: "unknown", externalId: null, needsReconciliation: true, errorKind: "unknown", lastError: note, completedAt: null, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
      await recomputePublicationStatus(dbtx, d.approvalId);
      repaired++;
    });
  }
  return repaired;
}
