/** Real worker entry point, collection, RSS parsing and PostgreSQL persistence.
 * Only source transport is synthetic; unexpected outbound requests fail closed. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { appSettings, channels, contentItems, contentRevisions, jobs, runs, searchRules, sourceDocuments, workerRuns } from "../shared/schema";

setTestEnv();
const fixture = vi.hoisted(() => ({
  feed: "https://scheduled-fixture.example/feed.xml",
  article: "https://scheduled-fixture.example/youth-science-camp",
  title: "중학생 청소년 과학캠프 참가자 모집",
  text: "예약 수집 통합 검증용 가상 모집 안내입니다. 중학생과 청소년을 위한 가상 과학캠프 참가자를 모집합니다. 실제 기관이나 모집 공고가 아니며, 신청이나 게시를 요청하지 않습니다.",
  rss: vi.fn(), publisher: vi.fn(), llm: vi.fn(), telegram: vi.fn(), publish: vi.fn(), instagram: vi.fn(),
}));
vi.mock("../server/services/newsSearch", async original => {
  const actual = await original<typeof import("../server/services/newsSearch")>();
  return { ...actual, createNewsSearch: (options: Parameters<typeof actual.createNewsSearch>[0]) => actual.createNewsSearch({
    ...options, preferNaver: false, loadXml: fixture.rss,
    feeds: [{ name: "가상 검증 신문", url: fixture.feed, site: "https://scheduled-fixture.example" }],
  }) };
});
vi.mock("../server/services/publisherLookup", async original => ({ ...await original<object>(), fetchPublisherArticle: fixture.publisher }));
vi.mock("../server/services/llm", async original => ({ ...await original<object>(),
  extractNotice: fixture.llm, generateCardCopy: fixture.llm, draftScience: fixture.llm, draftCurrent: fixture.llm,
  curateIssues: fixture.llm, openaiRequest: fixture.llm, callTool: fixture.llm,
}));
vi.mock("../server/services/telegram", async original => ({ ...await original<object>(), sendReviewMessage: fixture.telegram }));
vi.mock("../server/worker/publish", () => ({ publishDue: fixture.publish }));
vi.mock("../server/services/instagram", async original => ({ ...await original<object>(), publishContainer: fixture.instagram }));

const { getDb, closeDb } = await import("../server/db");
const collector = await import("../server/worker/collect");
const { collectOnce } = await import("../server/worker/run");
const actualCollection = vi.spyOn(collector, "runCollect");
const outbound = vi.fn(() => { throw new Error("Unexpected outbound request in scheduled collection regression"); });
let channelId: number;
const slug = "scheduled-collection-fixture";
const digest = createHash("sha256").update(fixture.text).digest("hex");

async function setting(key: string, value: boolean) {
  await getDb().insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}
async function storedIds() {
  const db = getDb();
  return {
    collection: (await db.select({ id: runs.id }).from(runs).orderBy(runs.id)).map(row => row.id),
    workers: (await db.select({ id: workerRuns.id }).from(workerRuns).orderBy(workerRuns.id)).map(row => row.id),
    items: (await db.select({ id: contentItems.id }).from(contentItems).orderBy(contentItems.id)).map(row => row.id),
    sources: (await db.select({ id: sourceDocuments.id }).from(sourceDocuments).orderBy(sourceDocuments.id)).map(row => row.id),
  };
}
function assertNoPaidOrPublicationWork() {
  for (const spy of [fixture.llm, fixture.telegram, fixture.publish, fixture.instagram, outbound]) expect(spy).not.toHaveBeenCalled();
}

beforeAll(async () => {
  // resetDb must never run against a remote service, even if a developer supplied the wrong URL.
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(process.env.APP_DATABASE_URL!).hostname);
  vi.stubGlobal("fetch", outbound);
  await resetDb();
  const db = getDb();
  await db.update(channels).set({ active: false });
  const [channel] = await db.insert(channels).values({
    slug, name: "가상 예약 수집 검증", contentType: "notice", accentColor: "#2563eb", active: true,
    budget: { naverCallsPerRun: 1, resultsPerRun: 1, fetchTargetsPerRun: 1, fetchCallsPerRun: 1, llmCallsPerRun: 12, dailyPublishLimit: 3, discovery: { enabled: false, autoDraft: false } },
  }).returning();
  channelId = channel.id;
  await db.insert(searchRules).values({ channelId, query: "과학캠프", normalizedQuery: "과학캠프", endpoint: "news", display: 1, enabled: true });
  vi.stubEnv("AUTO_COLLECT", "true");
  vi.stubEnv("AUTO_GENERATE", "true");
  vi.stubEnv("COLLECT_REVIEW_NOTIFICATIONS", "true");
  vi.stubEnv("AUTO_PUBLISH", "true");
  vi.stubEnv("GEMINI_API_KEY", "scheduled-test-not-a-real-key");
  vi.stubEnv("OPENAI_API_KEY", "scheduled-test-not-a-real-key");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "scheduled-test-not-a-real-token");
  vi.stubEnv("TELEGRAM_REVIEW_CHAT_ID", "scheduled-test-chat");
  fixture.rss.mockImplementation(async (url: string) => {
    if (url === fixture.feed) return `<rss><channel><item><title>${fixture.title}</title><link>${fixture.article}</link><description>중학생 청소년 과학캠프 참가자를 모집합니다.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    const parsed = new URL(url);
    if (parsed.hostname === "news.google.com" && parsed.pathname === "/rss/search") return "<rss><channel></channel></rss>";
    throw new Error("Unrecognized synthetic RSS address");
  });
  fixture.publisher.mockImplementation(async (url: string) => {
    expect(url).toBe(fixture.article);
    return { ok: true, finalUrl: url, title: fixture.title, text: fixture.text, hash: digest, attachments: [], contentKind: "html" };
  });
  for (const spy of [fixture.llm, fixture.telegram, fixture.publish, fixture.instagram]) spy.mockImplementation(() => { throw new Error("Scheduled collection must not generate, notify or publish"); });
});
afterEach(assertNoPaidOrPublicationWork);
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await closeDb(); });

it("persisted OFF → ON → OFF admits exactly one actual source collection despite enabled environment defaults", async () => {
  await setting("global_stop", false); await setting("auto_collect", false);
  const initial = await storedIds();
  expect(await collectOnce({ isSchedule: true })).toMatchObject({ skipped: expect.stringContaining("자동 수집 꺼짐"), results: [] });
  expect(await storedIds()).toEqual(initial);
  expect(actualCollection).not.toHaveBeenCalled(); expect(fixture.rss).not.toHaveBeenCalled(); expect(fixture.publisher).not.toHaveBeenCalled();

  await setting("auto_collect", true);
  const collected = await collectOnce({ isSchedule: true });
  expect(collected.results).toEqual([expect.objectContaining({ slug, status: "ok", counts: expect.objectContaining({ newItems: 1, fetchedOk: 1, extractionSkippedAutoGenerateOff: 1 }) })]);
  expect(actualCollection).toHaveBeenCalledOnce();
  expect(actualCollection).toHaveBeenCalledWith(getDb(), channelId, { trigger: "schedule", collectionOnly: true });
  expect(fixture.rss).toHaveBeenCalledWith(fixture.feed);
  expect(fixture.publisher).toHaveBeenCalledOnce();
  const [run] = await getDb().select().from(runs).where(eq(runs.channelId, channelId));
  expect(run).toMatchObject({ trigger: "schedule", status: "ok", snapshot: { ai: null, manualWorkload: false, flags: { autoGenerate: true } }, actualCalls: { llm: 0 }, llmUsage: { calls: 0 } });
  const [item] = await getDb().select().from(contentItems).where(eq(contentItems.channelId, channelId));
  expect(item).toMatchObject({ origin: "collected", runId: run.id, title: fixture.title });
  const [source] = await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId!));
  expect(source).toMatchObject({ originalUrl: fixture.article, fetchStatus: "ok", fetchedText: fixture.text, contentHash: digest });
  expect(await getDb().select().from(contentRevisions)).toHaveLength(0);
  expect(await getDb().select().from(jobs)).toHaveLength(0);
  expect(await getDb().select().from(workerRuns)).toEqual([expect.objectContaining({ command: "collect:once", status: "ok", processed: 1, failed: 0 })]);

  await setting("auto_collect", false);
  const afterCollection = await storedIds();
  expect(await collectOnce({ isSchedule: true })).toMatchObject({ skipped: expect.stringContaining("자동 수집 꺼짐"), results: [] });
  expect(await storedIds()).toEqual(afterCollection);
  expect(actualCollection).toHaveBeenCalledOnce(); expect(fixture.publisher).toHaveBeenCalledOnce();
  assertNoPaidOrPublicationWork();
});

it("global stop blocks the real scheduled entry point before any additional source transport", async () => {
  await setting("auto_collect", true); await setting("global_stop", true);
  const before = await storedIds(), rssCalls = fixture.rss.mock.calls.length, fetchCalls = fixture.publisher.mock.calls.length, collectorCalls = actualCollection.mock.calls.length;
  const stopped = await collectOnce({ isSchedule: true });
  expect(stopped.results).toEqual([expect.objectContaining({ slug, status: "failed", error: expect.stringContaining("전역 정지") })]);
  const after = await storedIds();
  expect(after.collection).toEqual(before.collection); expect(after.items).toEqual(before.items); expect(after.sources).toEqual(before.sources);
  expect(fixture.rss).toHaveBeenCalledTimes(rssCalls); expect(fixture.publisher).toHaveBeenCalledTimes(fetchCalls); expect(actualCollection).toHaveBeenCalledTimes(collectorCalls);
  assertNoPaidOrPublicationWork();
});
