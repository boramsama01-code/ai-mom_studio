import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
setTestEnv();
const { getDb, getPool, closeDb } = await import("../server/db");
const { channels, contentItems, officialSources, searchRules } = await import("../shared/schema");
const { runCollect } = await import("../server/worker/collect");
beforeAll(resetDb);
afterAll(closeDb);

it("공식 출처를 중복 없이 추가하며 운영자가 멈춘 출처를 다시 켜지 않는다", async () => {
  const db = getDb();
  const migration = await readFile(new URL("../migrations/0005_notice_sources.sql", import.meta.url), "utf8");
  await getPool().query(migration);
  const rows = await db.select().from(officialSources).where(eq(officialSources.adapter, "generic_board"));
  expect(rows).toHaveLength(2);
  await db.update(officialSources).set({ enabled: false, verificationNote: "운영자 일시정지" }).where(eq(officialSources.name, "GED 영재선발 공고"));
  await getPool().query(migration);
  const again = await db.select().from(officialSources).where(eq(officialSources.adapter, "generic_board"));
  expect(again).toHaveLength(2);
  expect(again.find(r => r.name === "GED 영재선발 공고")).toMatchObject({ enabled: false, verificationNote: "운영자 일시정지" });
});

it("공식 공고의 원문을 우선 확보하고 사후 홍보는 새 저장에서 제외한다", async () => {
  const db = getDb();
  await db.update(searchRules).set({ enabled: false }).where(eq(searchRules.channelId, 1));
  await db.insert(searchRules).values({ channelId: 1, query: "품질시험", normalizedQuery: "품질시험", endpoint: "news", enabled: true });
  const [ch] = await db.select().from(channels).where(eq(channels.id, 1));
  await db.update(channels).set({ budget: { ...ch.budget, naverCallsPerRun: 1, fetchCallsPerRun: 4, fetchTargetsPerRun: 1 } }).where(eq(channels.id, 1));
  const fetched: string[] = [];
  const result = await runCollect(db, 1, {
    trigger: "cli", collectionOnly: true, now: new Date("2026-10-26T01:00:00Z"),
    fetchBoard: async () => ({ ok: true, entries: [
      { title: "품질시험 청소년 캠프 모집", url: "https://www.scienceall.com/quality-invite", dateText: null },
      { title: "품질시험 과학캠프 성료", url: "https://www.scienceall.com/quality-report", dateText: null },
    ] }),
    rssLoad: async () => `<rss><channel>${["품질시험 참가자 모집", "품질시험 과학대회 성료", "품질시험 강사 채용 공고"].map((title, i) => `<item><title>${title}</title><link>https://press.example/quality-${i}</link><pubDate>2026-10-26T00:00:00Z</pubDate></item>`).join("")}</channel></rss>`,
    fetchSource: async url => { fetched.push(url); return { ok: true, finalUrl: url, title: "모집", text: "청소년 신청 안내".repeat(20), hash: "quality", attachments: [], contentKind: "html" }; },
  });
  expect(result.counts).toMatchObject({ officialNew: 1, newItems: 2, noticeReportsSkipped: 3, fetchedOk: 1 });
  expect(fetched).toEqual(["https://www.scienceall.com/quality-invite"]);
  const rows = await db.select().from(contentItems).where(eq(contentItems.runId, result.runId));
  expect(rows.map(r => r.title).sort()).toEqual(["품질시험 참가자 모집", "품질시험 청소년 캠프 모집"].sort());
});
