import { and, desc, eq, inArray } from "drizzle-orm";
import { approvals, contentItems, deliveries, deliveryAttemptEvents, type Approval, type ContentItem } from "../../shared/schema";
import { audit } from "../audit";
import type { DB } from "../db";

/** Keep provider messages useful without persisting a credential echoed by an API. */
export function publicationMessage(message: string): string {
  let safe = String(message).replace(/https?:\/\/[^\s]+/gi, "[외부 주소]");
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key) && value && value.length >= 6) safe = safe.split(value).join("[비밀값]");
  }
  return safe.replace(/(?:access_token|api_key|authorization)\s*[:=]\s*[^\s,;]+/gi, "[비밀값]").slice(0, 1000);
}

export function publicationEligibilityError(item: Pick<ContentItem, "currentRevisionId" | "reviewStatus" | "relevance" | "excluded">, approval: Pick<Approval, "status" | "revisionId">): string | null {
  if (approval.status !== "active") return "승인이 더 이상 유효하지 않습니다. 최신 내용을 다시 승인하세요.";
  if (item.currentRevisionId !== approval.revisionId) return "승인 이후 콘텐츠가 수정됐습니다. 최신 내용을 다시 승인하세요.";
  if (item.excluded || item.relevance === "irrelevant") return "제외 또는 관련 없음으로 변경된 콘텐츠입니다. 게시를 중단했습니다.";
  if (item.reviewStatus !== "reviewed") return "검토 완료가 철회됐습니다. 내용을 검토한 뒤 다시 승인하세요.";
  return null;
}

export function aggregatePublicationStatus(rows: Array<{ status: string; needsReconciliation?: boolean }>): string {
  const states = rows.map(row => row.needsReconciliation ? "unknown" : row.status);
  if (!states.length) return "waiting";
  if (states.includes("unknown")) return "unknown";
  if (states.includes("processing")) return "processing";
  if (states.includes("scheduled") || states.includes("waiting")) return states.includes("succeeded") ? "partial" : "scheduled";
  if (states.every(state => state === "succeeded")) return "succeeded";
  if (states.includes("succeeded")) return "partial";
  if (states.includes("failed")) return "failed";
  if (states.every(state => state === "cancelled")) return "cancelled";
  if (states.includes("dry_run")) return "dry_run";
  return "waiting";
}

/** Caller holds the item lock. Old attempts may finish, but cannot overwrite a new draft/approval. */
export async function recomputePublicationStatus(db: DB, approvalId: number, now = new Date()) {
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!ap) return null;
  const rows = await db.select({ status: deliveries.status, needsReconciliation: deliveries.needsReconciliation }).from(deliveries).where(eq(deliveries.approvalId, approvalId));
  const status = aggregatePublicationStatus(rows);
  if (status === "succeeded") {
    await db.update(approvals).set({ status: "completed", updatedAt: now }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "active")));
  }
  const [latest] = await db.select({ id: approvals.id }).from(approvals).where(eq(approvals.contentItemId, ap.contentItemId)).orderBy(desc(approvals.id)).limit(1);
  if (latest?.id === approvalId) {
    await db.update(contentItems).set({ publishStatus: status, updatedAt: now, ...(rows.some(row => row.status === "succeeded") ? { lastUsedAt: now } : {}) })
      .where(and(eq(contentItems.id, ap.contentItemId), eq(contentItems.currentRevisionId, ap.revisionId)));
  }
  return status;
}

/**
 * All eligibility/revision mutations use this in the same transaction as their edit.
 * Lock order: item → deliveries (all revisions, ordered) → approvals.
 * A dispatched request cannot be recalled. Its evidence and unknown state survive revocation.
 */
export async function revokePublicationEligibility(db: DB, itemId: number, reason: string, actor = "system", now = new Date()) {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId)).for("update");
    if (!item) return { cancelled: 0, inFlight: 0, unknown: 0, revokedApprovals: 0 };
    const rows = await tx.select({ id: deliveries.id, approvalId: deliveries.approvalId, status: deliveries.status, lastAttemptId: deliveries.lastAttemptId }).from(deliveries)
      .innerJoin(approvals, eq(approvals.id, deliveries.approvalId)).where(eq(approvals.contentItemId, itemId)).orderBy(deliveries.id).for("update", { of: deliveries });
    const active = await tx.select().from(approvals).where(and(eq(approvals.contentItemId, itemId), eq(approvals.status, "active"))).orderBy(approvals.id).for("update");
    const note = publicationMessage(reason);
    if (active.length) await tx.update(approvals).set({ status: "invalidated", invalidatedReason: note, updatedAt: now }).where(inArray(approvals.id, active.map(row => row.id)));
    const queued = rows.filter(row => row.status === "scheduled" || row.status === "waiting");
    if (queued.length) {
      await tx.update(deliveries).set({ status: "cancelled", phase: "finished", lastError: note, errorKind: "approval_required", leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
        .where(inArray(deliveries.id, queued.map(row => row.id)));
      for (const row of queued) await tx.insert(deliveryAttemptEvents).values({ deliveryId: row.id, attemptId: row.lastAttemptId, event: "approval_revoked", phase: "finished", status: "cancelled", source: "operator", actor, note });
    }
    const result = { cancelled: queued.length, inFlight: rows.filter(row => row.status === "processing").length, unknown: rows.filter(row => row.status === "unknown").length, revokedApprovals: active.length };
    const last = [...rows].sort((a, b) => b.approvalId - a.approvalId)[0];
    if (last) await recomputePublicationStatus(dbtx, last.approvalId, now);
    if (active.length || queued.length) await audit(tx, { actor, action: "revoke_publication", entity: "content_item", entityId: itemId, channelId: item.channelId, detail: { reason: note, ...result } });
    return result;
  });
}

/** Shared transaction lock order for cancellation, recovery, results and operator reconciliation. */
export async function lockDeliveryPublication(db: DB, deliveryId: number) {
  const [initial] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!initial) return null;
  const [initialApproval] = await db.select().from(approvals).where(eq(approvals.id, initial.approvalId));
  if (!initialApproval) return null;
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, initialApproval.contentItemId)).for("update");
  const rows = await db.select().from(deliveries).where(eq(deliveries.approvalId, initial.approvalId)).orderBy(deliveries.id).for("update");
  const [approval] = await db.select().from(approvals).where(eq(approvals.id, initial.approvalId)).for("update");
  const delivery = rows.find(row => row.id === deliveryId);
  if (!item || !approval || !delivery) return null;
  return { item, approval, delivery, siblings: rows };
}
