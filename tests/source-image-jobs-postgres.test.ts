import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { login, resetDb, setTestEnv } from "./helpers";
import { emptyPayload } from "../shared/payloads";

setTestEnv();
process.env.OPENAI_API_KEY = "isolated-image-test-key";
const image = vi.hoisted(() => vi.fn());
vi.mock("../server/services/studioAi", async original => ({ ...await original<object>(), generateStudioImage: (...args: unknown[]) => image(...args) }));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { contentItems, jobs, mediaAssets } = await import("../shared/schema");
let app: ReturnType<typeof createApp>, bytes: Buffer;
const outbound = vi.fn(() => { throw new Error("External calls are blocked in source image tests"); });
beforeAll(async () => {
  await resetDb(); app = createApp();
  bytes = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#16bd49" } }).png().toBuffer();
  vi.stubGlobal("fetch", outbound);
});
beforeEach(() => { image.mockReset().mockResolvedValue({ bytes, model: "isolated-image" }); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY; await closeDb(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function fixture() {
  const { agent, csrf } = await login(app), headers = { "x-csrf-token": csrf };
  const created = await agent.post("/api/channels/2/items").set(headers).send({ title: "자동 이미지와 원고 보존" });
  expect(created.status).toBe(201);
  const id = created.body.id, path = `/api/channels/2/items/${id}`;
  const initial = (await agent.get(path)).body;
  const payload = { ...emptyPayload("science_dialogue", "관찰하는 과학"), cardCopy: {
    version: 1, templateKey: "set:n03", cover: { title: "관찰하는 과학", subtitle: "확인한 사실을 나눠요" },
    pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i}`, title: `과학 이야기 ${i + 1}`, subtitle: "", body: "원문에서 확인한 사실을 함께 살펴봅니다." })),
  } };
  const saved = await agent.patch(path).set(headers).send({ version: initial.item.version, payload });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return { agent, headers, id, path, payload, body: { version: saved.body.version, templateKey: "set:n03", coverMode: "ai", requestId: randomUUID() } };
}
async function assetCount(itemId: number) { return (await getDb().select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.contentItemId, itemId))).length; }

describe("durable source cover rendering on real PostgreSQL", () => {
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
    const f = await fixture(), entered = deferred(), release = deferred();
    image.mockImplementation(async () => { entered.resolve(); await release.promise; return { bytes, model: "isolated-image" }; });
    const first = f.agent.post(`${f.path}/card`).set(f.headers).send(f.body).then(value => value);
    await entered.promise;
    try {
      const duplicate = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
      expect(duplicate.status).toBe(409); expect(duplicate.body.jobStatus).toBe("running");
      const different = await f.agent.post(`${f.path}/card`).set(f.headers).send({ ...f.body, requestId: randomUUID() });
      expect(different.status).toBe(409); expect(image).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); }
    expect((await first).status).toBe(200);
  });

  it("cancels before result persistence and never applies a late external image", async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    image.mockImplementation(async () => { entered.resolve(); await release.promise; return { bytes, model: "isolated-image" }; });
    const first = f.agent.post(`${f.path}/card`).set(f.headers).send(f.body).then(value => value);
    await entered.promise;
    try {
      const cancelled = await f.agent.post(`${f.path}/generation-cancel`).set(f.headers).send({ requestId: f.body.requestId });
      expect(cancelled.status).toBe(200); expect(cancelled.body.cancelled).toBe(true);
    } finally { release.resolve(); }
    const response = await first; expect([409, 422]).toContain(response.status); expect(response.body.jobStatus).toBe("cancelled");
    expect(await assetCount(f.id)).toBe(0);
    const again = await f.agent.post(`${f.path}/card`).set(f.headers).send(f.body);
    expect(again.body.jobStatus).toBe("cancelled"); expect(image).toHaveBeenCalledTimes(1);
  });

  it("does not save an old image over a concurrently edited source version", async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    image.mockImplementation(async () => { entered.resolve(); await release.promise; return { bytes, model: "isolated-image" }; });
    const first = f.agent.post(`${f.path}/card`).set(f.headers).send(f.body).then(value => value);
    await entered.promise;
    try {
      const saved = await f.agent.patch(f.path).set(f.headers).send({ version: f.body.version, payload: { ...f.payload, key_question: "최신 운영자 질문" } });
      expect(saved.status).toBe(200);
    } finally { release.resolve(); }
    expect((await first).status).toBe(409); expect(await assetCount(f.id)).toBe(0);
    const [current] = await getDb().select().from(contentItems).where(eq(contentItems.id, f.id));
    expect(current.edited?.key_question).toBe("최신 운영자 질문"); expect(image).toHaveBeenCalledTimes(1);
  });
});
