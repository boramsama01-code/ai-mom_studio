import { studioCards } from "../../shared/schema";
import { loadCardPages } from "../services/cardCarousel";
import { zipFiles } from "../services/zip";
import { studioAiStatus } from "../services/studioAi";
import { aiProviders } from "../../shared/aiProviders";
/**
 * 수집함 · 콘텐츠 초안 · 카드 · 승인
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
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
  runs,
  sourceDocuments,
} from "../../shared/schema";
import { ah, conflict, HttpError, intParam, loadChannel, parse, zVersion } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { emptyPayload, payloadSchemaFor } from "../../shared/payloads";
import { createRevision } from "../content";
import { computeScheduleStatus } from "../services/dates";
import { fetchPublisherArticle as fetchAndExtract } from "../services/publisherLookup";
import { sourceFetchUrl } from "../services/sourceFetchUrl";
import { normalizeUrl } from "../services/url";
import { extractForItem } from "../worker/collect";
import { LlmBudget } from "../services/llm";
import { generateDialogueDraft } from "../worker/generate";
import { approveItem, cancelApproval, renderCardForItem, retryDelivery, sourceOrgFor } from "../worker/publish";
import { buildCaptions } from "../services/cardModel";
import { matchOfficialSource } from "../worker/evidence";
import { collectionDateSchema, collectionDayRange } from "../../shared/collection";
import { NOTICE_INTENTS } from "../../shared/noticeIntent";
import { noticeIntentSql } from "../services/noticeIntent";
import { itemPrimarySource, itemSourceIdSql } from "../services/itemSources";
import { sha256 } from "../services/text";
import { SOURCE_TEXT_LIMIT, SOURCE_QUOTE_LIMIT, SOURCE_QUOTE_COUNT, suggestSourceQuotes } from "../../shared/sourceText";

export const itemRoutes = Router();

const listQuery = z.object({
  channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]),
  q: z.string().max(100).optional(),
  review: z.string().max(40).optional(),
  schedule: z.string().max(40).optional(),
  evidence: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  collectedOn: collectionDateSchema.optional(),
  noticeIntent: z.enum([...NOTICE_INTENTS, "all"]).optional(),
  view: z.enum(["inbox", "drafts", "excluded", "all"]).optional(),
  sample: z.enum(["0", "1"]).optional(),
  origin: z.enum(["idea", "scrap"]).optional(),
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
    if (q.origin === "idea") conds.push(eq(contentItems.origin, "idea"));
    if (q.origin === "scrap") conds.push(ne(contentItems.origin, "idea"));
    if (q.q) conds.push(or(ilike(contentItems.title, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`))!);
    if (q.review) conds.push(inArray(contentItems.reviewStatus, q.review.split(",")));
    if (q.schedule) conds.push(inArray(contentItems.scheduleStatus, q.schedule.split(",")));
    if (q.evidence) conds.push(inArray(contentItems.evidenceStatus, q.evidence.split(",")));
    if (q.category) conds.push(eq(contentItems.category, q.category));
    const intent = noticeIntentSql();
    if (q.noticeIntent && q.noticeIntent !== "all") conds.push(sql`${intent} = ${q.noticeIntent}`);
    if (q.collectedOn && q.origin !== "idea") {
      const { start, end } = collectionDayRange(q.collectedOn);
      conds.push(gte(contentItems.createdAt, start), lt(contentItems.createdAt, end), inArray(contentItems.origin, ["collected", "discovered"]));
    }
    const where = and(...conds);
    const db = getDb();
    const pageSize = q.pageSize ?? 20, page = q.page ?? 1;
    const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(contentItems).leftJoin(sourceDocuments, eq(sourceDocuments.id, itemSourceIdSql())).where(where)) as Array<{ total: number }>;
    const rows = await db
      .select({
        item: contentItems,
        source: { id: sourceDocuments.id, kind: sourceDocuments.kind, url: sourceDocuments.originalUrl, publisher: sql<string>`${sourceDocuments.meta}->>'publisher'`, publishedAt: sourceDocuments.publishedAt, publishedPrecision: sourceDocuments.publishedPrecision, fetchStatus: sourceDocuments.fetchStatus, snippet: sourceDocuments.snippet },
        channelSlug: channels.slug,
        channelName: channels.name,
        noticeIntent: intent,
        matchedQuery: sql<string | null>`coalesce((select coalesce(r->>'searchQuery', r->>'query') from jsonb_array_elements(coalesce(${runs.snapshot}->'rules', '[]'::jsonb)) r where r->>'id' = ${contentItems.ruleId}::text limit 1), ${contentItems.discovery}->>'query')`,
      })
      .from(contentItems)
      .innerJoin(channels, eq(channels.id, contentItems.channelId))
      .leftJoin(sourceDocuments, eq(sourceDocuments.id, itemSourceIdSql()))
      .leftJoin(runs, eq(runs.id, contentItems.runId))
      .where(where)
      .orderBy(...(q.origin === "idea" ? [asc(contentItems.topicKey), asc(contentItems.id)] : [desc(contentItems.createdAt), desc(contentItems.id)]))
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
    const primary = await itemPrimarySource(db, item);
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
      .select({ id: mediaAssets.id, revisionId: mediaAssets.revisionId, sha256: mediaAssets.sha256, createdAt: mediaAssets.createdAt, cloudinaryUrl: mediaAssets.cloudinaryUrl, source: mediaAssets.source, templateKey: mediaAssets.templateKey, carousel: mediaAssets.carousel })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.kind, "card")))
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
    res.json({ item, primary, linked, revisions, current, cards, approvals: aps, deliveries: dels, similar, defaultCaptions, imageAiAvailable: studioAiStatus().image });
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

/** Operator-supplied text: no network/AI call, isolated immutable source snapshot. */
itemRoutes.post("/channels/:cid/items/:id/source-text", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  const body = parse(z.object({ version: zVersion, url: z.string().url().max(2000), text: z.string().trim().min(20, "본문을 20자 이상 붙여넣어 주세요.").max(SOURCE_TEXT_LIMIT), quotes: z.array(z.string().trim().min(1).max(SOURCE_QUOTE_LIMIT)).max(SOURCE_QUOTE_COUNT).optional() }), req.body);
  const url = new URL(body.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new HttpError(400, "출처는 인증정보 없는 http/https 주소로 입력해 주세요.");
  const quotes = [...new Set(body.quotes ?? suggestSourceQuotes(body.text))];
  if (quotes.some(quote => !body.text.includes(quote))) throw new HttpError(400, "근거 구절은 붙여넣은 본문에 실제로 있는 문장이어야 합니다.");
  const db = getDb();
  const result = await db.transaction(async tx => {
    const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
    if (fresh.version !== body.version) conflict(fresh);
    const [doc] = await tx.insert(sourceDocuments).values({
      normalizedUrl: `manual-text:${item.id}:${randomUUID()}`, originalUrl: url.href, kind: "manual_text", title: fresh.title,
      fetchedText: body.text, snippet: body.text.slice(0, 500), contentHash: sha256(body.text), fetchStatus: "ok", isSample: fresh.isSample,
      meta: { acquisition: "operator_paste", addedBy: actorOf(req), savedAt: new Date().toISOString(), copiedFromSourceId: fresh.primarySourceId, quotes },
    }).returning();
    await tx.update(contentSources).set({ role: "previous_manual" }).where(and(eq(contentSources.contentItemId, item.id), eq(contentSources.role, "manual_primary")));
    await tx.insert(contentSources).values({ contentItemId: item.id, sourceDocumentId: doc.id, role: "manual_primary" });
    const current = fresh.currentRevisionId ? (await tx.select().from(contentRevisions).where(eq(contentRevisions.id, fresh.currentRevisionId)))[0] : null;
    // Copy the draft unchanged; this records the source change and invalidates old approvals.
    await createRevision(tx, { contentItemId: item.id, author: current?.author === "operator" ? "operator" : "system", payload: current?.payload ?? emptyPayload(item.kind, fresh.title), note: `본문 직접 저장 · 자료 #${doc.id} · ${body.text.length}자 · 발췌 ${quotes.length}개` });
    await tx.update(contentItems).set({ evidenceStatus: "needs_review", reviewStatus: "review_required", version: sql`${contentItems.version} + 1`, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
    await audit(tx, { actor: actorOf(req), action: "save_source_text", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { sourceId: doc.id, characters: body.text.length, quoteCount: quotes.length } });
    return { sourceId: doc.id, version: fresh.version + 1, quoteCount: quotes.length };
  });
  res.status(201).json(result);
}));

/** 원문 다시 확보 */
itemRoutes.post(
  "/channels/:cid/items/:id/fetch",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const db = getDb();
    const doc = await itemPrimarySource(db, item);
    if (!doc) throw new HttpError(400, "연결된 원문이 없습니다.");
    if (doc.kind === "manual_text") throw new HttpError(409, "직접 저장한 본문을 사용 중입니다. 본문 붙여넣기에서 수정해 주세요.");
    const r = await fetchAndExtract(sourceFetchUrl(doc), undefined, { title: doc.title, publisherUrl: typeof doc.meta.publisherUrl === "string" ? doc.meta.publisherUrl : undefined });
    const now = new Date();
    if (!r.ok) {
      await db.update(sourceDocuments).set({ fetchStatus: r.status, fetchError: r.error, attachments: r.attachments ?? doc.attachments, lastFetchedAt: now }).where(eq(sourceDocuments.id, doc.id));
      await db.update(contentItems).set({ evidenceStatus: "fetch_failed", updatedAt: now }).where(eq(contentItems.id, item.id));
      await audit(db, { actor: actorOf(req), action: "fetch_failed", entity: "source_document", entityId: doc.id, channelId: ch.id, detail: { error: r.error } });
      return res.status(502).json({ error: r.error, status: r.status });
    }
    const changed = doc.contentHash && doc.contentHash !== r.hash;
    await db.update(sourceDocuments).set({ fetchStatus: "ok", fetchError: null, fetchedText: r.text, contentHash: r.hash, attachments: r.attachments, lastFetchedAt: now, meta: { ...(doc.meta as object), finalUrl: r.finalUrl, pageTitle: r.title } }).where(eq(sourceDocuments.id, doc.id));
    if (item.evidenceStatus === "fetch_failed") await db.update(contentItems).set({ evidenceStatus: "needs_review", updatedAt: now }).where(eq(contentItems.id, item.id));
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
    const { provider } = parse(z.object({ provider: z.enum(aiProviders).optional() }).strict(), req.body ?? {});
    if (item.kind === "notice") {
      const r = await extractForItem(db, item.id, new LlmBudget(2), new Date(), undefined, provider);
      if (!r.ok) throw new HttpError(r.kind === "not_configured" ? 503 : 400, r.error);
    } else {
      const r = await generateDialogueDraft(db, item.id, new Date(), provider);
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
    const body = parse(z.object({ templateKey: z.string().max(40).nullable().optional(), coverMode: z.enum(["ai", "typography"]).optional() }), req.body ?? {});
    const r = await renderCardForItem(getDb(), item.id, new Date(), body.templateKey, { coverMode: body.coverMode, actor: actorOf(req) });
    if (!r.ok) return res.status(r.code === "font" || r.code === "render" ? 500 : r.code === "template" ? 400 : 422).json({ error: r.error, code: r.code, field: (r as { field?: string }).field });
    await audit(getDb(), { actor: actorOf(req), action: "render_card", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { assetId: r.asset.id, sha256: r.asset.sha256 } });
    res.json(r.asset);
  }),
);

