/** Real PostgreSQL leases and recovery, with collection replaced by an isolated callback. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { jobs, type Job } from "../shared/schema";

setTestEnv();
const mocked = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("../server/worker/collect", () => ({ runCollect: mocked.collect }));
vi.mock("../server/worker/publish", () => ({ publishDue: vi.fn() }));
vi.mock("../server/worker/studio", () => ({ processStudioJob: vi.fn() }));
const { getDb, closeDb } = await import("../server/db");
const { processCollectJob, jobsOnce } = await import("../server/worker/run");
const { recoverExpired, claimJob } = await import("../server/worker/queue");

const outbound = vi.fn(() => { throw new Error("No outbound requests allowed in PostgreSQL retry tests"); });
const owner = "collect-retry-test";
async function fixture(options: Partial<typeof jobs.$inferInsert> = {}) {
  const [job] = await getDb().insert(jobs).values({ type: "collect", channelId: 2, payload: {}, status: "running", attempts: 1, maxAttempts: 2,
    leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 60_000), ...options }).returning();
  return job;
}
const current = async (job: Pick<Job, "id">) => (await getDb().select().from(jobs).where(eq(jobs.id, job.id)))[0];

describe("collect paid-call protection across worker restarts", () => {
  beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch", outbound); });
  beforeEach(async () => { await getDb().delete(jobs); mocked.collect.mockReset(); });
  afterEach(() => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
  afterAll(async () => { vi.unstubAllGlobals(); await closeDb(); });

  it("persists the attempt limit before collection can call AI", async () => {
    vi.stubEnv("AUTO_GENERATE", "true");
    const job = await fixture();
    mocked.collect.mockImplementation(async () => {
      expect((await current(job)).maxAttempts).toBe(1);
      expect(job.maxAttempts).toBe(1);
      return { runId: 1, status: "ok_zero", counts: {}, errors: [] };
    });
    expect(await processCollectJob(getDb(), job, owner)).toBe(true);
    expect(await current(job)).toMatchObject({ status: "succeeded", maxAttempts: 1 });
  });

  it.each(["queued", "different_owner", "expired", "newer_attempt"] as const)("rejects stale execution without invoking collection: %s", async reason => {
    vi.stubEnv("AUTO_GENERATE", "true");
    const job = await fixture(reason === "queued" ? { status: "queued" } : reason === "different_owner" ? { leaseOwner: "other-worker" }
      : reason === "expired" ? { leaseExpiresAt: new Date(Date.now() - 1000) } : { attempts: 2, maxAttempts: 3 });
    const before = await current(job);
    if (reason === "newer_attempt") job.attempts = 1;
    await expect(processCollectJob(getDb(), job, owner)).rejects.toThrow("실행 권한이 만료");
    expect(mocked.collect).not.toHaveBeenCalled();
    expect(await current(job)).toEqual(before);
  });

  it("the jobsOnce exception path does not requeue a potentially billable request", async () => {
    vi.stubEnv("AUTO_GENERATE", "true");
    const job = await fixture({ status: "queued", attempts: 0, leaseOwner: null, leaseExpiresAt: null });
    mocked.collect.mockRejectedValue(new Error("isolated lost response"));
    expect(await jobsOnce({ types: ["collect"] })).toMatchObject({ processed: 1, failed: 1 });
    expect(await current(job)).toMatchObject({ status: "failed", attempts: 1, maxAttempts: 1, leaseOwner: null });
    expect(mocked.collect).toHaveBeenCalledOnce();
    expect(await claimJob(getDb(), "next-worker", ["collect"])).toBeNull();
  });

  it("a collectionOnly run retains the original attempt limit even while automatic AI is enabled", async () => {
    vi.stubEnv("AUTO_GENERATE", "true");
    const job = await fixture({ payload: { collectionOnly: true } });
    mocked.collect.mockResolvedValue({ runId: 1, status: "ok_zero", counts: {}, errors: [] });
    expect(await processCollectJob(getDb(), job, owner)).toBe(true);
    expect(await current(job)).toMatchObject({ status: "succeeded", maxAttempts: 2 });
    expect(job.maxAttempts).toBe(2);
  });

  it("recovers only explicitly pure collections after a crash, regardless of current AI settings", async () => {
    vi.stubEnv("AUTO_GENERATE", "false");
    const expired = new Date(Date.now() - 1000);
    const ambiguous: Job[] = [];
    for (const payload of [{}, { collectionOnly: false }, { collectionOnly: "true" }, { collectionOnly: null }])
      ambiguous.push(await fixture({ payload, leaseExpiresAt: expired, maxAttempts: 3 }));
    const pure = await fixture({ payload: { collectionOnly: true }, leaseExpiresAt: expired, maxAttempts: 3 });
    const other = await fixture({ type: "render", leaseExpiresAt: expired, maxAttempts: 3 });
    // Two recovering workers must not turn the same ambiguous job into a new paid attempt.
    const recovered = await Promise.all([recoverExpired(getDb()), recoverExpired(getDb())]);
    expect(recovered.reduce((total, count) => total + count, 0)).toBe(6);
    for (const job of ambiguous) {
      const row = await current(job);
      expect(row).toMatchObject({ status: "failed", maxAttempts: 1, leaseOwner: null, leaseExpiresAt: null });
      expect(row.finishedAt).toBeInstanceOf(Date);
      expect(row.lastError).toContain("AI 처리·과금 여부");
    }
    expect(await current(pure)).toMatchObject({ status: "queued", maxAttempts: 3, finishedAt: null });
    expect(await current(other)).toMatchObject({ status: "queued", maxAttempts: 3, finishedAt: null });
    expect((await claimJob(getDb(), "recovered-worker", ["collect"]))?.id).toBe(pure.id);
    expect(await claimJob(getDb(), "another-worker", ["collect"])).toBeNull();
    expect(mocked.collect).not.toHaveBeenCalled();
  });
});
