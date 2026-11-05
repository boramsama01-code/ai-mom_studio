import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { appSettings, channels, destinations, officialSources } from "../../shared/schema";
import { ah, conflict, HttpError, intParam, loadChannel, parse, zVersion } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { fetchBoardList } from "../services/boardAdapter";
import { allowedSecretName, defaultSecretRefs, resolveSecrets, SECRET_FIELDS } from "../services/secrets";

import type { DB } from "../db";
import { CHANNEL_ORDER_KEY, channelIdsSchema, orderedChannels } from "../services/channelOrder";
import { channelCategoriesSchema, channelContentTypes, channelCreateSchema } from "../../shared/channelSettings";
import { assertAvailableChannelSlug, assertCategoryRemovalSafe, newChannelBudget } from "../services/channelSettings";
import { channelAiSettingsSchema, defaultChannelRoleSettings } from "../../shared/channelAi";
import { withChannelAiSettings } from "../services/channelAi";

export const channelRoutes = Router();

channelRoutes.get(
  "/channels",
  ah(async (_req, res) => {
    res.json((await orderedChannels(getDb())).map(withChannelAiSettings));
  }),
);

channelRoutes.put("/channels/order", ah(async (req, res) => {
  const body = parse(z.object({ ids: channelIdsSchema, previousIds: channelIdsSchema }).strict(), req.body);
  const result = await getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193203)`);
    const current = await orderedChannels(tx as unknown as DB);
    const currentIds = current.map(c => c.id);
    if (JSON.stringify(currentIds) !== JSON.stringify(body.previousIds)) {
      throw new HttpError(409, "다른 곳에서 채널 목록이 변경됐습니다. 목록을 새로 불러온 뒤 다시 정렬해 주세요.", { current });
    }
    if (new Set(body.ids).size !== body.ids.length || body.ids.length !== currentIds.length || body.ids.some(id => !currentIds.includes(id))) {
      throw new HttpError(400, "모든 채널을 중복 없이 포함해야 합니다.");
    }
    await tx.insert(appSettings).values({ key: CHANNEL_ORDER_KEY, value: body.ids })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: body.ids, updatedAt: new Date() } });
    await audit(tx, { actor: actorOf(req), action: "reorder", entity: "channel", detail: { ids: body.ids } });
    const byId = new Map(current.map(ch => [ch.id, ch]));
    return body.ids.map(id => byId.get(id)!);
  });
  res.json(result.map(withChannelAiSettings));
}));

const budgetSchema = z.object({
  naverCallsPerRun: z.number().int().min(0).max(100),
  resultsPerRun: z.number().int().min(0).max(500),
  fetchTargetsPerRun: z.number().int().min(0).max(100),
  fetchCallsPerRun: z.number().int().min(0).max(200),
  llmCallsPerRun: z.number().int().min(0).max(100),
  dailyPublishLimit: z.number().int().min(0).max(25),
  llmInputTokenPriceUsdPerM: z.number().min(0).max(1000).nullable().optional(),
  llmOutputTokenPriceUsdPerM: z.number().min(0).max(1000).nullable().optional(),
  discovery: z
    .object({
      enabled: z.boolean(),
      queries: z.array(z.string().trim().min(1).max(40)).max(8),
      picksPerRun: z.number().int().min(0).max(10),
      autoDraft: z.boolean(),
    })
    .partial()
    .optional(),
});

const channelPatch = z.object({
  version: zVersion,
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  audience: z.string().trim().min(1).max(60).optional(),
  contentType: z.enum(channelContentTypes).optional(),
  categories: channelCategoriesSchema.optional(),
  aiSettings: channelAiSettingsSchema.nullable().optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  active: z.boolean().optional(),
  editorialGuide: z.string().max(4000).optional(),
  budget: budgetSchema.optional(),
}).strict();

channelRoutes.post("/channels", ah(async (req, res) => {
  const body = parse(channelCreateSchema, req.body);
  const created = await getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193203)`);
    const slug = body.slug ?? `channel-${randomUUID()}`;
    await assertAvailableChannelSlug(tx as unknown as DB, slug);
    const [ch] = await tx.insert(channels).values({ ...body, slug, aiSettings: body.aiSettings ?? defaultChannelRoleSettings(),
      budget: newChannelBudget(body.contentType),
    }).returning();
    await audit(tx, { actor: actorOf(req), action: "create", entity: "channel", entityId: ch.id, channelId: ch.id });
    return ch;
  });
  res.status(201).json(withChannelAiSettings(created));
}));

