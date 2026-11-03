import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { publisherHeartbeats } from "../../shared/schema";
import type { DB } from "../db";

const processWorkerId = `publisher:${process.pid}:${randomUUID()}`;
const HEARTBEAT_MS = 15_000;
export const PUBLISHER_STALE_MS = 90_000;

export async function withPublisherHeartbeat<T>(db: DB, actor: string, work: () => Promise<T>): Promise<T> {
  const workerId = `${processWorkerId}:${actor}`;
  const now = new Date();
  await db.insert(publisherHeartbeats).values({ workerId, mode: actor === "web-publisher" ? "inline" : "once", status: "running", heartbeatAt: now })
    .onConflictDoUpdate({ target: publisherHeartbeats.workerId, set: { status: "running", heartbeatAt: now, lastError: null } });
  const timer = setInterval(() => {
    void db.update(publisherHeartbeats).set({ heartbeatAt: new Date() }).where(eq(publisherHeartbeats.workerId, workerId)).catch(() => {
      // No raw database/provider error or connection URL is logged.
      console.error("게시 워커 heartbeat를 저장하지 못했습니다.");
    });
  }, HEARTBEAT_MS);
  timer.unref();
  try {
    const result = await work();
    await db.update(publisherHeartbeats).set({ status: "idle", heartbeatAt: new Date(), lastSweepAt: new Date(), lastError: null }).where(eq(publisherHeartbeats.workerId, workerId));
    return result;
  } catch (error) {
    await db.update(publisherHeartbeats).set({ status: "failed", heartbeatAt: new Date(), lastError: "게시 작업 확인에 실패했습니다. 발행함의 전송 기록을 확인하세요." }).where(eq(publisherHeartbeats.workerId, workerId)).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(timer);
  }
}

export async function stopPublisherHeartbeat(db: DB, actor = "web-publisher") {
  await db.update(publisherHeartbeats).set({ status: "stopped", heartbeatAt: new Date() }).where(eq(publisherHeartbeats.workerId, `${processWorkerId}:${actor}`));
}

export async function getPublisherHealth(db: DB, now = new Date()) {
  const recent = await db.select().from(publisherHeartbeats).orderBy(desc(publisherHeartbeats.heartbeatAt)).limit(10);
  const healthy = recent.find(row => ["idle", "running"].includes(row.status) && now.getTime() - row.heartbeatAt.getTime() <= PUBLISHER_STALE_MS);
  const latest = healthy ?? recent[0];
  return {
    connected: !!healthy,
    status: healthy ? healthy.status : latest?.status === "failed" ? "failed" : "stale",
    mode: latest?.mode ?? null,
    lastSeenAt: latest?.heartbeatAt.toISOString() ?? null,
    lastSweepAt: latest?.lastSweepAt?.toISOString() ?? null,
    ageSeconds: latest ? Math.max(0, Math.floor((now.getTime() - latest.heartbeatAt.getTime()) / 1000)) : null,
    lastError: latest?.lastError ?? null,
    staleAfterSeconds: PUBLISHER_STALE_MS / 1000,
  };
}
