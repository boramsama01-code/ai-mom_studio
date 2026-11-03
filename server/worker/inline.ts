/**
 * 웹 서버 안에서 수집 요청을 바로 처리 ("지금 수집" 버튼)
 * - GitHub Actions 워커를 기다리지 않는다. 같은 DB 대기열과 lease를 쓰므로 워커와 겹쳐 처리되지 않는다.
 * - 한 프로세스에서 한 번에 하나의 처리 루프만 돈다.
 */
import crypto from "node:crypto";
import type { DB } from "../db";
import { claimJob, failJob, recoverExpired } from "./queue";
import { processCollectJob, stopActiveCollections } from "./run";
import { env } from "../env";

let running: Promise<void> | null = null;
let stopping = false;

export function kickInlineCollect(db: DB): boolean {
  if (!env.inlineWorker || stopping) return false;
  if (running) return true; // 이미 도는 루프가 새 작업도 집어 간다
  const workerId = `web-${crypto.randomBytes(4).toString("hex")}`;
  running = (async () => {
    try {
      await recoverExpired(db);
      for (let i = 0; i < 6 && !stopping; i++) {
        const job = await claimJob(db, workerId, ["collect"]);
        if (!job) break;
        try {
          await processCollectJob(db, job, workerId);
        } catch (e) {
          await failJob(db, job, workerId, (e as Error).message || "오류", false);
        }
      }
    } catch (e) {
      console.error("즉시 수집 처리 오류:", (e as Error).message);
    } finally {
      running = null;
    }
  })();
  return true;
}

/** 테스트용: 진행 중인 즉시 처리가 끝날 때까지 대기 */
export async function waitInlineIdle() {
  while (running) await running;
}

/** Stop taking new jobs before the web process releases its database pool. */
export async function stopInlineCollect() {
  stopping = true;
  stopActiveCollections();
  await waitInlineIdle();
}
