import { and, desc, eq } from "drizzle-orm";
import { channels, deliveries, deliveryAttemptEvents, destinations, type Delivery } from "../../shared/schema";
import type { DB } from "../db";
import { audit } from "../audit";
import { containerStatus, type InstagramAuthMode } from "./instagram";
import { resolveSecrets } from "./secrets";
import { lockDeliveryPublication, publicationEligibilityError, publicationMessage, recomputePublicationStatus } from "./publicationState";

function approvedPostUrl(raw: string | undefined, platform: string) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (platform === "instagram" && !(["instagram.com", "www.instagram.com"].includes(url.hostname) && /^\/(p|reel|tv)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname))) return null;
    if (platform === "telegram_channel" && !(url.hostname === "t.me" && /^\/(?:[a-zA-Z0-9_]+|c\/\d+)\/\d+\/?$/.test(url.pathname))) return null;
    if (!["instagram", "telegram_channel"].includes(platform)) return null;
    url.search = ""; url.hash = "";
    return url.toString();
  } catch { return null; }
}

/** Recording an observed post is never an instruction to send another request. */
export async function confirmDeliveryPosted(db: DB, deliveryId: number, actor: string, input: { externalId?: string; externalUrl?: string; note: string }) {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB, locked = await lockDeliveryPublication(dbtx, deliveryId);
    if (!locked) return { ok: false as const, error: "전송 기록이 없습니다." };
    const { delivery: d } = locked;
    if (d.status === "succeeded" && !d.needsReconciliation) return { ok: true as const, deliveryId: d.id, message: "이미 게시 완료로 기록돼 있습니다.", unchanged: true };
    if (d.status !== "unknown") return { ok: false as const, error: "결과 확인이 필요한 전송만 정리할 수 있습니다. 전송 중이면 결과를 기다려 주세요." };
    const [destination] = await tx.select().from(destinations).where(eq(destinations.id, d.destinationId));
    const platform = d.destinationSnapshot?.platform ?? destination?.platform ?? "";
    const externalUrl = approvedPostUrl(input.externalUrl?.trim(), platform);
    const externalId = input.externalId?.trim() || null;
    if (input.externalUrl && !externalUrl) return { ok: false as const, error: "해당 플랫폼의 실제 게시물 https 주소를 입력하세요." };
    if (externalId && !/^[1-9]\d*$/.test(externalId)) return { ok: false as const, error: "게시물 ID는 플랫폼에서 확인한 양의 정수 ID를 입력하세요." };
    if (!externalUrl && !externalId) return { ok: false as const, error: "확인한 게시물 주소 또는 게시물 ID를 입력하세요." };
    if (d.needsReconciliation && (!input.note.trim() || input.note === "운영자가 게시 계정에서 게시물을 확인했습니다." || input.note.trim().length < 10)) return { ok: false as const, error: "여러 시도가 겹쳤을 수 있습니다. 실제 계정의 중복 게시 여부와 유지할 게시물을 확인한 내용을 확인 메모에 적어 주세요." };
    const note = publicationMessage(input.note.trim() || "운영자가 게시 계정에서 게시물을 확인했습니다.");
    const now = new Date();
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "operator_confirmed_posted", phase: "finished", status: "succeeded", source: "operator", actor, externalContainerId: d.externalContainerId, externalId, externalUrl, note });
    await tx.update(deliveries).set({ status: "succeeded", phase: "finished", externalId: externalId ?? d.externalId, externalUrl: externalUrl ?? d.externalUrl, outcomeSource: "operator_confirmed", resolutionNote: note, needsReconciliation: false,
      leaseToken: null, leaseOwner: null, leaseExpiresAt: null, lastError: null, errorKind: null, completedAt: now, updatedAt: now }).where(eq(deliveries.id, d.id));
    await recomputePublicationStatus(dbtx, d.approvalId, now);
    await audit(tx, { actor, action: "confirm_delivery_posted", entity: "delivery", entityId: d.id, channelId: d.channelId, detail: { externalId, externalUrl, note, outcomeSource: "operator_confirmed" } });
    return { ok: true as const, deliveryId: d.id, outcomeSource: "operator_confirmed", message: "운영자가 실제 게시물을 확인한 기록을 저장했습니다. 새 게시 요청은 보내지 않았습니다." };
  });
}

