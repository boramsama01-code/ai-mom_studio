import { validSubcategory } from "../../shared/channelCategories";
import { studioCards } from "../../shared/schema";
import { cardCopyFromPayload, loadCardPages, planCarousel, renderCarouselPage } from "../services/cardCarousel";
import { channelAiSelection } from "../services/channelAi";
import { familyCardCopySchema, pageDesignsSchema } from "../../shared/familyDialogue";
import { readingProfileForTemplateKey } from "../../shared/readingCardProfiles";
import { storedCardCopySchema } from "../../shared/storedCardCopy";
import { FAMILY_METADATA_KEYS, familyExecutionPlan, familyGenerateSchema, familyMetadataFromPayload, proposeFamilyDialogue, synchronizeFamilyQuestion } from "../services/familyEditorial";
import { assertFamilyEvidenceForCopy, confirmFamilyCaption, familyCaptionConfirmSchema, familyProposalMetadata, familySaveSchema, saveFamilyCardCopy } from "../services/familyEditorialPersistence";
import { familyEvidenceView, loadFamilyEvidence } from "../services/familyEvidence";
import { familyManualCreateSchema, familyManualInitializeSchema } from '../../shared/familyManual';
import { initializeManualFamily } from '../services/familyManual';
import { completeGenerationResult } from "../services/generationContext";
import { proposeNewsDiscussion } from "../services/newsEditorial";
import { articleAnalysisSchema, aiWorkflowSchema } from "../../shared/articleAnalysis";
import { assertNewsEditorialResources, loadNewsEditorialSources } from "../services/newsEditorialSources";
import { assertCardPageArtworkOwnership, loadCardPageArtworkCredits, loadCardPageArtworkForPage } from "../services/cardPageArtwork";
import { zipFiles } from "../services/zip";
import { studioAiStatus } from "../services/studioAi";
import { aiProviders } from "../../shared/aiProviders";
/**
 * 수집함 · 콘텐츠 초안 · 카드 · 승인
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, notExists, or, sql, type SQL } from "drizzle-orm";
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
  jobs,
  notionSyncLinks,
  officialSources,
  runs,
  sourceDocuments,
} from "../../shared/schema";
import { ah, conflict, HttpError, intParam, loadChannel, parse, zVersion } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { emptyPayload, payloadSchemaFor } from "../../shared/payloads";
import { createRevision } from "../content";
import { ensureSourceWorkspace } from "../services/sourceWorkspace";
import { persistSourceFetchAttempt } from "../services/sourceFetchPersistence";
import { cancelSourceGenerationRequest, runSourceGeneration } from "../services/sourceGeneration";
import { revokePublicationEligibility } from "../services/publicationState";
import { computeScheduleStatus, kstToday } from "../services/dates";
import { fetchPublisherArticle as fetchAndExtract } from "../services/publisherLookup";
import { sourceFetchUrl } from "../services/sourceFetchUrl";
import { normalizeUrl } from "../services/url";
import { extractForItem } from "../worker/collect";
import { generateCardCopy } from "../services/llm";
import { createManualCardCopyBudget, createManualSourceBudget } from "../services/manualAiBudget";
import { generateDialogueDraft } from "../worker/generate";
import { approveItem, cancelApproval, findReusableCardCover, renderCardForItem, retryDelivery, sourceOrgFor, reconcileDelivery, confirmDeliveryPosted, confirmDeliveryNotPosted } from "../worker/publish";
import { kickInlinePublish } from "../worker/inlinePublish";
import { publicationReadiness } from "../services/publishReadiness";
import { buildCaptions } from "../services/cardModel";
import { matchOfficialSource } from "../worker/evidence";
import { collectionDateSchema, collectionDayRange } from "../../shared/collection";
import { NOTICE_INTENTS } from "../../shared/noticeIntent";
import { noticeIntentSql } from "../services/noticeIntent";
import { itemPrimarySource, itemSourceIdSql } from "../services/itemSources";
import { sha256 } from "../services/text";
import { SOURCE_TEXT_LIMIT, SOURCE_QUOTE_LIMIT, SOURCE_QUOTE_COUNT, suggestSourceQuotes } from "../../shared/sourceText";
import { sourceRecovery } from "../../shared/sourceRecovery";
import { cardCopySchema } from "../../shared/cardCopy";
import { resolveStyle, TemplateNotFound } from "../services/templates";
import { CardFontError, CardOverflowError } from "../services/card";
import { assertStudioActive } from "../services/studio";
import { getSetting } from "../seed";
import type { PublicationOrphan } from "../../shared/publicationReadiness";
import { publicationDraftSaveSchema } from "../../shared/publicationDraft";
import { saveItemPublicationDraft } from "../services/publicationDraft";
import { restoreSourceRevision } from "../services/sourceRevisionRestore";
import { organizePublicationsSchema, publicationListStates } from "../../shared/publicationList";
import { organizePublications, publicationListCondition } from "../services/publicationList";
import { env } from "../env";

export const itemRoutes = Router();

const listQuery = z.object({
  channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]),
  q: z.string().max(100).optional(),
  review: z.string().max(40).optional(),
  schedule: z.string().max(40).optional(),
  evidence: z.string().max(40).optional(),
  fetchStatus: z.string().max(80).transform(value => value.split(",")).pipe(z.array(z.enum(["ok", "not_fetched", "failed", "blocked", "unsupported"])).min(1).max(5)).optional(),
  category: z.string().max(40).optional(),
  subcategory: z.string().max(40).optional(),
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
    if (q.fetchStatus) conds.push(inArray(sourceDocuments.fetchStatus, q.fetchStatus));
    if (q.category) conds.push(eq(contentItems.category, q.category));
    if (q.subcategory) conds.push(q.subcategory === "미분류" ? sql`coalesce(${contentItems.subcategory}, '') = ''` : eq(contentItems.subcategory, q.subcategory));
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

/** The generic editor cannot preserve Notion page IDs, metadata or long decks. */
async function assertGenericCardEditor(itemId: number, db: Pick<ReturnType<typeof getDb>, "select"> = getDb()) {
  const [link] = await db.select({ id: notionSyncLinks.id }).from(notionSyncLinks).where(eq(notionSyncLinks.contentItemId, itemId)).limit(1);
  if (link) throw new HttpError(409, "노션 연결 원고는 전용 카드 편집 화면에서 수정·제작해 주세요. 저장된 원고는 유지했습니다.", {
    code: "notion_editor_required", linkId: link.id, studioUrl: `${env.baseUrl}/notion?link=${link.id}`,
  });
}

