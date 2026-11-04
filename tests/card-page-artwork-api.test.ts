import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { channels, contentItems, contentRevisions, jobs, mediaAssets } from "../shared/schema";
import { emptyPayload } from "../shared/payloads";
import type { CardCopy } from "../shared/cardCopy";
import { discussionCardCopyFixture } from "./fixtures/discussionCardCopy";
import { login, resetDb, setTestEnv } from "./helpers";

setTestEnv();
const makeImage = vi.hoisted(() => vi.fn());
vi.mock("../server/services/studioAi", async original => ({ ...await original<object>(), generateStudioImage: (...args: unknown[]) => makeImage(...args) }));
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const { createRevision } = await import("../server/content");
const { loadCardPageArtwork } = await import("../server/services/cardPageArtwork");
const { cancelSourceGenerationRequest } = await import("../server/services/sourceGeneration");
const { AiServiceError } = await import("../server/services/llm");
let app: ReturnType<typeof createApp>;
let upload: string;
let generatedPng: Buffer;
const outbound = vi.fn(() => { throw new Error("Page background tests must not call real AI or publication APIs"); });

beforeAll(async () => {
  await resetDb(); app = createApp(); vi.stubGlobal("fetch", outbound);
  const bytes = await sharp({ create: { width: 80, height: 100, channels: 3, background: "#385e4b" } }).withMetadata().png().toBuffer();
  upload = `data:image/png;base64,${bytes.toString("base64")}`;
  generatedPng = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#d9b87a" } }).png().toBuffer();
});
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });

