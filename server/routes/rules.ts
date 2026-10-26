/**
 * 검색 설정(키워드) — DB의 search_rules가 운영 원본
 * 추가/수정/일시정지/삭제(soft)/복구, 줄 단위 대량 추가(저장 전 미리보기), 시험 검색
 */
import { Router } from "express";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { channels, searchRules, sourceDocuments, contentItems } from "../../shared/schema";
import { ah, conflict, HttpError, intParam, loadChannel, parse, zVersion } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { buildSchoolRuleCandidates, cleanQuery, normalizeQuery, parseBulkQueries, ADMISSION_KEYWORDS, resolveDiscovery } from "../../shared/domain";
import { applyExcludeTerms, NaverError } from "../services/naver";
import { createNewsSearch } from "../services/newsSearch";
import { normalizeUrl } from "../services/url";

export const ruleRoutes = Router();

ruleRoutes.get(
  "/channels/:cid/rules",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const deleted = req.query.deleted === "1";
    const rows = await getDb()
      .select()
      .from(searchRules)
      .where(and(eq(searchRules.channelId, ch.id), deleted ? isNotNull(searchRules.deletedAt) : isNull(searchRules.deletedAt)))
      .orderBy(asc(searchRules.priority), asc(searchRules.id));
    const active = rows.filter((r) => r.enabled && !r.deletedAt);
    const discovery = resolveDiscovery(ch.contentType, ch.budget.discovery);
    const discoveryCalls = discovery?.enabled && discovery.picksPerRun > 0 ? discovery.queries.length : 0;
    res.json({
      items: rows,
      discovery,
      estimate: {
        // 규칙 1개(검색어+endpoint) = 네이버 호출 1회, 자동 발굴 탐색 주제 1개 = 1회
        activeRules: active.length,
        discoveryCalls,
        callsPerRun: Math.min(active.length + discoveryCalls, ch.budget.naverCallsPerRun),
        cappedByBudget: active.length + discoveryCalls > ch.budget.naverCallsPerRun,
        budget: ch.budget.naverCallsPerRun,
      },
    });
  }),
);

const ruleBase = {
  categoryHint: z.string().max(40).nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  display: z.number().int().min(1).max(100).optional(),
  excludeTerms: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  excludeScope: z.enum(["title", "title_and_snippet"]).optional(),
  memo: z.string().max(500).optional(),
};

const ruleCreate = z.object({
  query: z.string().min(1).max(100),
  endpoints: z.array(z.enum(["news", "blog"])).min(1).max(2),
  ...ruleBase,
});

async function insertRules(channelId: number, items: Array<{ query: string; endpoint: string } & Record<string, unknown>>, actor: string) {
  const db = getDb();
  const created: unknown[] = [];
  const duplicates: Array<{ query: string; endpoint: string }> = [];
  for (const it of items) {
    const q = cleanQuery(it.query);
    if (!q) continue;
    if (/\b(OR|AND)\b|\|/.test(q)) {
      // 불리언 문법은 네이버 검색에서 그대로 글자로 처리되므로 경고만(자동 삽입하지 않음)
    }
    const inserted = await db
      .insert(searchRules)
      .values({
        channelId,
        query: q,
        normalizedQuery: normalizeQuery(q),
        endpoint: it.endpoint,
        categoryHint: (it.categoryHint as string | null | undefined) ?? null,
        enabled: (it.enabled as boolean | undefined) ?? true,
        priority: (it.priority as number | undefined) ?? 100,
        display: (it.display as number | undefined) ?? 10,
        excludeTerms: (it.excludeTerms as string[] | undefined) ?? [],
        excludeScope: (it.excludeScope as string | undefined) ?? "title",
        memo: (it.memo as string | undefined) ?? "",
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      created.push(inserted[0]);
      await audit(db, { actor, action: "create", entity: "search_rule", entityId: inserted[0].id, channelId, detail: { query: q, endpoint: it.endpoint } });
    } else duplicates.push({ query: q, endpoint: it.endpoint });
  }
  return { created, duplicates };
}

ruleRoutes.post(
  "/channels/:cid/rules",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(ruleCreate, req.body);
    const { endpoints, ...rest } = body;
    const r = await insertRules(ch.id, endpoints.map((e) => ({ ...rest, endpoint: e })), actorOf(req));
    if (!r.created.length) throw new HttpError(409, "같은 검색어가 이미 등록되어 있습니다.", { duplicates: r.duplicates });
    res.status(201).json(r);
  }),
);

