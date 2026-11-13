import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { login, resetDb, setTestEnv } from "./helpers";

setTestEnv();
const makeImage = vi.hoisted(() => vi.fn());
vi.mock("../server/services/studioAi", async original => ({ ...await original<object>(), generateStudioImage: (...args: unknown[]) => makeImage(...args) }));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { channels, contentItems, contentRevisions, mediaAssets, approvals, deliveries, destinations } = await import("../shared/schema");
let app: ReturnType<typeof createApp>;

const sourcePayload = {
  topic: "빛의 산란", age_band: "중학생", key_question: "하늘은 왜 파랗게 보일까요?",
  background: ["태양빛에는 여러 색이 섞여 있습니다.", "빛은 공기를 지나며 흩어집니다.", "색마다 흩어지는 정도가 다릅니다."],
  scientific_basis: "짧은 파장의 빛이 더 많이 산란합니다.", misconceptions: ["공기가 파란 물감으로 칠해진 것은 아닙니다."],
  discussion_questions: ["해질 무렵에는 왜 다를까요?", "달에서도 같을까요?", "무엇을 관찰하면 좋을까요?"],
  parent_hints: ["관찰한 색부터 이야기해 보세요."], safe_activity: "낮과 저녁의 하늘색을 비교해 보세요.",
  sources: [], evidence: [],
};
const copy = {
  version: 1, templateKey: "set:n03",
  cover: { title: "직접 고친 카드 표지", subtitle: "하늘색에서 시작하는 가족의 과학 대화" },
  pages: [
    { id: "background", title: "색이 섞인 빛", subtitle: "먼저 알아두기", body: "태양빛에는 여러 색이 섞여 있습니다. 공기를 지나며 빛이 흩어집니다." },
    { id: "evidence", title: "짧은 파장의 빛", subtitle: "과학적 근거", body: "짧은 파장의 빛이 더 많이 산란합니다." },
    { id: "questions", title: "우리의 질문", subtitle: "생각을 나눠요", body: "해질 무렵에는 왜 다를까요? 달에서도 같을까요? 무엇을 관찰하면 좋을까요?" },
    { id: "activity", title: "오늘 해볼 관찰", subtitle: "대화를 이어가요", body: "낮과 저녁의 하늘색을 비교하고, 직접 관찰한 색부터 이야기해 보세요." },
  ],
};

beforeAll(async () => { await resetDb(); app = createApp(); });
afterAll(closeDb);

async function setup() {
  const { agent, csrf } = await login(app), H = { "x-csrf-token": csrf };
  const created = await agent.post("/api/channels/2/items").set(H).send({ title: "수집 원문 제목" });
  expect(created.status).toBe(201);
  const id = created.body.id, endpoint = `/api/channels/2/items/${id}`;
  const initial = (await agent.get(endpoint)).body;
  const edited = await agent.patch(endpoint).set(H).send({ version: initial.item.version, payload: sourcePayload });
  expect(edited.status).toBe(200);
  const detail = (await agent.get(endpoint)).body;
  return { agent, H, id, endpoint, detail, copyEndpoint: `${endpoint}/card-copy` };
}

function binary(res: any, done: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
  res.on("error", done);
}

