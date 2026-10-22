import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { appSettings, channels, contentItems, contentSources, sourceDocuments } from "../../shared/schema";
import { emptyPayload, noticePayloadSchema } from "../../shared/payloads";
import { createRevision } from "../content";
import { importStudioBoard, studioImportSchema } from "./studio";
import { normalizeUrl } from "./url";
import starter from "../data/sitesStarter.json";

const MIGRATION_KEY = "sites_starter_migration_2026_10_20";

/**
 * The old Site contains only these unedited source defaults (verified by a deep
 * comparison on 2026-10-20). Do not combine its separate visitor owner scopes.
 * No visitor IDs, credentials, approvals, or private user edits are included.
 * Planning cards are editable drafts; historical notice examples are demo-only.
 * A marker prevents deleted cards/cleared notes from reappearing on redeploy.
 */
export async function migrateSitesStarter(db: DB) {
  const board = studioImportSchema.parse(starter.board);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193202)`);
    const [done] = await tx.select().from(appSettings).where(eq(appSettings.key, MIGRATION_KEY));
    if (done) return { applied: false, studioCards: 0, sampleNotices: 0 };

    // Drizzle's nested transaction is a PostgreSQL savepoint: the marker and all
    // imported records still commit/roll back as one outer transaction.
    const imported = await importStudioBoard(tx as unknown as DB, board, "migration:sites");
    const [highway] = await tx.select().from(channels).where(eq(channels.slug, "opportunities"));
    if (!highway) throw new Error("Sites 이전 전 Highway 기본 채널을 생성해야 합니다.");
    let sampleNotices = 0;

    for (const notice of starter.notices) {
      const normalizedUrl = normalizeUrl(notice.url);
      const [insertedSource] = await tx.insert(sourceDocuments).values({
        normalizedUrl, originalUrl: notice.url, title: notice.title, snippet: notice.summary,
        kind: "manual", fetchStatus: "not_fetched", isSample: true,
        meta: { origin: "sites_initial_reference", sourceId: notice.sourceId, sourceLabel: notice.sourceLabel,
          sourceCheckedAt: notice.sourceCheckedAt, originalNotice: notice },
      }).onConflictDoNothing().returning();
      const source = insertedSource ?? (await tx.select().from(sourceDocuments).where(and(
        eq(sourceDocuments.normalizedUrl, normalizedUrl), eq(sourceDocuments.isSample, true),
      )))[0];
      const payload = noticePayloadSchema.parse({
        ...emptyPayload("notice", notice.title), organization: notice.organization, audience: notice.audience,
        category: notice.category === "전국자사고 입시" ? "전국단위 자사고 입시"
          : /영재학교|과학고/.test(notice.category) ? "영재학교·과학고 입시"
          : notice.category === "STEM 경시대회" ? "STEM 대회" : notice.category,
        one_line_summary: notice.summary,
        key_details: notice.evidence,
        // Original dates remain in metadata. The old snapshots are not current
        // verified schedules; the operator must check the actual source again.
        schedules: [], evidence: [],
        uncertainties: ["기존 Hub 초기 참고 자료입니다. 원문과 일정·대상을 다시 확인해야 합니다."],
      });
      const [item] = await tx.insert(contentItems).values({
        channelId: highway.id, primarySourceId: source.id, title: notice.title, kind: "notice", origin: "manual",
        category: payload.category, relevance: "uncertain", evidenceStatus: "needs_review", scheduleStatus: "unknown",
        reviewStatus: "pending", publishStatus: "waiting", isSample: true, extracted: payload,
      }).onConflictDoNothing().returning();
      if (!item) continue;
      await tx.insert(contentSources).values({ contentItemId: item.id, sourceDocumentId: source.id, role: "primary" }).onConflictDoNothing();
      await createRevision(tx, { contentItemId: item.id, author: "system", payload,
        note: "기존 Hub 초기 참고 자료 보존 · 샘플 · 원문 재확인 필요" });
      sampleNotices++;
    }

    // Retain the old catalog and keyword defaults as migration provenance only;
    // do not overwrite existing source adapters, active rules or user settings.
    await tx.insert(appSettings).values({ key: "sites_initial_reference_catalog", value: {
      sources: starter.sourceCatalog, keywords: starter.keywords,
    } }).onConflictDoNothing();
    await tx.insert(appSettings).values({ key: MIGRATION_KEY, value: {
      migratedAt: new Date().toISOString(), source: "sites-source-defaults", studioCards: imported.imported,
      sampleNotices, notesImported: imported.notesImported, ownerDataImported: false,
    } });
    return { applied: true, studioCards: imported.imported, sampleNotices };
  });
}