/** An obsolete approval's unknown outcome can be resolved without re-approving/sending it. */
export async function confirmDeliveryNotPosted(db: DB, deliveryId: number, actor: string, inputNote = "") {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB, locked = await lockDeliveryPublication(dbtx, deliveryId);
    if (!locked) return { ok: false as const, error: "전송 기록이 없습니다." };
    const { delivery: d, approval, item } = locked;
    if (d.outcomeSource === "operator_not_posted" && ["failed", "cancelled"].includes(d.status)) return { ok: true as const, deliveryId: d.id, retryAllowed: d.status === "failed", message: "이미 미게시 확인을 기록했습니다.", unchanged: true };
    if (d.status !== "unknown") return { ok: false as const, error: "결과 확인이 필요한 전송만 정리할 수 있습니다." };
    const proof = await tx.select({ id: deliveryAttemptEvents.id }).from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, d.id), eq(deliveryAttemptEvents.source, "provider"), eq(deliveryAttemptEvents.status, "succeeded"))).limit(1);
    if (d.externalId || proof.length) return { ok: false as const, error: "외부 게시 성공 기록이 있습니다. 게시 결과를 다시 확인하고 실제 게시물 주소로 정리하세요. 미게시로 바꾸어 재전송할 수 없습니다." };
    const retryAllowed = !publicationEligibilityError(item, approval) && !!d.destinationSnapshot;
    const status = retryAllowed ? "failed" : "cancelled", note = publicationMessage(inputNote.trim() || "운영자가 게시 계정에서 이 콘텐츠가 게시되지 않았음을 확인했습니다.");
    const now = new Date();
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: "operator_confirmed_not_posted", phase: "finished", status, source: "operator", actor, externalContainerId: d.externalContainerId, note });
    await tx.update(deliveries).set({ status, phase: "finished", outcomeSource: "operator_not_posted", resolutionNote: note, needsReconciliation: false, errorKind: retryAllowed ? "not_posted" : "approval_required",
      lastError: retryAllowed ? "운영자가 미게시를 확인했습니다. 필요하면 이 목적지만 재전송하세요." : "미게시 확인 완료. 이전 승인은 전송하지 않습니다. 최신 내용을 다시 승인하세요.",
      leaseToken: null, leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now }).where(eq(deliveries.id, d.id));
    await recomputePublicationStatus(dbtx, d.approvalId, now);
    await audit(tx, { actor, action: "confirm_delivery_not_posted", entity: "delivery", entityId: d.id, channelId: d.channelId, detail: { note, retryAllowed } });
    return { ok: true as const, deliveryId: d.id, retryAllowed, message: retryAllowed ? "미게시 확인을 저장했습니다. 필요하면 재전송을 별도로 요청하세요." : "이전 전송을 미게시로 정리했습니다. 최신 원고를 승인할 수 있습니다." };
  });
}

async function recordReconciliation(db: DB, original: Delivery, actor: string, outcome: { message: string; externalId?: string; externalUrl?: string | null }) {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB, locked = await lockDeliveryPublication(dbtx, original.id);
    if (!locked) return { ok: false as const, error: "전송 기록이 없습니다." };
    const d = locked.delivery;
    if (d.status !== original.status || d.lastAttemptId !== original.lastAttemptId || d.updatedAt.getTime() !== original.updatedAt.getTime()) return { ok: false as const, error: "확인 중 전송 상태가 변경됐습니다. 최신 기록을 확인하세요." };
    const success = !!outcome.externalId, note = publicationMessage(outcome.message), now = new Date();
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: success ? "reconciled_from_attempt" : "provider_rechecked", phase: d.phase, status: success ? "succeeded" : d.status, source: success ? "provider" : "recovery", actor, externalContainerId: d.externalContainerId, externalId: outcome.externalId, externalUrl: outcome.externalUrl, note });
    if (success) {
      await tx.update(deliveries).set({ status: "succeeded", phase: "finished", externalId: outcome.externalId, externalUrl: outcome.externalUrl ?? d.externalUrl, outcomeSource: "provider_verified", needsReconciliation: false,
        resolutionNote: note, lastError: null, errorKind: null, completedAt: now, leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now }).where(eq(deliveries.id, d.id));
      await recomputePublicationStatus(dbtx, d.approvalId, now);
    } else {
      await tx.update(deliveries).set({ lastError: note, updatedAt: now }).where(eq(deliveries.id, d.id));
    }
    await audit(tx, { actor, action: "reconcile_delivery", entity: "delivery", entityId: d.id, channelId: d.channelId, detail: { resolved: success, message: note } });
    return { ok: true as const, deliveryId: d.id, resolved: success, message: outcome.message };
  });
}