const bulkSchema = z.object({
  text: z.string().max(20_000),
  endpoints: z.array(z.enum(["news", "blog"])).min(1).max(2),
  categoryHint: z.string().max(40).nullable().optional(),
  enabled: z.boolean().optional(),
});

/** 저장 전 미리보기: 새로 추가될 것 / 이미 있는 것 / 호출 수 */
async function bulkPreview(channelId: number, queries: string[], endpoints: string[]) {
  const existing = await getDb()
    .select({ n: searchRules.normalizedQuery, e: searchRules.endpoint })
    .from(searchRules)
    .where(and(eq(searchRules.channelId, channelId), isNull(searchRules.deletedAt)));
  const have = new Set(existing.map((x) => `${x.e}|${x.n}`));
  const rows = queries.flatMap((q) => endpoints.map((e) => ({ query: q, endpoint: e, duplicate: have.has(`${e}|${normalizeQuery(q)}`) })));
  return { rows, newCount: rows.filter((r) => !r.duplicate).length, duplicateCount: rows.filter((r) => r.duplicate).length };
}

ruleRoutes.post(
  "/channels/:cid/rules/bulk-preview",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(bulkSchema, req.body);
    res.json(await bulkPreview(ch.id, parseBulkQueries(body.text), body.endpoints));
  }),
);

ruleRoutes.post(
  "/channels/:cid/rules/bulk",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(bulkSchema, req.body);
    const qs = parseBulkQueries(body.text);
    if (qs.length > 200) throw new HttpError(400, "한 번에 200줄까지 추가할 수 있습니다.");
    const r = await insertRules(
      ch.id,
      qs.flatMap((q) => body.endpoints.map((e) => ({ query: q, endpoint: e, categoryHint: body.categoryHint ?? null, enabled: body.enabled ?? false }))),
      actorOf(req),
    );
    res.status(201).json(r);
  }),
);

/** 학교 × 입시 키워드 후보 생성(저장하지 않음) */
ruleRoutes.post(
  "/channels/:cid/rules/school-candidates",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(
      z.object({ schoolTypes: z.array(z.enum(["national_autonomous", "gifted", "science_high"])).min(1), keywords: z.array(z.string().min(1).max(20)).min(1).max(10) }),
      req.body,
    );
    const cands = buildSchoolRuleCandidates(body.schoolTypes, body.keywords);
    const preview = await bulkPreview(ch.id, cands.map((c) => c.query), ["news"]);
    res.json({ ...preview, candidates: cands, keywordOptions: ADMISSION_KEYWORDS });
  }),
);

const rulePatch = z.object({ version: zVersion, query: z.string().min(1).max(100).optional(), endpoint: z.enum(["news", "blog"]).optional(), ...ruleBase });