channelRoutes.patch(
  "/channels/:cid",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    if (ch.id !== intParam(req.params.cid)) throw new HttpError(409, "알리고당으로 통합된 채널입니다. 통합 채널에서 설정을 변경해 주세요.");
    const body = parse(channelPatch, req.body);
    const { version, ...patch } = body;
    const db = getDb();
    const updated = await db.transaction(async tx => {
      const [fresh] = await tx.select().from(channels).where(eq(channels.id, ch.id)).for("update");
      if (fresh.version !== version) conflict(fresh);
      if (patch.categories !== undefined) await assertCategoryRemovalSafe(tx as unknown as DB, fresh, patch.categories);
      // contentType is only the default for future items; existing kinds,
      // revisions, destination bindings and publication evidence remain intact.
      const [saved] = await tx.update(channels).set({ ...patch, version: fresh.version + 1, updatedAt: new Date() }).where(eq(channels.id, ch.id)).returning();
      await audit(tx, { actor: actorOf(req), action: "update", entity: "channel", entityId: ch.id, channelId: ch.id, detail: { fields: Object.keys(patch) } });
      return saved;
    });
    res.json(withChannelAiSettings(updated));
  }),
);

/* ───────────── 공식 출처 ───────────── */
channelRoutes.get(
  "/channels/:cid/official-sources",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    res.json(await getDb().select().from(officialSources).where(eq(officialSources.channelId, ch.id)).orderBy(asc(officialSources.schoolType), asc(officialSources.name)));
  }),
);

const officialPatch = z.object({
  version: zVersion,
  aliases: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).nullable().optional(),
  boardUrl: z.string().url().startsWith("https://").nullable().optional(),
  verified: z.boolean().optional(),
  verificationNote: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  adapter: z.enum(["generic_board"]).nullable().optional(),
  adapterConfig: z
    .object({
      linkSelector: z.string().trim().min(1).max(200),
      titleSelector: z.string().trim().max(200).nullable().optional(),
      dateSelector: z.string().trim().max(200).nullable().optional(),
      maxItems: z.number().int().min(1).max(30).optional(),
      format: z.enum(["links", "ged_selection"]).optional(),
    })
    .optional(),
});

