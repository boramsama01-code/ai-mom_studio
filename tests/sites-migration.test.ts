import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { migrateSitesStarter } = await import("../server/services/sitesMigration");
const { saveStudioCard, saveStudioNotes, loadStudioNotes, importStudioBoard } = await import("../server/services/studio");
const { appSettings, approvals, channels, contentItems, sourceDocuments, studioCards, studioRevisions } = await import("../shared/schema");
const { default: starter } = await import("../server/data/sitesStarter.json");
const { normalizeUrl } = await import("../server/services/url");

beforeEach(resetDb);
afterAll(closeDb);

describe("Sites 기본 자료 통합", () => {
  it("기존 운영 자료는 유지하고 계획7건·샘플 공고7건만 추가한다", async () => {
    const db = getDb();
    const [ch] = await db.select().from(channels).where(eq(channels.slug, "opportunities"));
    const notice = starter.notices[0];
    const [liveSource] = await db.insert(sourceDocuments).values({ normalizedUrl: normalizeUrl(notice.url), originalUrl: notice.url,
      kind: "manual", title: "운영자가 수정한 원문", isSample: false }).returning();
    const [liveItem] = await db.insert(contentItems).values({ channelId: ch.id, primarySourceId: liveSource.id, title: "운영자 콘텐츠",
      kind: "notice", isSample: false, edited: { title: "운영자 콘텐츠" } }).returning();

    expect(await migrateSitesStarter(db)).toEqual({ applied: true, studioCards: 7, sampleNotices: 7 });
    expect(await db.select().from(studioCards)).toHaveLength(7);
    expect(await db.select().from(studioRevisions)).toHaveLength(7);
    const sampleItems = await db.select().from(contentItems).where(eq(contentItems.isSample, true));
    expect(sampleItems).toHaveLength(7);
    expect(sampleItems.every(i => i.reviewStatus === "pending" && i.evidenceStatus === "needs_review" && i.publishStatus === "waiting")).toBe(true);
    expect(await db.select().from(approvals)).toHaveLength(0);
    expect((await db.select().from(contentItems).where(eq(contentItems.id, liveItem.id)))[0]).toEqual(liveItem);
    const [copiedSource] = await db.select().from(sourceDocuments).where(and(eq(sourceDocuments.normalizedUrl, normalizeUrl(notice.url)), eq(sourceDocuments.isSample, true)));
    expect(copiedSource.meta.originalNotice).toEqual(notice);
    expect(copiedSource.fetchStatus).toBe("not_fetched");
  });

  it("재배포가 수정한 카드와 비운 메모를 되돌리지 않는다", async () => {
    const db = getDb();
    await migrateSitesStarter(db);
    const [card] = await db.select().from(studioCards);
    await saveStudioCard(db, card.id, card.version, { title: "새롭게 수정한 제목" }, "operator");
    const notes = await loadStudioNotes(db);
    await saveStudioNotes(db, notes.notesVersion, "");
    expect(await migrateSitesStarter(db)).toEqual({ applied: false, studioCards: 0, sampleNotices: 0 });
    expect((await db.select().from(studioCards).where(eq(studioCards.id, card.id)))[0].content.title).toBe("새롭게 수정한 제목");
    expect((await loadStudioNotes(db)).notes).toBe("");
    expect(await db.select().from(studioCards)).toHaveLength(7);
  });

  it("이전 중 오류가 나면 카드·메모·완료 표시를 모두 되돌린다", async () => {
    const db = getDb();
    await db.update(channels).set({ slug: "renamed-opportunities" }).where(eq(channels.slug, "opportunities"));
    await expect(migrateSitesStarter(db)).rejects.toThrow("Highway 기본 채널");
    expect(await db.select().from(studioCards)).toHaveLength(0);
    expect(await db.select().from(studioRevisions)).toHaveLength(0);
    expect((await loadStudioNotes(db)).notes).toBe("");
    expect(await db.select().from(appSettings).where(eq(appSettings.key, "sites_starter_migration_2026_10_20"))).toHaveLength(0);
  });

  it("수동 백업 재가져오기도 운영자가 비운 메모를 덮어쓰지 않는다", async () => {
    const db = getDb();
    await saveStudioNotes(db, 1, "");
    const result = await importStudioBoard(db, { cards: [], settings: { notes: "예전 메모" } }, "operator");
    expect(result.notesImported).toBe(false);
    expect(await loadStudioNotes(db)).toEqual({ notes: "", notesVersion: 2 });
  });
});