itemRoutes.patch("/channels/:cid/items/:id/subcategory", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  const body = parse(z.object({ version: zVersion, subcategory: z.string().max(40).nullable() }).strict(), req.body);
  if (!validSubcategory(ch.slug, body.subcategory, ch.categories)) throw new HttpError(400, "이 채널의 소분류를 선택해 주세요.");
  const saved = await getDb().transaction(async tx => {
    const [currentChannel] = await tx.select().from(channels).where(eq(channels.id, ch.id)).for("share");
    if (!currentChannel?.active) throw new HttpError(409, "보관된 채널입니다. 채널을 복원한 뒤 분류를 변경해 주세요.");
    if (!validSubcategory(currentChannel.slug, body.subcategory, currentChannel.categories)) throw new HttpError(409, "채널의 분류 설정이 바뀌었습니다. 최신 분류를 확인해 주세요.");
    const [row] = await tx.update(contentItems).set({ subcategory: body.subcategory || null, version: sql`${contentItems.version} + 1`, updatedAt: new Date() }).where(and(eq(contentItems.id, item.id), eq(contentItems.channelId, ch.id), eq(contentItems.version, body.version))).returning();
    if (!row) conflict(item);
    await audit(tx, { actor: actorOf(req), action: "set_subcategory", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { subcategory: row.subcategory } });
    return row;
  });
  res.json(saved);
}));

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
    const recentApprovals = await db.select().from(approvals).where(eq(approvals.contentItemId, item.id)).orderBy(desc(approvals.id)).limit(5);
    // Older unresolved attempts must remain visible even after several revisions.
    const unresolvedApprovals = await db.select().from(approvals).where(and(eq(approvals.contentItemId, item.id), or(
      eq(approvals.status, "active"),
      inArray(approvals.id, db.select({ id: deliveries.approvalId }).from(deliveries).where(or(inArray(deliveries.status, ["processing", "unknown"]), eq(deliveries.needsReconciliation, true)))),
    )));
    const aps = [...new Map([...recentApprovals, ...unresolvedApprovals].map(row => [row.id, row])).values()].sort((a, b) => b.id - a.id);
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
    const publicationDraft = item.publicationDraft ?? { version: 0, captions: defaultCaptions ?? { instagram: "", telegram: "" } };
    const [workspace] = await db.select({ id: studioCards.id }).from(studioCards).where(eq(studioCards.sourceItemId, item.id));
    res.json({ item, primary, linked, revisions, current, cards, approvals: aps, deliveries: dels, similar, defaultCaptions, publicationDraft, canonicalStudioCardId: workspace?.id ?? null, imageAiAvailable: studioAiStatus().image, publicationReadiness: await publicationReadiness(db, ch.id) });
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
itemRoutes.post('/channels/:cid/items/manual-family',ah(async(req,res)=>{
  const channel=await loadChannel(req.params.cid),body=parse(familyManualCreateSchema,req.body);
  res.status(201).json(await initializeManualFamily(getDb(),channel.id,body,actorOf(req)));
}));
itemRoutes.post('/channels/:cid/items/:id/card-copy/manual-initialize',ah(async(req,res)=>{
  const {ch:channel,item}=await loadItem(req.params.cid,req.params.id);
  await assertGenericCardEditor(item.id);
  const body=parse(familyManualInitializeSchema,req.body);
  res.status(201).json(await initializeManualFamily(getDb(),channel.id,body,actorOf(req),intParam(req.params.id)));
}));
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

/** Start manual work after a failed AI request without replacing any saved revision. */
itemRoutes.post("/channels/:cid/items/:id/draft", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  const body = parse(z.object({ version: zVersion.optional() }).strict(), req.body ?? {});
  const db = getDb();
  const result = await db.transaction(async tx => {
    const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
    if (fresh.currentRevisionId) {
      await ensureSourceWorkspace(tx, fresh.id);
      return { item: fresh, revisionId: fresh.currentRevisionId, created: false };
    }
    if (body.version !== undefined && fresh.version !== body.version) conflict(fresh);
    const revision = await createRevision(tx, { contentItemId: item.id, author: "operator", payload: emptyPayload(item.kind, fresh.title), note: "직접 초안 작성 시작" });
    const [saved] = await tx.update(contentItems).set({ version: fresh.version + 1, reviewStatus: "pending", updatedAt: new Date() }).where(eq(contentItems.id, item.id)).returning();
    await audit(tx, { actor: actorOf(req), action: "start_manual_draft", entity: "content_item", entityId: item.id, channelId: ch.id });
    return { item: saved, revisionId: revision.id, created: true };
  });
  res.status(result.created ? 201 : 200).json(result);
}));

/** Publication copy and intent share a CAS version, separate from image/content revisions. */
itemRoutes.patch("/channels/:cid/items/:id/publication-draft", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  const body = parse(publicationDraftSaveSchema, req.body);
  res.json(await saveItemPublicationDraft(getDb(), item.id, ch.id, body, actorOf(req)));
}));

/** 운영자 편집 — 새 버전 생성, 기존 승인 무효화 */
itemRoutes.patch(
  "/channels/:cid/items/:id",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    await assertGenericCardEditor(item.id);
    const body = parse(editSchema, req.body);
    let payload: Record<string, unknown> | null = null;
    if (body.payload) {
      // Source editors cannot author the server's evidence analysis or model history.
      const sourceFields = { ...body.payload };
      for (const key of ["articleAnalysis", "aiWorkflow", "cardCopy", ...FAMILY_METADATA_KEYS, "rendererProvider", "canvaExport"]) delete sourceFields[key];
      const r = payloadSchemaFor(item.kind).safeParse(sourceFields);
      if (!r.success) throw new HttpError(400, `초안 형식 오류 — ${r.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
      payload = r.data as Record<string, unknown>;
    }
    const db = getDb();
    const out = await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
      await assertGenericCardEditor(item.id, tx);
      if (fresh.version !== body.version) conflict(fresh);
      // Older editors/imports only know source fields. Omission is not a request
      // to erase separately edited card words or trusted analysis/model history.
      if (payload) {
        const { cardCopy: _unownedCopy, ...ownedFields } = payload;
        payload = ownedFields;
        const [previous] = fresh.currentRevisionId ? await tx.select({ payload: contentRevisions.payload }).from(contentRevisions).where(eq(contentRevisions.id, fresh.currentRevisionId)) : [];
        const savedCopy = storedCardCopySchema.safeParse(previous?.payload.cardCopy);
        if (savedCopy.success) payload = { ...payload, cardCopy: savedCopy.data };
        if (savedCopy.success && savedCopy.data.version === 2) {
          const family = familyMetadataFromPayload(previous!.payload);
          if (!family) throw new HttpError(409, "저장된 8장 원고의 근거 메타데이터를 확인해 주세요. 기존 원고는 유지했습니다.");
          Object.assign(payload, family, { dependencies: { ...family.dependencies, caption: family.captionPackage ? "needs_review" : "not_generated", review: family.editorialReview ? "needs_review" : "not_generated", render: "needs_review" } });
          for (const key of ["rendererProvider", "canvaExport"]) if (previous!.payload[key] !== undefined) payload[key] = previous!.payload[key];
        }
        const savedAnalysis = articleAnalysisSchema.safeParse(previous?.payload.articleAnalysis);
        if (savedAnalysis.success) payload.articleAnalysis = savedAnalysis.data;
        const savedWorkflow = aiWorkflowSchema.safeParse(previous?.payload.aiWorkflow);
        if (savedWorkflow.success) payload.aiWorkflow = savedWorkflow.data;
      }
      const upd = await tx
        .update(contentItems)
        .set({
          ...(body.title ? { title: body.title } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(payload && fresh.kind === "notice" ? { scheduleStatus: computeScheduleStatus((payload as any).schedules), category: (payload as any).category ?? body.category ?? fresh.category, schoolType: (payload as any).school_type ?? fresh.schoolType, relevance: (payload as any).relevance } : {}),
          ...(payload && fresh.reviewStatus === "reviewed" ? { reviewStatus: "pending" } : {}),
          edited: payload ?? fresh.edited,
          version: sql`${contentItems.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(contentItems.id, item.id), eq(contentItems.version, body.version)))
        .returning();
      if (!upd.length) conflict(item);
      if (payload) await createRevision(tx, { contentItemId: item.id, author: "operator", payload, note: body.note ?? "운영자 편집" });
      await audit(tx, { actor: actorOf(req), action: "edit", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { fields: Object.keys(body).filter((k) => k !== "version") } });
      const [saved] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
      return saved;
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
    const db = getDb();
    const saved = await db.transaction(async tx => {
      const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
      if (fresh.version !== body.version) conflict(fresh);
      if (body.status === "reviewed") {
        if (!fresh.currentRevisionId) throw new HttpError(400, "초안이 없어 검토 완료로 표시할 수 없습니다.");
        if (fresh.relevance === "irrelevant" || fresh.excluded) throw new HttpError(400, "관련 없음 또는 제외 항목은 검토 완료할 수 없습니다.");
      }
      const [row] = await tx.update(contentItems).set({ reviewStatus: body.status, version: fresh.version + 1, updatedAt: new Date() }).where(eq(contentItems.id, item.id)).returning();
      if (body.status !== "reviewed") await revokePublicationEligibility(tx as unknown as ReturnType<typeof getDb>, item.id, `검토 상태 변경(${body.status}) — 대기 게시 취소`, actorOf(req));
      await audit(tx, { actor: actorOf(req), action: `review:${body.status}`, entity: "content_item", entityId: item.id, channelId: ch.id, detail: { reason: body.reason ?? null } });
      const [result] = await tx.select().from(contentItems).where(eq(contentItems.id, row.id));
      return result;
    });
    res.json(saved);
  }),
);

