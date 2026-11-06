import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { deliveryAttempts, deliveryAttemptEvents } from "../shared/schema";
const explicitTestDatabase = process.env.TEST_DATABASE_URL;
if (!explicitTestDatabase || !new URL(explicitTestDatabase).pathname.endsWith("_test")) {
  throw new Error("Process restart tests require an explicit TEST_DATABASE_URL with a _test database name");
}
setTestEnv();
const mocks = vi.hoisted(() => ({ identity: vi.fn(), quota: vi.fn(), create: vi.fn(), wait: vi.fn(), publish: vi.fn(), upload: vi.fn() }));
vi.mock("../server/services/instagram", () => ({
  accountIdentity: mocks.identity, publishingLimit: mocks.quota,
  createContainer: mocks.create, createCarouselContainer: mocks.create,
  waitForContainer: mocks.wait, publishContainer: mocks.publish,
  mediaPermalink: async () => "https://www.instagram.com/p/process-restart-fixture/",
}));
vi.mock("../server/services/cloudinary", () => ({ uploadCard: mocks.upload }));
const { publicationFixture, publicationAccounts } = await import("./fixtures/publication");
const { closeDb } = await import("../server/db");
const { publishDue, retryDelivery } = await import("../server/worker/publish");

beforeAll(resetDb);
afterAll(closeDb);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTO_PUBLISH", "true"); vi.stubEnv("DRY_RUN", "false"); vi.stubEnv("INLINE_WORKER", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Restart tests never contact a real provider"); }));
  mocks.identity.mockImplementation(async (token: string) => ({ ok: true, ...publicationAccounts.get(token) }));
  mocks.quota.mockResolvedValue({ ok: true, used: 0, total: 100 });
  mocks.create.mockResolvedValue({ ok: true, containerId: "restart-container" });
  mocks.wait.mockResolvedValue({ state: "FINISHED" });
  mocks.publish.mockResolvedValue({ ok: true, mediaId: "900401" });
  mocks.upload.mockResolvedValue({ url: "https://example.com/restart.jpg", publicId: "restart-fixture" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function killAtCheckpoint(deliveryId: number, phase: "preparing" | "dispatching") {
  const databaseUrl = process.env.APP_DATABASE_URL;
  if (!databaseUrl || process.env.APP_ENV !== "test") throw new Error("Missing isolated test database");
  const child = fork(fileURLToPath(new URL("./fixtures/publicationCrashWorker.ts", import.meta.url)), [String(deliveryId), phase], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, TEST_DATABASE_URL: databaseUrl, APP_DATABASE_URL: databaseUrl, PUBLICATION_CRASH_TEST: "1" },
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk).slice(0, 4000 - stderr.length); });
  try {
    const checkpoint = await new Promise<{ deliveryId: number; phase: string; attemptId: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Crash worker did not commit its checkpoint")), 15000);
      const finish = () => { clearTimeout(timer); child.off("error", onError); child.off("exit", onExit); };
      const onError = (error: Error) => { finish(); reject(error); };
      const onExit = (code: number | null) => { finish(); reject(new Error(`Crash worker exited early (${code}): ${stderr}`)); };
      child.once("error", onError); child.once("exit", onExit);
      child.once("message", message => { finish(); resolve(message as { deliveryId: number; phase: string; attemptId: string }); });
    });
    expect(checkpoint).toMatchObject({ deliveryId, phase, attemptId: expect.any(String) });
    const closed = once(child, "close");
    expect(child.kill("SIGKILL")).toBe(true);
    const [code, signal] = await closed;
    expect(signal === "SIGKILL" || code !== 0).toBe(true);
    return checkpoint;
  } finally {
    await stopChild(child);
  }
}
async function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close"); child.kill("SIGKILL"); await closed;
}

// A real separate process commits the production claim/dispatch transactions and
// is killed without cleanup. Only social HTTP adapters are mocked after restart.
describe("publication recovery after actual worker process termination", () => {
  it("resumes a persisted pre-dispatch attempt once after the owner is killed", async () => {
    const f = await publicationFixture();
    const checkpoint = await killAtCheckpoint(f.delivery.id, "preparing");
    expect(await f.read()).toMatchObject({ status: "processing", phase: "preparing", attempts: 1, lastAttemptId: checkpoint.attemptId });
    // Advance only the durable lease, without waiting two minutes in the test.
    await f.patch({ leaseExpiresAt: new Date(Date.now() - 1000) });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id, actor: "replacement-process" })).toMatchObject({ succeeded: 1 });
    expect(await f.read()).toMatchObject({ status: "succeeded", attempts: 1, externalId: "900401", outcomeSource: "provider_verified" });
    expect(await f.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.deliveryId, f.delivery.id))).toHaveLength(1);
    expect(await f.db.select().from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, f.delivery.id), eq(deliveryAttemptEvents.event, "lease_recovered")))).toHaveLength(1);
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ processed: 0 });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });

  it("preserves a killed dispatch as unknown and refuses an automatic or manual blind resend", async () => {
    const f = await publicationFixture();
    const checkpoint = await killAtCheckpoint(f.delivery.id, "dispatching");
    expect(await f.read()).toMatchObject({ status: "processing", phase: "dispatching", lastAttemptId: checkpoint.attemptId, dispatchStartedAt: expect.any(Date) });
    await f.patch({ leaseExpiresAt: new Date(Date.now() - 1000) });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id, actor: "replacement-process" })).toMatchObject({ unknown: 1, succeeded: 0 });
    expect(await f.read()).toMatchObject({ status: "unknown", phase: "unknown", attempts: 1 });
    expect(await retryDelivery(f.db, f.delivery.id, "operator")).toMatchObject({ ok: false, code: "confirmation_required" });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ processed: 0 });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    expect(await f.db.select().from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, f.delivery.id), eq(deliveryAttemptEvents.event, "lease_expired_unknown")))).toHaveLength(1);
  });
});
