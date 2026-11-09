import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { login, resetDb, setTestEnv } from "./helpers";
import type { CardCopy } from "../shared/cardCopy";

setTestEnv();
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { createRevision } = await import("../server/content");
const { emptyPayload } = await import("../shared/payloads");
const { channels, contentItems, contentRevisions, jobs, mediaAssets, notionSyncLinks } = await import("../shared/schema");
const db = getDb();
let app: ReturnType<typeof createApp>;
const fetchSpy = vi.fn(() => { throw new Error("No outbound requests are permitted in this suite"); });

beforeAll(() => {
  const url = new URL(process.env.APP_DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/spacepenguin_test") throw new Error("Isolated loopback test DB required");
});
beforeEach(async () => {
  await resetDb();
  app = createApp();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(closeDb);

function copy(corePages: number): CardCopy {
  return { version: 1, templateKey: "builtin:classic", cover: { title: "보존할 표지", subtitle: "원래 부제" }, pages: Array.from({ length: corePages - 1 }, (_, i) => ({ id: `body-${i + 1}`, title: `기관 ${i + 1}`, subtitle: "학생 지원", body: `보존할 기관별 일정 ${i + 1}` })) };
}
async function attachLink(itemId: number, channelId: number) {
  const [link] = await db.insert(notionSyncLinks).values({
    notionPageId: `isolated-notion-${itemId}`, notionUrl: `https://www.notion.so/isolated-${itemId}`, channelId, contentItemId: itemId,
    sourceHash: "a".repeat(64), baseCopyHash: "b".repeat(64), sourceEditedAt: "2026-11-10T00:00:00Z", sourceSnapshot: { protectedSource: "원문·각주·독립 메모 보존" },
  }).returning();
  return link;
}
async function fixture(corePages = 20, linked = true, alternateChannel = false) {
  const seeded = await db.select().from(channels);
  const channel = seeded.find(ch => alternateChannel ? ch.contentType === "science_dialogue" : ch.slug === "opportunities" || ch.slug === "highscoop")!;
  const [created] = await db.insert(contentItems).values({ channelId: channel.id, kind: channel.contentType, origin: "manual", title: "테스트 원고", topicKey: "테스트 원고" }).returning();
  const savedCopy = copy(corePages);
  const revision = await createRevision(db, { contentItemId: created.id, author: "operator", payload: { ...emptyPayload(channel.contentType, created.title), cardCopy: savedCopy, notionDesignEdits: { emphasisByPage: { "body-1": "보존할" } } } });
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, created.id));
  const link = linked ? await attachLink(item.id, channel.id) : undefined;
  const { agent, csrf } = await login(app);
  return { agent, headers: { "x-csrf-token": csrf }, channel, item, revision, savedCopy, link, endpoint: `/api/channels/${channel.id}/items/${item.id}` };
}

describe("Notion-linked manuscripts cannot enter generic card/source editors", () => {
  it.each([2, 20])("preserves a %i-core manuscript across legacy read, edit, proposal, preview, render and restore requests", async corePages => {
    const f = await fixture(corePages, true, corePages === 2);
    const beforeJobs = await db.select().from(jobs), beforeMedia = await db.select().from(mediaAssets);
    const calls = [
      () => f.agent.get(`${f.endpoint}/card-copy`),
      () => f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy: copy(2) }),
      () => f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ copy: { version: 2 } }),
      () => f.agent.post(`${f.endpoint}/card-copy/manual-initialize`).set(f.headers).send({}),
      () => f.agent.post(`${f.endpoint}/card-copy/caption-confirm`).set(f.headers).send({}),
      () => f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send({}),
      () => f.agent.post(`${f.endpoint}/card-copy/generate`).set(f.headers).send({ formatId: "family_dialogue_8" }),
      () => f.agent.post(`${f.endpoint}/card-copy/preview`).set(f.headers).send({}),
      () => f.agent.post(`${f.endpoint}/card-copy/preview`).set(f.headers).send({ copy: { version: 2 } }),
      () => f.agent.post(`${f.endpoint}/card`).set(f.headers).send({}),
      () => f.agent.patch(f.endpoint).set(f.headers).send({ version: f.item.version, payload: emptyPayload(f.item.kind, "이전 편집기 원고") }),
      () => f.agent.post(`${f.endpoint}/generate`).set(f.headers).send({}),
      () => f.agent.post(`${f.endpoint}/revisions/${f.revision.id}/restore`).set(f.headers).send({ version: f.item.version }),
    ];
    for (const call of calls) {
      const response = await call();
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body).toMatchObject({ code: "notion_editor_required", linkId: f.link!.id, studioUrl: `http://127.0.0.1/notion?link=${f.link!.id}` });
    }
    expect(await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id))).toEqual([f.revision]);
    expect((await db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0]).toEqual(f.item);
    expect(await db.select().from(jobs)).toEqual(beforeJobs);
    expect(await db.select().from(mediaAssets)).toEqual(beforeMedia);
    expect((await db.select().from(notionSyncLinks))[0].sourceSnapshot).toEqual({ protectedSource: "원문·각주·독립 메모 보존" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps authentication, CSRF and channel scoping ahead of the editor redirect", async () => {
    const f = await fixture();
    expect((await request(app).get(`${f.endpoint}/card-copy`)).status).toBe(401);
    expect((await request(app).post(`${f.endpoint}/card`).send({})).status).toBe(401);
    expect((await f.agent.patch(`${f.endpoint}/card-copy`).send({})).status).toBe(403);
    const wrongChannel = (await db.select().from(channels)).find(ch => ch.id !== f.channel.id)!;
    const wrong = f.endpoint.replace(`/channels/${f.channel.id}/`, `/channels/${wrongChannel.id}/`);
    const response = await f.agent.get(`${wrong}/card-copy`);
    expect(response.status).toBe(404);
    expect(response.body.studioUrl).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("continues to read and save exact copy for an unlinked generic item", async () => {
    const f = await fixture(2, false);
    const read = await f.agent.get(`${f.endpoint}/card-copy`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.copy).toEqual(f.savedCopy);
    const edited = structuredClone(f.savedCopy); edited.pages[0].body = "일반 카드의 수정 문구";
    const saved = await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy: edited });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.copy).toEqual(edited);
    expect((await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id))).at(-1)!.payload.cardCopy).toEqual(edited);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["card-copy", "source"])("rejects a Notion link created after the first %s check and before the item write lock", async route => {
    const f = await fixture(2, false);
    const query = pg.Client.prototype.query;
    let injectedLink: Awaited<ReturnType<typeof attachLink>> | undefined;
    let injecting = false;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof query>) {
      const config = args[0] as unknown as { text?: string };
      if (!injecting && config.text?.includes('from "content_items"') && config.text.includes("for update")) {
        injecting = true;
        return attachLink(f.item.id, f.channel.id).then(link => { injectedLink = link; return (query as Function).apply(this, args); });
      }
      return (query as Function).apply(this, args);
    } as typeof query);
    try {
      const edited = structuredClone(f.savedCopy); edited.pages[0].body = "旧편집기가 저장하려 한 문구";
      const response = route === "card-copy"
        ? await f.agent.patch(`${f.endpoint}/card-copy`).set(f.headers).send({ version: f.item.version, copy: edited })
        : await f.agent.patch(f.endpoint).set(f.headers).send({ version: f.item.version, payload: emptyPayload(f.item.kind, "구형 편집기") });
      expect(injectedLink).toBeDefined();
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body).toMatchObject({ code: "notion_editor_required", linkId: injectedLink!.id });
      expect(await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id))).toEqual([f.revision]);
      expect((await db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0]).toEqual(f.item);
    } finally { spy.mockRestore(); }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