/** 제외/제외 해제 */
itemRoutes.post(
  "/channels/:cid/items/:id/exclude",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    const body = parse(z.object({ version: zVersion, excluded: z.boolean(), reason: z.string().max(300).optional() }), req.body);
    const db = getDb();
    const saved = await db.transaction(async tx => {
      const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
      if (fresh.version !== body.version) conflict(fresh);
      await tx.update(contentItems).set({ excluded: body.excluded, excludedReason: body.excluded ? body.reason ?? "운영자 제외" : null, version: fresh.version + 1, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
      if (body.excluded) await revokePublicationEligibility(tx as unknown as ReturnType<typeof getDb>, item.id, body.reason ?? "운영자가 콘텐츠를 제외해 대기 게시를 취소했습니다.", actorOf(req));
      else await ensureSourceWorkspace(tx, item.id);
      await audit(tx, { actor: actorOf(req), action: body.excluded ? "exclude" : "unexclude", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { reason: body.reason ?? null } });
      const [result] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
      return result;
    });
    res.json(saved);
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
    const attemptStartedAt = new Date();
    const r = await fetchAndExtract(sourceFetchUrl(doc), undefined, { title: doc.title, publisherUrl: typeof doc.meta.publisherUrl === "string" ? doc.meta.publisherUrl : undefined });
    const now = new Date();
    const saved = await db.transaction(async tx => {
      const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
      const result = await persistSourceFetchAttempt(tx as unknown as ReturnType<typeof getDb>, doc.id, r, { attemptStartedAt, attemptedAt: now });
      const currentSource = await itemPrimarySource(tx as unknown as ReturnType<typeof getDb>, fresh);
      if (currentSource?.id === doc.id && !result.staleAttempt) {
        const evidenceStatus = result.hasUsableBody ? fresh.evidenceStatus === "fetch_failed" ? "needs_review" : fresh.evidenceStatus : "fetch_failed";
        const needsReview = result.changed && fresh.reviewStatus === "reviewed";
        if (needsReview || evidenceStatus !== fresh.evidenceStatus) {
          await tx.update(contentItems).set({ evidenceStatus, ...(needsReview ? { reviewStatus: "review_required" } : {}), version: fresh.version + 1, updatedAt: now }).where(eq(contentItems.id, item.id));
          if (needsReview) await revokePublicationEligibility(tx as unknown as ReturnType<typeof getDb>, item.id, "원문 본문이 변경돼 다시 검토해야 합니다.", actorOf(req));
        }
      }
      return result;
    });
    if (!r.ok) {
      const recovery = sourceRecovery({ ...saved.document, fetchStatus: r.status, fetchError: r.error });
      await audit(db, { actor: actorOf(req), action: "fetch_failed", entity: "source_document", entityId: doc.id, channelId: ch.id, detail: { error: r.error, preservedBody: saved.preservedBody, staleAttempt: saved.staleAttempt } });
      return res.status(502).json({ error: r.error, status: r.status, recovery, sourceUrl: recovery.links[0]?.url ?? null, preservedBody: saved.preservedBody, staleAttempt: saved.staleAttempt });
    }
    res.json({ ok: true, changed: saved.changed, length: saved.document.fetchedText?.length ?? 0, staleAttempt: saved.staleAttempt });
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
    await assertGenericCardEditor(item.id);
    const db = getDb();
    const { provider, templateKey, version, requestId } = parse(z.object({ version: zVersion.optional(), requestId: z.string().uuid().optional(), provider: z.enum(aiProviders).optional(), templateKey: z.string().min(1).max(40).optional() }).strict(), req.body ?? {});
    const logicalRequestId = requestId ?? randomUUID();
    if (templateKey) await resolveCardCopyStyle(templateKey, ch.id);
    const ai = { summary: channelAiSelection(ch, "summary", { provider }), copy: channelAiSelection(ch, "copy"), familyPlan: familyExecutionPlan(ch, item.currentRevisionId ?? 0) };
    const result = await runSourceGeneration(db, { type: "source_generate", itemId: item.id, channelId: ch.id, version: version ?? item.version, requestId: logicalRequestId, intent: { provider: provider ?? null, templateKey: templateKey ?? null }, configuration: ai, actor: actorOf(req) }, async () => {
      if (item.kind === "notice") {
        const [saved] = item.currentRevisionId ? await db.select({ payload: contentRevisions.payload }).from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId)) : [];
        const selectedTemplate = templateKey ?? ch.cardTemplate;
        const budget = createManualSourceBudget({ summary: ai.summary, copy: ai.copy, notice: true, hasSavedCopy: !!saved?.payload.cardCopy, templateKey: selectedTemplate,
          ...(readingProfileForTemplateKey(selectedTemplate) ? { familyPlan: ai.familyPlan } : {}) });
        const r = await extractForItem(db, item.id, budget, new Date(), undefined, provider, templateKey, ai);
        if (!r.ok) throw new HttpError(r.kind === "not_configured" ? 503 : 400, r.error);
      } else {
        const r = await generateDialogueDraft(db, item.id, new Date(), provider, templateKey, { ...ai, explicitRetry: true, requestId: logicalRequestId });
        if (!r.ok) throw new HttpError(400, r.error);
      }
      await audit(db, { actor: actorOf(req), action: "generate", entity: "content_item", entityId: item.id, channelId: ch.id });
      const [fresh] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
      return fresh;
    });
    res.json(result);
  }),
);

