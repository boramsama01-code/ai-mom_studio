import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { login, resetDb, setTestEnv } from "./helpers";
import { publicationKstDate, type PublicationOptions } from "../shared/publicationDraft";
import { approvals, contentItems, contentRevisions, deliveries, destinations, mediaAssets, studioCards, studioRevisions } from "../shared/schema";

setTestEnv();
const mocks = vi.hoisted(() => ({ identity: vi.fn(), quota: vi.fn() }));
vi.mock("../server/services/instagram", async importOriginal => ({
  ...await importOriginal<typeof import("../server/services/instagram")>(),
  accountIdentity: mocks.identity, publishingLimit: mocks.quota,
}));
const { publicationFixture, publicationAccounts } = await import("./fixtures/publication");
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const app = createApp();
beforeAll(resetDb);
afterAll(closeDb);
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({ AUTO_PUBLISH: "true", DRY_RUN: "false", INLINE_WORKER: "false", INSTAGRAM_API_VERSION: "v26.0", CLOUDINARY_CLOUD_NAME: "fixture", CLOUDINARY_API_KEY: "fixture", CLOUDINARY_API_SECRET: "fixture" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Publication draft tests must not contact external services"); }));
  mocks.identity.mockImplementation(async (token: string) => ({ ok: true, ...publicationAccounts.get(token) }));
  mocks.quota.mockResolvedValue({ ok: true, used: 0, total: 100 });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const captions = { instagram: "저장한 게시 캡션", telegram: "보조 채널 캡션" };
const futureKst = () => new Date(Date.now() + 7 * 86400000 + 9 * 3600000).toISOString().slice(0, 16);
const postingOptions = (destinationId: number): PublicationOptions => ({ destinationIds: [destinationId], timing: "later", scheduledAtKst: futureKst() });

async function sourceFixture() {
  const f = await publicationFixture("cancelled"), auth = await login(app);
  return { ...f, ...auth, H: { "x-csrf-token": auth.csrf }, path: `/api/channels/${f.channel.id}/items/${f.item.id}` };
}
type SourceFixture = Awaited<ReturnType<typeof sourceFixture>>;
async function sourceSave(f: SourceFixture, version: number, options?: PublicationOptions, copy = captions) {
  return f.agent.patch(`${f.path}/publication-draft`).set(f.H).send({ version, captions: copy, ...(options ? { options } : {}) });
}
function sourceApproval(f: SourceFixture, options: PublicationOptions, publicationDraftVersion = 1) {
  return { revisionId: f.revision.id, mediaAssetId: f.asset.id, publicationDraftVersion, captions, destinationIds: options.destinationIds, timing: options.timing,
    ...(options.timing === "later" ? { scheduledAt: publicationKstDate(options.scheduledAtKst)?.toISOString() } : {}) };
}

async function studioFixture(prepared = false) {
  const f = await sourceFixture();
  const created = await f.agent.post("/api/studio/cards").set(f.H).send({ title: "직접 제작 게시 의도", channel: f.channel.slug, caption: captions.instagram });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const card = created.body;
  if (prepared) {
    await f.db.update(contentItems).set({ origin: "studio" }).where(eq(contentItems.id, f.item.id));
    await f.db.update(contentRevisions).set({ payload: { title: card.title, summary: card.caption, studioCardId: card.id, studioVersion: card.version } }).where(eq(contentRevisions.id, f.revision.id));
    await f.db.update(studioCards).set({ sourceItemId: f.item.id, importedMeta: { studioPublication: true, publishedVersion: card.version, generatedAssetId: f.asset.id } }).where(eq(studioCards.id, card.id));
    await f.db.update(mediaAssets).set({ carousel: { version: 1, altVersion: 1, pages: [{ id: f.asset.id, sha256: f.asset.sha256, title: card.title, altText: "저장된 직접 제작 이미지 설명." }], cover: { kind: "typography", credit: "격리 테스트 미리보기" } } }).where(eq(mediaAssets.id, f.asset.id));
  }
  return { ...f, card, studioPath: `/api/studio/cards/${card.id}` };
}
type StudioFixture = Awaited<ReturnType<typeof studioFixture>>;
async function studioSave(f: StudioFixture, version: number, options: PublicationOptions) {
  return f.agent.patch(`${f.studioPath}/publication-draft`).set(f.H).send({ version, options });
}
function studioApproval(f: StudioFixture, options: PublicationOptions, publicationDraftVersion = 1) {
  return { version: f.card.version, assetId: f.asset.id, destinationId: options.destinationIds[0], publicationDraftVersion, timing: options.timing,
    ...(options.timing === "later" ? { scheduledAt: publicationKstDate(options.scheduledAtKst)?.toISOString() } : {}) };
}

// Real PostgreSQL transactions/CAS and HTTP session/CSRF. Only read-only provider
// identity/quota verification is mocked; no publication, rendering or AI request.
describe("persistent publication intentions on PostgreSQL", () => {
  it("reopens source account/mode/KST choices without changing the content or image revision", async () => {
    const f = await sourceFixture(), options = postingOptions(f.destination.id);
    const before = (await f.agent.get(f.path)).body;
    const saved = await sourceSave(f, 0, options);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ version: 1, captions, options });
    const reopened = (await f.agent.get(f.path)).body;
    expect(reopened.publicationDraft).toEqual(saved.body);
    expect(reopened.item.version).toBe(before.item.version);
    expect(reopened.current.id).toBe(before.current.id);
    expect(reopened.cards).toEqual(before.cards);
    expect(reopened.approvals.map((row: any) => row.id)).toEqual(before.approvals.map((row: any) => row.id));
    expect(reopened.deliveries.map((row: any) => row.d.id)).toEqual(before.deliveries.map((row: any) => row.d.id));
    expect(mocks.identity).not.toHaveBeenCalled();
    // Old caption-only clients cannot clear options saved by a newer editor.
    const legacy = await sourceSave(f, 1, undefined, { ...captions, instagram: "이전 클라이언트의 캡션 수정" });
    expect(legacy.body).toEqual({ version: 2, captions: { ...captions, instagram: "이전 클라이언트의 캡션 수정" }, options });
    expect((await sourceSave(f, 2, undefined, legacy.body.captions)).body.version).toBe(2);
  });

  it("stores empty/past source inputs but rejects unknown, foreign and duplicate destinations atomically", async () => {
    const f = await sourceFixture(), foreign = await publicationFixture("cancelled");
    const empty: PublicationOptions = { destinationIds: [], timing: "later", scheduledAtKst: "" };
    expect((await sourceSave(f, 0, empty)).body).toMatchObject({ version: 1, options: empty });
    const options = { ...postingOptions(f.destination.id), scheduledAtKst: "2000-01-01T00:00" };
    await f.db.update(destinations).set({ enabled: false, secretRefs: {} }).where(eq(destinations.id, f.destination.id));
    expect((await sourceSave(f, 1, options)).status).toBe(200); // draft does not require a usable connection
    for (const destinationIds of [[2147483647], [foreign.destination.id], [f.destination.id, f.destination.id]]) {
      const bad = await sourceSave(f, 2, { ...options, destinationIds });
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    }
    expect((await f.agent.get(f.path)).body.publicationDraft).toEqual({ version: 2, captions, options });
    expect((await f.agent.patch(`${f.path}/publication-draft`).send({ version: 2, captions, options })).status).toBe(403);
    expect((await request(app).get(f.path)).status).toBe(401);
    expect((await f.agent.patch(f.path.replace(`/channels/${f.channel.id}/`, `/channels/${foreign.channel.id}/`) + "/publication-draft").set(f.H).send({ version: 2, captions, options })).status).toBe(404);
  });

  it("allows one concurrent source intent save and exposes the winning complete draft", async () => {
    const f = await sourceFixture(), options = postingOptions(f.destination.id);
    const results = await Promise.all([sourceSave(f, 0, options), sourceSave(f, 0, { ...options, timing: "now" })]);
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    const winner = results.find(row => row.status === 200)!;
    expect((await f.agent.get(f.path)).body.publicationDraft).toEqual(winner.body);
  });

  it("requires the exact saved source version, selected destination and KST instant for approval", async () => {
    const f = await sourceFixture(), options = postingOptions(f.destination.id);
    expect((await sourceSave(f, 0, options)).status).toBe(200);
    const body = sourceApproval(f, options);
    for (const patch of [{ publicationDraftVersion: 0 }, { publicationDraftVersion: undefined }, { destinationIds: [2147483647] }, { timing: "now" }, { scheduledAt: new Date(publicationKstDate(options.scheduledAtKst)!.getTime() + 3600000).toISOString() }]) {
      const rejected = await f.agent.post(`${f.path}/approve`).set(f.H).send({ ...body, ...patch });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
    }
    const approved = await f.agent.post(`${f.path}/approve`).set(f.H).send(body);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.approval.scheduledAt).toBe(publicationKstDate(options.scheduledAtKst)!.toISOString());
    const rows = await f.db.select().from(deliveries).where(eq(deliveries.approvalId, approved.body.approval.id));
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ destinationId: f.destination.id, status: "scheduled" });
  });

  it("blocks incomplete saved source intentions even if an approval request supplies complete values", async () => {
    const f = await sourceFixture(), options = postingOptions(f.destination.id);
    for (const [index, incomplete] of [{ ...options, destinationIds: [] }, { ...options, scheduledAtKst: "" }, { ...options, scheduledAtKst: "2000-01-01T00:00" }].entries()) {
      expect((await sourceSave(f, index, incomplete)).status).toBe(200);
      const response = await f.agent.post(`${f.path}/approve`).set(f.H).send(sourceApproval(f, options, index + 1));
      expect(response.status, JSON.stringify(response.body)).toBe(400);
    }
    expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(1);
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it("saves Studio choices before preview and reopens them independently of content saves", async () => {
    const f = await studioFixture(), options = postingOptions(f.destination.id);
    expect((await f.agent.get(`${f.studioPath}/publication-draft`)).body).toEqual({ version: 0 });
    const beforeImages = await f.db.select({ id: mediaAssets.id }).from(mediaAssets);
    const beforeRevisions = await f.db.select().from(studioRevisions).where(eq(studioRevisions.cardId, f.card.id));
    const saved = await studioSave(f, 0, options);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ version: 1, options });
    expect((await f.agent.get(`${f.studioPath}/publication`)).body.publicationDraft).toEqual(saved.body);
    const [stored] = await f.db.select().from(studioCards).where(eq(studioCards.id, f.card.id));
    expect(stored).toMatchObject({ version: f.card.version, sourceItemId: null, importedMeta: null });
    expect(stored.content.caption).toBe(f.card.caption);
    expect(await f.db.select({ id: mediaAssets.id }).from(mediaAssets)).toEqual(beforeImages);
    expect(await f.db.select().from(studioRevisions).where(eq(studioRevisions.cardId, f.card.id))).toEqual(beforeRevisions);
    const contentSave = await f.agent.patch(f.studioPath).set(f.H).send({ version: f.card.version, title: "별도로 저장한 원고" });
    expect(contentSave.status, JSON.stringify(contentSave.body)).toBe(200);
    expect((await f.agent.get(`${f.studioPath}/publication-draft`)).body).toEqual(saved.body);
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it("CAS-protects Studio intent and rejects channel/platform crossing without losing incomplete values", async () => {
    const f = await studioFixture(), foreign = await publicationFixture("cancelled");
    const options = postingOptions(f.destination.id);
    const results = await Promise.all([studioSave(f, 0, options), studioSave(f, 0, { destinationIds: [], timing: "later", scheduledAtKst: "" })]);
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    const winner = results.find(row => row.status === 200)!;
    const [telegram] = await f.db.insert(destinations).values({ channelId: f.channel.id, platform: "telegram_channel", label: "드래프트 대상 검증", enabled: false }).returning();
    for (const destinationIds of [[2147483647], [foreign.destination.id], [telegram.id], [f.destination.id, telegram.id]]) expect((await studioSave(f, 1, { ...options, destinationIds })).status).toBe(400);
    expect((await f.agent.get(`${f.studioPath}/publication-draft`)).body).toEqual(winner.body);
    expect((await f.agent.patch(`${f.studioPath}/publication-draft`).send({ version: 1, options })).status).toBe(403);
    expect((await request(app).get(`${f.studioPath}/publication-draft`)).status).toBe(401);
  });

  it("changes Studio posting intentions without regenerating an existing preview and cancels only its queued approval", async () => {
    const f = await studioFixture(true), options = postingOptions(f.destination.id);
    expect((await studioSave(f, 0, options)).status).toBe(200);
    const before = await f.agent.post(`${f.studioPath}/publication/prepare`).set(f.H).send({ version: f.card.version });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const approved = await f.agent.post(`${f.studioPath}/publication/approve`).set(f.H).send(studioApproval(f, options));
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const updated = await studioSave(f, 1, { ...options, timing: "now" });
    expect(updated.body.version).toBe(2);
    const after = await f.agent.post(`${f.studioPath}/publication/prepare`).set(f.H).send({ version: f.card.version });
    expect(after.body).toEqual(before.body);
    expect((await f.db.select().from(approvals).where(eq(approvals.id, approved.body.approvalId)))[0].status).toBe("invalidated");
    expect((await f.db.select().from(deliveries).where(eq(deliveries.approvalId, approved.body.approvalId)))[0].status).toBe("cancelled");
    expect((await f.db.select().from(studioCards).where(eq(studioCards.id, f.card.id)))[0].version).toBe(f.card.version);
  });

  it("requires the saved Studio intent on both Studio approval and its content-item mirror", async () => {
    const f = await studioFixture(true), options = postingOptions(f.destination.id);
    expect((await sourceSave(f, 0, options)).status).toBe(409);
    expect((await studioSave(f, 0, options)).status).toBe(200);
    const body = studioApproval(f, options);
    for (const patch of [{ publicationDraftVersion: 0 }, { publicationDraftVersion: undefined }, { destinationId: 2147483647 }, { timing: "now" }, { scheduledAt: new Date(publicationKstDate(options.scheduledAtKst)!.getTime() + 3600000).toISOString() }]) {
      const rejected = await f.agent.post(`${f.studioPath}/publication/approve`).set(f.H).send({ ...body, ...patch });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
    }
    const mirror = await f.agent.post(`${f.path}/approve`).set(f.H).send({ ...sourceApproval(f, options), timing: "now" });
    expect(mirror.status, JSON.stringify(mirror.body)).toBe(409);
    const approved = await f.agent.post(`${f.studioPath}/publication/approve`).set(f.H).send(body);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.scheduledAt).toBe(publicationKstDate(options.scheduledAtKst)!.toISOString());
  });

  it("does not create a second Studio posting draft for a source workspace", async () => {
    const f = await studioFixture(), options = postingOptions(f.destination.id);
    await f.db.update(studioCards).set({ sourceItemId: f.item.id, importedMeta: { sourceWorkspace: true } }).where(eq(studioCards.id, f.card.id));
    expect((await studioSave(f, 0, options)).status).toBe(409);
    expect((await sourceSave(f, 0, options)).status).toBe(200);
    expect((await f.db.select().from(studioCards).where(eq(studioCards.id, f.card.id)))[0].publicationDraft).toBeNull();
  });

  it.each(["source", "studio"])("rejects a %s approval if posting intent changes during provider verification", async kind => {
    const f = await studioFixture(kind === "studio"), options = postingOptions(f.destination.id);
    const save = (version: number, value: PublicationOptions) => kind === "studio" ? studioSave(f, version, value) : sourceSave(f, version, value);
    expect((await save(0, options)).status).toBe(200);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    mocks.identity.mockImplementationOnce(async (token: string) => { entered(); await barrier; return { ok: true, ...publicationAccounts.get(token) }; });
    const path = kind === "studio" ? `${f.studioPath}/publication/approve` : `${f.path}/approve`;
    const body = kind === "studio" ? studioApproval(f, options) : sourceApproval(f, options);
    const work = f.agent.post(path).set(f.H).send(body).then(response => response);
    let response: Awaited<typeof work>;
    try {
      await Promise.race([started, work.then(() => { throw new Error("Approval ended before the identity barrier"); })]);
      const changed = await save(1, { ...options, timing: "now" });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    } finally {
      release();
      response = await work;
    }
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(1);
  });
});
