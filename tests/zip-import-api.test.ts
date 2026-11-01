import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { zipSync, unzipSync, strToU8 } from "fflate";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { login, resetDb, setTestEnv } from "./helpers";
setTestEnv();
const mocks = vi.hoisted(() => ({ response: vi.fn() }));
vi.mock("../server/services/llm", async original => ({ ...await original<object>(), openaiRequest: mocks.response }));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { studioCards, studioImages, approvals, deliveries, channels } = await import("../shared/schema");
let app: ReturnType<typeof createApp>, archive: Buffer, png: Buffer;
beforeAll(async () => {
  await resetDb(); app = createApp();
  png = await sharp({ create: { width: 40, height: 60, channels: 3, background: "red" } }).png().toBuffer();
  const second = await sharp({ create: { width: 60, height: 60, channels: 3, background: "blue" } }).png().toBuffer();
  archive = Buffer.from(zipSync({ "모음/01_김펭귄/01.png": png, "모음/01_김펭귄/02.png": second, "모음/02_김펭키/01.png": second, "모음/게시글_초안.txt": strToU8("[01 김펭귄]\n첫째의 게시글\n\n[02 김펭키]\n막내의 게시글"), "모음/README.md": strToU8("아빠는 사진기자, 엄마는 사업기획자") }));
});
afterAll(closeDb);
async function imported() {
  const { agent, csrf } = await login(app), H = { "x-csrf-token": csrf };
  const r = await agent.post("/api/studio/import-zip?channel=penguin").set({ ...H, "Content-Type": "application/zip" }).send(archive);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const card = (await agent.get(`/api/studio/cards/${r.body.cards[0].id}`)).body.card;
  return { agent, H, r, card };
}
describe("ZIP to the existing finished-deck editor and publication flow", () => {
  it("requires login and CSRF, and rejects corrupt images without partial writes", async () => {
    expect((await request(app).post("/api/studio/import-zip?channel=penguin").set("Content-Type", "application/zip").send(archive)).status).toBe(401);
    const { agent, csrf } = await login(app);
    expect((await agent.post("/api/studio/import-zip?channel=penguin").set("Content-Type", "application/zip").send(archive)).status).toBe(403);
    const before = await getDb().select({ id: studioCards.id }).from(studioCards);
    const bad = Buffer.from(zipSync({ "01/1.png": png, "02/1.png": strToU8("not an image") }));
    expect((await agent.post("/api/studio/import-zip?channel=penguin").set({ "x-csrf-token": csrf, "Content-Type": "application/zip" }).send(bad)).status).toBe(400);
    expect(await getDb().select({ id: studioCards.id }).from(studioCards)).toEqual(before);
  });
  it("imports ordered drafts and captions, preserves exact originals, and deduplicates concurrent retries", async () => {
    const { agent, H, r, card } = await imported();
    expect(r.body).toMatchObject({ imported: 2, skipped: 0, pageCount: 3 });
    expect(card).toMatchObject({ caption: "첫째의 게시글", stage: "review", memo: "아빠는 사진기자, 엄마는 사업기획자", sourceItemId: null });
    expect(card.finishedDeck.pages.map((p: any) => p.name)).toEqual(["01.png", "02.png"]);
    const [original] = await getDb().select().from(studioImages).where(eq(studioImages.id, card.finishedDeck.pages[0].imageId)); expect(original.bytes).toEqual(png);
    const upload = () => agent.post("/api/studio/import-zip?channel=penguin").set({ ...H, "Content-Type": "application/zip" }).send(archive);
    for (const result of await Promise.all([upload(), upload()])) expect(result.body).toMatchObject({ imported: 0, skipped: 2 });
    expect(await getDb().select().from(approvals)).toHaveLength(0); expect(await getDb().select().from(deliveries)).toHaveLength(0);
    const response = await agent.get(`/api/studio/cards/${card.id}/original.zip`).buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on("data", c => chunks.push(c)); res.on("end", () => done(null, Buffer.concat(chunks))); });
    const files = unzipSync(response.body); expect(Buffer.from(files["page-01.png"])).toEqual(png); expect(new TextDecoder().decode(files["caption.txt"])).toBe(card.caption);
  });
  it("uses the existing editable deck and publishing preparation with the user's saved order and caption", async () => {
    const { agent, H, card } = await imported();
    const pages = card.finishedDeck.pages.slice().reverse().map((p: any, i: number) => ({ ...p, altText: `${i + 1}번째 그림 설명` }));
    const saved = await agent.patch(`/api/studio/cards/${card.id}`).set(H).send({ version: card.version, caption: "직접 고친 게시글", finishedDeck: { pages } });
    expect(saved.status).toBe(200);
    const stale = await agent.post(`/api/studio/cards/${card.id}/publication/prepare`).set(H).send({ version: card.version }); expect(stale.status).toBe(409);
    const preview = await agent.post(`/api/studio/cards/${card.id}/publication/prepare`).set(H).send({ version: saved.body.version });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200); expect(preview.body.caption).toBe("직접 고친 게시글"); expect(preview.body.pages.map((p: any) => p.altText)).toEqual(pages.map((p: any) => p.altText));
    expect(await getDb().select().from(approvals)).toHaveLength(0); expect(await getDb().select().from(deliveries)).toHaveLength(0);
  });
  it("returns AI suggestions without changing saved data and rejects wrong page counts and stale results", async () => {
    const { agent, H, card } = await imported();
    const draft = { caption: "AI 제안 캡션", altTexts: card.finishedDeck.pages.map((_: unknown, i: number) => `${i + 1}장 그림과 글`) };
    const response = (value: object) => ({ output: [{ type: "function_call", name: "suggest_caption", arguments: JSON.stringify(value) }] });
    mocks.response.mockResolvedValueOnce(response(draft));
    const result = await agent.post(`/api/studio/cards/${card.id}/imported-ai`).set(H).send({ version: card.version, instruction: "짧게 다듬어 줘" });
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ ...draft, version: card.version });
    expect((await agent.get(`/api/studio/cards/${card.id}`)).body.card.caption).toBe(card.caption);
    const body = mocks.response.mock.calls[0][1]; expect(body.input[0].content.filter((p: any) => p.type === "input_image")).toHaveLength(card.finishedDeck.pages.length);
    mocks.response.mockResolvedValueOnce(response({ ...draft, altTexts: [] }));
    expect((await agent.post(`/api/studio/cards/${card.id}/imported-ai`).set(H).send({ version: card.version })).status).toBe(502);
    mocks.response.mockImplementationOnce(async () => { await agent.patch(`/api/studio/cards/${card.id}`).set(H).send({ version: card.version, caption: "생성 중 직접 편집" }); return response(draft); });
    expect((await agent.post(`/api/studio/cards/${card.id}/imported-ai`).set(H).send({ version: card.version })).status).toBe(409);
  });
  it("returns trashed duplicates without silently restoring and refuses an archived channel", async () => {
    const { agent, H, card } = await imported();
    expect((await agent.post(`/api/studio/cards/${card.id}/trash`).set(H).send({ version: card.version })).status).toBe(200);
    const again = await agent.post("/api/studio/import-zip?channel=penguin").set({ ...H, "Content-Type": "application/zip" }).send(archive);
    expect(again.body.cards[0]).toMatchObject({ id: card.id, duplicate: true, trashed: true });
    expect((await agent.get(`/api/studio/cards/${card.id}/original.zip`)).status).toBe(409);
    await getDb().update(channels).set({ active: false }).where(eq(channels.slug, "penguin"));
    expect((await agent.post("/api/studio/import-zip?channel=penguin").set({ ...H, "Content-Type": "application/zip" }).send(archive)).status).toBe(400);
  });
});
