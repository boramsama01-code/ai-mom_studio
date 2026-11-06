import { randomUUID } from "node:crypto";
import { and, eq, lte, or, sql } from "drizzle-orm";
import { approvals, channels, contentItems, contentRevisions, deliveries, deliveryAttempts, deliveryAttemptEvents, destinations, studioCards, type Delivery } from "../../shared/schema";
import type { DB } from "../db";
import { env } from "../env";
import { getSetting } from "../seed";
import { publicationDestinationError } from "./publicationDestination";
import { lockDeliveryPublication, publicationEligibilityError, publicationMessage, recomputePublicationStatus } from "./publicationState";

export const PUBLICATION_LEASE_MS = 120_000;
const MAX_ATTEMPT_MS = 10 * 60_000;
const nextLease = () => new Date(Date.now() + PUBLICATION_LEASE_MS);
export type AttemptResult = "succeeded" | "failed" | "unknown" | "dryRun" | "skipped";

/** Claims are serialized across web/cron processes; saved daily caps are obsolete. */
export async function claimPublicationDelivery(db: DB, deliveryId: number, actor: string, now: Date) {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const locked = await lockDeliveryPublication(dbtx, deliveryId);
    if (!locked) return null;
    const { delivery: d, approval: ap } = locked;
    if (d.status !== "scheduled" || d.needsReconciliation || ap.status !== "active" || ap.scheduledAt > now) return null;
    await tx.execute(sql`select pg_advisory_xact_lock(7193203, ${d.channelId})`);
    const attemptId = randomUUID(), leaseToken = randomUUID(), stamp = new Date();
    await tx.insert(deliveryAttempts).values({ id: attemptId, deliveryId: d.id, attemptNo: d.attempts + 1, actor });
    const [claimed] = await tx.update(deliveries).set({ status: "processing", phase: d.externalContainerId ? "container_wait" : "preparing", attempts: d.attempts + 1, lastAttemptId: attemptId,
      leaseToken, leaseOwner: actor, leaseExpiresAt: nextLease(), dispatchStartedAt: null, requestStartedAt: now, completedAt: null, updatedAt: stamp })
      .where(and(eq(deliveries.id, d.id), eq(deliveries.status, "scheduled"))).returning();
    if (!claimed) throw new Error("Publication claim changed while locked");
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId, event: "claimed", phase: claimed.phase, status: "processing", source: "worker", actor, externalContainerId: d.externalContainerId });
    await recomputePublicationStatus(dbtx, ap.id, stamp);
    return claimed;
  });
}

export async function withDeliveryLease(db: DB, d: Delivery, work: () => Promise<AttemptResult>): Promise<AttemptResult> {
  const deadline = Date.now() + MAX_ATTEMPT_MS;
  const heartbeat = setInterval(() => {
    if (Date.now() >= deadline) { clearInterval(heartbeat); return; }
    void db.update(deliveries).set({ leaseExpiresAt: nextLease() }).where(and(eq(deliveries.id, d.id), eq(deliveries.status, "processing"), eq(deliveries.leaseToken, d.leaseToken!), sql`${deliveries.leaseExpiresAt} > clock_timestamp()`))
      .catch(() => { /* The expired lease fences any subsequent dispatch; never extend locally. */ });
  }, 20_000);
  heartbeat.unref();
  try {
    return await work();
  } catch {
    const [current] = await db.select().from(deliveries).where(eq(deliveries.id, d.id));
    const uncertain = current?.phase === "dispatching" || !!current?.dispatchStartedAt;
    await finishDeliveryAttempt(db, d, { status: uncertain ? "unknown" : "failed", errorKind: uncertain ? "unknown" : "transient", lastError: uncertain ? "게시 요청 중 처리가 중단됐습니다. 실제 게시 여부를 확인하세요. 자동 재전송하지 않습니다." : "게시 준비 중 처리가 중단됐습니다. 저장된 작업을 유지했습니다. 실패 원인을 확인한 뒤 재전송하세요." });
    return uncertain ? "unknown" : "failed";
  } finally {
    clearInterval(heartbeat);
  }
}

/** Preserve the creation ID before polling. A stale preparation can never dispatch. */
export async function savePreparedContainer(db: DB, d: Delivery, containerId: string) {
  return db.transaction(async tx => {
    const locked = await lockDeliveryPublication(tx as unknown as DB, d.id);
    if (!locked) return false;
    const current = locked.delivery;
    const owns = current.status === "processing" && current.leaseToken === d.leaseToken && current.lastAttemptId === d.lastAttemptId && !!current.leaseExpiresAt && current.leaseExpiresAt > new Date();
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: owns ? "container_created" : "late_container_created", phase: "container_wait", status: owns ? "processing" : current.status, source: "provider", actor: d.leaseOwner ?? "publisher", externalContainerId: containerId });
    if (!owns) return false;
    await tx.update(deliveries).set({ externalContainerId: containerId, phase: "container_wait", leaseExpiresAt: nextLease(), updatedAt: new Date() }).where(eq(deliveries.id, d.id));
    d.externalContainerId = containerId; d.phase = "container_wait";
    return true;
  });
}

