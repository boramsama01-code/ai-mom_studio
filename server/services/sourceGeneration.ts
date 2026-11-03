import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { channels, contentItems, jobs, studioCards, type Job } from "../../shared/schema";
import type { DB } from "../db";
import { audit } from "../audit";
import { HttpError } from "../routes/util";
import { getSetting } from "../seed";
import { recoverExpired } from "../worker/queue";
import { withGenerationContext } from "./generationContext";
import { sha256 } from "./text";

const SOURCE_TYPES = ["source_generate", "card_copy_generate"];
const GENERATION_TYPES = [...SOURCE_TYPES, "studio_generate"];
const active = new Map<number, AbortController>();
const REQUEST_LIMIT_MS = 180_000;
let stopping = false;

function stopped(job: Job): never {
  throw new HttpError(job.status === "running" || job.status === "queued" ? 409 : 422,
    job.status === "running" || job.status === "queued" ? "같은 AI 요청을 처리 중입니다. 결과를 기다리거나 실행 중인 요청을 취소하세요. 새 요청은 보내지 않았습니다."
      : job.lastError || "이 AI 요청은 종료됐습니다. 저장된 작업을 확인한 뒤 새 요청으로 다시 시작하세요.",
    { jobId: job.id, jobStatus: job.status, replayed: true });
}

