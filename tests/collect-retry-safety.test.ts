import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Job } from "../shared/schema";

const mocks = vi.hoisted(() => ({ collect: vi.fn(), claim: vi.fn(), db: null as any }));
vi.mock("../server/db", () => ({ getDb: () => mocks.db }));
vi.mock("../server/seed", () => ({ getSetting: async () => false }));
vi.mock("../server/secretStore", () => ({ loadStoredSecrets: async () => ({ loaded: 0, unreadable: [] }) }));
vi.mock("../server/worker/collect", () => ({ runCollect: mocks.collect }));
vi.mock("../server/worker/publish", () => ({ publishDue: vi.fn() }));
vi.mock("../server/worker/studio", () => ({ processStudioJob: vi.fn() }));
vi.mock("../server/worker/discovery", () => ({ channelDiscovery: vi.fn() }));
vi.mock("../server/worker/queue", async original => ({ ...await original<object>(), claimJob: mocks.claim, recoverExpired: async () => 0, newWorkerId: () => "test-owner" }));
const { processCollectJob, jobsOnce, collectOnce } = await import("../server/worker/run");

function fixture(payload: Record<string, unknown> = {}, casAccepted = true) {
  const job = { id: 7, channelId: 2, type: "collect", payload, status: "running", attempts: 1, maxAttempts: 2,
    leaseOwner: "test-owner", leaseExpiresAt: new Date(Date.now() + 60_000), runAfter: new Date(),
  } as Job;
  const stored = { ...job };
  function query(action: string, table?: any) {
    let name = table ? getTableName(table) : "", patch: Record<string, unknown> = {}, executed = false;
    const execute = () => {
      if (executed) return;
      executed = true;
      if (action === "update" && name === "jobs" && (!Object.hasOwn(patch, "maxAttempts") || casAccepted)) Object.assign(stored, patch);
    };
    const q: any = {
      from(value: any) { name = getTableName(value); return q; }, set(value: Record<string, unknown>) { patch = value; return q; },
      values() { return q; }, where() { return q; }, for() { return q; },
      returning() { execute(); return Promise.resolve(name === "worker_runs" ? [{ id: 1 }] : casAccepted ? [{ maxAttempts: stored.maxAttempts }] : []); },
      then(resolve: any, reject: any) { execute(); return Promise.resolve(action === "select" && name === "jobs" ? [stored] : []).then(resolve, reject); },
    };
    return q;
  }
  const db: any = { select: () => query("select"), insert: (table: any) => query("insert", table), update: (table: any) => query("update", table), execute: async () => ({ rows: [], rowCount: 0 }) };
  mocks.db = db;
  return { db, job, stored };
}

beforeEach(() => {
  mocks.collect.mockReset(); mocks.claim.mockReset();
  vi.stubEnv("AUTO_GENERATE", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external calls allowed in retry tests"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("collect retry admission without a database or paid provider", () => {
  it('carries only the server-admitted manual workload flag and excludes AI even if an old payload lacked collectionOnly', async () => {
    const { db, job } = fixture({ manualWorkload: true });
    mocks.collect.mockResolvedValue({ runId: 1, status: 'ok_zero', counts: {}, errors: [] });
    expect(await processCollectJob(db, job, 'test-owner')).toBe(true);
    expect(mocks.collect).toHaveBeenCalledWith(db, 2, expect.objectContaining({ manualWorkload: true, collectionOnly: true }));
    expect(job.maxAttempts).toBe(2);
  });

  it('does not start scheduled collection when automatic collection is off', async () => {
    fixture(); vi.stubEnv('AUTO_COLLECT', 'false');
    expect(await collectOnce({ isSchedule: true })).toMatchObject({ results: [], skipped: expect.stringContaining('자동 수집 꺼짐') });
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("fixes both persisted and caller-owned attempt limits before work begins", async () => {
    const { db, job, stored } = fixture();
    mocks.collect.mockImplementation(async () => {
      expect(stored.maxAttempts).toBe(job.attempts);
      expect(job.maxAttempts).toBe(job.attempts);
      return { runId: 1, status: "ok_zero", counts: {}, errors: [] };
    });
    expect(await processCollectJob(db, job, "test-owner")).toBe(true);
    expect(stored.status).toBe("succeeded");
    expect(mocks.collect).toHaveBeenCalledOnce();
  });

  it("the real jobsOnce catch uses the mutated job and does not queue a failed paid-capable run", async () => {
    const { job, stored } = fixture();
    mocks.claim.mockResolvedValueOnce(job).mockResolvedValue(null);
    mocks.collect.mockRejectedValue(new Error("isolated processing failure after attempted work"));
    expect(await jobsOnce()).toMatchObject({ processed: 1, failed: 1 });
    expect(stored).toMatchObject({ status: "failed", maxAttempts: 1, leaseOwner: null });
    expect(mocks.collect).toHaveBeenCalledOnce();
  });

  it.each([
    { autoGenerate: "true", payload: { collectionOnly: true } },
    { autoGenerate: "false", payload: {} },
  ])("retains ordinary exception retries when AI is excluded: %j", async ({ autoGenerate, payload }) => {
    vi.stubEnv("AUTO_GENERATE", autoGenerate);
    const { job, stored } = fixture(payload);
    mocks.claim.mockResolvedValueOnce(job).mockResolvedValue(null);
    mocks.collect.mockRejectedValue(new Error("temporary collection failure"));
    expect(await jobsOnce()).toMatchObject({ processed: 1, failed: 1 });
    expect(stored).toMatchObject({ status: "queued", maxAttempts: 2 });
    expect(job.maxAttempts).toBe(2);
  });

  it("does not execute collection when the ownership CAS rejects admission", async () => {
    const { db, job, stored } = fixture({}, false);
    await expect(processCollectJob(db, job, "test-owner")).rejects.toThrow("실행 권한이 만료");
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(stored.maxAttempts).toBe(2);
    // If an outer catch still holds this object, it cannot requeue the possibly ambiguous job.
    expect(job.maxAttempts).toBe(1);
  });
});
