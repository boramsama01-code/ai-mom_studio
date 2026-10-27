import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { login, resetDb, setTestEnv } from "./helpers";
import { emptyPayload } from "../shared/payloads";
setTestEnv();
const fakeExtract = vi.hoisted(() => vi.fn());
vi.mock("../server/services/llm", async orig => ({ ...await orig<object>(), extractNotice: fakeExtract }));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { contentItems, sourceDocuments, contentSources, mediaAssets, approvals } = await import("../shared/schema");
const { createRevision } = await import("../server/content");
const { extractForItem } = await import("../server/worker/collect");
const { LlmBudget } = await import("../server/services/llm");
let app: ReturnType<typeof createApp>, itemId: number, sharedId: number, otherId: number;
const text = "청소년 연구 프로그램 참가자를 10월 30일까지 모집합니다.\n지원 대상은 과학 탐구에 관심이 있는 중학생입니다.";
beforeAll(async () => { await resetDb(); app = createApp(); });
afterAll(closeDb);
beforeEach(async () => {
  const db = getDb();
  const [doc] = await db.insert(sourceDocuments).values({ normalizedUrl: `https://press.example/${crypto.randomUUID()}`, originalUrl: "https://press.example/article", kind: "google_news_rss", fetchStatus: "failed", fetchError: "본문을 찾지 못함" }).returning();
  const rows = await db.insert(contentItems).values([{ channelId: 1, kind: "notice", title: "복사한 원문 테스트", primarySourceId: doc.id }, { channelId: 2, kind: "science_dialogue", title: "다른 채널 자료", primarySourceId: doc.id }]).returning();
  itemId = rows[0].id; otherId = rows[1].id; sharedId = doc.id; fakeExtract.mockReset();
});
const endpoint = () => `/api/channels/1/items/${itemId}/source-text`;
const body = (extra = {}) => ({ version: 1, url: "https://press.example/article", text, ...extra });

it("인증·CSRF·채널 경계를 검사한다", async () => {
  expect((await request(app).post(endpoint()).send(body())).status).toBe(401);
  const { agent, csrf } = await login(app);
  expect((await agent.post(endpoint()).send(body())).status).toBe(403);
  expect((await agent.post(`/api/channels/2/items/${itemId}/source-text`).set("x-csrf-token", csrf).send(body())).status).toBe(404);
});
it("본문과 실제 발췌를 저장하고 재조회하며 원래 중복 키와 다른 채널 원문을 보존한다", async () => {
  const { agent, csrf } = await login(app);
  const saved = await agent.post(endpoint()).set("x-csrf-token", csrf).send(body());
  expect(saved.status).toBe(201); expect(saved.body.quoteCount).toBe(2);
  const d = (await agent.get(`/api/channels/1/items/${itemId}`)).body;
  expect(d.item).toMatchObject({ primarySourceId: sharedId, evidenceStatus: "needs_review", reviewStatus: "review_required", version: 2 });
  expect(d.primary).toMatchObject({ kind: "manual_text", fetchedText: text, fetchStatus: "ok", fetchError: null, lastFetchedAt: null });
  expect(d.primary.meta.quotes.every((q: string) => text.includes(q))).toBe(true);
  expect(d.current.payload.title).toBe("복사한 원문 테스트");
  const list = await agent.get("/api/items?channelId=1&q=복사한 원문 테스트");
  expect(list.body.items.find((r: any) => r.item.id === itemId).source).toMatchObject({ id: saved.body.sourceId, kind: "manual_text", fetchStatus: "ok" });
  const other = (await agent.get(`/api/channels/2/items/${otherId}`)).body;
  expect(other.primary).toMatchObject({ id: sharedId, fetchStatus: "failed", fetchedText: null });
  expect(fakeExtract).not.toHaveBeenCalled();
  expect((await agent.post(`/api/channels/1/items/${itemId}/fetch`).set("x-csrf-token", csrf).send({})).status).toBe(409);
  expect((await agent.get(`/api/channels/1/items/${itemId}`)).body.primary.fetchedText).toBe(text);
});
it("없는 구절·과대 본문·비HTTP 주소는 저장하지 않는다", async () => {
  const { agent, csrf } = await login(app);
  for (const invalid of [{ quotes: ["본문에 없는 마감일입니다"] }, { text: "짧음" }, { text: "가".repeat(50001) }, { url: "javascript:alert(1)" }, { url: "https://user:password@press.example/a" }]) {
    expect((await agent.post(endpoint()).set("x-csrf-token", csrf).send(body(invalid))).status).toBe(400);
  }
  expect(await getDb().select().from(contentSources).where(eq(contentSources.contentItemId, itemId))).toHaveLength(0);
});
it("편집 초안은 보존하고 기존 승인만 무효화하며 구버전 저장을 거절한다", async () => {
  const db = getDb(), { agent, csrf } = await login(app);
  const payload = { ...emptyPayload("notice", "운영자가 작성한 제목"), key_details: "이 문장을 보존" };
  const rev = await createRevision(db, { contentItemId: itemId, author: "operator", payload });
  await db.update(contentItems).set({ edited: payload, reviewStatus: "reviewed" }).where(eq(contentItems.id, itemId));
  const [asset] = await db.insert(mediaAssets).values({ channelId: 1, contentItemId: itemId, revisionId: rev.id, mime: "image/png", width: 1, height: 1, bytes: Buffer.from("test"), sha256: "test" }).returning();
  const [approval] = await db.insert(approvals).values({ channelId: 1, contentItemId: itemId, revisionId: rev.id, mediaAssetId: asset.id, cardSha256: "test", captions: { instagram: "", telegram: "" }, scheduledAt: new Date(), approvedBy: "admin" }).returning();
  const first = await agent.post(endpoint()).set("x-csrf-token", csrf).send(body());
  expect(first.status).toBe(201);
  expect((await db.select().from(approvals).where(eq(approvals.id, approval.id)))[0].status).toBe("invalidated");
  const d = (await agent.get(`/api/channels/1/items/${itemId}`)).body;
  expect(d.current.payload).toEqual(payload); expect(d.item.edited).toEqual(payload);
  expect((await agent.post(endpoint()).set("x-csrf-token", csrf).send(body())).status).toBe(409);
  const second = await agent.post(endpoint()).set("x-csrf-token", csrf).send(body({ version: 2, text: text + "\n추가 신청 안내는 기관 홈페이지에서 확인할 수 있습니다." }));
  expect(second.status).toBe(201);
  expect((await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, first.body.sourceId)))[0].fetchedText).toBe(text);
  expect((await db.select().from(contentSources).where(eq(contentSources.contentItemId, itemId))).filter(r => r.role === "manual_primary")).toHaveLength(1);
});
it("후속 공고 추출은 실패한 RSS 대신 직접 저장한 본문을 사용한다", async () => {
  const { agent, csrf } = await login(app);
  const saved = await agent.post(endpoint()).set("x-csrf-token", csrf).send(body());
  fakeExtract.mockResolvedValue({ ok: true, data: { ...emptyPayload("notice", "추출 제목"), evidence: [{ field: "audience", source_id: saved.body.sourceId, quote: text.split("\n")[1] }] }, model: "test", usage: { inputTokens: 0, outputTokens: 0 }, droppedEvidence: 0 });
  expect((await extractForItem(getDb(), itemId, new LlmBudget(1), new Date())).ok).toBe(true);
  expect(fakeExtract.mock.calls[0][0].sources[0]).toMatchObject({ source_id: saved.body.sourceId, text });
  expect((await agent.get(`/api/channels/1/items/${itemId}`)).body.item.evidenceStatus).toBe("needs_review");
});
