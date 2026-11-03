/** PostgreSQL integration, with a fake provider only; no external generation or publication. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
setTestEnv();
const provider = vi.hoisted(() => ({ text: vi.fn() }));
vi.mock("../server/services/studioAi", () => ({ generateStudioText: provider.text, generateStudioCaption: vi.fn(), generateStudioImage: vi.fn() }));
const { getDb, closeDb } = await import("../server/db");
const { createStudioCard, queueStudioGeneration } = await import("../server/services/studio");
const { cancelGeneration } = await import("../server/services/sourceGeneration");
const queue = await import("../server/worker/queue");
const { processStudioJob } = await import("../server/worker/studio");
const { studioContentSchema, studioGenerationSchema } = await import("../shared/studio");
const { appSettings, jobs, studioCards, studioRevisions } = await import("../shared/schema");

const generated = { title: "생성 제목", script: "생성된 원고", caption: "생성 캡션", panels: Array.from({ length: 4 }, () => ({ scene: "장면", dialogue: "대사" })), provider: "openai", model: "isolated-mock" };
async function fixture(owner: string) {
  const db = getDb(), card = await createStudioCard(db, studioContentSchema.parse({ title: "보존할 원고", script: "직접 작성한 내용" }), "test");
  const queued = await queueStudioGeneration(db, card.id, studioGenerationSchema.parse({ version: 1, kind: "text", textTarget: "rewrite", instruction: "원고 다듬기", requestId: crypto.randomUUID() }), "test");
  const job = await queue.claimJob(db, owner, ["studio_generate"]);
  expect(job?.id).toBe(queued.job.id);
  return { card, job: job! };
}

describe("active Studio generation cancellation and atomic completion", () => {
  beforeAll(resetDb);
  afterAll(closeDb);
  afterEach(async () => { vi.restoreAllMocks(); provider.text.mockReset(); await getDb().update(appSettings).set({ value: false }).where(eq(appSettings.key, "global_stop")); });

  it("a persisted running cancellation aborts the provider and cannot apply a late response", async () => {
    const owner = "studio-cancel-integration", { card, job } = await fixture(owner);
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    let signal: AbortSignal | undefined;
    provider.text.mockImplementation((options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal = options.signal; signal.addEventListener("abort", () => reject(signal!.reason), { once: true }); markStarted();
    }));
    const work = processStudioJob(getDb(), job, owner);
    await started;
    expect(await cancelGeneration(getDb(), job.id, "test")).toMatchObject({ cancelled: true });
    expect(await work).toBe(false);
    expect(signal?.aborted).toBe(true);
    const [saved] = await getDb().select().from(studioCards).where(eq(studioCards.id, card.id));
    const [task] = await getDb().select().from(jobs).where(eq(jobs.id, job.id));
    expect(saved).toMatchObject({ version: 1, content: { script: "직접 작성한 내용" } });
    expect(task.status).toBe("cancelled");
    expect(await getDb().select().from(studioRevisions).where(eq(studioRevisions.cardId, card.id))).toHaveLength(1);
  });

  it("a changed global stop aborts the current request and preserves the draft", async () => {
    const owner = "studio-stop-integration", { card, job } = await fixture(owner);
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    provider.text.mockImplementation((options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }); markStarted();
    }));
    const work = processStudioJob(getDb(), job, owner);
    await started;
    await getDb().update(appSettings).set({ value: true }).where(eq(appSettings.key, "global_stop"));
    expect(await work).toBe(false);
    const [saved] = await getDb().select().from(studioCards).where(eq(studioCards.id, card.id));
    const [task] = await getDb().select().from(jobs).where(eq(jobs.id, job.id));
    expect(saved).toMatchObject({ version: 1, content: { script: "직접 작성한 내용" } });
    expect(task).toMatchObject({ status: "failed", maxAttempts: 1 });
  });

  it("does not expose a committed edited card before the job success commits", async () => {
    const owner = "studio-atomic-integration", { card, job } = await fixture(owner);
    provider.text.mockResolvedValue(generated);
    const original = queue.completeJob;
    const complete = vi.spyOn(queue, "completeJob").mockImplementation(async (tx, jobId, workerId, result) => {
      // This separate connection must still see the old card while the completion transaction is open.
      const [visible] = await getDb().select().from(studioCards).where(eq(studioCards.id, card.id));
      expect(visible).toMatchObject({ version: 1, content: { script: "직접 작성한 내용" } });
      return original(tx, jobId, workerId, result);
    });
    expect(await processStudioJob(getDb(), job, owner)).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    const [saved] = await getDb().select().from(studioCards).where(eq(studioCards.id, card.id));
    const [task] = await getDb().select().from(jobs).where(eq(jobs.id, job.id));
    expect(saved).toMatchObject({ version: 2, content: { script: "생성된 원고" } });
    expect(task).toMatchObject({ status: "succeeded", result: { applied: true } });
    expect(await cancelGeneration(getDb(), job.id, "test")).toMatchObject({ cancelled: false });
  });
});
