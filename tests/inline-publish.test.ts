import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DB } from "../server/db";
const publish = vi.hoisted(() => vi.fn());
vi.mock("../server/worker/publish", () => ({ publishDue: publish }));
beforeEach(() => {
  vi.resetModules(); publish.mockReset().mockResolvedValue({ processed: 0 });
  vi.useFakeTimers();
  for (const [key, value] of Object.entries({ INLINE_WORKER: "true", AUTO_PUBLISH: "true", DRY_RUN: "false", APP_CANONICAL_REDIRECT_URL: "" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
it("never starts publication when inline processing, live posting or the canonical server is unavailable", async () => {
  const { kickInlinePublish } = await import("../server/worker/inlinePublish");
  const db = {} as DB, target = { approvalId: 21 };
  vi.stubEnv("INLINE_WORKER", "false"); expect(kickInlinePublish(db, target)).toBe(false);
  vi.stubEnv("INLINE_WORKER", "true"); vi.stubEnv("DRY_RUN", "true"); expect(kickInlinePublish(db, target)).toBe(false);
  vi.stubEnv("DRY_RUN", "false"); vi.stubEnv("AUTO_PUBLISH", "false"); expect(kickInlinePublish(db, target)).toBe(false);
  vi.stubEnv("AUTO_PUBLISH", "true"); vi.stubEnv("APP_CANONICAL_REDIRECT_URL", "https://current.example"); expect(kickInlinePublish(db, target)).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});
it("a manual wake publishes only the named approval or failed destination", async () => {
  const { kickInlinePublish } = await import("../server/worker/inlinePublish");
  const db = {} as DB;
  expect(kickInlinePublish(db, { approvalId: 21 })).toBe(true);
  expect(publish).toHaveBeenCalledWith(db, { limit: 100, actor: "web-publisher", approvalId: 21 });
  await vi.advanceTimersByTimeAsync(0);
  expect(kickInlinePublish(db, { deliveryId: 44 })).toBe(true);
  expect(publish).toHaveBeenLastCalledWith(db, { limit: 3, actor: "web-publisher", deliveryId: 44 });
});
it("retains a new targeted wake while another publication is running", async () => {
  let finish!: () => void;
  publish.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const { kickInlinePublish } = await import("../server/worker/inlinePublish");
  const db = {} as DB;
  kickInlinePublish(db, { approvalId: 21 });
  kickInlinePublish(db, { deliveryId: 44 });
  kickInlinePublish(db, { deliveryId: 44 });
  expect(publish).toHaveBeenCalledTimes(1);
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith(db, { limit: 3, actor: "web-publisher", deliveryId: 44 });
});
it("only the periodic scheduler scans the complete approved queue", async () => {
  const { startInlinePublish } = await import("../server/worker/inlinePublish");
  const db = {} as DB;
  startInlinePublish(db);
  expect(publish).toHaveBeenCalledWith(db, { limit: 3, actor: "web-publisher" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(publish).toHaveBeenCalledTimes(2);
});