itemRoutes.get("/channels/:cid/media/:mid/alt-text",ah(async(req,res)=>{
  const ch=await loadChannel(req.params.cid);
  const [asset]=await getDb().select().from(mediaAssets).where(and(eq(mediaAssets.id,intParam(req.params.mid)),eq(mediaAssets.channelId,ch.id),eq(mediaAssets.kind,"card")));
  if(!asset)throw new HttpError(404,"카드뉴스를 찾을 수 없습니다.");
  const [item]=await getDb().select({title:contentItems.title}).from(contentItems).where(eq(contentItems.id,asset.contentItemId));
  res.json(cardAltTextState(asset,item.title));
}));
itemRoutes.patch("/channels/:cid/media/:mid/alt-text",ah(async(req,res)=>{
  const ch=await loadChannel(req.params.cid),id=intParam(req.params.mid);
  const body=parse(z.object({version:z.number().int().min(0),values:z.array(z.string().trim().min(1,"대체텍스트를 입력해 주세요.").max(ALT_TEXT_LIMIT).refine(value => !altTextError(value), "대체텍스트는 1~2문장, 공백 포함 125자 이내로 작성해 주세요.")).min(1).max(10)}).strict(),req.body);
  const result=await getDb().transaction(async tx=>{
    const [initial]=await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id,id),eq(mediaAssets.channelId,ch.id),eq(mediaAssets.kind,"card")));
    if(!initial)throw new HttpError(404,"카드뉴스를 찾을 수 없습니다.");
    const [item]=await tx.select().from(contentItems).where(eq(contentItems.id,initial.contentItemId)).for("update");
    const [board]=await tx.select().from(studioCards).where(eq(studioCards.sourceItemId,item.id));
    if(board?.trashedAt)throw new HttpError(409,"휴지통에서 복원한 뒤 수정해 주세요.");
    const [asset]=await tx.select().from(mediaAssets).where(eq(mediaAssets.id,id)).for("update");
    const current=cardAltTextState(asset,item.title);
    if(current.version!==body.version)throw new HttpError(409,"다른 곳에서 대체텍스트가 변경됐습니다. 입력을 복사한 뒤 최신 내용을 확인해 주세요.");
    if(current.values.length!==body.values.length)throw new HttpError(400,"카드 장수와 대체텍스트 개수가 다릅니다.");
    const manifest=asset.carousel??{version:1 as const,pages:[{id:asset.id,sha256:asset.sha256,title:item.title}],cover:{kind:"typography" as const,credit:""}};
    const carousel={...manifest,altVersion:body.version+1,pages:manifest.pages.map((p,i)=>({...p,altText:body.values[i]}))};
    await tx.update(mediaAssets).set({carousel}).where(eq(mediaAssets.id,id));
    await audit(tx,{actor:actorOf(req),action:"update_alt_text",entity:"media_asset",entityId:id,channelId:ch.id,detail:{version:carousel.altVersion,pages:body.values.length}});
    return {version:carousel.altVersion,values:body.values};
  });res.json(result);
}));