/** Read-only provider lookup; never infers a post from matching captions or creates a new container. */
export async function reconcileDelivery(db: DB, deliveryId: number, actor: string) {
  const [d] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!d || d.status !== "unknown") return { ok: false as const, error: "결과 확인이 필요한 전송만 다시 확인할 수 있습니다." };
  const events = await db.select().from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, d.id), eq(deliveryAttemptEvents.source, "provider"), eq(deliveryAttemptEvents.status, "succeeded"))).orderBy(desc(deliveryAttemptEvents.id));
  const ids = new Set(events.map(event => event.externalId).filter((id): id is string => !!id));
  if (ids.size > 1) return recordReconciliation(db, d, actor, { message: "여러 시도에 서로 다른 게시물 ID가 있습니다. 실제 계정에서 중복 여부와 게시물 주소를 확인해 기록하세요." });
  if (ids.size === 1) {
    const event = events.find(event => !!event.externalId)!;
    if (d.dispatchStartedAt && d.lastAttemptId !== event.attemptId) return recordReconciliation(db, d, actor, { message: "이전 시도의 게시 성공은 확인했지만 이후 시도도 게시 요청을 시작했습니다. 현재 시도의 결과와 중복 여부를 실제 계정에서 확인한 뒤 게시물 주소와 메모를 기록하세요." });
    return recordReconciliation(db, d, actor, { message: "저장된 외부 성공 응답의 게시물 ID로 결과를 확인했습니다.", externalId: event.externalId!, externalUrl: event.externalUrl });
  }
  const [destination] = await db.select().from(destinations).where(eq(destinations.id, d.destinationId));
  const [channel] = await db.select().from(channels).where(eq(channels.id, d.channelId));
  const snapshot = d.destinationSnapshot;
  if (snapshot?.platform !== "instagram" || !d.externalContainerId || !destination || !channel) return recordReconciliation(db, d, actor, { message: "자동 대조에 필요한 게시물 ID 또는 원래 계정 정보가 없습니다. 실제 게시 계정에서 확인한 결과를 기록하세요." });
  const sec = resolveSecrets(destination.platform, channel.slug, destination.secretRefs);
  if (sec.missing.length || sec.invalid.length || sec.values.userId !== snapshot.accountId || (sec.values.authMode ?? "instagram") !== snapshot.authMode) return recordReconciliation(db, d, actor, { message: "승인 당시 인스타그램 계정의 연결을 확인할 수 없습니다. 원래 게시 계정에서 결과를 확인하세요." });
  const result = await containerStatus(d.externalContainerId, sec.values.accessToken, snapshot.authMode as InstagramAuthMode);
  const message = !result.ok ? "게시 API에서 결과를 확인하지 못했습니다. 실제 계정에서 게시 여부를 확인하거나 잠시 후 다시 조회하세요."
    : result.statusCode === "PUBLISHED" ? "인스타그램은 이 컨테이너가 게시됐다고 응답했습니다. 게시물 ID가 없어 완료로 확정하지 않았습니다. 실제 게시물 주소를 입력해 이미 게시됨으로 기록하세요."
    : `현재 컨테이너 상태는 ${["FINISHED", "IN_PROGRESS", "ERROR", "EXPIRED"].includes(result.statusCode) ? result.statusCode : "확인 불가"}입니다. 이것만으로 이전 게시 요청의 미게시를 단정할 수 없습니다. 실제 계정에서 확인한 결과를 기록하세요.`;
  return recordReconciliation(db, d, actor, { message });
}