/** One paid logical request, recorded before network I/O; completed IDs are never run twice. */
export async function runSourceGeneration<T extends Record<string, unknown>>(
  db: DB,
  input: { type: "source_generate" | "card_copy_generate"; channelId: number; itemId: number; version: number; requestId?: string; intent: Record<string, unknown>; actor: string },
  work: () => Promise<T>,
): Promise<T & { jobId: number }> {
  const requestId = input.requestId ?? randomUUID();
  const requestHash = sha256(JSON.stringify({ type: input.type, itemId: input.itemId, version: input.version, intent: input.intent }));
  const dedupeKey = `source-ai:${input.itemId}:${requestId}`;
  await recoverExpired(db);
  const admitted = await db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, input.itemId), eq(contentItems.channelId, input.channelId))).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    const [prior] = await tx.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).orderBy(jobs.id).limit(1);
    if (prior) {
      if (prior.status === "cancelled" && prior.payload.cancelledBeforeStart === true) return { job: prior, replay: true };
      if (prior.payload.requestHash !== requestHash) throw new HttpError(409, "같은 요청 ID에 다른 AI 입력을 사용할 수 없습니다. 최신 내용에서 새 요청을 만들어 주세요.", { requestRejected: true, jobStatus: "failed" });
      return { job: prior, replay: true };
    }
    if (stopping || await getSetting(tx as unknown as DB, "global_stop", false)) throw new HttpError(409, "전체 작업이 정지돼 AI를 호출하지 않았습니다. 직접 편집과 저장은 계속할 수 있습니다.", { requestRejected: true, jobStatus: "failed" });
    const [channel] = await tx.select().from(channels).where(eq(channels.id, input.channelId));
    if (!channel?.active) throw new HttpError(409, "보관된 채널입니다. 채널을 복원한 뒤 AI를 요청하세요.", { requestRejected: true, jobStatus: "failed" });
    if (item.version !== input.version) throw new HttpError(409, "AI 요청 전에 원고가 변경됐습니다. 최신 원고를 확인하세요.", { requestRejected: true, jobStatus: "failed" });
    const [busy] = await tx.select().from(jobs).where(and(inArray(jobs.type, SOURCE_TYPES), inArray(jobs.status, ["queued", "running"]), sql`${jobs.payload}->>'itemId' = ${String(item.id)}`)).limit(1);
    if (busy) throw new HttpError(409, "다른 AI 요청이 이 콘텐츠를 처리 중이어서 새 요청을 시작하지 않았습니다. 실행 기록에서 기존 결과를 확인하세요.", { requestRejected: true, jobStatus: "failed", activeJobId: busy.id });
    const now = new Date();
    const [job] = await tx.insert(jobs).values({ type: input.type, channelId: input.channelId, dedupeKey, requestedBy: input.actor,
      payload: { itemId: item.id, version: input.version, requestId, requestHash, ...input.intent }, status: "running", attempts: 1, maxAttempts: 1,
      startedAt: now, heartbeatAt: now, leaseOwner: `source-ai:${randomUUID()}`, leaseExpiresAt: new Date(now.getTime() + REQUEST_LIMIT_MS + 30_000),
    }).returning();
    await audit(tx, { actor: input.actor, action: "start_generation", entity: "job", entityId: job.id, channelId: input.channelId, detail: { itemId: item.id, requestId, type: input.type } });
    return { job, replay: false };
  });
  const job = admitted.job;
  if (admitted.replay) {
    if (job.status === "succeeded" && job.result?.response) return { ...job.result.response as T, jobId: job.id };
    stopped(job);
  }
  const controller = new AbortController();
  active.set(job.id, controller);
  const deadline = setTimeout(() => controller.abort(new Error("AI 요청 제한 시간 초과")), REQUEST_LIMIT_MS);
  deadline.unref();
  let polling = false;
  const heartbeat = setInterval(() => {
    if (controller.signal.aborted) { clearInterval(heartbeat); return; }
    if (polling) return;
    polling = true;
    void (async () => {
      const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      if (controller.signal.aborted || !current || current.status !== "running" || current.leaseOwner !== job.leaseOwner || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date() || await getSetting(db, "global_stop", false)) {
        controller.abort(new Error("AI 작업 취소")); return;
      }
      await db.update(jobs).set({ heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000) }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, job.leaseOwner!), sql`${jobs.leaseExpiresAt} > clock_timestamp()`));
    })().catch(() => controller.abort(new Error("AI 작업 상태 확인 실패"))).finally(() => { polling = false; });
  }, 2_000);
  heartbeat.unref();
  const stopHeartbeat = () => clearInterval(heartbeat);
  controller.signal.addEventListener("abort", stopHeartbeat, { once: true });
  const assertLease = async (dbtx: DB) => {
    const [current] = await dbtx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
    if (!current || current.status !== "running" || current.leaseOwner !== job.leaseOwner || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date() || controller.signal.aborted || await getSetting(dbtx, "global_stop", false))
      throw new HttpError(409, "AI 요청이 취소되거나 실행 권한이 만료돼 결과를 적용하지 않았습니다.", { jobId: job.id, jobStatus: current?.status ?? "cancelled" });
  };
  const assertActive = async (dbtx: DB) => {
    await assertLease(dbtx);
    const [item] = await dbtx.select({ version: contentItems.version }).from(contentItems).where(eq(contentItems.id, input.itemId));
    if (!item || item.version !== input.version) throw new HttpError(409, "AI 요청 이후 원고가 수정돼 결과를 적용하지 않았습니다. 직접 작성한 최신 내용은 유지했습니다.", { jobId: job.id, jobStatus: "failed" });
  };
  const complete = async (dbtx: DB, response: Record<string, unknown>) => {
    await assertLease(dbtx);
    await dbtx.update(jobs).set({ status: "succeeded", result: { response }, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, job.leaseOwner!)));
  };
  try {
    const response = await withGenerationContext({ signal: controller.signal, assertActive, complete }, work);
    return await db.transaction(async tx => {
      await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, input.itemId)).for("update");
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
      if (current.status === "succeeded" && current.result?.response) return { ...current.result.response as T, jobId: job.id };
      await assertActive(tx as unknown as DB);
      await complete(tx as unknown as DB, response);
      return { ...response, jobId: job.id };
    });
  } catch (error) {
    const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    // The content and replay response may already be committed even if the HTTP
    // connection disappeared. Never convert that success into a retryable failure.
    if (current?.status === "succeeded" && current.result?.response) return { ...current.result.response as T, jobId: job.id };
    const cancelled = current?.status === "cancelled";
    const message = cancelled ? "AI 요청을 취소했습니다. 기존 입력과 저장본은 유지했습니다. 이미 시작된 외부 요청의 과금 취소는 보장되지 않습니다."
      : error instanceof HttpError ? error.message
      : controller.signal.aborted ? "AI 처리를 중단했습니다. 응답을 확인하지 못한 요청은 자동 재실행하지 않습니다. 기존 작업을 확인하거나 직접 편집하세요."
      : "AI 처리 또는 결과 저장에 실패했습니다. 자동 재실행하지 않았습니다. 기존 작업을 확인하거나 직접 편집하세요.";
    await db.update(jobs).set({ status: "failed", lastError: message, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, job.leaseOwner!)));
    throw new HttpError(error instanceof HttpError ? error.status : 422, message, { jobId: job.id, jobStatus: cancelled ? "cancelled" : "failed" });
  } finally {
    clearTimeout(deadline); clearInterval(heartbeat); controller.signal.removeEventListener("abort", stopHeartbeat); active.delete(job.id);
  }
}