channelRoutes.patch(
  "/channels/:cid/official-sources/:id",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const body = parse(officialPatch, req.body);
    const db = getDb();
    const [cur] = await db.select().from(officialSources).where(and(eq(officialSources.id, id), eq(officialSources.channelId, ch.id)));
    if (!cur) throw new HttpError(404, "공식 출처를 찾을 수 없습니다.");
    const domain = body.domain !== undefined ? body.domain : cur.domain;
    const boardUrl = body.boardUrl !== undefined ? body.boardUrl : cur.boardUrl;
    if (boardUrl && domain && !new URL(boardUrl).hostname.toLowerCase().endsWith(domain))
      throw new HttpError(400, "게시판 URL이 확인한 도메인과 다릅니다.");
    if (body.adapter === "generic_board" && !(body.adapterConfig ?? (cur.adapterConfig as { linkSelector?: string })).linkSelector)
      throw new HttpError(400, "게시판 수집기에는 목록 링크 선택자가 필요합니다.");
    const { version, verified, ...rest } = body;
    const updated = await db
      .update(officialSources)
      .set({
        ...rest,
        ...(verified === undefined ? {} : { verifiedAt: verified ? new Date() : null }),
        version: sql`${officialSources.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(officialSources.id, id), eq(officialSources.version, version)))
      .returning();
    if (!updated.length) conflict(cur);
    await audit(db, { actor: actorOf(req), action: "update", entity: "official_source", entityId: id, channelId: ch.id, detail: body });
    res.json(updated[0]);
  }),
);

/** 게시판 시험 읽기 — 저장하지 않고 목록만 보여줌 */
channelRoutes.post(
  "/channels/:cid/official-sources/:id/test-board",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const [src] = await getDb().select().from(officialSources).where(and(eq(officialSources.id, intParam(req.params.id)), eq(officialSources.channelId, ch.id)));
    if (!src) throw new HttpError(404, "공식 출처를 찾을 수 없습니다.");
    if (!src.domain || !src.boardUrl) throw new HttpError(400, "도메인과 게시판 URL을 먼저 저장하세요.");
    const cfg = src.adapterConfig as { linkSelector?: string };
    if (!cfg.linkSelector) throw new HttpError(400, "목록 링크 선택자를 먼저 저장하세요.");
    const r = await fetchBoardList(src.boardUrl, src.domain, src.adapterConfig as never);
    if (!r.ok) throw new HttpError(502, r.error);
    res.json({ entries: r.entries });
  }),
);

/* ───────────── 게시 목적지 ───────────── */
function destinationView(d: typeof destinations.$inferSelect, slug: string) {
  const sec = resolveSecrets(d.platform, slug, d.secretRefs);
  return { ...d, connection: { missing: sec.missing, invalid: sec.invalid, ready: !sec.missing.length && !sec.invalid.length } };
}

channelRoutes.get(
  "/channels/:cid/destinations",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const rows = await getDb().select().from(destinations).where(eq(destinations.channelId, ch.id)).orderBy(asc(destinations.id));
    res.json({ items: rows.map((d) => destinationView(d, ch.slug)), defaults: { instagram: defaultSecretRefs("instagram", ch.slug), telegram_channel: defaultSecretRefs("telegram_channel", ch.slug) } });
  }),
);

const destCreate = z.object({
  platform: z.enum(["instagram", "telegram_channel"]),
  label: z.string().trim().min(1).max(60),
  secretRefs: z.record(z.string(), z.string().max(80)).optional(),
});

function checkRefs(platform: string, slug: string, refs: Record<string, string>) {
  for (const [f, name] of Object.entries(refs)) {
    if (!SECRET_FIELDS[platform]?.includes(f)) throw new HttpError(400, `알 수 없는 항목: ${f}`);
    if (!allowedSecretName(platform, slug, f, name)) throw new HttpError(400, `허용되지 않은 환경변수 이름: ${name}`);
  }
}

channelRoutes.post(
  "/channels/:cid/destinations",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(destCreate, req.body);
    const refs = body.secretRefs && Object.keys(body.secretRefs).length ? body.secretRefs : defaultSecretRefs(body.platform, ch.slug);
    checkRefs(body.platform, ch.slug, refs);
    const db = getDb();
    const inserted = await db.insert(destinations).values({ channelId: ch.id, platform: body.platform, label: body.label, secretRefs: refs, enabled: false }).onConflictDoNothing().returning();
    if (!inserted.length) throw new HttpError(409, "같은 이름의 목적지가 이미 있습니다.");
    await audit(db, { actor: actorOf(req), action: "create", entity: "destination", entityId: inserted[0].id, channelId: ch.id, detail: { platform: body.platform, label: body.label } });
    res.status(201).json(destinationView(inserted[0], ch.slug));
  }),
);

const destPatch = z.object({ version: zVersion, label: z.string().trim().min(1).max(60).optional(), enabled: z.boolean().optional(), secretRefs: z.record(z.string(), z.string().max(80)).optional() });

channelRoutes.patch(
  "/channels/:cid/destinations/:id",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const body = parse(destPatch, req.body);
    const db = getDb();
    const [cur] = await db.select().from(destinations).where(and(eq(destinations.id, id), eq(destinations.channelId, ch.id)));
    if (!cur) throw new HttpError(404, "목적지를 찾을 수 없습니다.");
    if (body.secretRefs) checkRefs(cur.platform, ch.slug, body.secretRefs);
    const { version, ...patch } = body;
    const updated = await db
      .update(destinations)
      .set({ ...patch, version: sql`${destinations.version} + 1`, updatedAt: new Date() })
      .where(and(eq(destinations.id, id), eq(destinations.version, version)))
      .returning();
    if (!updated.length) conflict(cur);
    await audit(db, { actor: actorOf(req), action: "update", entity: "destination", entityId: id, channelId: ch.id, detail: { fields: Object.keys(patch) } });
    res.json(destinationView(updated[0], ch.slug));
  }),
);


