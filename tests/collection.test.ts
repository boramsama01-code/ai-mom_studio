import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { login, naverResponse, resetDb, setTestEnv } from "./helpers";
import { collectionDateSchema, collectionDayRange, kstDay, nextCollectionAt } from "../shared/collection";
setTestEnv();
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { channels, contentItems, searchRules, jobs } = await import("../shared/schema");
const { runCollect } = await import("../server/worker/collect");
const { PUBLIC_NEWS_FEEDS } = await import("../server/services/newsSearch");
const { enqueueJob } = await import("../server/worker/queue");
const { eq, and } = await import("drizzle-orm");
let app: ReturnType<typeof createApp>;
beforeAll(async () => { await resetDb(); app = createApp(); });
afterAll(closeDb);

it("한국 날짜 경계와 아침·저녁 예약 시각을 계산한다", () => {
  expect(kstDay(new Date("2026-10-25T15:00:00Z"))).toBe("2026-10-26");
  expect(collectionDayRange("2026-10-26").start.toISOString()).toBe("2026-10-25T15:00:00.000Z");
  expect(collectionDateSchema.safeParse("2026-02-30").success).toBe(false);
  expect(nextCollectionAt(new Date("2026-10-25T20:12:00Z"))).toBe("2026-10-25T20:13:00.000Z");
  expect(nextCollectionAt(new Date("2026-10-25T20:13:00Z"))).toBe("2026-10-25T22:13:00.000Z");
  expect(nextCollectionAt(new Date("2026-10-26T10:14:00Z"))).toBe("2026-10-26T20:13:00.000Z");
});
describe("실제 수집 설정·브리핑", () => {
  it("기존 자료를 삭제하지 않고 분류한 뒤 페이지를 나누며 후보 수를 따로 집계한다", async () => {
    const db = getDb(), { agent } = await login(app);
    const day = new Date("2026-10-24T01:00:00Z");
    await db.insert(contentItems).values([
      { channelId: 1, kind: "notice", origin: "collected", title: "품질검증 청소년 참가자 모집", createdAt: day },
      { channelId: 1, kind: "notice", origin: "collected", title: "품질검증 초등·중등 모집요강", createdAt: day },
      { channelId: 1, kind: "notice", origin: "collected", title: "품질검증 모집 마감 임박", createdAt: day },
      { channelId: 1, kind: "notice", origin: "collected", title: "품질검증 모집 마감", createdAt: day },
      { channelId: 1, kind: "notice", origin: "collected", title: "품질검증 연구교원 모집", createdAt: day },
      { channelId: 1, kind: "notice", origin: "collected", title: "품질검증 캠프 성료…다음 기수 추가 모집", createdAt: day },
      ...Array.from({ length: 23 }, (_, i) => ({ channelId: 1, kind: "notice", origin: "collected", title: `품질검증 과학캠프 성료 ${i}`, createdAt: new Date(day.getTime() + 1000) })),
    ]);
    const list = await agent.get("/api/items?channelId=1&q=품질검증&noticeIntent=candidate&pageSize=5");
    expect(list.status).toBe(200); expect(list.body.total).toBe(3);
    expect(list.body.items).toHaveLength(3); expect(list.body.items.every((r: any) => r.noticeIntent === "candidate")).toBe(true);
    const all = await agent.get("/api/items?channelId=1&q=품질검증&noticeIntent=all");
    expect(all.body.total).toBe(29);
    const summary = await agent.get("/api/collection/overview?channelId=1&date=2026-10-24");
    expect(summary.body.channels[0]).toMatchObject({ noticeCandidates: 3, noticeUncertain: 1, noticeReports: 25 });
  });
  it("인증·CSRF 없이 수집 또는 설정을 바꿀 수 없다", async () => {
    expect((await request(app).get("/api/collection/overview?channelId=all")).status).toBe(401);
    const { agent } = await login(app);
    expect((await agent.post("/api/collection/collect").send({ channelId: "all" })).status).toBe(403);
  });
  it("추천 묶음은 중복·일시정지를 보존하고 변경 버전을 검사한다", async () => {
    const { agent, csrf } = await login(app), db = getDb();
    const [paused] = await db.insert(searchRules).values({ channelId: 1, query: "고입 전형일정", normalizedQuery: "고입 전형일정", endpoint: "news", enabled: false, memo: "운영자 메모" }).returning();
    const ch = (await agent.get("/api/channels")).body.find((c: { id: number }) => c.id === 1);
    const a = await agent.post("/api/channels/1/collection-profile").set("x-csrf-token", csrf).send({ version: ch.version });
    expect(a.status).toBe(200); expect(a.body.added).toBeGreaterThan(60);
    expect(a.body.channel.budget.llmCallsPerRun).toBe(0);
    const b = await agent.post("/api/channels/1/collection-profile").set("x-csrf-token", csrf).send({ version: a.body.channel.version });
    expect(b.body.added).toBe(0);
    const [unchanged] = await db.select().from(searchRules).where(eq(searchRules.id, paused.id));
    expect(unchanged).toMatchObject({ enabled: false, memo: "운영자 메모" });
    expect((await agent.post("/api/channels/1/collection-profile").set("x-csrf-token", csrf).send({ version: ch.version })).status).toBe(409);
  });
  it("오늘 수집은 KST 경계를 사용하고 수동 작성·샘플·제외 자료는 세지 않는다", async () => {
    const db = getDb(), { agent } = await login(app);
    await db.insert(contentItems).values([
      { channelId: 1, kind: "notice", origin: "collected", title: "어제 자료", createdAt: new Date("2026-10-25T14:59:59Z") },
      { channelId: 1, kind: "notice", origin: "collected", title: "오늘 자료", createdAt: new Date("2026-10-25T15:00:00Z") },
      { channelId: 1, kind: "notice", origin: "manual", title: "수동 작성", createdAt: new Date("2026-10-26T00:00:00Z") },
      { channelId: 1, kind: "notice", origin: "collected", title: "제외 자료", excluded: true, createdAt: new Date("2026-10-26T00:00:00Z") },
      { channelId: 1, kind: "notice", origin: "collected", title: "샘플 자료", isSample: true, createdAt: new Date("2026-10-26T00:00:00Z") },
      { channelId: 1, kind: "notice", origin: "collected", title: "내일 자료", createdAt: new Date("2026-10-26T15:00:00Z") },
    ]);
    const overview = await agent.get("/api/collection/overview?channelId=1&date=2026-10-26");
    expect(overview.status).toBe(200); expect(overview.body.channels[0].newItems).toBe(1);
    const list = await agent.get("/api/items?channelId=1&collectedOn=2026-10-26");
    expect(list.body.items.map((r: { item: { title: string } }) => r.item.title)).toEqual(["오늘 자료"]);
    expect((await agent.get("/api/collection/overview?channelId=all&date=2026-02-30")).status).toBe(400);
  });
  it("오래 대기한 수집은 새 요청을 중복 생성하지 않고 안전 모드로 재개한다", async () => {
    const db = getDb(), { agent, csrf } = await login(app);
    const old = await enqueueJob(db, { type: "collect", channelId: 1, dedupeKey: "collect:1" });
    await db.update(jobs).set({ createdAt: new Date("2026-10-01T00:00:00Z") }).where(eq(jobs.id, old.job.id));
    const summary = await agent.get("/api/collection/overview?channelId=1");
    expect(summary.body.channels[0].jobs[0].stale).toBe(true);
    const r = await agent.post("/api/collection/collect").set("x-csrf-token", csrf).send({ channelId: 1 });
    expect(r.status).toBe(202); expect(r.body.requested).toHaveLength(1); expect(r.body.requested[0].jobId).toBe(old.job.id);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, old.job.id));
    expect(job.payload.collectionOnly).toBe(true); expect(job.status).toBe("queued");
  });
  it("한도로 밀린 검색어는 다음 실행에서 먼저 검색한다", async () => {
    const db = getDb();
    await db.update(searchRules).set({ enabled: false }).where(eq(searchRules.channelId, 1));
    const [ch] = await db.select().from(channels).where(eq(channels.id, 1));
    await db.update(channels).set({ budget: { ...ch.budget, naverCallsPerRun: 1, fetchTargetsPerRun: 0 } }).where(eq(channels.id, 1));
    for (const query of ["순환 A", "순환 B"]) await db.insert(searchRules).values({ channelId: 1, query, normalizedQuery: query, endpoint: "news", enabled: true });
    const called: string[] = [];
    const naverFetch = vi.fn(async (url: URL | RequestInfo) => { called.push(new URL(String(url)).searchParams.get("query")!); return naverResponse([]); }) as typeof fetch;
    const a = await runCollect(db, 1, { trigger: "cli", naverFetch, collectionOnly: true });
    const b = await runCollect(db, 1, { trigger: "cli", naverFetch, collectionOnly: true });
    expect(called).toEqual(["순환 A", "순환 B"]); expect(a.counts.rulesDeferred).toBe(1); expect(b.status).toBe("ok_zero");
  });
  it("네이버 키 없이 공개 RSS를 수집하고 다음 실행의 중복을 제외한다", async () => {
    const db = getDb(), { agent } = await login(app);
    await db.update(searchRules).set({ enabled: false }).where(eq(searchRules.channelId, 1));
    const [ch] = await db.select().from(channels).where(eq(channels.id, 1));
    await db.update(channels).set({ budget: { ...ch.budget, naverCallsPerRun: 10, fetchTargetsPerRun: 0 } }).where(eq(channels.id, 1));
    await db.insert(searchRules).values({ channelId: 1, query: "공개 RSS", normalizedQuery: "공개 RSS", endpoint: "news", enabled: true });
    const now = new Date("2026-10-26T01:00:00Z");
    const rssLoad = vi.fn(async () => '<rss><channel><item><title>공개 RSS 뉴스</title><link>https://press.example/rss-keyless</link><pubDate>2026-10-26T00:00:00Z</pubDate><source url="https://press.example">테스트신문</source></item></channel></rss>');
    delete process.env.NAVER_CLIENT_ID;
    delete process.env.NAVER_CLIENT_SECRET;
    try {
      const a = await runCollect(db, 1, { trigger: "cli", now, rssLoad, collectionOnly: true });
      expect(a.counts).toMatchObject({ newItems: 1, rssFeedOk: PUBLIC_NEWS_FEEDS.length, googleQueries: 1 });
      const b = await runCollect(db, 1, { trigger: "cli", now, rssLoad, collectionOnly: true });
      expect(b.counts.newItems).toBe(0); expect(b.counts.duplicates).toBe(1);
      const list = await agent.get("/api/items?channelId=1&q=공개%20RSS");
      expect(list.body.items[0].source).toMatchObject({ kind: "rss_direct", publisher: "테스트신문" });
      const overview = await agent.get("/api/collection/overview?channelId=all");
      expect(overview.body).toMatchObject({ searchReady: true, naverReady: false, sourceMode: "public_rss" });
    } finally {
      process.env.NAVER_CLIENT_ID = "test-id"; process.env.NAVER_CLIENT_SECRET = "test-secret";
    }
  });
});