describe("editable text on collected card-news pages", () => {
  it("requires an actual eight-page copy before a reading template can be saved, previewed or rendered", async () => {
    const { agent, H, detail, copyEndpoint, endpoint } = await setup();
    const templateKey = "cardnews14-cinematic-v1";
    // Construct each request only after the previous one finishes: Supertest
    // closes its ephemeral listener after a request, invalidating prebuilt URLs.
    const requests = [
      () => agent.get(copyEndpoint).query({ templateKey }),
      () => agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy: { ...copy, templateKey } }),
      () => agent.post(`${copyEndpoint}/preview`).set(H).send({ version: detail.item.version, copy: { ...copy, templateKey }, page: 0 }),
      () => agent.post(`${copyEndpoint}/generate`).set(H).send({ version: detail.item.version, templateKey }),
      () => agent.post(`${endpoint}/card`).set(H).send({ version: detail.item.version, templateKey, coverMode: "reuse" }),
    ];
    for (const makeRequest of requests) {
      const response = await makeRequest();
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(response.body.error).toContain("8장");
    }
    const after = (await agent.get(endpoint)).body;
    expect(after.current).toEqual(detail.current);
    expect(after.item.version).toBe(detail.item.version);
    expect(after.cards).toEqual(detail.cards);
  });

  it("checks authentication, CSRF and channel scope for saved and preview copy", async () => {
    const { agent, H, detail, copyEndpoint } = await setup();
    const body = { version: detail.item.version, copy };
    expect((await request(app).get(copyEndpoint)).status).toBe(401);
    expect((await request(app).patch(copyEndpoint).send(body)).status).toBe(401);
    expect((await request(app).post(`${copyEndpoint}/preview`).send({ ...body, page: 1 })).status).toBe(401);
    expect((await request(app).post(`${copyEndpoint}/generate`).send({ version: detail.item.version, templateKey: copy.templateKey, provider: "gemini" })).status).toBe(401);
    expect((await agent.patch(copyEndpoint).send(body)).status).toBe(403);
    expect((await agent.post(`${copyEndpoint}/preview`).send({ ...body, page: 1 })).status).toBe(403);
    expect((await agent.post(`${copyEndpoint}/generate`).send({ version: detail.item.version, templateKey: copy.templateKey, provider: "gemini" })).status).toBe(403);
    const wrongChannel = copyEndpoint.replace("/channels/2/", "/channels/1/");
    expect((await agent.get(wrongChannel)).status).toBe(404);
    expect((await agent.patch(wrongChannel).set(H).send(body)).status).toBe(404);
    expect((await agent.post(`${wrongChannel}/preview`).set(H).send({ ...body, page: 1 })).status).toBe(404);
    expect((await agent.post(`${wrongChannel}/generate`).set(H).send({ version: detail.item.version, templateKey: copy.templateKey, provider: "gemini" })).status).toBe(404);
  });

  it("derives editable legacy copy without modifying the source or saving a revision", async () => {
    const { agent, endpoint, copyEndpoint, detail } = await setup();
    const initial = await agent.get(copyEndpoint).query({ templateKey: "set:n03" });
    expect(initial.status, JSON.stringify(initial.body)).toBe(200);
    expect(initial.body).toMatchObject({ version: detail.item.version, revisionId: detail.current.id, hasSavedCopy: false, copy: { templateKey: "set:n03", cover: { title: sourcePayload.key_question } } });
    expect(initial.body.copy.pages).toHaveLength(4);
    const text = JSON.stringify(initial.body.copy);
    [...sourcePayload.background, sourcePayload.scientific_basis, ...sourcePayload.misconceptions, ...sourcePayload.discussion_questions, ...sourcePayload.parent_hints, sourcePayload.safe_activity].forEach(value => expect(text).toContain(value));
    const after = (await agent.get(endpoint)).body;
    expect(after.item.version).toBe(detail.item.version);
    expect(after.current).toEqual(detail.current);
    expect(after.revisions).toEqual(detail.revisions);
    expect(after.cards).toEqual(detail.cards);

  });

  it("saves exact card text as a new revision while keeping source facts, captions and manual text on template changes", async () => {
    const { agent, H, endpoint, copyEndpoint, detail } = await setup();
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ version: detail.item.version + 1, hasSavedCopy: true, copy });
    expect(saved.body.revisionId).not.toBe(detail.current.id);
    const loaded = await agent.get(copyEndpoint);
    expect(loaded.body).toMatchObject(saved.body);
    const after = (await agent.get(endpoint)).body;
    expect(after.current.id).toBe(saved.body.revisionId);
    expect(after.current.payload).toEqual({ ...sourcePayload, cardCopy: copy });
    expect(after.item.edited).toEqual({ ...sourcePayload, cardCopy: copy });
    expect(after.item.title).toBe(detail.item.title);
    expect(after.defaultCaptions).toEqual(detail.defaultCaptions);
    expect(after.revisions).toHaveLength(detail.revisions.length + 1);
    expect(after.cards).toEqual(detail.cards);

    const repeatedSave = await agent.patch(copyEndpoint).set(H).send({ version: saved.body.version, copy });
    expect(repeatedSave.status).toBe(200);
    expect(repeatedSave.body).toMatchObject({ version: saved.body.version, revisionId: saved.body.revisionId, copy });
    expect((await agent.get(endpoint)).body.revisions).toHaveLength(after.revisions.length);

    const differentTemplate = await agent.get(copyEndpoint).query({ templateKey: "set:n01-blue" });
    expect(differentTemplate.body.copy).toEqual({ ...copy, templateKey: "set:n01-blue" });
    expect((await agent.get(copyEndpoint)).body.copy).toEqual(copy);
    const sourceEdit = await agent.patch(endpoint).set(H).send({ version: saved.body.version, payload: { ...after.current.payload, scientific_basis: "원문 검토 후 보완한 과학적 근거입니다." } });
    expect(sourceEdit.status).toBe(200);
    expect((await agent.get(copyEndpoint)).body.copy).toEqual(copy);
  });

  it("rejects stale and invalid edits without overwriting the saved text", async () => {
    const { agent, H, endpoint, copyEndpoint, detail } = await setup();
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy });
    expect(saved.status).toBe(200);
    const stale = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy: { ...copy, cover: { ...copy.cover, title: "오래된 화면에서 쓴 제목" } } });
    expect(stale.status).toBe(409);
    expect((await agent.post(`${copyEndpoint}/preview`).set(H).send({ version: detail.item.version, copy, page: 1 })).status).toBe(409);
    expect((await agent.post(`${copyEndpoint}/generate`).set(H).send({ version: detail.item.version, templateKey: copy.templateKey, provider: "gemini" })).status).toBe(409);
    expect((await agent.post(`${endpoint}/card`).set(H).send({ version: detail.item.version, coverMode: "reuse" })).status).toBe(409);
    const beforeInvalid = (await agent.get(endpoint)).body;
    for (const invalid of [
      { ...copy, templateKey: "set:not-a-template" },
      { ...copy, pages: [] },
      { ...copy, cover: { ...copy.cover, title: "가".repeat(1000) } },
      { ...copy, pages: [{ ...copy.pages[0], body: "가".repeat(20000) }] },
    ]) {
      const response = await agent.patch(copyEndpoint).set(H).send({ version: saved.body.version, copy: invalid });
      expect(response.status, JSON.stringify(response.body)).toBe(400);
    }
    expect((await agent.get(copyEndpoint)).body.copy).toEqual(copy);
    const afterInvalid = (await agent.get(endpoint)).body;
    expect(afterInvalid.current).toEqual(beforeInvalid.current);
    expect(afterInvalid.revisions).toEqual(beforeInvalid.revisions);
  });

  it("preserves saved card copy when a source editor submits only factual payload fields", async () => {
    const { agent, H, endpoint, copyEndpoint, detail } = await setup();
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy });
    expect(saved.status).toBe(200);
    const facts = { ...sourcePayload, scientific_basis: "원문을 다시 대조해 보완한 과학적 근거입니다." };
    expect(facts).not.toHaveProperty("cardCopy");
    const edited = await agent.patch(endpoint).set(H).send({ version: saved.body.version, payload: facts });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const after = (await agent.get(endpoint)).body;
    expect(after.current.payload).toEqual({ ...facts, cardCopy: copy });
    expect(after.item.edited).toEqual({ ...facts, cardCopy: copy });
    expect((await agent.get(copyEndpoint)).body.copy).toEqual(copy);
    const [prior] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, saved.body.revisionId));
    expect(prior.payload).toEqual({ ...sourcePayload, cardCopy: copy });
  });

  it("offers recoverable source-derived copy for malformed old data without overwriting it until explicit save", async () => {
    const { agent, H, endpoint, copyEndpoint, detail } = await setup();
    const malformed = { ...copy, version: 99, pages: [{ ...copy.pages[0], body: null }] };
    await getDb().update(contentRevisions).set({ payload: { ...sourcePayload, cardCopy: malformed } }).where(eq(contentRevisions.id, detail.current.id));
    const before = (await agent.get(endpoint)).body;
    const recovered = await agent.get(copyEndpoint).query({ templateKey: "set:n03" });
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect(recovered.body.hasSavedCopy).toBe(false);
    expect(typeof recovered.body.recoveryNotice).toBe("string");
    expect(recovered.body.recoveryNotice.length).toBeGreaterThan(0);
    expect(recovered.body.copy.cover.title).toBe(sourcePayload.key_question);
    expect(recovered.body.copy.pages).toHaveLength(4);
    const recoveredText = JSON.stringify(recovered.body.copy);
    [...sourcePayload.background, sourcePayload.scientific_basis, ...sourcePayload.misconceptions, ...sourcePayload.discussion_questions, ...sourcePayload.parent_hints, sourcePayload.safe_activity].forEach(value => expect(recoveredText).toContain(value));
    const unchanged = (await agent.get(endpoint)).body;
    expect(unchanged.current).toEqual(before.current);
    expect(unchanged.revisions).toEqual(before.revisions);
    expect(unchanged.item.version).toBe(before.item.version);
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: recovered.body.version, copy: recovered.body.copy });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.revisionId).not.toBe(before.current.id);
    const after = (await agent.get(endpoint)).body;
    expect(after.current.payload).toEqual({ ...sourcePayload, cardCopy: recovered.body.copy });
    expect((await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, before.current.id)))[0].payload).toEqual(before.current.payload);
  });

  it("recovers a deleted saved template without changing any saved copy text or writing a revision", async () => {
    const { agent, endpoint, copyEndpoint, detail } = await setup();
    const missingTemplateCopy = { ...copy, templateKey: "custom:999999" };
    await getDb().update(contentRevisions).set({ payload: { ...sourcePayload, cardCopy: missingTemplateCopy } }).where(eq(contentRevisions.id, detail.current.id));
    const before = (await agent.get(endpoint)).body;
    const recovered = await agent.get(copyEndpoint);
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect(recovered.body).toMatchObject({ version: before.item.version, revisionId: before.current.id, hasSavedCopy: false });
    expect(recovered.body.copy.templateKey).not.toBe("custom:999999");
    expect(recovered.body.copy.templateKey).toBe('editorial:red');
    expect(recovered.body.copy).toEqual({ ...missingTemplateCopy, templateKey: recovered.body.copy.templateKey });
    expect(typeof recovered.body.recoveryNotice).toBe("string");
    expect(recovered.body.recoveryNotice.length).toBeGreaterThan(0);
    const after = (await agent.get(endpoint)).body;
    expect(after.item).toEqual(before.item);
    expect(after.current).toEqual(before.current);
    expect(after.revisions).toEqual(before.revisions);
    expect(after.cards).toEqual(before.cards);
    expect(after.current.payload.cardCopy).toEqual(missingTemplateCopy);
  });

  it("keeps a deleted-template V1 draft editable when the channel default is an eight-page set", async () => {
    const { agent, H, endpoint, copyEndpoint, detail } = await setup(), db = getDb();
    const missingTemplateCopy = { ...copy, templateKey: "custom:999999" };
    await db.update(contentRevisions).set({ payload: { ...sourcePayload, cardCopy: missingTemplateCopy } }).where(eq(contentRevisions.id, detail.current.id));
    const [channel] = await db.select().from(channels).where(eq(channels.id, 2));
    await db.update(channels).set({ cardTemplate: "cardnews14-cinematic-v1" }).where(eq(channels.id, 2));
    try {
      const before = (await agent.get(endpoint)).body;
      const recovered = await agent.get(copyEndpoint);
      expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
      expect(recovered.body).toMatchObject({ version: before.item.version, revisionId: before.current.id, hasSavedCopy: false });
      expect(recovered.body.copy).toEqual({ ...missingTemplateCopy, templateKey: "builtin:classic" });
      expect((await agent.get(endpoint)).body.current).toEqual(before.current);
      const saved = await agent.patch(copyEndpoint).set(H).send({ version: recovered.body.version, copy: recovered.body.copy });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.copy).toEqual(recovered.body.copy);
      const [original] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, detail.current.id));
      expect(original.payload.cardCopy).toEqual(missingTemplateCopy);
    } finally {
      await db.update(channels).set({ cardTemplate: channel.cardTemplate }).where(eq(channels.id, 2));
    }
  });

  it("previews and exports the saved text with identical body pixels, without rewriting old image files", async () => {
    const { agent, H, id, endpoint, copyEndpoint, detail } = await setup();
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const body = { version: saved.body.version, copy, page: 1 };
    const beforePreview = (await agent.get(endpoint)).body;
    const preview = await agent.post(`${copyEndpoint}/preview`).set(H).send(body).buffer(true).parse(binary);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/jpeg");
    expect(await sharp(preview.body).metadata()).toMatchObject({ width: 1080, height: 1350, format: "jpeg" });
    const afterPreview = (await agent.get(endpoint)).body;
    expect(afterPreview.item.version).toBe(beforePreview.item.version);
    expect(afterPreview.current).toEqual(beforePreview.current);
    expect(afterPreview.revisions).toEqual(beforePreview.revisions);
    expect(await getDb().select().from(mediaAssets).where(eq(mediaAssets.contentItemId, id))).toHaveLength(0);

    const generated = await agent.post(`${endpoint}/card`).set(H).send({ version: saved.body.version, coverMode: "typography" });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    expect(generated.body.templateKey).toBe(copy.templateKey);
    expect(generated.body.carousel.copy).toEqual(copy);
    expect(generated.body.carousel.pages.map((page: any) => page.title)).toEqual([copy.cover.title, ...copy.pages.map(page => page.title)]);
    const pageId = generated.body.carousel.pages[1].id;
    const image = await agent.get(`/api/channels/2/media/${pageId}`).buffer(true).parse(binary);
    expect(image.body.equals(preview.body)).toBe(true);
    const zip = await agent.get(`/api/channels/2/media/${generated.body.id}/deck.zip`).buffer(true).parse(binary);
    expect(zip.status).toBe(200);
    const files = unzipSync(zip.body);
    expect(Buffer.from(files["page-02.jpg"]).equals(image.body)).toBe(true);
    const repeat = await agent.post(`${endpoint}/card`).set(H).send({ version: saved.body.version, coverMode: "typography" });
    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(generated.body.id);

    const changed = { ...copy, pages: copy.pages.map((page, i) => i === 0 ? { ...page, subtitle: "내가 직접 고친 소제목", body: "수정한 문구가 이미지에 반영되는지 확인합니다." } : page) };
    const savedAgain = await agent.patch(copyEndpoint).set(H).send({ version: saved.body.version, copy: changed });
    expect(savedAgain.status).toBe(200);
    const changedImage = await agent.post(`${endpoint}/card`).set(H).send({ version: savedAgain.body.version, coverMode: "typography" });
    expect(changedImage.status, JSON.stringify(changedImage.body)).toBe(200);
    expect(changedImage.body.carousel.copy).toEqual(changed);
    expect(changedImage.body.carousel.pages[1].sha256).not.toBe(generated.body.carousel.pages[1].sha256);
    expect((await agent.get(`/api/channels/2/media/${pageId}`).buffer(true).parse(binary)).body.equals(image.body)).toBe(true);
    expect((await agent.get(endpoint)).body.defaultCaptions).toEqual(detail.defaultCaptions);
    expect(await getDb().select().from(approvals).where(eq(approvals.contentItemId, id))).toHaveLength(0);
  });

  it("invalidates the old approval and cancels only queued delivery when card text changes", async () => {
    const { agent, H, id, endpoint, copyEndpoint, detail } = await setup(), db = getDb();
    const [asset] = await db.insert(mediaAssets).values({ channelId: 2, contentItemId: id, revisionId: detail.current.id, sha256: "old-copy-snapshot", bytes: Buffer.from("old immutable image"), width: 1080, height: 1350 }).returning();
    const captions = { instagram: "승인했던 게시글 설명", telegram: "승인했던 텔레그램 설명" };
    const [approval] = await db.insert(approvals).values({ channelId: 2, contentItemId: id, revisionId: detail.current.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions, scheduledAt: new Date("2030-01-01"), approvedBy: "test" }).returning();
    const [destination] = await db.insert(destinations).values({ channelId: 2, platform: "telegram_channel", label: "카드 문구 테스트" }).returning();
    const queued = await db.insert(deliveries).values([{ channelId: 2, approvalId: approval.id, destinationId: destination.id, status: "scheduled" }]).returning();
    await db.update(contentItems).set({ reviewStatus: "reviewed", publishStatus: "scheduled" }).where(eq(contentItems.id, id));
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const [oldApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(oldApproval.status).toBe("invalidated");
    expect(oldApproval.captions).toEqual(captions);
    expect((await db.select().from(deliveries).where(eq(deliveries.id, queued[0].id)))[0].status).toBe("cancelled");
    expect(await db.select().from(approvals).where(eq(approvals.contentItemId, id))).toHaveLength(1);
    expect(await db.select().from(deliveries).where(eq(deliveries.approvalId, approval.id))).toHaveLength(1);
    const after = (await agent.get(endpoint)).body;
    expect(after.item.publishStatus).toBe("waiting");
    expect(after.item.reviewStatus).not.toBe("reviewed");
    expect(after.current.payload).toEqual({ ...sourcePayload, cardCopy: copy });
    expect((await db.select().from(contentRevisions).where(eq(contentRevisions.id, detail.current.id)))[0].payload).toEqual(sourcePayload);
    expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id)))[0].bytes.toString()).toBe("old immutable image");
  });

  it("reuses the actual existing cover art across copy-only revisions without another image-generation call", async () => {
    const { agent, H, id, endpoint, copyEndpoint, detail } = await setup(), db = getDb();
    makeImage.mockClear();
    const art = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#12bc45" } }).png().toBuffer();
    const [originalArt] = await db.insert(mediaAssets).values({ channelId: 2, contentItemId: id, revisionId: detail.current.id, kind: "cover_art", source: "ai", templateKey: "fixture-image-model", mime: "image/png", width: 128, height: 128, bytes: art, sha256: createHash("sha256").update(art).digest("hex") }).returning();
    const saved = await agent.patch(copyEndpoint).set(H).send({ version: detail.item.version, copy });
    expect(saved.status).toBe(200);
    const preview = await agent.post(`${copyEndpoint}/preview`).set(H).send({ version: saved.body.version, copy, page: 0, coverMode: "reuse" }).buffer(true).parse(binary);
    expect(preview.status).toBe(200);
    // The center of n03's photo is the old green artwork, not the typography placeholder.
    const pixel = await sharp(preview.body).extract({ left: 500, top: 300, width: 1, height: 1 }).raw().toBuffer();
    [18, 188, 69].forEach((value, i) => expect(Math.abs(pixel[i] - value)).toBeLessThanOrEqual(3));
    const rendered = await agent.post(`${endpoint}/card`).set(H).send({ version: saved.body.version, coverMode: "reuse" });
    expect(rendered.status, JSON.stringify(rendered.body)).toBe(200);
    expect(rendered.body.carousel.cover).toMatchObject({ kind: "ai", model: "fixture-image-model" });
    const cover = await agent.get(`/api/channels/2/media/${rendered.body.id}`).buffer(true).parse(binary);
    expect((await sharp(cover.body).raw().toBuffer()).equals(await sharp(preview.body).raw().toBuffer())).toBe(true);
    const secondCopy = { ...copy, cover: { ...copy.cover, title: "표지 글자만 한 번 더 수정" } };
    const secondSave = await agent.patch(copyEndpoint).set(H).send({ version: saved.body.version, copy: secondCopy });
    const again = await agent.post(`${endpoint}/card`).set(H).send({ version: secondSave.body.version, coverMode: "reuse" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.carousel.cover).toMatchObject({ kind: "ai", model: "fixture-image-model" });
    const assets = await db.select().from(mediaAssets).where(eq(mediaAssets.contentItemId, id));
    expect(assets.filter(asset => asset.kind === "cover_art")).toHaveLength(1);
    expect(assets.find(asset => asset.id === originalArt.id)?.bytes.equals(art)).toBe(true);
    expect(makeImage).not.toHaveBeenCalled();
  });
});