itemRoutes.post("/channels/:cid/items/:id/generation-cancel", ah(async (req, res) => {
  const { item } = await loadItem(req.params.cid, req.params.id);
  const { requestId } = parse(z.object({ requestId: z.string().uuid() }).strict(), req.body);
  const result = await cancelSourceGenerationRequest(getDb(), item.id, requestId, actorOf(req));
  res.json({ cancelled: result.cancelled, jobId: result.job.id, jobStatus: result.job.status });
}));

/* ───────────── 카드 ───────────── */
async function resolveCardCopyStyle(key: string, channelId: number) {
  try { return await resolveStyle(getDb(), key, channelId); }
  catch (error) {
    if (error instanceof TemplateNotFound) throw new HttpError(400, error.message);
    throw error;
  }
}

async function cardCopyRevision(item: typeof contentItems.$inferSelect) {
  if (!item.currentRevisionId) throw new HttpError(409, "먼저 원문으로 초안을 만든 뒤 카드 문구를 편집해 주세요.");
  const [revision] = await getDb().select().from(contentRevisions).where(and(eq(contentRevisions.id, item.currentRevisionId), eq(contentRevisions.contentItemId, item.id)));
  if (!revision) throw new HttpError(409, "현재 초안을 찾을 수 없습니다. 새로고침해 주세요.");
  return revision;
}

function cardCopyRenderError(error: unknown): never {
  if (error instanceof CardOverflowError) throw new HttpError(422, `문구를 줄이거나 줄바꿈을 조정해 주세요. ${error.message}`);
  if (error instanceof CardFontError) throw new HttpError(500, error.message);
  throw error;
}

/** An eight-page layout must never silently fall through to the legacy renderer. */
function assertLegacyTemplate(key: string) {
  if (readingProfileForTemplateKey(key)) throw new HttpError(422, "이 디자인은 8장 원고용입니다. 현재 원고를 보존한 채 ‘8장 구성으로 제안받기’에서 비교한 뒤 적용해 주세요.", { code: "eight_page_copy_required" });
}

/** Editable image copy is separate from article facts and destination captions. */
itemRoutes.get("/channels/:cid/items/:id/card-copy", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  await assertGenericCardEditor(item.id);
  const query = parse(z.object({ templateKey: z.string().min(1).max(40).optional() }).strict(), req.query);
  const revision = await cardCopyRevision(item);
  if ((revision.payload.cardCopy as { version?: unknown } | undefined)?.version === 2) {
    const savedFamily = parse(familyCardCopySchema, revision.payload.cardCopy), metadata = familyMetadataFromPayload(revision.payload);
    if (!metadata) throw new HttpError(409, "저장된 8장 카드의 근거·편집 기록을 읽을 수 없습니다. 기존 원고는 유지했습니다.");
    const copy = query.templateKey ? { ...savedFamily, templateKey: query.templateKey } : savedFamily;
    await resolveCardCopyStyle(copy.templateKey, ch.id);
    const evidence = familyEvidenceView(await loadFamilyEvidence(getDb(), item, metadata.evidenceBinding));
    const artworkCredits = await loadCardPageArtworkCredits(getDb(), item.id, ch.id, copy, metadata.pageDesigns, true);
    res.set("Cache-Control", "no-store").json({ version: item.version, revisionId: revision.id, copy, ...metadata, evidence, artworkCredits, hasSavedCopy: true, recommendedStoryFormat: "family_dialogue_8", ai: { summary: channelAiSelection(ch, "summary"), copy: channelAiSelection(ch, "copy"), image: channelAiSelection(ch, "image") } });
    return;
  }
  const saved = cardCopySchema.safeParse(revision.payload.cardCopy);
  if (query.templateKey) assertLegacyTemplate(query.templateKey);
  let key = query.templateKey || (saved.success ? saved.data.templateKey : null) || ch.cardTemplate || "builtin:classic";
  let style, templateRecovery: string | undefined;
  if (readingProfileForTemplateKey(key)) {
    key = "builtin:classic";
    templateRecovery = "선택한 기본 디자인은 8장 원고용입니다. 기존 원고는 그대로 열었습니다. 8장 디자인을 고른 뒤 새 구성과 비교해서 적용해 주세요.";
  }
  try { style = await resolveCardCopyStyle(key, ch.id); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400 || query.templateKey || !saved.success) throw error;
    // A removed custom layout can fall back only to another V1 layout. An
    // eight-page channel default must not relabel this preserved legacy copy.
    key = ch.cardTemplate !== key && !readingProfileForTemplateKey(ch.cardTemplate) ? ch.cardTemplate : "builtin:classic";
    try { style = await resolveCardCopyStyle(key, ch.id); }
    catch (fallbackError) {
      if (!(fallbackError instanceof HttpError) || fallbackError.status !== 400) throw fallbackError;
      key = "builtin:classic"; style = await resolveCardCopyStyle(key, ch.id);
    }
    templateRecovery = "이전에 사용한 템플릿을 찾을 수 없어 기존 카드 형식에 맞는 기본 디자인으로 미리봅니다. 작성한 문구와 기존 저장본은 유지했습니다. 디자인을 고른 뒤 저장해 주세요.";
  }
  try {
    const invalidSavedCopy = revision.payload.cardCopy !== undefined && !saved.success;
    const { cardCopy: _oldCopy, ...sourcePayload } = revision.payload;
    const copy = cardCopyFromPayload({ kind: item.kind, payload: invalidSavedCopy ? sourcePayload : revision.payload, channelName: ch.name, channelSlug: ch.slug, channelCategories: ch.categories, subcategory: item.subcategory, accent: ch.accentColor, sourceOrg: await sourceOrgFor(getDb(), item, revision.payload), checkedDate: kstToday(new Date()) }, style, key);
    const recoveryNotice = templateRecovery ?? (invalidSavedCopy ? "이전 카드 문구의 형식을 읽을 수 없어 원문 요약에서 편집 문구를 가져왔습니다. 기존 저장본은 유지했으며, 내용을 확인한 뒤 저장하면 새 버전으로 기록됩니다." : undefined);
    res.set("Cache-Control", "no-store").json({ version: item.version, revisionId: revision.id, copy, hasSavedCopy: saved.success && !templateRecovery, recommendedStoryFormat: item.kind === "notice" ? null : "family_dialogue_8", ai: { summary: channelAiSelection(ch, "summary"), copy: channelAiSelection(ch, "copy"), image: channelAiSelection(ch, "image") }, ...(recoveryNotice ? { recoveryNotice } : {}) });
  } catch (error) { cardCopyRenderError(error); }
}));