itemRoutes.get("/channels/:cid/media/:mid/deck.zip", ah(async (req, res) => {
  const ch = await loadChannel(req.params.cid);
  const [cover] = await getDb().select().from(mediaAssets).where(and(eq(mediaAssets.id, intParam(req.params.mid)), eq(mediaAssets.channelId, ch.id), eq(mediaAssets.kind, "card")));
  if (!cover) throw new HttpError(404, "카드뉴스를 찾을 수 없습니다.");
  const pages = await loadCardPages(getDb(), cover);
  const [revision] = await getDb().select().from(contentRevisions).where(eq(contentRevisions.id, cover.revisionId));
  const [item] = await getDb().select().from(contentItems).where(eq(contentItems.id, cover.contentItemId));
  const primary = await itemPrimarySource(getDb(), item);
  const captions = buildCaptions({ kind: item.kind, payload: revision.payload, sourceOrg: await sourceOrgFor(getDb(), item, revision.payload), sourceUrl: primary?.originalUrl ?? null });
  const files = pages.map((page, i) => ({ name: `page-${String(i + 1).padStart(2, "0")}.jpg`, bytes: page.bytes }));
  const descriptions = cardAltTextState(cover, item.title).values;
  const invalidPage = descriptions.findIndex(value => !!altTextError(value));
  if (invalidPage >= 0) throw new HttpError(400, `${invalidPage + 1}페이지: ${altTextError(descriptions[invalidPage])} 대체텍스트를 수정한 후 내려받으세요.`);
  files.push({name:"alt-text.txt",bytes:Buffer.from(altTextFile(descriptions))},{ name: "caption.txt", bytes: Buffer.from(captions.instagram) }, { name: "credits.txt", bytes: Buffer.from(cover.carousel?.cover.credit ?? "출처는 각 카드 하단을 확인하세요.") });
  res.type("application/zip").set("Content-Disposition", `attachment; filename="cardnews-${cover.contentItemId}-r${cover.revisionId}.zip"`).send(zipFiles(files));
}));

