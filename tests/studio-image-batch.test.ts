/** PostgreSQL integration with in-memory fake providers and local image bytes only. */
import crypto from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
setTestEnv();
const provider = vi.hoisted(() => ({ image: vi.fn(), panel: vi.fn() }));
vi.mock("../server/services/studioAi", () => ({ generateStudioImage: provider.image, generateStudioPanel: provider.panel, generateStudioText: vi.fn(), generateStudioCaption: vi.fn() }));
const { getDb, closeDb } = await import("../server/db");
const { createStudioCard, queueStudioGeneration, saveStudioCard } = await import("../server/services/studio");
const { cancelGeneration } = await import("../server/services/sourceGeneration");
const { processStudioJob } = await import("../server/worker/studio");
const { claimJob, recoverExpired } = await import("../server/worker/queue");
const { studioContentSchema, studioGenerationSchema } = await import("../shared/studio");
const { studioImageProgress } = await import("../shared/studioGenerationFeedback");
const { AiServiceError } = await import("../server/services/llm");
const { jobs, studioCards, studioImages, studioRevisions } = await import("../shared/schema");
let png: Buffer;

async function fixture(owner: string, indexes = [0, 1, 2, 3]) {
  const db = getDb();
  const card = await createStudioCard(db, studioContentSchema.parse({ title: "그림 생성 보존 테스트", characters: [], script: "확인한 원고", caption: "직접 쓴 캡션", panels: Array.from({ length: 4 }, (_, index) => ({ scene: `${index + 1}컷 장면`, dialogue: `${index + 1}컷 문구` })) }), "test");
  const input = studioGenerationSchema.parse({ version: card.version, kind: "image", panelIndexes: indexes, provider: "openai", requestId: crypto.randomUUID() });
  const queued = await queueStudioGeneration(db, card.id, input, "test");
  const job = await claimJob(db, owner, ["studio_generate"]);
  expect(job?.id).toBe(queued.job.id);
  return { card, input, job: job! };
}
const image = () => ({ bytes: png, mimeType: "image/png", model: "isolated-image-fixture" });
async function rows(cardId: number, jobId: number) {
  const [card] = await getDb().select().from(studioCards).where(eq(studioCards.id, cardId));
  const [job] = await getDb().select().from(jobs).where(eq(jobs.id, jobId));
  const revisions = await getDb().select().from(studioRevisions).where(eq(studioRevisions.cardId, cardId));
  return { card, job, revisions };
}
describe("durable sequential Studio image generation", () => {
  beforeAll(async () => { await resetDb(); png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#e32d62" } }).png().toBuffer(); });
  afterAll(closeDb);
  beforeEach(() => { provider.image.mockReset(); provider.panel.mockReset(); });

  it("deduplicates the same intent and commits each of at most four selected panels before the next call", async () => {
    const owner = "batch-sequential", { card, job, input } = await fixture(owner);
    expect((await queueStudioGeneration(getDb(), card.id, input, "test")).duplicate).toBe(true);
    expect(await claimJob(getDb(), "duplicate-worker", ["studio_generate"])).toBeNull();
    let completed = 0;
    provider.image.mockImplementation(async () => {
      const current = await rows(card.id, job.id);
      expect(current.card.version).toBe(1 + completed);
      expect(studioImageProgress(current.job.result)?.completedPanels).toHaveLength(completed);
      completed++;
      return image();
    });
    expect(await processStudioJob(getDb(), job, owner)).toBe(true);
    const result = await rows(card.id, job.id);
    expect(provider.image).toHaveBeenCalledTimes(4);
    expect(result.card).toMatchObject({ version: 5, content: { caption: card.caption, script: card.script } });
    expect(result.card.content.panels.every(panel => typeof panel.imageId === "number")).toBe(true);
    expect(result.job).toMatchObject({ status: "succeeded", maxAttempts: 1, result: { partial: false, remainingPanelIndexes: [], activePanelIndex: null } });
    expect(result.revisions).toHaveLength(5);
    expect((await queueStudioGeneration(getDb(), card.id, input, "test")).job.id).toBe(job.id);
    expect(provider.image).toHaveBeenCalledTimes(4);
  });

  it("stops on the first paid failure and preserves the first committed image and all other input", async () => {
    const owner = "batch-partial-failure", { card, job } = await fixture(owner);
    provider.image.mockResolvedValueOnce(image()).mockRejectedValueOnce(new AiServiceError("OpenAI HTTP 429: API 선불 크레딧이 소진되었습니다."));
    expect(await processStudioJob(getDb(), job, owner)).toBe(false);
    const result = await rows(card.id, job.id);
    expect(provider.image).toHaveBeenCalledTimes(2);
    expect(result.card.version).toBe(2);
    expect(result.card.content.panels[0].imageId).toBeTypeOf("number");
    expect(result.card.content.panels.slice(1)).toEqual(card.panels.slice(1));
    expect(result.job).toMatchObject({ status: "failed", result: { partial: true, errorKind: "quota", remainingPanelIndexes: [1, 2, 3] } });
    expect(await claimJob(getDb(), "no-paid-retry", ["studio_generate"])).toBeNull();
  });

  it("aborts a cancelled second request and leaves the first image available after cancellation", async () => {
    const owner = "batch-cancel", { card, job } = await fixture(owner);
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    let activeSignal: AbortSignal | undefined;
    provider.image.mockResolvedValueOnce(image()).mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      activeSignal = signal; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); started();
    }));
    const work = processStudioJob(getDb(), job, owner);
    await waiting;
    expect(await cancelGeneration(getDb(), job.id, "test")).toMatchObject({ cancelled: true });
    expect(await work).toBe(false);
    expect(activeSignal?.aborted).toBe(true);
    const result = await rows(card.id, job.id);
    expect(provider.image).toHaveBeenCalledTimes(2);
    expect(result.card.version).toBe(2);
    expect(result.card.content.panels[0].imageId).toBeTypeOf("number");
    expect(result.job.status).toBe("cancelled");
    expect(studioImageProgress(result.job.result)?.completedPanels).toHaveLength(1);
  });

  it("retains an old picture for one-panel regeneration and uses it as a reference", async () => {
    const db = getDb();
    const card = await createStudioCard(db, studioContentSchema.parse({ title: "기존 그림 보존", characters: [], panels: Array.from({ length: 4 }, () => ({ scene: "원래 장면", dialogue: "원래 문구" })) }), "test");
    const [oldImage] = await db.insert(studioImages).values({ cardId: card.id, panelIndex: 2, bytes: png, mimeType: "image/png", model: "old" }).returning();
    const saved = await saveStudioCard(db, card.id, 1, { panels: card.panels.map((panel, index) => index === 2 ? { ...panel, imageId: oldImage.id } : panel) }, "test");
    const owner = "batch-single-regeneration";
    await queueStudioGeneration(db, card.id, studioGenerationSchema.parse({ version: 2, kind: "image", panelIndex: 2, provider: "openai", instruction: "표정만 수정", requestId: crypto.randomUUID() }), "test");
    const job = await claimJob(db, owner, ["studio_generate"]);
    provider.image.mockResolvedValue(image());
    expect(await processStudioJob(db, job!, owner)).toBe(true);
    expect(provider.image.mock.calls[0][0].referenceImages).toContain(`data:image/png;base64,${png.toString("base64")}`);
    const result = await rows(card.id, job!.id);
    expect(result.card.content.panels.filter((_, index) => index !== 2)).toEqual(saved.panels.filter((_, index) => index !== 2));
    expect(result.card.content.panels[2].imageId).not.toBe(oldImage.id);
    expect(await db.select().from(studioImages).where(eq(studioImages.id, oldImage.id))).toHaveLength(1);
    expect(result.revisions.some(revision => revision.snapshot.panels[2].imageId === oldImage.id)).toBe(true);
  });

  it("a newer edit during a paid request wins and the unused result stops the remaining batch", async () => {
    const owner = "batch-edited", { card, job } = await fixture(owner);
    provider.image.mockImplementationOnce(async () => {
      await saveStudioCard(getDb(), card.id, 1, { caption: "생성 중 새로 저장한 캡션" }, "test");
      return image();
    });
    expect(await processStudioJob(getDb(), job, owner)).toBe(true);
    const result = await rows(card.id, job.id);
    expect(provider.image).toHaveBeenCalledOnce();
    expect(result.card.content.caption).toBe("생성 중 새로 저장한 캡션");
    expect(result.card.content.panels).toEqual(card.panels);
    expect(result.job).toMatchObject({ status: "succeeded", result: { applied: false, remainingPanelIndexes: [1, 2, 3] } });
    expect(result.revisions.some(revision => !revision.applied && revision.snapshot.panels[0].imageId)).toBe(true);
  });

  it("an expired lease preserves partial progress and cannot charge for the batch again", async () => {
    const owner = "batch-expired", { card, job } = await fixture(owner);
    provider.image.mockImplementationOnce(async () => image()).mockImplementationOnce(async () => {
      await getDb().update(jobs).set({ leaseExpiresAt: new Date(0) }).where(eq(jobs.id, job.id));
      await recoverExpired(getDb());
      return image();
    });
    expect(await processStudioJob(getDb(), job, owner)).toBe(false);
    const result = await rows(card.id, job.id);
    expect(provider.image).toHaveBeenCalledTimes(2);
    expect(result.card.version).toBe(2);
    expect(result.job.status).toBe("failed");
    expect(studioImageProgress(result.job.result)?.completedPanels).toHaveLength(1);
    expect(await claimJob(getDb(), "new-process", ["studio_generate"])).toBeNull();
  });

  it("panel text regeneration changes only selected scene and dialogue, preserving all drawings and other fields", async () => {
    const db = getDb(), owner = "partial-panel-text";
    const card = await createStudioCard(db, studioContentSchema.parse({ title: "유지할 제목", characters: [], script: "전체 원고 보존", caption: "캡션 보존", panels: Array.from({ length: 4 }, () => ({ scene: "원래 장면", dialogue: "원래 문구" })) }), "test");
    const [oldImage] = await db.insert(studioImages).values({ cardId: card.id, panelIndex: 1, bytes: png, mimeType: "image/png", model: "old" }).returning();
    const saved = await saveStudioCard(db, card.id, 1, { panels: card.panels.map((panel, index) => index === 1 ? { ...panel, imageId: oldImage.id } : panel) }, "test");
    await queueStudioGeneration(db, card.id, studioGenerationSchema.parse({ version: 2, kind: "text", textTarget: "panel", panelIndex: 1, provider: "openai", instruction: "문구를 짧게", requestId: crypto.randomUUID() }), "test");
    const job = await claimJob(db, owner, ["studio_generate"]);
    provider.panel.mockResolvedValue({ scene: "수정한 장면", dialogue: "짧은 문구", model: "mock-text", provider: "openai" });
    expect(await processStudioJob(db, job!, owner)).toBe(true);
    const result = await rows(card.id, job!.id);
    expect(result.card.content).toMatchObject({ title: saved.title, script: saved.script, caption: saved.caption });
    expect(result.card.content.panels[1]).toMatchObject({ scene: "수정한 장면", dialogue: "짧은 문구", imageId: oldImage.id });
    expect(result.card.content.panels.filter((_, index) => index !== 1)).toEqual(saved.panels.filter((_, index) => index !== 1));
    expect(provider.image).not.toHaveBeenCalled();
  });
});