/** A text edit becomes an immutable content revision; existing image files stay intact. */
itemRoutes.patch("/channels/:cid/items/:id/card-copy", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  await assertGenericCardEditor(item.id);
  if (req.body?.copy?.version === 2) {
    const body = parse(familySaveSchema, req.body);
    await resolveCardCopyStyle(body.copy.templateKey, ch.id);
    const artworkCredits = await loadCardPageArtworkCredits(getDb(), item.id, ch.id, body.copy, body.pageDesigns, true);
    res.json({ ...await saveFamilyCardCopy(getDb(), item.id, ch.id, body, actorOf(req)), artworkCredits });
    return;
  }
  const body = parse(z.object({ version: zVersion, copy: cardCopySchema, proposalJobId: z.number().int().positive().optional() }).strict(), req.body);
  assertLegacyTemplate(body.copy.templateKey);
  await resolveCardCopyStyle(body.copy.templateKey, ch.id);
  const result = await getDb().transaction(async tx => {
    const [fresh] = await tx.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.channelId, ch.id))).for("update");
    await assertGenericCardEditor(item.id, tx);
    if (!fresh || fresh.version !== body.version) conflict(fresh ?? item);
    const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
    if (board) assertStudioActive(board);
    const [current] = fresh.currentRevisionId ? await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id, fresh.currentRevisionId), eq(contentRevisions.contentItemId, item.id))) : [];
    if (!current) throw new HttpError(409, "현재 초안이 없습니다. 먼저 원문 초안을 저장해 주세요.");
    // Already-open legacy clients strip storyFormat, roles, columns and artwork
    // while parsing a new eight-page response. A current CAS version alone does
    // not make that lossy downgrade safe. Only the upgraded editor can save it.
    const storedCopy = current.payload.cardCopy as { storyFormat?: unknown; version?: unknown } | null | undefined;
    if (storedCopy?.version === 2 || storedCopy?.storyFormat === "discussion8" && body.copy.storyFormat !== "discussion8") {
      throw new HttpError(409, "8장 카드가 저장된 원고입니다. 이전 형식으로 저장하려 해 중단했습니다. 입력한 문구를 복사한 뒤 페이지를 새로고침해 주세요. 저장된 카드·배경·참고자료는 유지됩니다.", { code: "editor_reload_required" });
    }
    await assertCardPageArtworkOwnership(tx as unknown as import("../db").DB, item.id, ch.id, body.copy);
    await assertNewsEditorialResources(tx as unknown as import("../db").DB, fresh, body.copy);
    const payload: Record<string, unknown> = { ...current.payload, cardCopy: body.copy };
    if (body.proposalJobId) {
      const [proposal] = await tx.select().from(jobs).where(and(eq(jobs.id, body.proposalJobId), eq(jobs.channelId, ch.id), eq(jobs.type, "card_copy_generate"), eq(jobs.status, "succeeded")));
      const response = proposal?.result?.response as Record<string, unknown> | undefined;
      if (!proposal || proposal.payload.itemId !== item.id || proposal.payload.version !== body.version || response?.revisionId !== current.id) throw new HttpError(409, "제안 이후 원고 버전이 바뀌었습니다. 현재 문구를 유지했으니 최신 원고를 확인해 주세요.");
      const analysis = articleAnalysisSchema.safeParse(response.articleAnalysis), workflow = aiWorkflowSchema.safeParse(response.aiWorkflow);
      if (analysis.success) payload.articleAnalysis = analysis.data;
      if (workflow.success) payload.aiWorkflow = workflow.data;
    }
    // Saving reviewed wording resolves only the incomplete-copy warning, never unrelated source warnings.
    const workflow = aiWorkflowSchema.safeParse(payload.aiWorkflow);
    if (workflow.success) payload.aiWorkflow = { ...workflow.data, warnings: workflow.data.warnings.filter(warning => !warning.startsWith("기사 요약은 저장했습니다. 카드 문구는 완성하지 못했습니다:")) };
    // PostgreSQL JSONB may reorder keys. A repeated save must not manufacture a
    // new revision or invalidate an approval when the data is unchanged.
    if (isDeepStrictEqual(current.payload, payload)) return { version: fresh.version, revisionId: current.id, copy: body.copy, hasSavedCopy: true };
    const revision = await createRevision(tx, { contentItemId: item.id, author: "operator", payload, note: "카드 문구 편집 · 원문 요약과 캡션 유지" });
    await tx.update(contentItems).set({ edited: payload, version: fresh.version + 1, reviewStatus: fresh.reviewStatus === "reviewed" ? "pending" : fresh.reviewStatus, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
    await audit(tx, { actor: actorOf(req), action: "edit_card_copy", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { revisionId: revision.id, templateKey: body.copy.templateKey, pages: body.copy.pages.length + 1 } });
    return { version: fresh.version + 1, revisionId: revision.id, copy: body.copy, hasSavedCopy: true };
  });
  res.json({ ...result, recommendedStoryFormat: item.kind === "notice" ? null : "family_dialogue_8", ai: { summary: channelAiSelection(ch, "summary"), copy: channelAiSelection(ch, "copy"), image: channelAiSelection(ch, "image") } });
}));

/** Explicit manual confirmation reads the already saved publication caption. */
itemRoutes.post("/channels/:cid/items/:id/card-copy/caption-confirm", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  await assertGenericCardEditor(item.id);
  const body = parse(familyCaptionConfirmSchema, req.body);
  res.json(await confirmFamilyCaption(getDb(), item.id, ch.id, body, actorOf(req)));
}));