ruleRoutes.patch(
  "/channels/:cid/rules/:id",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const body = parse(rulePatch, req.body);
    const db = getDb();
    const [cur] = await db.select().from(searchRules).where(and(eq(searchRules.id, id), eq(searchRules.channelId, ch.id)));
    if (!cur) throw new HttpError(404, "검색어를 찾을 수 없습니다.");
    if (cur.deletedAt) throw new HttpError(400, "삭제된 검색어는 먼저 복구하세요.");
    const { version, query, ...rest } = body;
    const patch: Record<string, unknown> = { ...rest };
    if (query !== undefined) {
      patch.query = cleanQuery(query);
      patch.normalizedQuery = normalizeQuery(query);
    }
    let updated;
    try {
      updated = await db
        .update(searchRules)
        .set({ ...patch, version: sql`${searchRules.version} + 1`, updatedAt: new Date() })
        .where(and(eq(searchRules.id, id), eq(searchRules.version, version)))
        .returning();
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === "23505" || (e as { code?: string }).code === "23505") throw new HttpError(409, "같은 검색어가 이미 등록되어 있습니다.");
      throw e;
    }
    if (!updated.length) conflict(cur);
    await audit(db, { actor: actorOf(req), action: "update", entity: "search_rule", entityId: id, channelId: ch.id, detail: { before: { query: cur.query, endpoint: cur.endpoint, enabled: cur.enabled }, fields: Object.keys(patch) } });
    res.json(updated[0]);
  }),
);

ruleRoutes.post(
  "/channels/:cid/rules/:id/delete",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const db = getDb();
    const updated = await db
      .update(searchRules)
      .set({ deletedAt: new Date(), enabled: false, version: sql`${searchRules.version} + 1`, updatedAt: new Date() })
      .where(and(eq(searchRules.id, id), eq(searchRules.channelId, ch.id), isNull(searchRules.deletedAt)))
      .returning();
    if (!updated.length) throw new HttpError(404, "삭제할 검색어가 없습니다.");
    await audit(db, { actor: actorOf(req), action: "delete", entity: "search_rule", entityId: id, channelId: ch.id });
    res.json(updated[0]);
  }),
);

ruleRoutes.post(
  "/channels/:cid/rules/:id/restore",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const db = getDb();
    try {
      const updated = await db
        .update(searchRules)
        .set({ deletedAt: null, enabled: false, version: sql`${searchRules.version} + 1`, updatedAt: new Date() })
        .where(and(eq(searchRules.id, id), eq(searchRules.channelId, ch.id), isNotNull(searchRules.deletedAt)))
        .returning();
      if (!updated.length) throw new HttpError(404, "복구할 검색어가 없습니다.");
      await audit(db, { actor: actorOf(req), action: "restore", entity: "search_rule", entityId: id, channelId: ch.id });
      res.json(updated[0]);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if ((e as { cause?: { code?: string } }).cause?.code === "23505" || (e as { code?: string }).code === "23505")
        throw new HttpError(409, "같은 검색어가 이미 활성 목록에 있어 복구할 수 없습니다.");
      throw e;
    }
  }),
);

/* ───────────── 시험 검색: 버튼을 눌렀을 때만, 1검색어·1endpoint·5건 ───────────── */
ruleRoutes.post(
  "/channels/:cid/trial-search",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(
      z.object({ query: z.string().min(1).max(100), endpoint: z.enum(["news", "blog"]), excludeTerms: z.array(z.string()).max(30).optional(), excludeScope: z.enum(["title", "title_and_snippet"]).optional() }),
      req.body,
    );
    try {
      const session = createNewsSearch();
      const counter = { naver: 0, rss: 0, limit: 2 };
      const items = await session.search(cleanQuery(body.query), body.endpoint, 5, counter);
      await audit(getDb(), { actor: actorOf(req), action: "trial_search", entity: "channel", entityId: ch.id, channelId: ch.id, detail: { query: body.query, endpoint: body.endpoint, results: items.length } });
      res.json({
        items: items.slice(0, 5).map((it) => ({
          ...it,
          excludedReason: applyExcludeTerms(it, body.excludeTerms ?? [], body.excludeScope ?? "title"),
        })),
        calls: counter.naver + session.counts.rssRequests,
        warnings: session.warnings.map(w => w.message),
      });
    } catch (e) {
      if (e instanceof NaverError) throw new HttpError(e.kind === "not_configured" ? 503 : 502, e.message, { kind: e.kind });
      throw e;
    }
  }),
);

