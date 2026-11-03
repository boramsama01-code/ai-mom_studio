/**
 * DB 기반 작업 큐. 워커는 "한 번 실행 후 종료"한다(서버 무한 루프·메모리 큐 없음).
 * - claim: FOR UPDATE SKIP LOCKED + lease(만료 시각)로 동시 처리 방지
 * - heartbeat: 긴 작업 중 lease 연장
 * - recover: lease가 만료된 running 작업을 대기열로 되돌리거나 실패 처리
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { jobs, type Job } from "../../shared/schema";

export const LEASE_MS = 5 * 60_000;

export function newWorkerId(): string {
  return `${process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}` : "cli"}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function enqueueJob(
  db: DB,
  j: { type: string; channelId?: number | null; payload?: Record<string, unknown>; dedupeKey?: string | null; requestedBy?: string; runAfter?: Date; maxAttempts?: number },
): Promise<{ job: Job; duplicate: boolean }> {
  const inserted = await db
    .insert(jobs)
    .values({
      type: j.type,
      channelId: j.channelId ?? null,
      payload: j.payload ?? {},
      dedupeKey: j.dedupeKey ?? null,
      requestedBy: j.requestedBy ?? null,
      runAfter: j.runAfter ?? new Date(),
      maxAttempts: j.maxAttempts ?? 3,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) return { job: inserted[0], duplicate: false };
  // 같은 dedupe 키의 대기/처리 중 작업이 이미 있음
  const existing = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.dedupeKey, j.dedupeKey!), sql`${jobs.status} in ('queued','running')`));
  return { job: existing[0], duplicate: true };
}

/** lease 만료 작업 복구 */
export async function recoverExpired(db: DB): Promise<number> {
  const r = await db.execute(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      last_error = coalesce(last_error, '') || case when attempts >= max_attempts then ' [lease 만료 — 재시도 한도 도달]' else ' [lease 만료 — 재대기]' end,
      lease_owner = null, lease_expires_at = null,
      finished_at = case when attempts >= max_attempts then now() else null end
    where status = 'running' and lease_expires_at < now()
  `);
  return r.rowCount ?? 0;
}

export async function claimJob(db: DB, workerId: string, types: string[]): Promise<Job | null> {
  const typeList = sql.join(types.map((t) => sql`${t}`), sql`, `);
  const r = await db.execute(sql`
    update jobs set status = 'running', lease_owner = ${workerId},
      lease_expires_at = now() + (${LEASE_MS} || ' milliseconds')::interval,
      heartbeat_at = now(), started_at = coalesce(started_at, now()), attempts = attempts + 1
    where id = (
      select id from jobs
      where status = 'queued' and run_after <= now() and type in (${typeList})
      order by run_after, id
      for update skip locked
      limit 1
    )
    returning *
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, Number(row.id)));
  return job;
}

export async function heartbeat(db: DB, jobId: number, workerId: string): Promise<boolean> {
  const r = await db.execute(sql`
    update jobs set heartbeat_at = now(), lease_expires_at = now() + (${LEASE_MS} || ' milliseconds')::interval
    where id = ${jobId} and lease_owner = ${workerId} and status = 'running' and lease_expires_at > clock_timestamp()
  `);
  return (r.rowCount ?? 0) > 0;
}

export async function completeJob(db: DB, jobId: number, workerId: string, result: Record<string, unknown>) {
  await db
    .update(jobs)
    .set({ status: "succeeded", result, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseOwner, workerId)));
}

export async function failJob(db: DB, job: Job, workerId: string, error: string, retryable: boolean) {
  const final = !retryable || job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(60_000 * 2 ** Math.max(job.attempts - 1, 0), 30 * 60_000);
  await db
    .update(jobs)
    .set({
      status: final ? "failed" : "queued",
      lastError: error.slice(0, 1000),
      runAfter: final ? job.runAfter : new Date(Date.now() + backoffMs),
      finishedAt: final ? new Date() : null,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, workerId)));
}