/** Explicit AI action returns a proposal; it never overwrites saved/operator copy. */
itemRoutes.post("/channels/:cid/items/:id/card-copy/generate", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  await assertGenericCardEditor(item.id);
  if (req.body?.formatId === "family_dialogue_8") {
    const body = parse(familyGenerateSchema, req.body), db = getDb();
    const configuration = familyExecutionPlan(ch, body.baseRevision);
    const { version, requestId, ...intent } = body;
    const result = await runSourceGeneration(db, { type: "card_copy_generate", channelId: ch.id, itemId: item.id, version, requestId, intent, configuration, actor: actorOf(req) }, async () => {
      await resolveCardCopyStyle(body.templateKey, ch.id);
      const revision = await cardCopyRevision(item);
      const [board] = await db.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
      if (board) assertStudioActive(board);
      const proposed = await proposeFamilyDialogue(db, item, ch, revision, body, configuration);
      const artworkCredits = proposed.copy && proposed.pageDesigns ? await loadCardPageArtworkCredits(db, item.id, ch.id, proposed.copy, proposed.pageDesigns, true) : undefined;
      // Preserve a late response as a comparison-only proposal. Content is never
      // written here; explicit apply uses the item CAS and original revision.
      return db.transaction(async tx => {
        const [fresh] = await tx.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.channelId, ch.id))).for("update");
        const response = { ...proposed, ...(artworkCredits ? { artworkCredits } : {}), lateResult: !fresh || fresh.version !== body.version || fresh.currentRevisionId !== revision.id };
        await completeGenerationResult(tx as unknown as import("../db").DB, response);
        await audit(tx, { actor: actorOf(req), action: "propose_family_card_copy", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { scope: body.scope, baseRevision: revision.id, status: response.status, lateResult: response.lateResult, stages: proposed.generationRuns?.length ?? 0 } });
        return response;
      });
    });
    res.json(result);
    return;
  }
  const body = parse(z.object({ version: zVersion, requestId: z.string().uuid().optional(), templateKey: z.string().min(1).max(40), provider: z.enum(aiProviders).optional(), instructions: z.string().trim().max(1500).optional(), selectedPage: z.number().int().min(0).max(9).optional(), storyFormat: z.literal("discussion8").optional(), refreshAnalysis: z.boolean().optional() }).strict(), req.body);
  assertLegacyTemplate(body.templateKey);
  const db = getDb();
  const ai = { summary: channelAiSelection(ch, "summary"), copy: channelAiSelection(ch, "copy", { provider: body.provider }) };
  const result = await runSourceGeneration(db, { type: "card_copy_generate", channelId: ch.id, itemId: item.id, version: body.version, requestId: body.requestId, intent: { templateKey: body.templateKey, provider: body.provider ?? null, ...(body.instructions ? { instructions: body.instructions } : {}), ...(body.selectedPage !== undefined ? { selectedPage: body.selectedPage } : {}), ...(body.storyFormat ? { storyFormat: body.storyFormat } : {}), ...(body.refreshAnalysis ? { refreshAnalysis: true } : {}) }, configuration: ai, actor: actorOf(req) }, async () => {
  await resolveCardCopyStyle(body.templateKey, ch.id);
  const revision = await cardCopyRevision(item);
  const [board] = await db.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
  if (board) assertStudioActive(board);
  if (await getSetting(db, "global_stop", false)) throw new HttpError(409, "전역 정지 상태입니다. 정지를 해제한 뒤 AI 문구를 만들어 주세요.");
  const sources = await loadNewsEditorialSources(db, item);
  if (!sources.length && item.kind === "current_dialogue") throw new HttpError(400, "뉴스 원문을 먼저 확보하거나 본문을 붙여넣어 주세요. 제목만으로 카드 문구를 생성하지 않습니다.");
  const existingCopy = cardCopySchema.safeParse(revision.payload.cardCopy);
  if (body.selectedPage !== undefined && existingCopy.success && body.selectedPage > existingCopy.data.pages.length) throw new HttpError(400, "수정할 카드 페이지를 확인해 주세요.");
  const storyFormat = body.storyFormat ?? (existingCopy.success ? existingCopy.data.storyFormat : undefined);
  const args = { kind: item.kind, title: item.title, payload: revision.payload, templateKey: body.templateKey, channelName: ch.name, channelSlug: ch.slug, sources, instructions: body.instructions, selectedPage: body.selectedPage,
    budget: createManualCardCopyBudget({ ...ai, refreshAnalysis: storyFormat === "discussion8" && (body.refreshAnalysis === true || !articleAnalysisSchema.safeParse(revision.payload.articleAnalysis).success) }) };
  const generated = storyFormat === "discussion8"
    ? await proposeNewsDiscussion({ ...args, ...ai, refreshAnalysis: body.refreshAnalysis })
    : await generateCardCopy({ ...args, ...ai.copy });
  if (!generated.ok) throw new HttpError(generated.kind === "not_configured" ? 503 : 422, generated.error);
  const [fresh] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
  if (fresh.version !== body.version || fresh.currentRevisionId !== revision.id) throw new HttpError(409, "AI 작성 중 원고가 변경됐습니다. 입력 내용은 유지했습니다. 최신 원고를 확인해 주세요.");
  await audit(db, { actor: actorOf(req), action: "propose_card_copy", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { templateKey: body.templateKey, model: generated.model, pages: generated.data.pages.length + 1 } });
  return { version: item.version, revisionId: revision.id, copy: generated.data, model: generated.model, selectedPage: body.selectedPage ?? 0, scope: body.selectedPage === undefined ? "all" : "page", ...( "articleAnalysis" in generated ? { articleAnalysis: generated.articleAnalysis } : {}), ...( "aiWorkflow" in generated ? { aiWorkflow: generated.aiWorkflow } : {}) };
  });
  res.json(result);
}));

/** Same layout/fonts as final JPEG; no source writes or image-generation calls. */
itemRoutes.post("/channels/:cid/items/:id/card-copy/preview", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  await assertGenericCardEditor(item.id);
  if (req.body?.copy?.version === 2) {
    const body = parse(z.object({ version: zVersion, copy: familyCardCopySchema, pageDesigns: pageDesignsSchema, page: z.number().int().min(0).max(7), proposalJobId: z.number().int().positive().optional() }).strict(), req.body);
    if (item.version !== body.version) conflict(item);
    const db = getDb(), revision = await cardCopyRevision(item);
    const saved = body.proposalJobId ? (await familyProposalMetadata(db, item, revision.id, body.proposalJobId)).metadata : familyMetadataFromPayload(revision.payload);
    if (!saved) throw new HttpError(409, "8장 제안의 고정 근거를 확인한 뒤 미리보기해 주세요.");
    const metadata = synchronizeFamilyQuestion(body.copy, saved);
    await assertFamilyEvidenceForCopy(db, item, body.copy, metadata);
    const style = await resolveCardCopyStyle(body.copy.templateKey, ch.id);
    try {
      const plan = planCarousel({ kind: item.kind, payload: { ...revision.payload, ...metadata, cardCopy: body.copy, pageDesigns: body.pageDesigns }, channelName: ch.name, channelSlug: ch.slug, channelCategories: ch.categories, subcategory: item.subcategory, accent: ch.accentColor, sourceOrg: await sourceOrgFor(db, item, revision.payload), checkedDate: kstToday(new Date()) }, style);
      const images = await loadCardPageArtworkForPage(db, item.id, ch.id, body.copy, body.page, body.pageDesigns);
      const bytes = await renderCarouselPage(plan, body.page, style, null, "우주펭귄상회 스튜디오 · 본문 근거 확인", images);
      res.set("Cache-Control", "no-store").type("image/jpeg").send(bytes);
    } catch (error) { cardCopyRenderError(error); }
    return;
  }
  const body = parse(z.object({ version: zVersion, copy: cardCopySchema, page: z.number().int().min(0).max(9), coverMode: z.enum(["ai", "typography", "reuse"]).optional() }).strict(), req.body);
  assertLegacyTemplate(body.copy.templateKey);
  if (item.version !== body.version) conflict(item);
  if (body.page > body.copy.pages.length) throw new HttpError(400, "카드 페이지를 확인해 주세요.");
  const revision = await cardCopyRevision(item);
  const style = await resolveCardCopyStyle(body.copy.templateKey, ch.id);
  await assertNewsEditorialResources(getDb(), item, body.copy);
  try {
    const plan = planCarousel({ kind: item.kind, payload: { ...revision.payload, cardCopy: body.copy }, channelName: ch.name, channelSlug: ch.slug, channelCategories: ch.categories, subcategory: item.subcategory, accent: ch.accentColor, sourceOrg: await sourceOrgFor(getDb(), item, revision.payload), checkedDate: kstToday(new Date()) }, style);
    const pageImages = await loadCardPageArtworkForPage(getDb(), item.id, ch.id, body.copy, body.page);
    const savedArt = body.coverMode === "typography" ? null : await findReusableCardCover(getDb(), item.id, revision.payload);
    const credit = savedArt ? "표지: AI 생성 · OpenAI" : style.background ? "이미지: 내 배경 템플릿" : "우주펭귄상회 스튜디오";
    const bytes = await renderCarouselPage(plan, body.page, style, savedArt?.bytes ?? null, credit, pageImages);
    res.set("Cache-Control", "no-store").type("image/jpeg").send(bytes);
  } catch (error) { cardCopyRenderError(error); }
}));