itemRoutes.get(
  "/channels/:cid/media/:mid",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const [a] = await getDb().select().from(mediaAssets).where(and(eq(mediaAssets.id, intParam(req.params.mid)), eq(mediaAssets.channelId, ch.id)));
    if (!a) throw new HttpError(404, "이미지 없음");
    res.setHeader("content-type", a.mime);
    res.setHeader("cache-control", "private, max-age=86400, immutable");
    if (req.query.download === "1") res.setHeader("content-disposition", `attachment; filename="spacepenguin-card-${a.contentItemId}-r${a.revisionId}.jpg"`);
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
        altTextVersion: z.number().int().min(0).optional(),
        captions: z.object({ instagram: z.string().max(5000), telegram: z.string().max(5000) }),
        scheduledAt: z.string().datetime({ offset: true }),
      }),
      req.body,
    );
    const r = await approveItem(getDb(), { itemId: item.id, revisionId: body.revisionId, mediaAssetId: body.mediaAssetId, altTextVersion:body.altTextVersion, captions: body.captions, scheduledAt: new Date(body.scheduledAt), actor: actorOf(req) });
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


/** 여러 항목 한꺼번에: 제외 / 보류 / 검토 대기로 (검토 완료는 항목별로 확인해야 하므로 제외) */
itemRoutes.post(
  "/channels/:cid/items/bulk",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100), action: z.enum(["exclude", "unexclude", "hold", "pending"]) }), req.body);
    const db = getDb();
    const set =
      body.action === "exclude" ? { excluded: true, excludedReason: "운영자 일괄 제외" } :
      body.action === "unexclude" ? { excluded: false, excludedReason: null } :
      body.action === "hold" ? { reviewStatus: "held" } :
      { reviewStatus: "pending" };
    const upd = await db
      .update(contentItems)
      .set({ ...set, version: sql`${contentItems.version} + 1`, updatedAt: new Date() })
      .where(and(eq(contentItems.channelId, ch.id), inArray(contentItems.id, body.ids)))
      .returning({ id: contentItems.id });
    await audit(db, { actor: actorOf(req), action: `bulk:${body.action}`, entity: "content_item", channelId: ch.id, detail: { ids: upd.map((u) => u.id) } });
    res.json({ updated: upd.length });
  }),
);


import { ALT_TEXT_LIMIT, altTextError, altTextFile } from "../../shared/altText";
import { cardAltTextState } from "../services/cardAccessibility";
