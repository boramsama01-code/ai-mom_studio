import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { channels, contentItems, jobs, officialSources, runs, searchRules } from "../../shared/schema";
import { COLLECTION_PROFILES, collectionDateSchema, collectionDayRange, kstDay, nextCollectionAt } from "../../shared/collection";
import { normalizeQuery, resolveDiscovery } from "../../shared/domain";
import { ah, conflict, HttpError, loadChannel, parse, zVersion } from "./util";
import { env } from "../env";
import { getSetting } from "../seed";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { enqueueJob } from "../worker/queue";
import { kickInlineCollect } from "../worker/inline";

export const collectionRoutes = Router();
const channelIdSchema = z.union([z.literal("all"), z.coerce.number().int().positive()]);
collectionRoutes.get("/collection/overview", ah(async (req, res) => {
  const q = parse(z.object({ channelId: channelIdSchema, date: collectionDateSchema.optional() }), req.query);
  const db = getDb(), now = new Date(), date = q.date ?? kstDay(now);
  const { start, end } = collectionDayRange(date);
  const chs = await db.select().from(channels).where(q.channelId === "all" ? eq(channels.active, true) : eq(channels.id, q.channelId)).orderBy(asc(channels.id));
  const autoCollect = env.autoCollect || await getSetting(db, "auto_collect", false) === true;
  const globalStop = await getSetting(db, "global_stop", false) === true;
  const [scheduled] = await db.select({ startedAt: runs.startedAt }).from(runs).where(eq(runs.trigger, "schedule")).orderBy(desc(runs.id)).limit(1);
  const rows = await Promise.all(chs.map(async ch => {
    const ruleRows = await db.select({ id: searchRules.id }).from(searchRules).where(and(eq(searchRules.channelId, ch.id), eq(searchRules.enabled, true), isNull(searchRules.deletedAt)));
    const boards = await db.select({ id: officialSources.id }).from(officialSources).where(and(eq(officialSources.channelId, ch.id), eq(officialSources.enabled, true), sql`${officialSources.adapter} is not null and ${officialSources.verifiedAt} is not null`));
    const [counts] = await db.select({
      newItems: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${contentItems.reviewStatus} in ('pending','review_required'))::int`,
      fetched: sql<number>`count(*) filter (where ${contentItems.evidenceStatus} = 'official_confirmed')::int`,
    }).from(contentItems).where(and(eq(contentItems.channelId, ch.id), eq(contentItems.isSample, !!req.session.demo), eq(contentItems.excluded, false), inArray(contentItems.origin, ["collected", "discovered"]), gte(contentItems.createdAt, start), lt(contentItems.createdAt, end)));
    const [lastRun] = await db.select().from(runs).where(and(eq(runs.channelId, ch.id), eq(runs.kind, "collect"))).orderBy(desc(runs.id)).limit(1);
    const pendingJobs = await db.select({ id: jobs.id, status: jobs.status, createdAt: jobs.createdAt, leaseExpiresAt: jobs.leaseExpiresAt }).from(jobs).where(and(eq(jobs.channelId, ch.id), eq(jobs.type, "collect"), inArray(jobs.status, ["queued", "running"])));
    const discovery = resolveDiscovery(ch.contentType, ch.budget.discovery);
    const profile = COLLECTION_PROFILES[ch.slug];
    return { id: ch.id, version: ch.version, slug: ch.slug, name: ch.name, active: ch.active, queries: ruleRows.length, discoveryQueries: discovery?.enabled ? discovery.queries.length : 0, boards: boards.length, budget: ch.budget.naverCallsPerRun,
      profile: profile ? { label: profile.label, count: profile.news.length + profile.blog.length } : null, ...counts,
      jobs: pendingJobs.map(j => ({ id: j.id, status: j.status, createdAt: j.createdAt, stale: j.status === "queued" ? now.getTime() - j.createdAt.getTime() > 120_000 : !j.leaseExpiresAt || j.leaseExpiresAt < now })),
      lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, counts: lastRun.counts, errors: lastRun.errors } : null };
  }));
  res.json({ date, timezone: "Asia/Seoul", autoCollect, globalStop, naverReady: !!env.naverClientId && !!env.naverClientSecret, inlineWorker: env.inlineWorker, nextAt: autoCollect && !globalStop ? nextCollectionAt(now) : null, lastScheduledAt: scheduled?.startedAt ?? null, channels: rows });
}));

collectionRoutes.post("/channels/:cid/collection-profile", ah(async (req, res) => {
  const ch = await loadChannel(req.params.cid), body = parse(z.object({ version: zVersion }), req.body);
  const profile = COLLECTION_PROFILES[ch.slug];
  if (!profile || !ch.active) throw new HttpError(400, "이 채널에는 외부 자료 수집 추천 묶음이 없습니다.");
  const db = getDb();
  const result = await db.transaction(async tx => {
    const budget = { ...ch.budget, naverCallsPerRun: Math.max(ch.budget.naverCallsPerRun, profile.calls), resultsPerRun: Math.max(ch.budget.resultsPerRun, profile.results), fetchTargetsPerRun: Math.max(ch.budget.fetchTargetsPerRun, 8), fetchCallsPerRun: Math.max(ch.budget.fetchCallsPerRun, 16), llmCallsPerRun: 0,
      ...(profile.discovery.length ? { discovery: { enabled: true, queries: profile.discovery, picksPerRun: 8, autoDraft: false } } : {}) };
    const [updated] = await tx.update(channels).set({ budget, version: sql`${channels.version} + 1`, updatedAt: new Date() }).where(and(eq(channels.id, ch.id), eq(channels.version, body.version))).returning();
    if (!updated) conflict(ch);
    const candidates = (["news", "blog"] as const).flatMap(endpoint => profile[endpoint].map(query => ({ channelId: ch.id, query, normalizedQuery: normalizeQuery(query), endpoint, enabled: true, display: 10, priority: 100, memo: `추천 검색어 · ${profile.label}` })));
    const created = await tx.insert(searchRules).values(candidates).onConflictDoNothing().returning({ id: searchRules.id });
    await audit(tx, { actor: actorOf(req), action: "apply_collection_profile", entity: "channel", entityId: ch.id, channelId: ch.id, detail: { added: created.length, profile: profile.label, budget } });
    return { added: created.length, preserved: candidates.length - created.length, channel: updated };
  });
  res.json(result);
}));

collectionRoutes.post("/collection/collect", ah(async (req, res) => {
  const { channelId } = parse(z.object({ channelId: channelIdSchema }), req.body);
  const db = getDb();
  if (await getSetting(db, "global_stop", false)) throw new HttpError(409, "전역 정지 중입니다. 실행 기록에서 정지 상태를 먼저 확인하세요.");
  const chs = await db.select().from(channels).where(and(eq(channels.active, true), channelId === "all" ? undefined : eq(channels.id, channelId)));
  const requested = [];
  for (const ch of chs) {
    const [rule] = await db.select({ id: searchRules.id }).from(searchRules).where(and(eq(searchRules.channelId, ch.id), eq(searchRules.enabled, true), isNull(searchRules.deletedAt))).limit(1);
    const [board] = await db.select({ id: officialSources.id }).from(officialSources).where(and(eq(officialSources.channelId, ch.id), eq(officialSources.enabled, true), sql`${officialSources.adapter} is not null and ${officialSources.verifiedAt} is not null`)).limit(1);
    const d = resolveDiscovery(ch.contentType, ch.budget.discovery);
    if ((!rule && !board && !(d?.enabled && d.queries.length && d.picksPerRun)) || (!ch.budget.naverCallsPerRun && !board)) continue;
    const r = await enqueueJob(db, { type: "collect", channelId: ch.id, dedupeKey: `collect:${ch.id}`, requestedBy: actorOf(req), maxAttempts: 2, payload: { collectionOnly: true } });
    // 오래 대기한 요청도 같은 안전한 수집 경로로 재개한다.
    await db.update(jobs).set({ payload: { ...r.job.payload, collectionOnly: true } }).where(and(eq(jobs.id, r.job.id), eq(jobs.status, "queued")));
    requested.push({ channelId: ch.id, jobId: r.job.id, duplicate: r.duplicate });
  }
  if (!requested.length) throw new HttpError(400, "활성 검색어 또는 연결된 공식 게시판을 먼저 설정하세요.");
  const inline = kickInlineCollect(db);
  await audit(db, { actor: actorOf(req), action: "collect_channels", entity: "job", detail: { requested, inline } });
  res.status(202).json({ requested, inline });
}));