itemRoutes.post(
  "/channels/:cid/items/:id/card",
  ah(async (req, res) => {
    const { ch, item } = await loadItem(req.params.cid, req.params.id);
    await assertGenericCardEditor(item.id);
    const body = parse(z.object({
      version: zVersion.optional(), requestId: z.string().uuid().optional(), templateKey: z.string().max(40).nullable().optional(),
      coverMode: z.enum(["ai", "typography", "reuse"]).optional(), regenerateCover: z.boolean().optional(), coverInstruction: z.string().trim().max(2000).optional(),
    }).strict().refine(value => !value.requestId || value.version !== undefined, "요청 ID와 함께 원고 버전을 보내 주세요.")
      .refine(value => !value.regenerateCover || value.coverMode === "ai", "새 표지 생성은 AI 표지에서만 사용할 수 있습니다.")
      .refine(value => !value.regenerateCover || (value.version !== undefined && value.requestId !== undefined), "새 표지를 만들려면 최신 원고 버전과 요청 ID가 필요합니다.")
      .refine(value => !value.coverInstruction || value.regenerateCover, "표지 수정 지시는 새 표지 생성과 함께 요청해 주세요."), req.body ?? {});
    const savedRevision = item.currentRevisionId ? await cardCopyRevision(item) : null;
    if ((savedRevision?.payload.cardCopy as { version?: unknown } | undefined)?.version !== 2) {
      const savedKey = (savedRevision?.payload.cardCopy as { templateKey?: string } | undefined)?.templateKey;
      assertLegacyTemplate(body.templateKey || savedKey || ch.cardTemplate);
    }
    if ((savedRevision?.payload.cardCopy as { version?: unknown } | undefined)?.version === 2 && savedRevision?.payload.rendererProvider === "canva") throw new HttpError(409, "이 원고는 Canva 이미지로 발행하도록 선택했습니다. Canva에서 최신 8장을 가져오거나, '스튜디오 자체 이미지로 전환'을 직접 선택한 뒤 생성해 주세요.", { code: "explicit_renderer_switch_required" });
    const imageAi = channelAiSelection(ch, "image");
    const render = async () => {
      const r = await renderCardForItem(getDb(), item.id, new Date(), body.templateKey, { version: body.version, coverMode: body.coverMode, regenerateCover: body.regenerateCover, coverInstruction: body.coverInstruction, actor: actorOf(req), imageAi });
      if (!r.ok) throw new HttpError(r.code === "font" || r.code === "render" ? 500 : r.code === "template" || r.code === "invalid_image_request" ? 400 : r.code === "conflict" ? 409 : 422, r.error, { code: r.code, field: (r as { field?: string }).field });
      await audit(getDb(), { actor: actorOf(req), action: "render_card", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { assetId: r.asset.id, sha256: r.asset.sha256 } });
      return r.asset;
    };
    const asset = body.requestId || body.coverMode === "ai" || body.coverMode === undefined ? await runSourceGeneration(getDb(), {
      type: "card_render", channelId: ch.id, itemId: item.id, version: body.version ?? item.version,
      requestId: body.requestId, intent: { templateKey: body.templateKey ?? null, coverMode: body.coverMode ?? null, ...(body.regenerateCover ? { regenerateCover: true, coverInstruction: body.coverInstruction ?? "" } : {}) }, configuration: { image: imageAi }, actor: actorOf(req),
    }, render) : await render();
    res.json(asset);
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
  const body=parse(z.object({version:z.number().int().min(0),values:z.array(z.string().min(1,"대체텍스트를 입력해 주세요.").refine(value => !altTextError(value), "대체텍스트는 1~2문장, 공백 포함 125자 이내로 작성해 주세요.")).min(1).max(10)}).strict(),req.body);
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
  const captions = item.publicationDraft?.captions ?? buildCaptions({ kind: item.kind, payload: revision.payload, sourceOrg: await sourceOrgFor(getDb(), item, revision.payload), sourceUrl: primary?.originalUrl ?? null });
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
    if (req.query.download === "1") {
      const extension = a.mime === "image/png" ? "png" : a.mime === "image/webp" ? "webp" : a.mime === "image/jpeg" ? "jpg" : "bin";
      res.setHeader("content-disposition", `attachment; filename="spacepenguin-card-${a.contentItemId}-r${a.revisionId}.${extension}"`);
    }
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
        publicationDraftVersion: z.number().int().min(0).optional(),
        requestId: z.string().uuid().optional(),
        destinationIds: z.array(z.number().int().positive()).min(1).max(20).refine(ids => new Set(ids).size === ids.length, "게시 계정은 중복 선택할 수 없습니다.").optional(),
        captions: z.object({ instagram: z.string().max(5000), telegram: z.string().max(5000) }),
        timing: z.enum(["now", "later"]).optional(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
      req.body,
    );
    const timing = resolvePublicationTiming(body);
    if (!timing.ok) throw new HttpError(400, timing.error);
    const r = await approveItem(getDb(), { itemId: item.id, revisionId: body.revisionId, mediaAssetId: body.mediaAssetId, altTextVersion:body.altTextVersion, publicationDraftVersion: body.publicationDraftVersion, requestId: body.requestId, timing: timing.timing, destinationIds: body.destinationIds, captions: body.captions, scheduledAt: timing.scheduledAt, actor: actorOf(req) });
    if (!r.ok) throw new HttpError(400, r.error);
    const workerStarted = timing.timing === "now" && kickInlinePublish(getDb(), { approvalId: r.approval.id });
    res.status(201).json({ ...r, timing: timing.timing, workerStarted });
  }),
);

itemRoutes.post(
  "/channels/:cid/approvals/:aid/cancel",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const [ap] = await getDb().select().from(approvals).where(and(eq(approvals.id, intParam(req.params.aid)), eq(approvals.channelId, ch.id)));
    if (!ap) throw new HttpError(404, "승인을 찾을 수 없습니다.");
    const r = await cancelApproval(getDb(), ap.id, actorOf(req));
    if (!r.ok) throw new HttpError(409, r.error);
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
    if (!r.ok) throw new HttpError("code" in r && r.code === "confirmation_required" ? 400 : 409, r.error);
    const workerStarted = kickInlinePublish(getDb(), { deliveryId: r.deliveryId });
    res.json({ ...r, workerStarted });
  }),
);

/** Resolve uncertainty without resending. Channel ownership is checked before any provider lookup. */
for (const action of ["reconcile", "confirm-posted", "confirm-not-posted"] as const) {
  itemRoutes.post(`/channels/:cid/deliveries/:did/${action}`, ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const db = getDb();
    const [delivery] = await db.select().from(deliveries).where(and(eq(deliveries.id, intParam(req.params.did)), eq(deliveries.channelId, ch.id)));
    if (!delivery) throw new HttpError(404, "전송 기록 없음");
    const body = parse(z.object({
      externalId: z.string().trim().min(1).max(200).optional(),
      externalUrl: z.string().url().max(2000).refine(url => new URL(url).protocol === "https:", "https 게시물 주소를 입력하세요.").optional(),
      note: z.string().trim().max(500).optional(),
    }).strict(), req.body ?? {});
    if (action === "confirm-posted" && !body.externalId && !body.externalUrl) throw new HttpError(400, "게시물 주소 또는 게시물 ID를 입력하세요.");
    const result = action === "reconcile" ? await reconcileDelivery(db, delivery.id, actorOf(req))
      : action === "confirm-posted" ? await confirmDeliveryPosted(db, delivery.id, actorOf(req), { ...body, note: body.note || "운영자가 게시 계정에서 게시물을 확인했습니다." })
      : await confirmDeliveryNotPosted(db, delivery.id, actorOf(req), body.note);
    if (!result.ok) throw new HttpError(409, result.error);
    res.json(result);
  }));
}

