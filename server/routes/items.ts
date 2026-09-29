/**
 * 수집함 · 콘텐츠 초안 · 카드 · 승인
 */
import { Router } from "express";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import {
  approvals,
  channels,
  contentItems,
  contentRevisions,
  contentSources,
  deliveries,
  destinations,
  mediaAssets,
  officialSources,
  sourceDocuments,
} from "../../shared/schema";
import { ah, conflict, HttpError, intParam, loadChannel, parse, zVersion } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { emptyPayload, payloadSchemaFor } from "../../shared/payloads";
import { createRevision } from "../content";
import { computeScheduleStatus } from "../services/dates";
import { fetchAndExtract } from "../services/extract";
import { normalizeUrl } from "../services/url";
import { extractForItem } from "../worker/collect";
import { LlmBudget } from "../services/llm";
import { generateDialogueDraft } from "../worker/generate";
import { approveItem, cancelApproval, renderCardForItem, retryDelivery, sourceOrgFor } from "../worker/publish";
import { buildCaptions } from "../services/cardModel";
import { matchOfficialSource } from "../worker/evidence";

export const itemRoutes = Router();

const listQuery = z.object({
  channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]),
  q: z.string().max(100).optional(),
  review: z.string().max(40).optional(),
  schedule: z.string().max(40).optional(),
  evidence: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  view: z.enum(["inbox", "drafts", "excluded", "all"]).optional(),
  sample: z.enum(["0", "1"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
});

