import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv, login } from "./helpers";
setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { channels, officialSources, searchRules, contentItems, sourceDocuments } = await import("../shared/schema");
const { runCollect } = await import("../server/worker/collect");
const { createApp } = await import("../server/app");
const { seedOfficialCatalog, OFFICIAL_CATALOG, YOUTH_WEB_QUERIES } = await import("../server/services/officialCatalog");
beforeEach(async () => { await resetDb(); await getDb().update(searchRules).set({ enabled: false }); });
afterAll(closeDb);
async function board(name: string, category = "고등입시") {
  const [row] = await getDb().insert(officialSources).values({ channelId: 1, name, domain: "school.example", boardUrl: `https://school.example/${name}`, enabled: true, verifiedAt: new Date(), adapter: "generic_board", adapterConfig: { linkSelector: "a", subcategory: category } }).returning();
  return row;
}
async function budget(fetchCallsPerRun: number, fetchTargetsPerRun: number, resultsPerRun = 20) {
  const [ch] = await getDb().select().from(channels).where(eq(channels.id, 1));
  await getDb().update(channels).set({ budget: { ...ch.budget, naverCallsPerRun: 0, fetchCallsPerRun, fetchTargetsPerRun, resultsPerRun } }).where(eq(channels.id, 1));
}
const body = async (url: string) => ({ ok: true as const, finalUrl: url, title: "모집", text: "공식 원문 내용 ".repeat(50), hash: "test", attachments: [], contentKind: "html" as const });
it("installs official sources idempotently while preserving a paused source and custom configuration", async () => {
  await seedOfficialCatalog(getDb());
  const [ged] = await getDb().select().from(officialSources).where(eq(officialSources.name, "GED 영재선발 공고"));
  await getDb().update(officialSources).set({ enabled: false, adapterConfig: { linkSelector: ".custom" } }).where(eq(officialSources.id, ged.id));
  await seedOfficialCatalog(getDb());
  const rows = await getDb().select().from(officialSources).where(eq(officialSources.adapter, "generic_board"));
  expect(rows).toHaveLength(OFFICIAL_CATALOG.length);
  expect(rows.find(r => r.id === ged.id)).toMatchObject({ enabled: false, adapterConfig: { linkSelector: ".custom" } });
});
it("adds regional web searches once without resurrecting deleted or paused rules", async () => {
  await seedOfficialCatalog(getDb());
  const rows = (await getDb().select().from(searchRules)).filter(r => r.endpoint === "webkr");
  expect(rows).toHaveLength(YOUTH_WEB_QUERIES.length);
  await getDb().update(searchRules).set({ deletedAt: new Date(), enabled: false }).where(eq(searchRules.id, rows[0].id));
  await getDb().update(searchRules).set({ enabled: false }).where(eq(searchRules.id, rows[1].id));
  await seedOfficialCatalog(getDb());
  const again = (await getDb().select().from(searchRules)).filter(r => r.endpoint === "webkr");
  expect(again).toHaveLength(rows.length);
  expect(again.find(r => r.id === rows[0].id)?.deletedAt).not.toBeNull();
  expect(again.find(r => r.id === rows[1].id)?.enabled).toBe(false);
});
it("supports news, blogs and web documents in the existing rule editor API", async () => {
  const { agent, csrf } = await login(createApp());
  const response = await agent.post("/api/channels/1/rules").set("x-csrf-token", csrf).send({ query: "청소년 실험캠프", endpoints: ["news", "blog", "webkr"] });
  expect(response.status).toBe(201);
  expect((await getDb().select().from(searchRules)).filter(r => r.query === "청소년 실험캠프").map(r => r.endpoint).sort()).toEqual(["blog", "news", "webkr"]);
});
it("stores youth aggregator posts as secondary listings and filters college mentor recruitment", async () => {
  const source = await board("youth", "전국대회"); await budget(4, 2, 10);
  await getDb().update(officialSources).set({ adapterConfig: { linkSelector: "a", sourceRole: "discovery", youthOnly: true } }).where(eq(officialSources.id, source.id));
  const r = await runCollect(getDb(), 1, { trigger: "cli", collectionOnly: true, fetchSource: body, fetchBoard: async () => ({ ok: true, entries: [
    { title: "청소년 영상 공모전", url: "https://school.example/contest", dateText: null },
    { title: "청소년 AI 페스티벌 대학생 모집", url: "https://school.example/adult", dateText: null },
  ] }) });
  expect(r.counts.newItems).toBe(1);
  expect((await getDb().select().from(sourceDocuments))[0].kind).toBe("opportunity_listing");
});
it("collects official-only subcategories through the API even with no search rules or search budget", async () => {
  await board("camp", "캠프·체험 선발모집"); await budget(4, 2);
  const { agent, csrf } = await login(createApp());
  const response = await agent.post("/api/collection/collect").set("x-csrf-token", csrf).send({ channelId: 1, subcategory: "캠프·체험 선발모집" });
  expect(response.status).toBe(202);
  const r = await runCollect(getDb(), 1, { trigger: "cli", collectionOnly: true, subcategory: "캠프·체험 선발모집", fetchBoard: async () => ({ ok: true, entries: [{ title: "중학생 캠프 모집", url: "https://school.example/camp/1", dateText: null }] }), fetchSource: body });
  expect(r.counts).toMatchObject({ officialChecked: 1, officialNew: 1, fetchedOk: 1 });
  const [item] = await getDb().select().from(contentItems).where(eq(contentItems.runId, r.runId));
  expect(item.subcategory).toBe("캠프·체험 선발모집");
});
it("reserves body budget, rotates skipped boards and fetches one body per source first", async () => {
  await board("a"); await board("b"); await board("c"); await budget(4, 2);
  const fetchBoard = vi.fn(async (url: string) => ({ ok: true as const, entries: [1, 2].map(i => ({ title: `입학 모집요강 ${url}/${i}`, url: `${url}/${i}`, dateText: null })) }));
  const fetched: string[] = [];
  const first = await runCollect(getDb(), 1, { trigger: "cli", collectionOnly: true, now: new Date("2026-11-06T00:00:00Z"), fetchBoard, fetchSource: async url => { fetched.push(url); return body(url); } });
  expect(first.counts).toMatchObject({ officialChecked: 2, officialDeferred: 1, fetchedOk: 2 });
  expect(fetched).toEqual(["https://school.example/a/1", "https://school.example/b/1"]);
  fetchBoard.mockClear();
  await runCollect(getDb(), 1, { trigger: "cli", collectionOnly: true, now: new Date("2026-11-06T02:00:00Z"), fetchBoard, fetchSource: body });
  expect(fetchBoard.mock.calls[0][0]).toBe("https://school.example/c");
});
it("distinguishes all-board failure from healthy duplicate-only collection", async () => {
  const source = await board("a"); await budget(4, 2);
  const failure = await runCollect(getDb(), 1, { trigger: "cli", collectionOnly: true, fetchBoard: async () => ({ ok: false, error: "HTTP 403" }) });
  expect(failure.status).toBe("failed"); expect(failure.counts.officialFailed).toBe(1);
  const options = { trigger: "cli" as const, collectionOnly: true, fetchBoard: async () => ({ ok: true as const, entries: [{ title: "입학 모집", url: "https://school.example/1", dateText: null }] }), fetchSource: body };
  await runCollect(getDb(), 1, options);
  const duplicate = await runCollect(getDb(), 1, options);
  expect(duplicate.status).toBe("ok_zero"); expect(duplicate.counts.officialDuplicates).toBe(1);
  const [health] = await getDb().select().from(officialSources).where(eq(officialSources.id, source.id));
  expect(health).toMatchObject({ lastStatus: "ok", lastError: null, lastNewCount: 0 });
});
it("fetches a previously deferred official body without duplicating or overwriting the edited item", async () => {
  await board("a"); await budget(2, 0);
  const options = { trigger: "cli" as const, collectionOnly: true, fetchBoard: async () => ({ ok: true as const, entries: [{ title: "입학 모집", url: "https://school.example/1", dateText: null }] }), fetchSource: body };
  await runCollect(getDb(), 1, options);
  await getDb().update(contentItems).set({ title: "사용자 수정 제목" });
  await budget(2, 1); const r = await runCollect(getDb(), 1, options);
  expect(r.counts).toMatchObject({ newItems: 0, officialDuplicates: 1, fetchedOk: 1 });
  expect((await getDb().select().from(contentItems))[0].title).toBe("사용자 수정 제목");
  expect((await getDb().select().from(sourceDocuments))[0].fetchStatus).toBe("ok");
});
it("bounds official results and never treats a list date as an application deadline", async () => {
  await board("a"); await budget(4, 1, 1);
  const result = await runCollect(getDb(), 1, { trigger: "cli", collectionOnly: true, fetchBoard: async () => ({ ok: true, entries: [1, 2, 3].map(i => ({ title: `입학 모집 ${i}`, url: `https://school.example/${i}`, dateText: "2026.11.05" })) }), fetchSource: body });
  expect(result.counts.newItems).toBe(1); expect(result.counts.results).toBe(1);
  expect((await getDb().select().from(contentItems))[0].scheduleStatus).toBe("unknown");
});
it("finds new posts behind old pinned entries, then resumes deferred bodies", async () => {
  await board("a"); await budget(4, 1, 2);
  const entries = [1, 2, 3].map(i => ({ title: `입학 모집 ${i}`, url: `https://school.example/${i}`, dateText: null }));
  const options = { trigger: "cli" as const, collectionOnly: true, fetchBoard: async () => ({ ok: true as const, entries }), fetchSource: body };
  for (let i = 0; i < 3; i++) expect((await runCollect(getDb(), 1, options)).counts.officialNew).toBe(1);
  expect(await getDb().select().from(contentItems)).toHaveLength(3);
  await getDb().update(sourceDocuments).set({ fetchedText: null, fetchStatus: "not_fetched" }).where(eq(sourceDocuments.originalUrl, "https://school.example/3"));
  const fetchSource = vi.fn(body);
  const resumed = await runCollect(getDb(), 1, { ...options, fetchSource });
  expect(resumed.counts).toMatchObject({ newItems: 0, fetchedOk: 1 });
  expect(fetchSource.mock.calls[0][0]).toBe("https://school.example/3");
});
