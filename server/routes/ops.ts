/**
 * 오늘의 작업 · 실행 기록 · 작업 큐 · 전역 설정 · 감사 로그
 */
import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { appSettings, auditLogs, contentItems, jobs, runs, workerRuns } from "../../shared/schema";
import { ah, HttpError, intParam, loadChannel, parse } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { enqueueJob } from "../worker/queue";
import { integrationStatus } from "../env";

export const opsRoutes = Router();

opsRoutes.get(
  "/status",
  ah(async (_req, res) => {
    const db = getDb();
    const [lastWorker] = await db.select().from(workerRuns).orderBy(desc(workerRuns.id)).limit(1);
    const [{ queued }] = (await db.select({ queued: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.status, "queued"))) as Array<{ queued: number }>;
    const [gs] = await db.select().from(appSettings).where(eq(appSettings.key, "global_stop"));
    res.json({
      integrations: integrationStatus(),
      worker: lastWorker ?? null,
      // 최근 6시간 안에 워커 실행 기록이 없으면 "워커 미연결"로 안내
      workerConnected: !!lastWorker && Date.now() - new Date(lastWorker.startedAt).getTime() < 6 * 3600_000,
      queuedJobs: queued,
      globalStop: gs ? gs.value === true : false,
    });
  }),
);

/** 오늘의 작업 — 실측 숫자만 */
opsRoutes.get(
  "/channels/:cid/today",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const db = getDb();
    const base = and(eq(contentItems.channelId, ch.id), eq(contentItems.excluded, false), eq(contentItems.isSample, !!req.session.demo));
    const count = async (extra: ReturnType<typeof eq>) =>
      ((await db.select({ n: sql<number>`count(*)::int` }).from(contentItems).where(and(base, extra))) as Array<{ n: number }>)[0].n;
    const pendingReview = await count(inArray(contentItems.reviewStatus, ["pending", "review_required"]));
    const needsEvidence = await count(inArray(contentItems.evidenceStatus, ["needs_review", "fetch_failed", "conflict"]));
    const draftsReady = await count(and(eq(contentItems.reviewStatus, "reviewed"), eq(contentItems.publishStatus, "waiting"))!);
    const [next] = await db
      .select({ id: contentItems.id, title: contentItems.title, reviewStatus: contentItems.reviewStatus })
      .from(contentItems)
      .where(and(base, inArray(contentItems.reviewStatus, ["review_required", "pending"])))
      .orderBy(sql`case when ${contentItems.reviewStatus} = 'review_required' then 0 else 1 end`, desc(contentItems.createdAt))
      .limit(1);
    const [lastRun] = await db.select().from(runs).where(eq(runs.channelId, ch.id)).orderBy(desc(runs.id)).limit(1);
    const pendingJobs = await db.select().from(jobs).where(and(eq(jobs.channelId, ch.id), inArray(jobs.status, ["queued", "running"]))).orderBy(desc(jobs.id)).limit(5);
    res.json({ counts: { pendingReview, needsEvidence, draftsReady }, next: next ?? null, lastRun: lastRun ?? null, pendingJobs });
  }),
);

opsRoutes.get(
  "/runs",
  ah(async (req, res) => {
    const q = parse(z.object({ channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]), limit: z.coerce.number().int().min(1).max(100).optional() }), req.query);
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(q.channelId === "all" ? undefined : eq(runs.channelId, q.channelId))
      .orderBy(desc(runs.id))
      .limit(q.limit ?? 30);
    const workers = await db.select().from(workerRuns).orderBy(desc(workerRuns.id)).limit(20);
    res.json({ runs: rows, workers });
  }),
);

opsRoutes.get(
  "/jobs",
  ah(async (req, res) => {
    const q = parse(z.object({ channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]) }), req.query);
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(q.channelId === "all" ? undefined : eq(jobs.channelId, q.channelId))
      .orderBy(desc(jobs.id))
      .limit(50);
    res.json(rows);
  }),
);

/** 정식 수집 요청 — DB에 작업만 등록(워커가 처리). 즉시 처리한 것처럼 보이지 않게 한다. */
opsRoutes.post(
  "/channels/:cid/jobs/collect",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    if (!ch.active) throw new HttpError(400, "비활성 채널입니다.");
    const db = getDb();
    const r = await enqueueJob(db, { type: "collect", channelId: ch.id, dedupeKey: `collect:${ch.id}`, requestedBy: actorOf(req), maxAttempts: 2 });
    if (!r.duplicate) await audit(db, { actor: actorOf(req), action: "enqueue_collect", entity: "job", entityId: r.job.id, channelId: ch.id });
    res.status(r.duplicate ? 200 : 201).json(r);
  }),
);

opsRoutes.post(
  "/jobs/:id/cancel",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const db = getDb();
    const upd = await db.update(jobs).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.status, "queued"))).returning();
    if (!upd.length) throw new HttpError(400, "처리 시작 전 작업만 취소할 수 있습니다.");
    await audit(db, { actor: actorOf(req), action: "cancel", entity: "job", entityId: id, channelId: upd[0].channelId });
    res.json(upd[0]);
  }),
);

opsRoutes.put(
  "/settings/global-stop",
  ah(async (req, res) => {
    const body = parse(z.object({ stop: z.boolean() }), req.body);
    const db = getDb();
    await db
      .insert(appSettings)
      .values({ key: "global_stop", value: body.stop })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: body.stop, updatedAt: new Date() } });
    await audit(db, { actor: actorOf(req), action: body.stop ? "global_stop_on" : "global_stop_off", entity: "settings" });
    res.json({ globalStop: body.stop });
  }),
);

opsRoutes.get(
  "/audit",
  ah(async (req, res) => {
    const q = parse(z.object({ entity: z.string().max(40).optional(), entityId: z.string().max(40).optional(), channelId: z.coerce.number().int().optional() }), req.query);
    const conds = [];
    if (q.entity) conds.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    if (q.channelId) conds.push(eq(auditLogs.channelId, q.channelId));
    res.json(await getDb().select().from(auditLogs).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLogs.id)).limit(100));
  }),
);