const publicationListQuery = z.object({
  channelId: z.union([z.literal("all"), z.coerce.number().int().positive()]),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  status: z.string().max(150).transform(value => value.split(",")).pipe(z.array(z.enum(["waiting", "scheduled", "processing", "succeeded", "failed", "unknown", "cancelled", "dry_run"])).min(1)).optional(),
  from: collectionDateSchema.optional(),
  to: collectionDateSchema.optional(),
  view: z.enum(publicationListStates).default("active"),
});

itemRoutes.post("/channels/:cid/deliveries/organize", ah(async (req, res) => {
  const channel = await loadChannel(req.params.cid);
  const input = parse(organizePublicationsSchema, req.body);
  res.json(await organizePublications(getDb(), channel.id, input, actorOf(req)));
}));

function publicationDateConditions(q: z.infer<typeof publicationListQuery>): SQL[] {
  if (q.from && q.to && q.from > q.to) throw new HttpError(400, "조회 시작일은 종료일보다 늦을 수 없습니다.");
  return [
    ...(q.from ? [gte(approvals.scheduledAt, collectionDayRange(q.from).start)] : []),
    ...(q.to ? [lt(approvals.scheduledAt, collectionDayRange(q.to).end)] : []),
  ];
}

/** Read historical approvals which never acquired a destination delivery. */
itemRoutes.get("/publication-orphans", ah(async (req, res) => {
  const q = parse(publicationListQuery, req.query);
  const db = getDb();
  const where = and(eq(approvals.status, "active"), q.channelId === "all" ? undefined : eq(approvals.channelId, q.channelId), ...publicationDateConditions(q), notExists(db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.approvalId, approvals.id))));
  const page = q.page ?? 1, pageSize = q.pageSize ?? 30;
  const paged = q.page !== undefined || q.pageSize !== undefined;
  const rows = await db.select({
    ap: { id: approvals.id, scheduledAt: approvals.scheduledAt, status: approvals.status, revisionId: approvals.revisionId },
    item: { id: contentItems.id, title: contentItems.title, channelId: contentItems.channelId },
    canonicalStudioCardId: studioCards.id,
  }).from(approvals).innerJoin(contentItems, eq(contentItems.id, approvals.contentItemId))
    .leftJoin(studioCards, eq(studioCards.sourceItemId, contentItems.id))
    .where(where).orderBy(desc(approvals.scheduledAt), desc(approvals.id)).limit(paged ? pageSize : 100).offset(paged ? (page - 1) * pageSize : 0);
  const result: PublicationOrphan[] = rows.map(row => ({ ...row, ap: { ...row.ap, scheduledAt: row.ap.scheduledAt.toISOString() }, reason: "승인은 저장됐지만 전송 예약이 없습니다. 게시 계정을 연결한 뒤 원고에서 다시 승인하세요." }));
  if (!paged) return res.json(result);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(approvals).innerJoin(contentItems, eq(contentItems.id, approvals.contentItemId)).where(where);
  res.json({ items: result, total, page, pageSize });
}));

/** 발행함 */
itemRoutes.get(
  "/deliveries",
  ah(async (req, res) => {
    const q = parse(publicationListQuery, req.query);
    const db = getDb();
    const base = and(q.channelId === "all" ? undefined : eq(deliveries.channelId, q.channelId), ...publicationDateConditions(q), publicationListCondition(q.view));
    const where = and(base, q.status ? or(inArray(deliveries.status, q.status), q.status.includes("unknown") ? eq(deliveries.needsReconciliation, true) : undefined) : undefined);
    const page = q.page ?? 1, pageSize = q.pageSize ?? 30;
    const paged = q.page !== undefined || q.pageSize !== undefined;
    const rows = await db
      .select({
        d: deliveries,
        dest: { label: destinations.label, platform: destinations.platform },
        ap: { id: approvals.id, scheduledAt: approvals.scheduledAt, status: approvals.status, revisionId: approvals.revisionId },
        item: { id: contentItems.id, title: contentItems.title, channelId: contentItems.channelId },
        canonicalStudioCardId: studioCards.id,
      })
      .from(deliveries)
      .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
      .innerJoin(approvals, eq(approvals.id, deliveries.approvalId))
      .innerJoin(contentItems, eq(contentItems.id, approvals.contentItemId))
      .leftJoin(studioCards, eq(studioCards.sourceItemId, contentItems.id))
      .where(where)
      .orderBy(desc(approvals.scheduledAt), asc(deliveries.id))
      .limit(paged ? pageSize : 100).offset(paged ? (page - 1) * pageSize : 0);
    if (!paged) return res.json(rows);
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(deliveries).innerJoin(approvals, eq(approvals.id, deliveries.approvalId)).where(where);
    const grouped = await db.select({ status: deliveries.status, count: sql<number>`count(*)::int` }).from(deliveries).innerJoin(approvals, eq(approvals.id, deliveries.approvalId)).where(base).groupBy(deliveries.status);
    const [{ overdue, needsAttention }] = await db.select({
      overdue: sql<number>`count(*) filter (where ${deliveries.status} = 'scheduled' and ${approvals.scheduledAt} < now() - interval '1 minute')::int`,
      needsAttention: sql<number>`count(*) filter (where ${deliveries.status} in ('failed','unknown','dry_run') or ${deliveries.needsReconciliation} = true)::int`,
    }).from(deliveries).innerJoin(approvals, eq(approvals.id, deliveries.approvalId)).where(base);
    const counts: Record<string, number> = Object.fromEntries(grouped.map(row => [row.status, row.count]));
    counts.overdue = overdue;
    counts.needsAttention = needsAttention;
    res.json({ items: rows, total, page, pageSize, counts });
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
    const upd = await db.transaction(async tx => {
      const items = await tx.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.channelId, ch.id), inArray(contentItems.id, body.ids))).orderBy(contentItems.id).for("update");
      if (!items.length) return [];
      const saved = await tx.update(contentItems).set({ ...set, version: sql`${contentItems.version} + 1`, updatedAt: new Date() }).where(inArray(contentItems.id, items.map(row => row.id))).returning({ id: contentItems.id });
      for (const row of saved) {
        if (body.action !== "unexclude") await revokePublicationEligibility(tx as unknown as ReturnType<typeof getDb>, row.id, `일괄 ${body.action} — 대기 게시 취소`, actorOf(req));
        else await ensureSourceWorkspace(tx, row.id);
      }
      await audit(tx, { actor: actorOf(req), action: `bulk:${body.action}`, entity: "content_item", channelId: ch.id, detail: { ids: saved.map(u => u.id) } });
      return saved;
    });
    res.json({ updated: upd.length });
  }),
);


import { altTextError, altTextFile } from "../../shared/altText";
import { cardAltTextState } from "../services/cardAccessibility";
import { resolvePublicationTiming } from "../../shared/publicationTiming";

// Restore as a new revision; the service owns the row lock, version check and approval revocation.
itemRoutes.post("/channels/:cid/items/:id/revisions/:rid/restore", ah(async (req, res) => {
  const { ch, item } = await loadItem(req.params.cid, req.params.id);
  await assertGenericCardEditor(item.id);
  const body = parse(z.object({ version: zVersion }).strict(), req.body);
  res.json(await restoreSourceRevision(getDb(), { channelId: ch.id, itemId: item.id, revisionId: intParam(req.params.rid), version: body.version, actor: actorOf(req) }));
}));