async function fixture() {
  const { agent, csrf } = await login(app), H = { "x-csrf-token": csrf };
  const copy = discussionCardCopyFixture("set:n03");
  const payload = { ...emptyPayload("science_dialogue", "원문에 근거한 카드"), cardCopy: copy };
  const result = await getDb().transaction(async tx => {
    const [created] = await tx.insert(contentItems).values({ channelId: 2, kind: "science_dialogue", title: "원문에 근거한 카드", relevance: "relevant" }).returning();
    const revision = await createRevision(tx, { contentItemId: created.id, author: "operator", payload });
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, created.id));
    return { item, revision };
  });
  const endpoint = `/api/channels/2/items/${result.item.id}`;
  return { agent, H, copy, payload, endpoint, backgroundEndpoint: `${endpoint}/card-copy/background`, ...result };
}
function input(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  return { version: f.item.version, requestId: randomUUID(), pageId: "body-1", mode: "upload", imageData: upload, ...extra };
}
async function assets(itemId: number) {
  return getDb().select().from(mediaAssets).where(eq(mediaAssets.contentItemId, itemId));
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function enteredWithin(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Mock image provider was not entered")), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

describe("page-specific backgrounds on PostgreSQL", () => {
  it("requires authentication, CSRF, an owning channel, a version and a request UUID", async () => {
    const f = await fixture(), body = input(f);
    expect((await request(app).post(f.backgroundEndpoint).send(body)).status).toBe(401);
    expect((await f.agent.post(f.backgroundEndpoint).send(body)).status).toBe(403);
    expect((await f.agent.post(f.backgroundEndpoint.replace("/channels/2/", "/channels/1/")).set(f.H).send(body)).status).toBe(404);
    expect((await f.agent.post(f.backgroundEndpoint).set(f.H).send({ ...body, version: undefined })).status).toBe(400);
    expect((await f.agent.post(f.backgroundEndpoint).set(f.H).send({ ...body, requestId: undefined })).status).toBe(400);
    expect((await f.agent.post(f.backgroundEndpoint).set(f.H).send({ ...body, pageId: "body-9" })).status).toBe(400);
    expect(await assets(f.item.id)).toHaveLength(0);
  });

  it("stores a normalized proposal without editing copy, and returns the same result after a lost HTTP response", async () => {
    const f = await fixture(), body = input(f);
    const first = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ version: f.item.version, pageId: "body-1", source: "upload", credit: "직접 등록 이미지" });
    const again = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
    expect(again.body).toEqual(first.body);
    const stored = await assets(f.item.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "card_page_art", mime: "image/jpeg", revisionId: f.revision.id });
    expect((await sharp(stored[0].bytes).metadata()).exif).toBeUndefined();
    const [item] = await getDb().select().from(contentItems).where(eq(contentItems.id, f.item.id));
    const [revision] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, f.revision.id));
    expect(item.version).toBe(f.item.version);
    expect(item.currentRevisionId).toBe(f.revision.id);
    expect(revision.payload).toEqual(f.payload);
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, first.body.jobId)))[0];
    expect(job).toMatchObject({ status: "succeeded", maxAttempts: 1, payload: { pageBackground: true, pageId: "body-1" } });
    expect(JSON.stringify(job)).not.toContain("data:image/");
    const image = await f.agent.get(`${f.backgroundEndpoint}/${first.body.assetId}`);
    expect(image.status).toBe(200); expect(image.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(image.headers["cache-control"]).toContain("private");
    expect((await request(app).get(`${f.backgroundEndpoint}/${first.body.assetId}`)).status).toBe(401);
    expect((await f.agent.post(f.backgroundEndpoint).set(f.H).send({ ...body, pageId: "body-2" })).status).toBe(409);
  });

  it("rejects malformed uploads and enforces the raw 8MB limit without adding assets", async () => {
    const f = await fixture();
    for (const imageData of ["https://example.invalid/image.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,SGVsbG8="]) {
      const response = await f.agent.post(f.backgroundEndpoint).set(f.H).send(input(f, { imageData }));
      expect(response.status).toBe(400);
      expect(response.body.error).not.toContain("<svg");
    }
    const oversized = `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")}`;
    const response = await f.agent.post(f.backgroundEndpoint).set(f.H).send(input(f, { imageData: oversized }));
    expect(response.status).toBe(413);
    expect(await assets(f.item.id)).toHaveLength(0);
  });

  it("recovers an uploaded response with only a scoped request UUID and hides unrelated job records", async () => {
    const f = await fixture(), other = await fixture(), body = input(f);
    const first = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const lookup = `${f.endpoint}/card-copy/background-requests/${body.requestId}`;
    const recovered = await f.agent.get(lookup);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({ status: "succeeded", response: first.body });
    expect(recovered.headers["cache-control"]).toContain("private");
    expect((await request(app).get(lookup)).status).toBe(401);
    expect((await f.agent.get(lookup.replace("/channels/2/", "/channels/1/"))).status).toBe(404);
    expect((await other.agent.get(`${other.endpoint}/card-copy/background-requests/${body.requestId}`)).status).toBe(404);
    expect((await f.agent.get(`${f.endpoint}/card-copy/background-requests/${randomUUID()}`)).status).toBe(404);
    expect((await f.agent.get(`${f.endpoint}/card-copy/background-requests/not-a-uuid`)).status).toBe(400);
    for (const [type, pageBackground] of [["source_generate", true], ["card_render", false]] as const) {
      const unrelated = randomUUID();
      await getDb().insert(jobs).values({ type, channelId: 2, status: "succeeded", dedupeKey: `source-ai:${f.item.id}:${unrelated}`,
        payload: { itemId: f.item.id, pageBackground }, result: { response: { ...first.body, privateField: "must-not-return" } } });
      const response = await f.agent.get(`${f.endpoint}/card-copy/background-requests/${unrelated}`);
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain("must-not-return");
    }
    expect(await assets(f.item.id)).toHaveLength(1);
  });

  it("restricts backgrounds to their item, channel and asset kind while retaining reuse across revisions", async () => {
    const f = await fixture(), other = await fixture();
    const created = await f.agent.post(f.backgroundEndpoint).set(f.H).send(input(f));
    const id = created.body.assetId;
    expect((await other.agent.get(`${other.backgroundEndpoint}/${id}`)).status).toBe(404);
    expect((await f.agent.get(`${f.backgroundEndpoint.replace("/channels/2/", "/channels/1/")}/${id}`)).status).toBe(404);
    const copy = { ...f.copy, cover: { ...f.copy.cover, background: { assetId: id } } } as CardCopy;
    const loaded = await loadCardPageArtwork(getDb(), f.item.id, 2, copy);
    expect(loaded.has(id)).toBe(true);
    expect(loaded.credits.get(id)).toBe("직접 등록 이미지");
    await expect(loadCardPageArtwork(getDb(), other.item.id, 2, copy)).rejects.toMatchObject({ status: 404 });
    await getDb().transaction(async tx => { await createRevision(tx, { contentItemId: f.item.id, author: "operator", payload: { ...f.payload, cardCopy: copy } }); });
    expect((await loadCardPageArtwork(getDb(), f.item.id, 2, copy)).has(id)).toBe(true);
    await getDb().update(mediaAssets).set({ kind: "cover_art" }).where(eq(mediaAssets.id, id));
    await expect(loadCardPageArtwork(getDb(), f.item.id, 2, copy)).rejects.toMatchObject({ status: 404 });
    await getDb().update(mediaAssets).set({ kind: "card_page_art", bytes: Buffer.from("tampered") }).where(eq(mediaAssets.id, id));
    await expect(loadCardPageArtwork(getDb(), f.item.id, 2, copy)).rejects.toMatchObject({ status: 409 });
    expect((await f.agent.get(`${f.backgroundEndpoint}/${id}`)).status).toBe(409);
  });

  it("uses the channel image model, passes the saved page and explicit instruction, and does not rerun a completed request", async () => {
    const f = await fixture();
    const [originalChannel] = await getDb().select().from(channels).where(eq(channels.id, 2));
    await getDb().update(channels).set({ aiSettings: { summary: { provider: "gemini", model: "" }, copy: { provider: "openai", model: "" }, image: { provider: "openai", model: "gpt-image-1.5" } } }).where(eq(channels.id, 2));
    makeImage.mockReset(); makeImage.mockResolvedValue({ bytes: generatedPng, mimeType: "image/png", provider: "openai", model: "gpt-image-1.5" });
    const body = input(f, { mode: "ai", imageData: undefined, instruction: "중앙을 비우고 사물은 가장자리에 배치" });
    try {
      const first = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.source).toBe("ai");
      expect(makeImage).toHaveBeenCalledTimes(1);
      expect(makeImage.mock.calls[0][0]).toMatchObject({ model: "gpt-image-1.5", purpose: "cover", instruction: "중앙을 비우고 사물은 가장자리에 배치", signal: expect.any(AbortSignal) });
      expect(makeImage.mock.calls[0][0].prompt).toContain(f.copy.pages[0].body);
      expect(makeImage.mock.calls[0][0].prompt).not.toContain(f.copy.pages[1].title);
      await getDb().update(channels).set({ aiSettings: { ...originalChannel.aiSettings!, summary: { provider: "gemini", model: "" }, copy: { provider: "openai", model: "" }, image: { provider: "openai", model: "gpt-image-1" } } }).where(eq(channels.id, 2));
      await getDb().update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
      const replay = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
      expect(replay.body).toEqual(first.body);
      expect(makeImage).toHaveBeenCalledTimes(1);
    } finally { await getDb().update(channels).set({ aiSettings: originalChannel.aiSettings }).where(eq(channels.id, 2)); }
  });

  it("allows only one simultaneous paid attempt for an item", async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    makeImage.mockReset(); makeImage.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { bytes: generatedPng, mimeType: "image/png", provider: "openai", model: "gpt-image-1" }; });
    const body = input(f, { mode: "ai", imageData: undefined });
    const first = f.agent.post(f.backgroundEndpoint).set(f.H).send(body).then(response => response);
    try {
      await enteredWithin(entered.promise);
      const duplicate = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
      expect(duplicate.status).toBe(409); expect(duplicate.body.jobStatus).toBe("running");
      expect((await f.agent.get(`${f.endpoint}/card-copy/background-requests/${body.requestId}`)).body).toEqual({ status: "running" });
      const differentId = await f.agent.post(f.backgroundEndpoint).set(f.H).send({ ...body, requestId: randomUUID() });
      expect(differentId.status).toBe(409); expect(differentId.body.requestRejected).toBe(true);
      expect(makeImage).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); expect((await first).status).toBe(200); }
    expect(await assets(f.item.id)).toHaveLength(1);
  });

  it("rejects a late generated result after another editor saves and preserves the previous artwork", async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    const old = await f.agent.post(f.backgroundEndpoint).set(f.H).send(input(f));
    makeImage.mockReset(); makeImage.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { bytes: generatedPng, mimeType: "image/png", provider: "openai", model: "gpt-image-1" }; });
    const body = input(f, { mode: "ai", imageData: undefined });
    const pending = f.agent.post(f.backgroundEndpoint).set(f.H).send(body).then(response => response);
    try {
      await enteredWithin(entered.promise);
      await getDb().update(contentItems).set({ version: f.item.version + 1, title: "다른 편집기의 최신 제목" }).where(eq(contentItems.id, f.item.id));
    } finally { release.resolve(); }
    const result = await pending;
    expect(result.status).toBe(409);
    expect((await assets(f.item.id)).map(asset => asset.id)).toEqual([old.body.assetId]);
    expect((await getDb().select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].title).toBe("다른 편집기의 최신 제목");
    const replay = await f.agent.post(f.backgroundEndpoint).set(f.H).send(body);
    expect(replay.body.jobStatus).toBe("failed"); expect(makeImage).toHaveBeenCalledTimes(1);
  });

  it("fences cancellation and a provider failure without replaying a paid call or losing stored input", async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    makeImage.mockReset(); makeImage.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { bytes: generatedPng, mimeType: "image/png", provider: "openai", model: "gpt-image-1" }; });
    const body = input(f, { mode: "ai", imageData: undefined });
    const pending = f.agent.post(f.backgroundEndpoint).set(f.H).send(body).then(response => response);
    try {
      await enteredWithin(entered.promise);
      expect((await cancelSourceGenerationRequest(getDb(), f.item.id, body.requestId, "isolated-test")).cancelled).toBe(true);
    } finally { release.resolve(); }
    expect((await pending).body.jobStatus).toBe("cancelled");
    expect((await f.agent.get(`${f.endpoint}/card-copy/background-requests/${body.requestId}`)).body).toMatchObject({ status: "cancelled", error: expect.any(String) });
    expect(await assets(f.item.id)).toHaveLength(0);
    makeImage.mockReset(); makeImage.mockRejectedValue(new Error("private-upstream-error-with-secret"));
    const failedBody = input(f, { mode: "ai", imageData: undefined });
    const failed = await f.agent.post(f.backgroundEndpoint).set(f.H).send(failedBody);
    expect(failed.status).toBe(422); expect(failed.body.error).not.toContain("private-upstream");
    expect((await f.agent.post(f.backgroundEndpoint).set(f.H).send(failedBody)).body.jobStatus).toBe("failed");
    const failedLookup = await f.agent.get(`${f.endpoint}/card-copy/background-requests/${failedBody.requestId}`);
    expect(failedLookup.body).toMatchObject({ status: "failed", error: expect.any(String) });
    expect(JSON.stringify(failedLookup.body)).not.toContain("private-upstream");
    expect(makeImage).toHaveBeenCalledTimes(1);
    expect((await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, f.revision.id)))[0].payload).toEqual(f.payload);
    makeImage.mockReset(); makeImage.mockRejectedValue(new AiServiceError("설정에서 OpenAI API 키를 먼저 입력하세요.", "not_configured"));
    expect((await f.agent.post(f.backgroundEndpoint).set(f.H).send(input(f, { mode: "ai", imageData: undefined }))).status).toBe(503);
  });
});