/** The commit of this transaction is the cancellation/dispatch boundary. No network under locks. */
export async function beginDeliveryDispatch(db: DB, d: Delivery) {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const locked = await lockDeliveryPublication(dbtx, d.id);
    if (!locked) return { ok: false as const, error: "전송 기록이 없습니다." };
    const { item, approval: ap, delivery: current } = locked;
    if (current.status !== "processing" || current.lastAttemptId !== d.lastAttemptId || current.leaseToken !== d.leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) return { ok: false as const, stale: true, error: "다른 작업자가 전송 상태를 확인 중입니다." };
    if (current.phase === "dispatching" || current.dispatchStartedAt) return { ok: false as const, stale: true, error: "이미 게시 요청을 시작한 시도입니다. 결과 확인이 필요합니다." };
    if (current.needsReconciliation) return { ok: false as const, uncertain: true, error: "이전 시도의 늦은 게시 응답이 도착했습니다. 발행함에서 실제 결과를 확인하세요." };
    const eligibility = publicationEligibilityError(item, ap);
    if (eligibility) return { ok: false as const, error: eligibility };
    if (await getSetting(dbtx, "global_stop", false) || !env.autoPublish || env.dryRun || env.canonicalRedirectUrl) return { ok: false as const, error: "전체 게시가 중지됐습니다. 현재 상태를 확인하고 다시 승인하세요." };
    const [channel] = await tx.select().from(channels).where(eq(channels.id, current.channelId)).for("share");
    const [destination] = await tx.select().from(destinations).where(eq(destinations.id, current.destinationId)).for("share");
    const targetError = publicationDestinationError(current.destinationSnapshot, destination, channel);
    if (targetError) return { ok: false as const, error: targetError };
    const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
    if (board?.trashedAt) return { ok: false as const, error: "휴지통에 있는 콘텐츠입니다. 게시를 중단했습니다." };
    if (board?.importedMeta?.studioPublication) {
      const [revision] = await tx.select().from(contentRevisions).where(eq(contentRevisions.id, ap.revisionId));
      if (revision?.payload.studioVersion !== board.version) return { ok: false as const, error: "제작보드가 수정됐습니다. 최신 내용을 다시 승인하세요." };
    }
    const stamp = new Date();
    await tx.update(deliveries).set({ phase: "dispatching", dispatchStartedAt: stamp, leaseExpiresAt: nextLease(), updatedAt: stamp }).where(eq(deliveries.id, d.id));
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "dispatch_started", phase: "dispatching", status: "processing", source: "worker", actor: d.leaseOwner ?? "publisher", externalContainerId: current.externalContainerId });
    d.phase = "dispatching"; d.dispatchStartedAt = stamp;
    return { ok: true as const };
  });
}

/** Commit evidence even after a lease was lost; only its owner may change current progress. */
export async function finishDeliveryAttempt(db: DB, d: Delivery, patch: Partial<Delivery>, source = patch.status === "succeeded" ? "provider" : "worker") {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const locked = await lockDeliveryPublication(dbtx, d.id);
    if (!locked) return false;
    const current = locked.delivery, stamp = new Date();
    const sameAttempt = current.lastAttemptId === d.lastAttemptId;
    const owner = sameAttempt && current.status === "processing" && current.leaseToken === d.leaseToken;
    const recoveredSuccess = sameAttempt && current.status === "unknown" && !current.externalId && patch.status === "succeeded" && !!patch.externalId;
    const note = publicationMessage(patch.lastError ?? "");
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: owner || recoveredSuccess ? "attempt_result" : "late_result", phase: d.phase, status: patch.status, source, actor: d.leaseOwner ?? "publisher",
      externalContainerId: d.externalContainerId, externalId: patch.externalId, externalUrl: patch.externalUrl, errorKind: patch.errorKind, note });
    if (owner || recoveredSuccess) {
      const conflictingSuccess = patch.status === "succeeded" && current.needsReconciliation;
      await tx.update(deliveries).set({ ...patch, lastError: patch.lastError == null ? patch.lastError : note, phase: patch.status === "unknown" ? "unknown" : "finished", leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
        completedAt: patch.completedAt ?? (patch.status === "unknown" ? null : stamp), ...(patch.status === "succeeded" ? { outcomeSource: "provider_verified", needsReconciliation: conflictingSuccess, errorKind: null } : {}),
        ...(current.needsReconciliation ? { status: "unknown", phase: "unknown", errorKind: "unknown", lastError: "여러 시도의 게시 응답이 도착했습니다. 모든 시도의 게시물 ID와 실제 계정을 대조하세요." } : {}), updatedAt: stamp }).where(eq(deliveries.id, d.id));
    } else if (patch.status === "succeeded" && patch.externalId && current.externalId !== patch.externalId) {
      // A retry may already exist. Do not replace its ID with an older post ID or
      // discard evidence: stop future dispatch and require explicit reconciliation.
      await tx.update(deliveries).set({ needsReconciliation: true, ...(current.status !== "processing" ? { status: "unknown", phase: "unknown" } : {}), errorKind: "unknown", lastError: "이전 시도의 게시 성공 응답이 늦게 도착했습니다. 전송 기록과 실제 게시물을 대조하세요.", updatedAt: stamp }).where(eq(deliveries.id, d.id));
    }
    await recomputePublicationStatus(dbtx, current.approvalId, stamp);
    return owner || recoveredSuccess;
  });
}

