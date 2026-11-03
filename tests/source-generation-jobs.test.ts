import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appSettings, contentItems, jobs } from "../shared/schema";
import { resetDb, setTestEnv } from "./helpers";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { runSourceGeneration, cancelGeneration, cancelSourceGenerationRequest, stopActiveGenerations } = await import("../server/services/sourceGeneration");
const { assertGenerationActive, completeGenerationResult, currentGenerationSignal } = await import("../server/services/generationContext");
const outbound = vi.fn(() => { throw new Error("Only isolated generation callbacks are allowed"); });
beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch", outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function fixture() {
  const [item] = await getDb().insert(contentItems).values({ channelId: 2, kind: "science_dialogue", title: "보존할 수동 원고", relevance: "relevant" }).returning();
  return { type: "source_generate" as const, channelId: 2, itemId: item.id, version: item.version, requestId: randomUUID(), intent: { provider: "gemini", templateKey: "set:n03" }, actor: "isolated-test" };
}
async function currentJob(itemId: number) {
  return (await getDb().select().from(jobs)).find(job => job.payload.itemId === itemId)!;
}

describe("durable source generation requests on PostgreSQL", () => {
  it("returns the same completed response when an HTTP response was lost, without invoking AI again", async () => {
    const input = await fixture(), work = vi.fn(async () => ({ version: 7, copy: { title: "저장된 제안" } }));
    const first = await runSourceGeneration(getDb(), input, work);
    const second = await runSourceGeneration(getDb(), input, work);
    expect(second).toEqual(first);
    expect(work).toHaveBeenCalledTimes(1);
    expect((await currentJob(input.itemId)).status).toBe("succeeded");
    await expect(runSourceGeneration(getDb(), { ...input, intent: { provider: "openai" } }, work)).rejects.toMatchObject({ status: 409 });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("admits only one concurrent request for the same item, even with two request IDs", async () => {
    const input = await fixture(), entered = deferred(), release = deferred();
    const work = vi.fn(async () => { entered.resolve(); await release.promise; return { generated: true }; });
    const first = runSourceGeneration(getDb(), input, work);
    await entered.promise;
    try {
      await expect(runSourceGeneration(getDb(), input, work)).rejects.toMatchObject({ status: 409, extra: { jobStatus: "running" } });
      await expect(runSourceGeneration(getDb(), { ...input, requestId: randomUUID() }, work)).rejects.toMatchObject({ status: 409, extra: { requestRejected: true, jobStatus: "failed" } });
      expect(work).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); await first; }
  });

  it("cancellation reaches the active signal and prevents the result transaction from overwriting input", async () => {
    const input = await fixture(), entered = deferred(), release = deferred();
    let signal: AbortSignal | undefined;
    const request = runSourceGeneration(getDb(), input, async () => {
      signal = currentGenerationSignal(); entered.resolve(); await release.promise;
      return getDb().transaction(async tx => {
        await tx.select().from(contentItems).where(eq(contentItems.id, input.itemId)).for("update");
        await assertGenerationActive(tx as any);
        await tx.update(contentItems).set({ title: "적용하면 안 되는 AI 원고" }).where(eq(contentItems.id, input.itemId));
        return { applied: true };
      });
    });
    const outcome = request.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const cancelled = await cancelSourceGenerationRequest(getDb(), input.itemId, input.requestId!, "test-operator");
    expect(cancelled.cancelled).toBe(true); expect(signal?.aborted).toBe(true);
    release.resolve();
    expect((await outcome as any).error).toMatchObject({ extra: { jobStatus: "cancelled" } });
    expect((await getDb().select().from(contentItems).where(eq(contentItems.id, input.itemId)))[0].title).toBe("보존할 수동 원고");
    expect((await currentJob(input.itemId)).status).toBe("cancelled");
  });

  it("a cancellation received before admission prevents a late POST from charging", async () => {
    const input = await fixture(), work = vi.fn(async () => ({ generated: true }));
    expect((await cancelSourceGenerationRequest(getDb(), input.itemId, input.requestId!, "operator")).cancelled).toBe(true);
    await expect(runSourceGeneration(getDb(), input, work)).rejects.toMatchObject({ extra: { jobStatus: "cancelled" } });
    expect(work).not.toHaveBeenCalled();
  });

  it("saving a new version during AI generation keeps the operator's version", async () => {
    const input = await fixture(), entered = deferred(), release = deferred();
    const request = runSourceGeneration(getDb(), input, async () => {
      entered.resolve(); await release.promise;
      return getDb().transaction(async tx => {
        await tx.select().from(contentItems).where(eq(contentItems.id, input.itemId)).for("update");
        await assertGenerationActive(tx as any);
        await tx.update(contentItems).set({ title: "오래된 AI 응답" }).where(eq(contentItems.id, input.itemId));
        return { applied: true };
      });
    });
    const outcome = request.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    await getDb().update(contentItems).set({ title: "운영자의 최신 원고", version: input.version + 1 }).where(eq(contentItems.id, input.itemId));
    release.resolve();
    expect((await outcome as any).error.status).toBe(409);
    expect((await getDb().select().from(contentItems).where(eq(contentItems.id, input.itemId)))[0].title).toBe("운영자의 최신 원고");
  });

  it("commits the content and replay response atomically, so a later cancel cannot report success", async () => {
    const input = await fixture(), committed = deferred(), release = deferred();
    const request = runSourceGeneration(getDb(), input, async () => {
      const saved = await getDb().transaction(async tx => {
        await tx.select().from(contentItems).where(eq(contentItems.id, input.itemId)).for("update");
        await assertGenerationActive(tx as any);
        const [item] = await tx.update(contentItems).set({ title: "성공적으로 저장된 AI 원고", version: input.version + 1 }).where(eq(contentItems.id, input.itemId)).returning();
        await completeGenerationResult(tx as any, item);
        return item;
      });
      committed.resolve(); await release.promise;
      return saved;
    });
    await committed.promise;
    expect((await cancelGeneration(getDb(), (await currentJob(input.itemId)).id, "operator")).cancelled).toBe(false);
    release.resolve();
    const saved = await request;
    const noNewWork = vi.fn(async () => ({ title: "새 호출 금지" }));
    const replayed = await runSourceGeneration(getDb(), input, noNewWork);
    expect(replayed.title).toBe(saved.title); expect(noNewWork).not.toHaveBeenCalled();
  });

  it("does not replay a failed or expired paid attempt with the same request ID", async () => {
    const input = await fixture(), work = vi.fn(async () => { throw new Error("unknown provider outcome"); });
    await expect(runSourceGeneration(getDb(), input, work)).rejects.toMatchObject({ extra: { jobStatus: "failed" } });
    await expect(runSourceGeneration(getDb(), input, work)).rejects.toMatchObject({ extra: { jobStatus: "failed" } });
    expect(work).toHaveBeenCalledTimes(1);
    const job = await currentJob(input.itemId);
    await getDb().update(jobs).set({ status: "running", attempts: 1, maxAttempts: 1, leaseExpiresAt: new Date(0) }).where(eq(jobs.id, job.id));
    await expect(runSourceGeneration(getDb(), input, work)).rejects.toMatchObject({ extra: { jobStatus: "failed" } });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("fences an expired lease even before the recovery sweep runs", async () => {
    const input = await fixture(), entered = deferred(), release = deferred();
    const request = runSourceGeneration(getDb(), input, async () => {
      entered.resolve(); await release.promise;
      return getDb().transaction(async tx => {
        await tx.select().from(contentItems).where(eq(contentItems.id, input.itemId)).for("update");
        await assertGenerationActive(tx as any);
        await tx.update(contentItems).set({ title: "만료된 응답" }).where(eq(contentItems.id, input.itemId));
        return { applied: true };
      });
    });
    const outcome = request.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const job = await currentJob(input.itemId);
    await getDb().update(jobs).set({ leaseExpiresAt: new Date(0) }).where(eq(jobs.id, job.id));
    release.resolve();
    expect((await outcome as any).error.status).toBe(409);
    expect((await getDb().select().from(contentItems).where(eq(contentItems.id, input.itemId)))[0].title).toBe("보존할 수동 원고");
    expect((await currentJob(input.itemId)).status).toBe("failed");
  });

  it("global stop blocks new calls and cancels persisted running AI work", async () => {
    const input = await fixture(), entered = deferred(), release = deferred();
    const request = runSourceGeneration(getDb(), input, async () => { entered.resolve(); await release.promise; return { applied: false }; });
    const outcome = request.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    await getDb().insert(appSettings).values({ key: "global_stop", value: true }).onConflictDoUpdate({ target: appSettings.key, set: { value: true } });
    try {
      expect(await stopActiveGenerations(getDb(), "operator")).toBeGreaterThan(0);
      const next = await fixture(), forbidden = vi.fn(async () => ({ generated: true }));
      await expect(runSourceGeneration(getDb(), next, forbidden)).rejects.toMatchObject({ status: 409 });
      expect(forbidden).not.toHaveBeenCalled();
      release.resolve(); expect((await outcome as any).error.extra.jobStatus).toBe("cancelled");
    } finally {
      release.resolve(); await outcome;
      await getDb().update(appSettings).set({ value: false }).where(eq(appSettings.key, "global_stop"));
    }
  });
});