/** 시험 검색 결과 중 선택한 자료만 수집함에 저장 */
ruleRoutes.post(
  "/channels/:cid/trial-search/save",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(
      z.object({
        categoryHint: z.string().max(40).nullable().optional(),
        items: z
          .array(
            z.object({
              endpoint: z.enum(["news", "blog"]),
              title: z.string().max(500),
              description: z.string().max(2000),
              link: z.string().url(),
              originallink: z.string().url().optional().nullable(),
              provider: z.enum(["google_news_rss", "rss_direct"]).optional(),
              publisher: z.string().max(200).optional(),
              publisherUrl: z.string().max(2000).optional(),
              feedUrl: z.string().max(4000).optional(),
              published: z.object({ raw: z.string().nullable(), iso: z.string().nullable(), precision: z.enum(["datetime", "date", "unknown"]) }),
            }),
          )
          .min(1)
          .max(5),
      }),
      req.body,
    );
    const db = getDb();
    let created = 0, dup = 0;
    for (const it of body.items) {
      const identity = it.endpoint === "news" && it.originallink ? it.originallink : it.link;
      const normalized = normalizeUrl(identity);
      await db
        .insert(sourceDocuments)
        .values({
          normalizedUrl: normalized,
          originalUrl: identity,
          kind: it.provider ?? (it.endpoint === "news" ? "naver_news" : "naver_blog"),
          title: it.title,
          snippet: it.description,
          meta: { naverLink: it.provider ? null : it.link, publisher: it.publisher ?? null, publisherUrl: it.publisherUrl ?? null, feedUrl: it.feedUrl ?? null, originallink: it.originallink ?? null, fetchUrl: it.endpoint === "news" && /n\.news\.naver\.com/.test(it.link) ? it.link : identity, via: "trial_search" },
          publishedRaw: it.published.raw,
          publishedAt: it.published.iso ? new Date(it.published.iso) : null,
          publishedPrecision: it.published.precision,
        })
        .onConflictDoNothing();
      const [doc] = await db.select().from(sourceDocuments).where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
      const ins = await db
        .insert(contentItems)
        .values({ channelId: ch.id, kind: ch.contentType, origin: "collected", primarySourceId: doc.id, title: it.title, category: body.categoryHint ?? null, scheduleStatus: ch.contentType === "notice" ? "unknown" : "not_applicable" })
        .onConflictDoNothing()
        .returning({ id: contentItems.id });
      if (ins.length) created++;
      else dup++;
    }
    await audit(db, { actor: actorOf(req), action: "trial_save", entity: "channel", entityId: ch.id, channelId: ch.id, detail: { created, dup } });
    res.status(201).json({ created, duplicates: dup });
  }),
);

/* 자동 화제 발굴 설정(과학·시사 채널) — 예산 jsonb 안에 저장 */
const discoveryBody = z.object({
  enabled: z.boolean(),
  queries: z.array(z.string().max(40)).max(8),
  picksPerRun: z.number().int().min(0).max(10),
  autoDraft: z.boolean(),
});
ruleRoutes.put(
  "/channels/:cid/discovery",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    if (!resolveDiscovery(ch.contentType, null)) throw new HttpError(400, "자동 화제 발굴은 과학·시사 채널에서만 씁니다.");
    const b = parse(discoveryBody, req.body);
    const seen = new Set<string>();
    const queries = b.queries.map(cleanQuery).filter((q) => q && !seen.has(normalizeQuery(q)) && seen.add(normalizeQuery(q)));
    if (b.enabled && !queries.length) throw new HttpError(400, "탐색 주제를 1개 이상 넣으세요.");
    const discovery = { ...b, queries };
    const db = getDb();
    await db
      .update(channels)
      .set({ budget: { ...ch.budget, discovery }, version: sql`${channels.version} + 1`, updatedAt: new Date() })
      .where(eq(channels.id, ch.id));
    await audit(db, { actor: actorOf(req), action: "update_discovery", entity: "channel", entityId: ch.id, channelId: ch.id, detail: discovery });
    res.json({ discovery: resolveDiscovery(ch.contentType, discovery) });
  }),
);

