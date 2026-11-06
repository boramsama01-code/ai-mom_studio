import { channelCategories, categoryLabel, validSubcategory } from "../../shared/channelCategories";
import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { appSettings, channels, contentItems, jobs, officialSources, runs, searchRules, sourceDocuments } from "../../shared/schema";
import { noticeIntentSql } from "../services/noticeIntent";
import { itemSourceIdSql } from "../services/itemSources";
import { COLLECTION_PROFILES, collectionDateSchema, collectionDayRange, kstDay, nextCollectionAt } from "../../shared/collection";
import { normalizeQuery, resolveDiscovery } from "../../shared/domain";
import { ah, conflict, HttpError, loadChannel, parse, zVersion } from "./util";
import { env } from "../env";
import { getSetting } from "../seed";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { enqueueJob } from "../worker/queue";
import { kickInlineCollect } from "../worker/inline";
import { orderedChannels } from "../services/channelOrder";
import { boardMatchesCategory } from "../services/officialCatalog";
import { PUBLIC_NEWS_FEEDS } from "../services/newsSearch";
import { secretStatuses } from "../secretStore";

export const collectionRoutes = Router();
const processStartedAt = Date.now() - process.uptime() * 1000;
const channelIdSchema = z.union([z.literal("all"), z.coerce.number().int().positive()]);
collectionRoutes.get("/collection/overview", ah(async (req, res) => {
  const q = parse(z.object({ channelId: channelIdSchema, date: collectionDateSchema.optional() }), req.query);
  const db = getDb(), now = new Date(), date = q.date ?? kstDay(now);
  const { start, end } = collectionDayRange(date);
  const chs = (await orderedChannels(db)).filter(ch => q.channelId === "all" ? ch.active : ch.id === q.channelId);
  const autoCollect = env.autoCollect || await getSetting(db, "auto_collect", false) === true;
  const globalStop = await getSetting(db, "global_stop", false) === true;
  const [naverTest] = await db.select({ value: appSettings.value, at: appSettings.updatedAt }).from(appSettings).where(eq(appSettings.key, "conn_test:naver")).limit(1);
  const naverKeys = await secretStatuses(db, ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]);
  const parsedTest = z.object({ ok: z.boolean() }).safeParse(naverTest?.value);
  // A later key edit needs a new test. Return only safe result metadata, never provider messages or credentials.
  const naverConnectionTest = naverTest && parsedTest.success && naverKeys.every(key => key.source === "environment"
    ? naverTest.at.getTime() >= processStartedAt
    : !key.updatedAt || new Date(key.updatedAt) <= naverTest.at)
    ? { ok: parsedTest.data.ok, at: naverTest.at.toISOString() } : null;
  const [scheduled] = await db.select({ startedAt: runs.startedAt }).from(runs).where(eq(runs.trigger, "schedule")).orderBy(desc(runs.id)).limit(1);
  const rows = await Promise.all(chs.map(async ch => {
    const ruleRows = await db.select({ id: searchRules.id, normalizedQuery: searchRules.normalizedQuery, endpoint: searchRules.endpoint, enabled: searchRules.enabled, deletedAt: searchRules.deletedAt }).from(searchRules).where(eq(searchRules.channelId, ch.id));
    const boards = await db.select({ id: officialSources.id }).from(officialSources).where(and(eq(officialSources.channelId, ch.id), eq(officialSources.enabled, true), sql`${officialSources.adapter} is not null and ${officialSources.verifiedAt} is not null`));
    const [counts] = await db.select({
      newItems: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${contentItems.reviewStatus} in ('pending','review_required'))::int`,
      fetched: sql<number>`count(*) filter (where ${contentItems.evidenceStatus} = 'official_confirmed')::int`,
      noticeCandidates: sql<number>`count(*) filter (where ${noticeIntentSql()} = 'candidate')::int`,
      noticeUncertain: sql<number>`count(*) filter (where ${noticeIntentSql()} = 'uncertain')::int`,
      noticeReports: sql<number>`count(*) filter (where ${noticeIntentSql()} in ('retrospective','off_topic','closed'))::int`,
    }).from(contentItems).leftJoin(sourceDocuments, eq(sourceDocuments.id, itemSourceIdSql())).where(and(eq(contentItems.channelId, ch.id), eq(contentItems.isSample, !!req.session.demo), eq(contentItems.excluded, false), inArray(contentItems.origin, ["collected", "discovered"]), gte(contentItems.createdAt, start), lt(contentItems.createdAt, end)));
    const categoryRows = await db.select({ subcategory: contentItems.subcategory, count: sql<number>`count(*)::int` }).from(contentItems).where(and(eq(contentItems.channelId, ch.id), eq(contentItems.isSample, !!req.session.demo), eq(contentItems.excluded, false), inArray(contentItems.origin, ["collected", "discovered"]), gte(contentItems.createdAt, start), lt(contentItems.createdAt, end))).groupBy(contentItems.subcategory);
    const categories = [...channelCategories(ch.slug, ch.categories), "미분류"].map(label => ({ label, newItems: categoryRows.filter(r => categoryLabel(r.subcategory) === label).reduce((n, r) => n + r.count, 0) }));
    const [lastRun] = await db.select().from(runs).where(and(eq(runs.channelId, ch.id), eq(runs.kind, "collect"))).orderBy(desc(runs.id)).limit(1);
    const pendingJobs = await db.select({ id: jobs.id, status: jobs.status, createdAt: jobs.createdAt, leaseExpiresAt: jobs.leaseExpiresAt }).from(jobs).where(and(eq(jobs.channelId, ch.id), eq(jobs.type, "collect"), inArray(jobs.status, ["queued", "running"])));
    const discovery = resolveDiscovery(ch.contentType, ch.budget.discovery);
    const profile = Object.hasOwn(COLLECTION_PROFILES, ch.slug) ? COLLECTION_PROFILES[ch.slug] : undefined;
    const profileRules = profile ? (["news", "blog"] as const).flatMap(endpoint => profile[endpoint].map(query => {
      const matches = ruleRows.filter(r => r.normalizedQuery === normalizeQuery(query) && r.endpoint === endpoint);
      const existing = matches.find(r => !r.deletedAt) ?? matches[0];
      return { query, endpoint, state: !existing ? "missing" as const : existing.deletedAt ? "removed" as const : existing.enabled ? "active" as const : "paused" as const };
    })) : [];
    return { id: ch.id, version: ch.version, slug: ch.slug, name: ch.name, active: ch.active, queries: ruleRows.filter(r => r.enabled && !r.deletedAt).length, discoveryQueries: discovery?.enabled ? discovery.queries.length : 0, boards: boards.length, budget: ch.budget.naverCallsPerRun,
      categories,
      profile: profile ? { label: profile.label, count: profileRules.length, missing: profileRules.filter(r => r.state === "missing").length, active: profileRules.filter(r => r.state === "active").length, paused: profileRules.filter(r => r.state === "paused").length, removed: profileRules.filter(r => r.state === "removed").length, rules: profileRules } : null, ...counts,
      jobs: pendingJobs.map(j => ({ id: j.id, status: j.status, createdAt: j.createdAt, stale: j.status === "queued" ? now.getTime() - j.createdAt.getTime() > 120_000 : !j.leaseExpiresAt || j.leaseExpiresAt < now })),
      lastRun: lastRun ? { subcategory: typeof lastRun.snapshot.subcategory === "string" ? lastRun.snapshot.subcategory : null, id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, counts: lastRun.counts, errors: lastRun.errors } : null };
  }));
  res.json({ date, timezone: "Asia/Seoul", autoCollect, globalStop, searchReady: true, sourceMode: "official_naver", collectionStrategy: "official_first", publicFeeds: PUBLIC_NEWS_FEEDS.map(f => f.name), naverReady: !!env.naverClientId && !!env.naverClientSecret, naverConnectionTest, inlineWorker: env.inlineWorker, nextAt: autoCollect && !globalStop ? nextCollectionAt(now) : null, lastScheduledAt: scheduled?.startedAt ?? null, channels: rows });
}));

collectionRoutes.post("/channels/:cid/collection-profile", ah(async (req, res) => {
  const ch = await loadChannel(req.params.cid), body = parse(z.object({ version: zVersion }), req.body);
  const profile = Object.hasOwn(COLLECTION_PROFILES, ch.slug) ? COLLECTION_PROFILES[ch.slug] : undefined;
  if (!profile || !ch.active) throw new HttpError(400, "이 채널에는 외부 자료 수집 추천 묶음이 없습니다.");
  const db = getDb();
  const result = await db.transaction(async tx => {
    const budget = { ...ch.budget, naverCallsPerRun: Math.max(ch.budget.naverCallsPerRun, profile.calls), resultsPerRun: Math.max(ch.budget.resultsPerRun, profile.results), fetchTargetsPerRun: Math.max(ch.budget.fetchTargetsPerRun, 8), fetchCallsPerRun: Math.max(ch.budget.fetchCallsPerRun, 16), llmCallsPerRun: 0,
      ...(profile.discovery.length ? { discovery: { enabled: true, queries: profile.discovery, picksPerRun: 8, autoDraft: false } } : {}) };
    const [updated] = await tx.update(channels).set({ budget, version: sql`${channels.version} + 1`, updatedAt: new Date() }).where(and(eq(channels.id, ch.id), eq(channels.version, body.version))).returning();
    if (!updated) conflict(ch);
    const candidates = (["news", "blog"] as const).flatMap(endpoint => profile[endpoint].map(query => ({ channelId: ch.id, query, normalizedQuery: normalizeQuery(query), endpoint, enabled: true, display: 10, priority: 100, memo: `추천 검색어 · ${profile.label}` })));
    const existing = await tx.select({ normalizedQuery: searchRules.normalizedQuery, endpoint: searchRules.endpoint }).from(searchRules).where(eq(searchRules.channelId, ch.id));
    const missing = candidates.filter(c => !existing.some(r => r.normalizedQuery === c.normalizedQuery && r.endpoint === c.endpoint));
    const created = missing.length ? await tx.insert(searchRules).values(missing).onConflictDoNothing().returning({ id: searchRules.id }) : [];
    await audit(tx, { actor: actorOf(req), action: "apply_collection_profile", entity: "channel", entityId: ch.id, channelId: ch.id, detail: { added: created.length, profile: profile.label, budget } });
    return { added: created.length, preserved: candidates.length - created.length, channel: updated };
  });
  res.json(result);
}));

collectionRoutes.post("/collection/collect", ah(async (req, res) => {
  const { channelId, subcategory } = parse(z.object({ channelId: channelIdSchema, subcategory: z.string().min(1).max(40).optional() }), req.body);
  if (subcategory && channelId === "all") throw new HttpError(400, "소분류 수집은 채널 하나를 선택해 주세요.");
  const db = getDb();
  if (await getSetting(db, "global_stop", false)) throw new HttpError(409, "전역 정지 중입니다. 실행 기록에서 정지 상태를 먼저 확인하세요.");
  const chs = await db.select().from(channels).where(and(eq(channels.active, true), channelId === "all" ? undefined : eq(channels.id, channelId)));
  const requested = [];
  for (const ch of chs) {
    if (!validSubcategory(ch.slug, subcategory, ch.categories)) throw new HttpError(400, "이 채널의 소분류를 선택해 주세요.");
    const [rule] = await db.select({ id: searchRules.id }).from(searchRules).where(and(eq(searchRules.channelId, ch.id), eq(searchRules.enabled, true), isNull(searchRules.deletedAt), subcategory ? eq(searchRules.subcategory, subcategory) : undefined)).limit(1);
    const boardRows = await db.select().from(officialSources).where(and(eq(officialSources.channelId, ch.id), eq(officialSources.enabled, true), sql`${officialSources.adapter} is not null and ${officialSources.verifiedAt} is not null`));
    const board = boardRows.find(o => o.domain && o.boardUrl && boardMatchesCategory(ch.slug, o, subcategory, ch.categories));
    const d = resolveDiscovery(ch.contentType, ch.budget.discovery);
    if (subcategory && (!rule || !ch.budget.naverCallsPerRun) && (!board || !ch.budget.fetchCallsPerRun)) continue;
    if ((!rule && !board && !(d?.enabled && d.queries.length && d.picksPerRun)) || (!ch.budget.naverCallsPerRun && !board)) continue;
    const r = await enqueueJob(db, { type: "collect", channelId: ch.id, dedupeKey: subcategory ? `collect:${ch.id}:category:${subcategory}` : `collect:${ch.id}`, requestedBy: actorOf(req), maxAttempts: 2, payload: { collectionOnly: true, ...(subcategory ? { subcategory } : {}) } });
    // 오래 대기한 요청도 같은 안전한 수집 경로로 재개한다.
    await db.update(jobs).set({ payload: { ...r.job.payload, collectionOnly: true } }).where(and(eq(jobs.id, r.job.id), eq(jobs.status, "queued")));
    requested.push({ channelId: ch.id, jobId: r.job.id, duplicate: r.duplicate });
  }
  if (!requested.length) throw new HttpError(400, subcategory ? "선택한 소분류에 활성 키워드나 공식 출처를 연결하고 수집 한도를 설정해 주세요." : "활성 검색어 또는 연결된 공식 게시판을 먼저 설정하세요.");
  const inline = kickInlineCollect(db);
  await audit(db, { actor: actorOf(req), action: "collect_channels", entity: "job", detail: { requested, inline } });
  res.status(202).json({ requested, inline });
}));


