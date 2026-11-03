import type { DB } from "../db";
import { env } from "../env";
import { publishDue, type PublishTarget } from "./publish";

let running: Promise<unknown> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const pending = new Map<string, { db: DB; target?: PublishTarget }>();

function enqueue(db: DB, target?: PublishTarget) {
  if (!env.inlineWorker || !env.autoPublish || env.dryRun || env.canonicalRedirectUrl) return false;
  const key = target?.deliveryId !== undefined ? `delivery:${target.deliveryId}` : target?.approvalId !== undefined ? `approval:${target.approvalId}` : "scheduled";
  pending.set(key, { db, target });
  drain();
  return true;
}

function drain() {
  if (running || !pending.size) return;
  if (!env.inlineWorker || !env.autoPublish || env.dryRun || env.canonicalRedirectUrl) { pending.clear(); return; }
  const [key, work] = pending.entries().next().value!;
  pending.delete(key);
  // A button press can only wake the approval/delivery it just changed. Only the
  // existing periodic scheduler is allowed to scan the entire approved queue.
  running = publishDue(work.db, { limit: work.target?.approvalId !== undefined ? 100 : 3, actor: "web-publisher", ...work.target }).catch(() => {
    // Provider messages may contain credentials; delivery errors are sanitized by adapters.
    console.error("인스타 발행 처리 중 오류가 발생했습니다. 발행함을 확인하세요.");
  }).finally(() => { running = null; drain(); });
}

/** Uses the same atomic delivery claims as the scheduled worker, scoped to one action. */
export function kickInlinePublish(db: DB, target: PublishTarget) {
  return enqueue(db, target);
}
export function startInlinePublish(db: DB) {
  if (timer || !env.inlineWorker || env.canonicalRedirectUrl) return;
  enqueue(db);
  timer = setInterval(() => enqueue(db), 30_000);
  timer.unref();
}
