/**
 * 워커 진입점 — 한 번 실행 후 종료.
 * DB 연결 실패는 비정상 종료(exit 1), 항목별 실패는 기록·집계한다.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { channels, searchRules, workerRuns, type Job } from "../../shared/schema";
import { claimJob, completeJob, failJob, heartbeat, newWorkerId, recoverExpired } from "./queue";
import { runCollect } from "./collect";
import { publishDue } from "./publish";
import { env } from "../env";
import { loadStoredSecrets } from "../secretStore";
import { getSetting } from "../seed";
import { channelDiscovery } from "./discovery";
import { processStudioJob } from "./studio";

async function startRun(db: DB, workerId: string, command: string) {
  const [r] = await db.insert(workerRuns).values({ workerId, command }).returning();
  return r.id;
}
async function endRun(db: DB, id: number, status: string, processed: number, failed: number, note: string) {
  await db.update(workerRuns).set({ status, processed, failed, note: note.slice(0, 2000), finishedAt: new Date() }).where(eq(workerRuns.id, id));
}

/** 연결 확인만 수행. 자료 수집·대기 작업·AI·알림·게시 API를 호출하지 않는다. */
export async function checkWorkerConnection() {
  const db = getDb();
  await db.execute(sql`select 1`);
  const secrets = await loadStoredSecrets(db);
  if (secrets.unreadable.length) throw new Error("저장된 연결 키 복호화 실패 — Render와 GitHub의 암호키를 확인하세요.");
  if (!env.naverClientId || !env.naverClientSecret) throw new Error("수집용 네이버 키 미설정");
  const runId = await startRun(db, newWorkerId(), "connection:check");
  await endRun(db, runId, "ok", 0, 0, "DB·저장된 연결 키 읽기 확인. 수집·AI·알림·게시 실행 없음.");
  return { connected: true, storedKeysLoaded: secrets.loaded, runId, collected: 0, published: 0 };
}

/** 수집 작업 1건 처리 — 성공 여부 반환(GitHub 워커와 웹 서버 즉시 실행이 함께 씀) */
export async function processCollectJob(db: DB, job: Job, workerId: string): Promise<boolean> {
  if (!job.channelId) throw new Error("채널 없는 수집 작업");
  const r = await runCollect(db, job.channelId, { trigger: "worker", heartbeat: () => heartbeat(db, job.id, workerId) });
  if (r.status === "failed") {
    // 키 미연결·인증 오류 등은 재시도해도 같으므로 재시도하지 않음
    await failJob(db, job, workerId, `수집 실행 #${r.runId} 실패: ${r.errors[0]?.message ?? "원인 미상"}`, false);
    return false;
  }
  await completeJob(db, job.id, workerId, { runId: r.runId, status: r.status, counts: r.counts });
  return true;
}

/** 예약 실행에서 자동 수집을 할지 — 화면 스위치(auto_collect) 또는 환경변수 AUTO_COLLECT */
export async function autoCollectEnabled(db: DB): Promise<boolean> {
  return env.autoCollect || (await getSetting(db, "auto_collect", false)) === true;
}

/** DB 대기열의 작업 처리 (수집 요청 등) */
export async function jobsOnce(opts: { maxMs?: number; types?: string[] } = {}) {
  const db = getDb();
  await db.execute(sql`select 1`); // 연결 확인 — 실패 시 예외로 비정상 종료
  await loadStoredSecrets(db);
  const workerId = newWorkerId();
  const runId = await startRun(db, workerId, "jobs:once");
  const recovered = await recoverExpired(db);
  const deadline = Date.now() + (opts.maxMs ?? 8 * 60_000);
  let processed = 0, failed = 0;
  const notes: string[] = recovered ? [`lease 만료 복구 ${recovered}건`] : [];
  while (Date.now() < deadline) {
    const job = await claimJob(db, workerId, opts.types ?? ["collect", "publish", "studio_generate"]);
    if (!job) break;
    processed++;
    try {
      if (job.type === "collect") {
        if (!(await processCollectJob(db, job, workerId))) failed++;
      } else if (job.type === "studio_generate") {
        if (!(await processStudioJob(db, job, workerId))) failed++;
      } else if (job.type === "publish") {
        const s = await publishDue(db, {});
        await completeJob(db, job.id, workerId, s as unknown as Record<string, unknown>);
      } else {
        await failJob(db, job, workerId, `알 수 없는 작업 유형: ${job.type}`, false);
        failed++;
      }
    } catch (e) {
      failed++;
      const msg = (e as Error).message || "오류";
      await failJob(db, job, workerId, msg, !/전역 정지|채널 없음/.test(msg));
      notes.push(`job ${job.id}: ${msg}`);
    }
  }
  await endRun(db, runId, failed ? (processed > failed ? "partial" : "failed") : "ok", processed, failed, notes.join("\n"));
  return { processed, failed, recovered, notes };
}

/** 활성 채널 수집을 바로 실행(Actions collect.yml) */
export async function collectOnce(opts: { channelSlug?: string; isSchedule?: boolean } = {}) {
  const db = getDb();
  await db.execute(sql`select 1`);
  await loadStoredSecrets(db);
  if (opts.isSchedule && !(await autoCollectEnabled(db))) return { skipped: "자동 수집 꺼짐(화면의 '자동 수집' 스위치 또는 AUTO_COLLECT) — 예약 실행에서는 수집하지 않음", results: [] };
  const workerId = newWorkerId();
  const runId = await startRun(db, workerId, "collect:once");
  const chs = await db.select().from(channels).where(eq(channels.active, true));
  const results: Array<{ slug: string; status: string; counts?: Record<string, number>; error?: string }> = [];
  for (const ch of chs) {
    if (opts.channelSlug && ch.slug !== opts.channelSlug) continue;
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(searchRules)
      .where(and(eq(searchRules.channelId, ch.id), eq(searchRules.enabled, true), isNull(searchRules.deletedAt)))) as Array<{ n: number }>;
    const [{ b }] = (await db.execute(sql`select count(*)::int as b from official_sources where channel_id = ${ch.id} and enabled and adapter is not null and verified_at is not null`)).rows as Array<{ b: number }>;
    // 활성 검색어·연결된 공식 게시판·자동 화제 발굴이 모두 없는 채널은 호출하지 않음
    if (!n && !b && !channelDiscovery(ch)) continue;
    try {
      const r = await runCollect(db, ch.id, { trigger: opts.isSchedule ? "schedule" : "cli" });
      results.push({ slug: ch.slug, status: r.status, counts: r.counts });
    } catch (e) {
      results.push({ slug: ch.slug, status: "failed", error: (e as Error).message });
    }
  }
  const failed = results.filter((r) => r.status === "failed").length;
  await endRun(db, runId, failed ? (failed === results.length ? "failed" : "partial") : "ok", results.length, failed, JSON.stringify(results));
  return { results };
}

export async function publishOnce() {
  const db = getDb();
  await db.execute(sql`select 1`);
  await loadStoredSecrets(db);
  const workerId = newWorkerId();
  const runId = await startRun(db, workerId, "publish:once");
  const s = await publishDue(db, {});
  await endRun(db, runId, s.failed || s.unknown ? "partial" : "ok", s.processed, s.failed, [...s.notes, JSON.stringify(s)].join("\n"));
  return s;
}