/** Cancel is a persisted decision. A result already committed cannot be called cancelled. */
export async function cancelGeneration(db: DB, jobId: number, actor: string) {
  const result = await db.transaction(async tx => {
    const [initial] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (!initial) throw new HttpError(404, "작업을 찾을 수 없습니다.");
    if (SOURCE_TYPES.includes(initial.type)) await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, Number(initial.payload.itemId))).for("update");
    if (initial.type === "studio_generate") {
      const [card] = await tx.select().from(studioCards).where(eq(studioCards.id, Number(initial.payload.cardId)));
      if (card?.sourceItemId) await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, card.sourceItemId)).for("update");
      if (card) await tx.select({ id: studioCards.id }).from(studioCards).where(eq(studioCards.id, card.id)).for("update");
    }
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (job.status === "cancelled") return { job, cancelled: true };
    if (!["queued", "running"].includes(job.status)) return { job, cancelled: false };
    if (job.status === "running" && !GENERATION_TYPES.includes(job.type)) throw new HttpError(409, "이 작업은 이미 처리를 시작했습니다. 실행 기록에서 결과를 확인하세요.");
    const [saved] = await tx.update(jobs).set({ status: "cancelled", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: "운영자가 요청을 취소했습니다. 기존 작업은 유지합니다." }).where(eq(jobs.id, job.id)).returning();
    await audit(tx, { actor, action: "cancel", entity: "job", entityId: job.id, channelId: job.channelId });
    return { job: saved, cancelled: true };
  });
  if (result.cancelled) active.get(jobId)?.abort(new Error("운영자 취소"));
  return result;
}

export async function stopActiveGenerations(db: DB, actor: string) {
  const pending = await db.select({ id: jobs.id }).from(jobs).where(and(inArray(jobs.type, GENERATION_TYPES), inArray(jobs.status, ["queued", "running"]))).orderBy(jobs.id);
  let cancelled = 0;
  for (const job of pending) if ((await cancelGeneration(db, job.id, actor)).cancelled) cancelled++;
  return cancelled;
}

export async function cancelSourceGenerationRequest(db: DB, itemId: number, requestId: string, actor: string) {
  const jobId = await db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId)).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    const dedupeKey = `source-ai:${itemId}:${requestId}`;
    const [existing] = await tx.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey)).limit(1);
    if (existing) return existing.id;
    // Cancellation can arrive before the original POST has acquired its item lock.
    // Keep a tombstone so that delayed admission cannot spend an AI call afterwards.
    const [cancelled] = await tx.insert(jobs).values({ type: "source_generate", channelId: item.channelId, dedupeKey, requestedBy: actor,
      payload: { itemId, requestId, cancelledBeforeStart: true }, status: "cancelled", maxAttempts: 1, finishedAt: new Date(), lastError: "AI 실행 전에 요청을 취소했습니다.",
    }).returning();
    await audit(tx, { actor, action: "cancel_generation_before_start", entity: "job", entityId: cancelled.id, channelId: item.channelId });
    return cancelled.id;
  });
  return cancelGeneration(db, jobId, actor);
}

export function stopSourceGeneration() {
  stopping = true;
  for (const controller of active.values()) controller.abort(new Error("서버 종료"));
}
