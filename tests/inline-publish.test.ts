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
  const db = {} as DB;
  vi.stubEnv("INLINE_WORKER", "false"); expect(kickInlinePublish(db)).toBe(false);
  vi.stubEnv("INLINE_WORKER", "true"); vi.stubEnv("DRY_RUN", "true"); expect(kickInlinePublish(db)).toBe(false);
  vi.stubEnv("DRY_RUN", "false"); vi.stubEnv("AUTO_PUBLISH", "false"); expect(kickInlinePublish(db)).toBe(false);
  vi.stubEnv("AUTO_PUBLISH", "true"); vi.stubEnv("APP_CANONICAL_REDIRECT_URL", "https://current.example"); expect(kickInlinePublish(db)).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});
it("starts after approval and checks the same persisted delivery queue every 30 seconds", async () => {
  const { kickInlinePublish, startInlinePublish } = await import("../server/worker/inlinePublish");
  const db = {} as DB;
  expect(kickInlinePublish(db)).toBe(true); expect(kickInlinePublish(db)).toBe(true);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledWith(db, { limit: 3, actor: "web-publisher" });
  await vi.runAllTicks();
  startInlinePublish(db);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(publish.mock.calls.length).toBeGreaterThanOrEqual(2);
});
