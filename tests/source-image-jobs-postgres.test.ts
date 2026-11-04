import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { login, resetDb, setTestEnv } from "./helpers";
import { emptyPayload, sciencePayloadSchema } from "../shared/payloads";
import { currentGenerationSignal } from "../server/services/generationContext";
import type { Response as TestResponse } from "supertest";

setTestEnv();
process.env.OPENAI_API_KEY = "isolated-image-test-key";
const image = vi.hoisted(() => vi.fn());
vi.mock("../server/services/studioAi", async original => ({ ...await original<object>(), generateStudioImage: (...args: unknown[]) => image(...args) }));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { approvals, contentItems, deliveries, destinations, jobs, mediaAssets } = await import("../shared/schema");
let app: ReturnType<typeof createApp>, bytes: Buffer;
const outbound = vi.fn(() => { throw new Error("External calls are blocked in source image tests"); });
beforeAll(async () => {
  await resetDb(); app = createApp();
  bytes = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#16bd49" } }).png().toBuffer();
  vi.stubGlobal("fetch", outbound);
});
beforeEach(() => { image.mockReset().mockResolvedValue({ bytes, model: "isolated-image" }); });
afterAll(async () => {
  try { expect(outbound).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY; await closeDb(); }
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function bounded<T>(promise: Promise<T>, message: string, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function blockedImage() {
  const entered = deferred(), release = deferred();
  image.mockImplementation(async () => {
    const generation = currentGenerationSignal();
    generation?.throwIfAborted();
    entered.resolve();
    let abort: (() => void) | undefined;
    try {
      await bounded(new Promise<void>(resolve => {
        // Model a provider's late success after cancellation. The persistence
        // fence must reject it; observing abort prevents a stranded mock/DB lease.
        abort = resolve;
        generation?.addEventListener("abort", abort, { once: true });
        void release.promise.then(resolve);
        if (generation?.aborted) resolve();
      }), "Blocked image mock was not released", 12_000);
    } finally { if (abort) generation?.removeEventListener("abort", abort); }
    return { bytes, model: "isolated-image" };
  });
  return { entered, release };
}

async function waitForImage(entered: Promise<void>, first: Promise<TestResponse>) {
  await bounded(Promise.race([entered, first.then(response => {
    throw new Error(`Image mock was not entered: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  })]), "Image mock admission timed out before the provider was called");
}

async function releaseAndDrain(release: ReturnType<typeof deferred>, first: Promise<TestResponse>) {
  release.resolve();
  // Preserve the main assertion/HTTP error, while still allowing the route to
  // unwind and release its transaction before the next test resets its mocks.
  await bounded(first.then(() => undefined, () => undefined), "Image request did not finish during cleanup", 22_000);
}

async function fixture() {
  const { agent, csrf } = await login(app), headers = { "x-csrf-token": csrf };
  const created = await agent.post("/api/channels/2/items").set(headers).send({ title: "자동 이미지와 원고 보존" });
  expect(created.status).toBe(201);
  const id = created.body.id, path = `/api/channels/2/items/${id}`;
  const initial = (await agent.get(path)).body;
  const payload = sciencePayloadSchema.parse({ ...emptyPayload("science_dialogue", "관찰하는 과학"), key_question: "관찰한 사실은 어떻게 확인할까요?", background: ["같은 장면을 반복해서 살펴봅니다.", "관찰한 결과를 기록합니다.", "서로의 기록을 비교합니다."], scientific_basis: "관찰한 결과를 기록하고 비교합니다." });
  const copy = {
    version: 1, templateKey: "set:n03", cover: { title: "관찰하는 과학", subtitle: "확인한 사실을 나눠요" },
    pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i}`, title: `과학 이야기 ${i + 1}`, subtitle: "", body: "원문에서 확인한 사실을 함께 살펴봅니다." })),
  };
  const saved = await agent.patch(path).set(headers).send({ version: initial.item.version, payload });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  // Article updates intentionally cannot replace cardCopy; use its own CAS API.
  const copySaved = await agent.patch(`${path}/card-copy`).set(headers).send({ version: saved.body.version, copy });
  expect(copySaved.status, JSON.stringify(copySaved.body)).toBe(200);
  expect(copySaved.body).toMatchObject({ hasSavedCopy: true, copy });
  return { agent, headers, id, path, payload, body: { version: copySaved.body.version, templateKey: "set:n03", coverMode: "ai", requestId: randomUUID() } };
}
async function assetCount(itemId: number) { return (await getDb().select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.contentItemId, itemId))).length; }

describe("durable source cover rendering on real PostgreSQL", () => {
  it("requires a fresh review for the first AI cover after a reviewed typography card", async () => {
    const f = await fixture(), db = getDb();
    const typography = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, coverMode: "typography" });
    expect(typography.status, JSON.stringify(typography.body)).toBe(200);
    expect(image).not.toHaveBeenCalled();
    const reviewed = await f.agent.post(`${f.path}/review`).set(f.headers).send({ version: f.body.version, status: "reviewed" });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.body.reviewStatus).toBe("reviewed");
    const [before] = await db.select().from(contentItems).where(eq(contentItems.id, f.id));
    const request = { ...f.body, requestId: randomUUID(), version: reviewed.body.version };

    // The first generated art also changes a reviewed visual, without an
    // explicit redraw flag: it must not inherit the typography card's review.
    const firstArt = await f.agent.post(`${f.path}/card`).set(f.headers).send(request);
    expect(firstArt.status, JSON.stringify(firstArt.body)).toBe(200);
    expect(image).toHaveBeenCalledTimes(1);
    expect(firstArt.body.id).not.toBe(typography.body.id);
    expect(firstArt.body.carousel.cover.kind).toBe("ai");
    const [after] = await db.select().from(contentItems).where(eq(contentItems.id, f.id));
    expect(after.reviewStatus).toBe("pending");
    expect(after.version).toBe(before.version + 1);
    expect(firstArt.body.itemVersion).toBe(after.version);
    expect(after.currentRevisionId).toBe(before.currentRevisionId);
    expect(after.edited).toEqual(before.edited);

    const replay = await f.agent.post(`${f.path}/card`).set(f.headers).send(request);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toEqual(firstArt.body);
    expect(image).toHaveBeenCalledTimes(1);
    expect((await db.select().from(contentItems).where(eq(contentItems.id, f.id)))[0].version).toBe(after.version);
  });

  it("reuses a saved cover by default, regenerates it once on explicit instruction, and revokes only queued publication", async () => {
    const f = await fixture(), db = getDb();
    const first = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(image).toHaveBeenCalledTimes(1);
    const [source] = await db.select().from(contentItems).where(eq(contentItems.id, f.id));
    const [initialArt] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.contentItemId, f.id), eq(mediaAssets.kind, "cover_art")));
    expect(initialArt.bytes).toEqual(bytes);

    // Fixture an already approved snapshot without calling any external identity
    // or publishing API. A dispatched sibling must retain its external evidence.
    const targets = await db.insert(destinations).values([
      { channelId: source.channelId, platform: "telegram_channel", label: "격리된 예약 목적지", enabled: false },
      { channelId: source.channelId, platform: "telegram_channel", label: "격리된 처리중 목적지", enabled: false },
    ]).returning();
    const [approval] = await db.insert(approvals).values({ channelId: source.channelId, contentItemId: f.id, revisionId: first.body.revisionId,
      mediaAssetId: first.body.id, cardSha256: first.body.sha256, captions: { instagram: "승인한 기존 캡션", telegram: "" },
      scheduledAt: new Date("2035-01-01T00:00:00Z"), approvedBy: "isolated-test" }).returning();
    const [queued, inFlight] = await db.insert(deliveries).values([
      { channelId: source.channelId, approvalId: approval.id, destinationId: targets[0].id, status: "scheduled", phase: "queued" },
      { channelId: source.channelId, approvalId: approval.id, destinationId: targets[1].id, status: "processing", phase: "dispatching", externalContainerId: "isolated-container", requestStartedAt: new Date("2026-11-04T00:00:00Z") },
    ]).returning();
    await db.update(contentItems).set({ reviewStatus: "reviewed", publishStatus: "processing" }).where(eq(contentItems.id, f.id));

    const normal = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, requestId: randomUUID() });
    expect(normal.status, JSON.stringify(normal.body)).toBe(200);
    expect(normal.body.id).toBe(first.body.id); expect(normal.body.sha256).toBe(first.body.sha256);
    expect(image).toHaveBeenCalledTimes(1);
    expect((await db.select().from(approvals).where(eq(approvals.id, approval.id)))[0].status).toBe("active");
    expect((await db.select().from(deliveries).where(eq(deliveries.id, queued.id)))[0].status).toBe("scheduled");
    const [originalCard] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, first.body.id));

    const replacement = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#d52c88" } }).png().toBuffer();
    image.mockResolvedValue({ bytes: replacement, model: "isolated-image-redraw" });
    const coverInstruction = "원래 구도는 유지하고 배경을 분홍색으로 밝게 바꿔 주세요.";
    const redrawRequest = { ...f.body, requestId: randomUUID(), regenerateCover: true, coverInstruction };
    const redrawn = await f.agent.post(`${f.path}/card`).set(f.headers).send(redrawRequest);
    expect(redrawn.status, JSON.stringify(redrawn.body)).toBe(200);
    expect(image).toHaveBeenCalledTimes(2);
    expect(image.mock.calls[1][0]).toMatchObject({ purpose: "cover", instruction: coverInstruction, referenceImages: [`data:image/png;base64,${initialArt.bytes.toString("base64")}`] });
    expect(redrawn.body.id).not.toBe(first.body.id); expect(redrawn.body.sha256).not.toBe(first.body.sha256);
    const savedArt = await db.select().from(mediaAssets).where(and(eq(mediaAssets.contentItemId, f.id), eq(mediaAssets.kind, "cover_art")));
    expect(savedArt).toHaveLength(2); expect(savedArt.some(art => art.bytes.equals(replacement))).toBe(true);
    expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id, first.body.id)))[0]).toEqual(originalCard);
    expect((await db.select().from(approvals).where(eq(approvals.id, approval.id)))[0].status).toBe("invalidated");
    expect((await db.select().from(deliveries).where(eq(deliveries.id, queued.id)))[0]).toMatchObject({ status: "cancelled", errorKind: "approval_required" });
    expect((await db.select().from(deliveries).where(eq(deliveries.id, inFlight.id)))[0]).toEqual(inFlight);
    const [edited] = await db.select().from(contentItems).where(eq(contentItems.id, f.id));
    expect(edited.reviewStatus).toBe("pending"); expect(edited.version).toBe(source.version + 1);
    expect(redrawn.body.itemVersion).toBe(edited.version);
    expect(edited.edited).toEqual(source.edited); expect(edited.currentRevisionId).toBe(source.currentRevisionId);

    const assetsAfterRedraw = await assetCount(f.id);
    const replay = await f.agent.post(`${f.path}/card`).set(f.headers).send(redrawRequest);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200); expect(replay.body).toEqual(redrawn.body);
    expect(image).toHaveBeenCalledTimes(2); expect(await assetCount(f.id)).toBe(assetsAfterRedraw);
    const changedIntent = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...redrawRequest, coverInstruction: "이번에는 배경을 파란색으로 바꿔 주세요." });
    expect(changedIntent.status).toBe(409); expect(image).toHaveBeenCalledTimes(2);
  });

  it("rejects inconsistent cover-regeneration options before spending an image call", async () => {
    const f = await fixture();
    for (const options of [
      { coverMode: "typography", regenerateCover: true },
      { coverMode: "reuse", regenerateCover: true },
      { coverMode: undefined, regenerateCover: true },
      { coverMode: "ai", coverInstruction: "배경만 바꿔 주세요." },
      { coverMode: "ai", regenerateCover: false, coverInstruction: "배경만 바꿔 주세요." },
      { coverMode: "ai", regenerateCover: true, coverInstruction: "가".repeat(2001) },
      { version: undefined }, // A stable UUID must also pin its input version.
    ]) {
      const response = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, ...options, requestId: randomUUID() });
      expect(response.status, JSON.stringify(response.body)).toBe(400);
    }
    for (const missing of [{ version: undefined }, { requestId: undefined }]) {
      const response = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, requestId: randomUUID(), regenerateCover: true, ...missing });
      expect(response.status, JSON.stringify(response.body)).toBe(400);
    }
    expect(image).not.toHaveBeenCalled(); expect(await assetCount(f.id)).toBe(0);
    const imageJobs = await getDb().select().from(jobs).where(eq(jobs.type, "card_render"));
    expect(imageJobs.filter(job => job.payload.itemId === f.id)).toHaveLength(0);
    const typography = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, requestId: randomUUID(), templateKey: "set:n04", regenerateCover: true });
    expect(typography.status, JSON.stringify(typography.body)).toBe(400);
    expect(image).not.toHaveBeenCalled(); expect(await assetCount(f.id)).toBe(0);
  });

  it("replays the saved image response after a lost HTTP response without another image call", async () => {
    const f = await fixture();
    const first = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const count = await assetCount(f.id);
    await f.agent.patch(f.path).set(f.headers).send({ version: f.body.version, payload: { ...f.payload, key_question: "이미지 요청 후에 고친 질문" } });
    const replay = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200); expect(replay.body).toEqual(first.body);
    expect(image).toHaveBeenCalledTimes(1); expect(await assetCount(f.id)).toBe(count);
    const [job] = await getDb().select().from(jobs).where(and(eq(jobs.id, first.body.jobId), eq(jobs.type, "card_render")));
    expect(job.status).toBe("succeeded"); expect(job.result?.response).toMatchObject({ id: first.body.id });
  });

  it("admits one image call under duplicate HTTP requests and different request IDs", async () => {
    const f = await fixture(), { entered, release } = blockedImage();
    const first = f.agent.post(`${f.path}/card`).set(f.headers).send(f.body).timeout({ deadline: 20_000 }).then(value => value);
    try {
      await waitForImage(entered.promise, first);
      const duplicate = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
      expect(duplicate.status).toBe(409); expect(duplicate.body.jobStatus).toBe("running");
      const different = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, requestId: randomUUID() });
      expect(different.status).toBe(409); expect(image).toHaveBeenCalledTimes(1);
      release.resolve();
      expect((await first).status).toBe(200);
    } finally { await releaseAndDrain(release, first); }
  });

  it("cancels before result persistence and never applies a late external image", async () => {
    const f = await fixture(), { entered, release } = blockedImage();
    const first = f.agent.post(`${f.path}/card`).set(f.headers).send(f.body).timeout({ deadline: 20_000 }).then(value => value);
    try {
      await waitForImage(entered.promise, first);
      const cancelled = await f.agent.post(`${f.path}/generation-cancel`).set(f.headers).send({ requestId: f.body.requestId });
      expect(cancelled.status).toBe(200); expect(cancelled.body.cancelled).toBe(true);
      release.resolve();
      const response = await first; expect([409, 422]).toContain(response.status); expect(response.body.jobStatus).toBe("cancelled");
      expect(await assetCount(f.id)).toBe(0);
      const again = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
      expect(again.body.jobStatus).toBe("cancelled"); expect(image).toHaveBeenCalledTimes(1);
    } finally { await releaseAndDrain(release, first); }
  });

  it("does not save an old image over a concurrently edited source version", async () => {
    const f = await fixture(), { entered, release } = blockedImage();
    const first = f.agent.post(`${f.path}/card`).set(f.headers).send(f.body).timeout({ deadline: 20_000 }).then(value => value);
    try {
      await waitForImage(entered.promise, first);
      const saved = await f.agent.patch(f.path).set(f.headers).send({ version: f.body.version, payload: { ...f.payload, key_question: "최신 운영자 질문" } });
      expect(saved.status).toBe(200);
      release.resolve();
      expect((await first).status).toBe(409); expect(await assetCount(f.id)).toBe(0);
      const [current] = await getDb().select().from(contentItems).where(eq(contentItems.id, f.id));
      expect(current.edited?.key_question).toBe("최신 운영자 질문"); expect(image).toHaveBeenCalledTimes(1);
    } finally { await releaseAndDrain(release, first); }
  });
});
