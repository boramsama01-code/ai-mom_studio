import type { DB } from "../db";
import { env } from "../env";
import { publishDue } from "./publish";

let running: Promise<unknown> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Uses the same atomic delivery claims as the scheduled worker. */
export function kickInlinePublish(db: DB) {
  if (!env.inlineWorker || !env.autoPublish || env.dryRun || env.canonicalRedirectUrl) return false;
  if (running) return true;
  running = publishDue(db, { limit: 3, actor: "web-publisher" }).catch(() => {
    // Provider messages may contain credentials; delivery errors are sanitized by adapters.
    console.error("인스타 발행 처리 중 오류가 발생했습니다. 발행함을 확인하세요.");
  }).finally(() => { running = null; });
  return true;
}
export function startInlinePublish(db: DB) {
  if (timer || !env.inlineWorker || env.canonicalRedirectUrl) return;
  kickInlinePublish(db);
  timer = setInterval(() => kickInlinePublish(db), 30_000);
  timer.unref();
}