export async function parkContainerWait(db: DB, d: Delivery) {
  const now = new Date();
  await db.update(deliveries).set({ phase: "container_wait", lastError: "인스타그램 이미지 처리 중 — 다음 실행에서 이어서 확인", leaseToken: null, leaseOwner: null, leaseExpiresAt: new Date(now.getTime() + 30_000), updatedAt: now })
    .where(and(eq(deliveries.id, d.id), eq(deliveries.status, "processing"), eq(deliveries.leaseToken, d.leaseToken!)));
}

/** Unknown/legacy dispatches never become queued merely because a lease expired. */
export async function recoverPublicationAttempts(db: DB, opts: { now?: Date; approvalId?: number; deliveryId?: number; claimSafe: boolean; actor: string }) {
  const now = opts.now ?? new Date();
  const rows = await db.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.status, "processing"), or(lte(deliveries.leaseExpiresAt, now), sql`${deliveries.leaseExpiresAt} is null`),
    opts.approvalId !== undefined ? eq(deliveries.approvalId, opts.approvalId) : undefined,
    opts.deliveryId !== undefined ? eq(deliveries.id, opts.deliveryId) : undefined)).orderBy(deliveries.id).limit(10);
  const resumed: Delivery[] = [];
  let unknown = 0;
  for (const row of rows) {
    const recovered = await db.transaction(async tx => {
      const dbtx = tx as unknown as DB;
      const locked = await lockDeliveryPublication(dbtx, row.id);
      if (!locked) return null;
      const { delivery: d, item, approval: ap } = locked;
      if (d.status !== "processing" || (d.leaseExpiresAt && d.leaseExpiresAt > now)) return null;
      const safe = !!d.lastAttemptId && ["preparing", "container_wait"].includes(d.phase ?? "") && !d.dispatchStartedAt && !d.needsReconciliation && !d.externalId;
      if (!safe) {
        const note = "서버 중단 전 게시 결과를 확인할 수 없습니다. 계정에서 실제 게시 여부를 확인하세요. 자동 재전송하지 않습니다.";
        await tx.update(deliveries).set({ status: "unknown", phase: "unknown", leaseToken: null, leaseOwner: null, leaseExpiresAt: null, errorKind: "unknown", lastError: note, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
        await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "lease_expired_unknown", phase: d.phase, status: "unknown", source: "recovery", actor: opts.actor, externalContainerId: d.externalContainerId, externalId: d.externalId, note });
        await recomputePublicationStatus(dbtx, ap.id);
        return "unknown" as const;
      }
      if (!opts.claimSafe) return null;
      const error = publicationEligibilityError(item, ap);
      if (error) {
        await tx.update(deliveries).set({ status: "cancelled", phase: "finished", leaseToken: null, leaseOwner: null, leaseExpiresAt: null, errorKind: "approval_required", lastError: error, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
        await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "recovery_cancelled", phase: "finished", status: "cancelled", source: "recovery", actor: opts.actor, note: error });
        await recomputePublicationStatus(dbtx, ap.id);
        return null;
      }
      const [claimed] = await tx.update(deliveries).set({ leaseToken: randomUUID(), leaseOwner: opts.actor, leaseExpiresAt: nextLease(), updatedAt: new Date() }).where(eq(deliveries.id, d.id)).returning();
      await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "lease_recovered", phase: d.phase, status: "processing", source: "recovery", actor: opts.actor, externalContainerId: d.externalContainerId });
      return claimed;
    });
    if (recovered === "unknown") unknown++;
    else if (recovered) resumed.push(recovered);
  }
  return { resumed, unknown };
}