/** 목록 — '전체' 채널은 조회 전용 */
itemRoutes.get(
  "/items",
  ah(async (req, res) => {
    const q = parse(listQuery, req.query);
    const conds: SQL[] = [];
    if (q.channelId !== "all") conds.push(eq(contentItems.channelId, q.channelId));
    conds.push(eq(contentItems.isSample, q.sample === "1" || !!req.session.demo));
    const view = q.view ?? "inbox";
    if (view === "excluded") conds.push(eq(contentItems.excluded, true));
    else if (view !== "all") conds.push(eq(contentItems.excluded, false));
    if (view === "drafts") conds.push(sql`${contentItems.currentRevisionId} is not null`);
    if (q.q) conds.push(or(ilike(contentItems.title, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`))!);
    if (q.review) conds.push(inArray(contentItems.reviewStatus, q.review.split(",")));
    if (q.schedule) conds.push(inArray(contentItems.scheduleStatus, q.schedule.split(",")));
    if (q.evidence) conds.push(inArray(contentItems.evidenceStatus, q.evidence.split(",")));
    if (q.category) conds.push(eq(contentItems.category, q.category));
    const where = and(...conds);
    const db = getDb();
    const pageSize = q.pageSize ?? 20, page = q.page ?? 1;
    const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(contentItems).where(where)) as Array<{ total: number }>;
    const rows = await db
      .select({
        item: contentItems,
        source: { id: sourceDocuments.id, kind: sourceDocuments.kind, url: sourceDocuments.originalUrl, publishedAt: sourceDocuments.publishedAt, publishedPrecision: sourceDocuments.publishedPrecision, fetchStatus: sourceDocuments.fetchStatus, snippet: sourceDocuments.snippet },
        channelSlug: channels.slug,
        channelName: channels.name,
      })
      .from(contentItems)
      .innerJoin(channels, eq(channels.id, contentItems.channelId))
      .leftJoin(sourceDocuments, eq(sourceDocuments.id, contentItems.primarySourceId))
      .where(where)
      .orderBy(desc(contentItems.createdAt), desc(contentItems.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({ total, page, pageSize, items: rows });
  }),
);

async function loadItem(cid: unknown, id: unknown) {
  const ch = await loadChannel(cid);
  const itemId = intParam(id);
  const [item] = await getDb().select().from(contentItems).where(and(eq(contentItems.id, itemId), eq(contentItems.channelId, ch.id)));
  if (!item) throw new HttpError(404, "항목을 찾을 수 없습니다.");
  return { ch, item };
}

itemRoutes.get(
  "/channels/:cid/items/:id",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const db = getDb();
    const primary = item.primarySourceId ? (await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId)))[0] : null;
    const linked = await db
      .select({ link: contentSources, doc: sourceDocuments })
      .from(contentSources)
      .innerJoin(sourceDocuments, eq(sourceDocuments.id, contentSources.sourceDocumentId))
      .where(eq(contentSources.contentItemId, item.id));
    const revisions = await db
      .select({ id: contentRevisions.id, revisionNo: contentRevisions.revisionNo, author: contentRevisions.author, model: contentRevisions.model, promptVersion: contentRevisions.promptVersion, usage: contentRevisions.usage, note: contentRevisions.note, createdAt: contentRevisions.createdAt })
      .from(contentRevisions)
      .where(eq(contentRevisions.contentItemId, item.id))
      .orderBy(desc(contentRevisions.revisionNo));
    const current = item.currentRevisionId ? (await db.select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId)))[0] : null;
    const cards = await db
      .select({ id: mediaAssets.id, revisionId: mediaAssets.revisionId, sha256: mediaAssets.sha256, createdAt: mediaAssets.createdAt, cloudinaryUrl: mediaAssets.cloudinaryUrl, source: mediaAssets.source, templateKey: mediaAssets.templateKey })
      .from(mediaAssets)
      .where(eq(mediaAssets.contentItemId, item.id))
      .orderBy(desc(mediaAssets.id))
      .limit(5);
    const aps = await db.select().from(approvals).where(eq(approvals.contentItemId, item.id)).orderBy(desc(approvals.id)).limit(5);
    const dels = aps.length
      ? await db
          .select({ d: deliveries, dest: { label: destinations.label, platform: destinations.platform } })
          .from(deliveries)
          .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
          .where(inArray(deliveries.approvalId, aps.map((a) => a.id)))
      : [];
    // 비슷한 항목(자동 병합하지 않음 — 운영자 판단용)
    const ex = (item.extracted ?? {}) as Record<string, unknown>;
    const similar =
      ex.organization && item.kind === "notice"
        ? await db
            .select({ id: contentItems.id, title: contentItems.title, reviewStatus: contentItems.reviewStatus })
            .from(contentItems)
            .where(and(eq(contentItems.channelId, ch.id), ne(contentItems.id, item.id), sql`${contentItems.extracted}->>'organization' = ${String(ex.organization)}`, sql`coalesce(${contentItems.extracted}->>'academic_year','') = ${String(ex.academic_year ?? "")}`, sql`coalesce(${contentItems.extracted}->>'notice_type','') = ${String(ex.notice_type ?? "")}`))
            .limit(5)
        : [];
    const defaultCaptions = current ? buildCaptions({ kind: item.kind, payload: current.payload, sourceUrl: primary?.originalUrl ?? null, sourceOrg: await sourceOrgFor(db, item, current.payload) }) : null;
    res.json({ item, primary, linked, revisions, current, cards, approvals: aps, deliveries: dels, similar, defaultCaptions });
  }),
);

itemRoutes.get(
  "/channels/:cid/items/:id/revisions/:rid",
  ah(async (req, res) => {
    const { item } = await loadItem(req.params.cid, req.params.id);
    const [rev] = await getDb().select().from(contentRevisions).where(and(eq(contentRevisions.id, intParam(req.params.rid)), eq(contentRevisions.contentItemId, item.id)));
    if (!rev) throw new HttpError(404, "버전을 찾을 수 없습니다.");
    res.json(rev);
  }),
);

/** 수동 작성 */
itemRoutes.post(
  "/channels/:cid/items",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(z.object({ title: z.string().trim().min(1).max(200), topic: z.string().max(200).optional(), origin: z.enum(["manual", "evergreen"]).optional() }), req.body);
    const db = getDb();
    const item = await db.transaction(async (tx) => {
      const [it] = await tx
        .insert(contentItems)
        .values({ channelId: ch.id, kind: ch.contentType, origin: body.origin ?? "manual", title: body.title, topicKey: body.topic ?? body.title, relevance: "relevant", scheduleStatus: ch.contentType === "notice" ? "unknown" : "not_applicable" })
        .returning();
      await createRevision(tx, { contentItemId: it.id, author: "operator", payload: emptyPayload(ch.contentType, body.title), note: "직접 작성 시작" });
      await tx.update(contentItems).set({ version: sql`${contentItems.version} + 1` }).where(eq(contentItems.id, it.id));
      await audit(tx, { actor: actorOf(req), action: "create", entity: "content_item", entityId: it.id, channelId: ch.id, detail: { title: body.title } });
      return it;
    });
    res.status(201).json(item);
  }),
);

const editSchema = z.object({
  version: zVersion,
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().max(40).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(300).optional(),
});

/** 운영자 편집 — 새 버전 생성, 기존 승인 무효화 */
itemRoutes.patch(
  "/channels/:cid/items/:id",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(editSchema, req.body);
    let payload: Record<string, unknown> | null = null;
    if (body.payload) {
      const r = payloadSchemaFor(item.kind).safeParse(body.payload);
      if (!r.success) throw new HttpError(400, `초안 형식 오류 — ${r.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
      payload = r.data as Record<string, unknown>;
    }
    const db = getDb();
    const out = await db.transaction(async (tx) => {
      const upd = await tx
        .update(contentItems)
        .set({
          ...(body.title ? { title: body.title } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(payload && item.kind === "notice" ? { scheduleStatus: computeScheduleStatus((payload as any).schedules), category: (payload as any).category ?? body.category ?? item.category, schoolType: (payload as any).school_type ?? item.schoolType, relevance: (payload as any).relevance } : {}),
          ...(payload && item.reviewStatus === "reviewed" ? { reviewStatus: "pending" } : {}),
          edited: payload ?? item.edited,
          version: sql`${contentItems.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(contentItems.id, item.id), eq(contentItems.version, body.version)))
        .returning();
      if (!upd.length) conflict(item);
      if (payload) await createRevision(tx, { contentItemId: item.id, author: "operator", payload, note: body.note ?? "운영자 편집" });
      await audit(tx, { actor: actorOf(req), action: "edit", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { fields: Object.keys(body).filter((k) => k !== "version") } });
      const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
      return fresh;
    });
    res.json(out);
  }),
);

/** 검토 상태 변경 */
itemRoutes.post(
  "/channels/:cid/items/:id/review",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(z.object({ version: zVersion, status: z.enum(["pending", "reviewed", "held", "rejected"]), reason: z.string().max(300).optional() }), req.body);
    if (body.status === "reviewed") {
      if (!item.currentRevisionId) throw new HttpError(400, "초안이 없어 검토 완료로 표시할 수 없습니다.");
      if (item.relevance === "irrelevant") throw new HttpError(400, "'관련 없음' 항목은 검토 완료할 수 없습니다. 제외하거나 관련성을 수정하세요.");
    }
    const db = getDb();
    const upd = await db
      .update(contentItems)
      .set({ reviewStatus: body.status, version: sql`${contentItems.version} + 1`, updatedAt: new Date() })
      .where(and(eq(contentItems.id, item.id), eq(contentItems.version, body.version)))
      .returning();
    if (!upd.length) conflict(item);
    await audit(db, { actor: actorOf(req), action: `review:${body.status}`, entity: "content_item", entityId: item.id, channelId: ch.id, detail: { reason: body.reason ?? null } });
    res.json(upd[0]);
  }),
);

/** 제외/제외 해제 */
itemRoutes.post(
  "/channels/:cid/items/:id/exclude",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(z.object({ version: zVersion, excluded: z.boolean(), reason: z.string().max(300).optional() }), req.body);
    const db = getDb();
    const upd = await db
      .update(contentItems)
      .set({ excluded: body.excluded, excludedReason: body.excluded ? body.reason ?? "운영자 제외" : null, version: sql`${contentItems.version} + 1`, updatedAt: new Date() })
      .where(and(eq(contentItems.id, item.id), eq(contentItems.version, body.version)))
      .returning();
    if (!upd.length) conflict(item);
    await audit(db, { actor: actorOf(req), action: body.excluded ? "exclude" : "unexclude", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { reason: body.reason ?? null } });
    res.json(upd[0]);
  }),
);

/** 원문 다시 확보 */
itemRoutes.post(
  "/channels/:cid/items/:id/fetch",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    if (!item.primarySourceId) throw new HttpError(400, "연결된 원문이 없습니다.");
    const db = getDb();
    const [doc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId));
    const r = await fetchAndExtract((doc.meta as { fetchUrl?: string }).fetchUrl || doc.originalUrl);
    const now = new Date();
    if (!r.ok) {
      await db.update(sourceDocuments).set({ fetchStatus: r.status, fetchError: r.error, attachments: r.attachments ?? doc.attachments, lastFetchedAt: now }).where(eq(sourceDocuments.id, doc.id));
      await db.update(contentItems).set({ evidenceStatus: "fetch_failed", updatedAt: now }).where(eq(contentItems.id, item.id));
      await audit(db, { actor: actorOf(req), action: "fetch_failed", entity: "source_document", entityId: doc.id, channelId: ch.id, detail: { error: r.error } });
      return res.status(502).json({ error: r.error, status: r.status });
    }
    const changed = doc.contentHash && doc.contentHash !== r.hash;
    await db.update(sourceDocuments).set({ fetchStatus: "ok", fetchError: null, fetchedText: r.text, contentHash: r.hash, attachments: r.attachments, lastFetchedAt: now, meta: { ...(doc.meta as object), finalUrl: r.finalUrl, pageTitle: r.title } }).where(eq(sourceDocuments.id, doc.id));
    if (changed && item.reviewStatus === "reviewed") await db.update(contentItems).set({ reviewStatus: "review_required", updatedAt: now }).where(eq(contentItems.id, item.id));
    res.json({ ok: true, changed: !!changed, length: r.text.length });
  }),
);

/** 근거 자료 추가(운영자가 준 URL을 실제로 조회해 확보한 경우에만 연결) */
itemRoutes.post(
  "/channels/:cid/items/:id/sources",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(z.object({ url: z.string().url().max(1000) }), req.body);
    const r = await fetchAndExtract(body.url);
    if (!r.ok) throw new HttpError(502, `원문을 확보하지 못해 연결하지 않았습니다: ${r.error}`);
    const db = getDb();
    const normalized = normalizeUrl(r.finalUrl);
    const officials = await db.select().from(officialSources).where(eq(officialSources.channelId, ch.id));
    const official = matchOfficialSource(normalized, officials);
    await db
      .insert(sourceDocuments)
      .values({ normalizedUrl: normalized, originalUrl: r.finalUrl, kind: official ? "official" : "manual", title: r.title, fetchStatus: "ok", fetchedText: r.text, contentHash: r.hash, attachments: r.attachments, lastFetchedAt: new Date(), meta: { addedBy: actorOf(req) } })
      .onConflictDoNothing();
    const [doc] = await db.select().from(sourceDocuments).where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
    await db.insert(contentSources).values({ contentItemId: item.id, sourceDocumentId: doc.id, role: official ? "official" : "supporting" }).onConflictDoNothing();
    await audit(db, { actor: actorOf(req), action: "link_source", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { url: r.finalUrl, official: !!official } });
    res.status(201).json({ doc: { id: doc.id, title: doc.title, url: doc.originalUrl, kind: doc.kind }, official: official?.name ?? null });
  }),
);

/** 구조화 추출(공고) / 초안 생성(과학·시사) — 단일 항목 동기 호출 */
itemRoutes.post(
  "/channels/:cid/items/:id/generate",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const db = getDb();
    if (item.kind === "notice") {
      const r = await extractForItem(db, item.id, new LlmBudget(2), new Date());
      if (!r.ok) throw new HttpError(r.kind === "not_configured" ? 503 : 400, r.error);
    } else {
      const r = await generateDialogueDraft(db, item.id);
      if (!r.ok) throw new HttpError(400, r.error);
    }
    await audit(db, { actor: actorOf(req), action: "generate", entity: "content_item", entityId: item.id, channelId: ch.id });
    const [fresh] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
    res.json(fresh);
  }),
);

/* ───────────── 카드 ───────────── */
itemRoutes.post(
  "/channels/:cid/items/:id/card",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(z.object({ templateKey: z.string().max(40).nullable().optional() }), req.body ?? {});
    const r = await renderCardForItem(getDb(), item.id, new Date(), body.templateKey);
    if (!r.ok) return res.status(r.code === "font" || r.code === "render" ? 500 : r.code === "template" ? 400 : 422).json({ error: r.error, code: r.code, field: (r as { field?: string }).field });
    await audit(getDb(), { actor: actorOf(req), action: "render_card", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { assetId: r.asset.id, sha256: r.asset.sha256 } });
    res.json(r.asset);
  }),
);

itemRoutes.get(
  "/channels/:cid/media/:mid",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const [a] = await getDb().select().from(mediaAssets).where(and(eq(mediaAssets.id, intParam(req.params.mid)), eq(mediaAssets.channelId, ch.id)));
    if (!a) throw new HttpError(404, "이미지 없음");
    res.setHeader("content-type", a.mime);
    res.setHeader("cache-control", "private, max-age=86400, immutable");
    if (req.query.download === "1") res.setHeader("content-disposition", `attachment; filename="ai-mom-card-${a.contentItemId}-r${a.revisionId}.jpg"`);
    res.send(a.bytes);
  }),
);

/* ───────────── 최종 승인 ───────────── */
itemRoutes.post(
  "/channels/:cid/items/:id/approve",
  ah(async (req, res) => {
    const { item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(
      z.object({
        revisionId: z.number().int(),
        mediaAssetId: z.number().int(),
        captions: z.object({ instagram: z.string().max(5000), telegram: z.string().max(5000) }),
        scheduledAt: z.string().datetime({ offset: true }),
      }),
      req.body,
    );
    const r = await approveItem(getDb(), { itemId: item.id, revisionId: body.revisionId, mediaAssetId: body.mediaAssetId, captions: body.captions, scheduledAt: new Date(body.scheduledAt), actor: actorOf(req) });
    if (!r.ok) throw new HttpError(400, r.error);
    res.status(201).json(r);
  }),
);

itemRoutes.post(
  "/channels/:cid/approvals/:aid/cancel",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const [ap] = await getDb().select().from(approvals).where(and(eq(approvals.id, intParam(req.params.aid)), eq(approvals.channelId, ch.id)));
    if (!ap) throw new HttpError(404, "승인을 찾을 수 없습니다.");
    const r = await cancelApproval(getDb(), ap.id, actorOf(req));
    if (!r.ok) throw new HttpError(400, r.error);
    res.json(r);
  }),
);

itemRoutes.post(
  "/channels/:cid/deliveries/:did/retry",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const [d] = await getDb().select().from(deliveries).where(and(eq(deliveries.id, intParam(req.params.did)), eq(deliveries.channelId, ch.id)));
    if (!d) throw new HttpError(404, "전송 기록 없음");
    const body = parse(z.object({ confirmNotPosted: z.boolean().optional() }), req.body ?? {});
    const r = await retryDelivery(getDb(), d.id, actorOf(req), body.confirmNotPosted);
    if (!r.ok) throw new HttpError(400, r.error);
    res.json(r);
  }),
);

/** 발행함 */
itemRoutes.get(
  "/deliveries",
  ah(async (req, res) => {
    const q = parse(z.object({ channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]) }), req.query);
    const db = getDb();
    const rows = await db
      .select({
        d: deliveries,
        dest: { label: destinations.label, platform: destinations.platform },
        ap: { id: approvals.id, scheduledAt: approvals.scheduledAt, status: approvals.status, revisionId: approvals.revisionId },
        item: { id: contentItems.id, title: contentItems.title, channelId: contentItems.channelId },
      })
      .from(deliveries)
      .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
      .innerJoin(approvals, eq(approvals.id, deliveries.approvalId))
      .innerJoin(contentItems, eq(contentItems.id, approvals.contentItemId))
      .where(q.channelId === "all" ? undefined : eq(deliveries.channelId, q.channelId))
      .orderBy(desc(approvals.scheduledAt), asc(deliveries.id))
      .limit(100);
    res.json(rows);
  }),
);

