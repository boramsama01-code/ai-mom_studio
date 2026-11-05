/**
 * 카드 템플릿 · Canva 연동 · 글자 내보내기(대량 제작 CSV, 망고보드 복사용)
 */
import crypto from "node:crypto";
import express, { Router } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import sharp from "sharp";
import { getDb } from "../db";
import { cardTemplates, channels, contentItems, contentRevisions, mediaAssets } from "../../shared/schema";
import { ah, HttpError, intParam, loadChannel, parse } from "./util";
import { actorOf } from "../auth";
import { audit } from "../audit";
import { env } from "../env";
import { clearPreviewCache, listTemplates, renderPreview, resolveStyle, TemplateNotFound, TemplatePreviewPageError } from "../services/templates";
import { normalizeBackground, CARD_W, CARD_H } from "../services/card";
import { cardFields, csvCell, CARD_FIELD_KEYS } from "../../shared/cardFields";
import { sourceOrgFor } from "../worker/publish";
import { kstToday } from "../services/dates";
import { safeFetch } from "../services/safeFetch";
import { sha256 } from "../services/text";
import { invalidateCanvaLibraryConnection } from "../services/canvaTemplateLibrary";
import { kickCanvaLibrary } from "../worker/canvaLibrary";
import {
  autofillFromBrandTemplate,
  brandTemplateDataset,
  buildAuthUrl,
  CANVA_SCOPES,
  CanvaError,
  canvaConfigured,
  canvaConnected,
  disconnectCanva,
  exchangeCode,
  exportDesignPng,
  listBrandTemplates,
  pkcePair,
} from "../services/canva";

declare module "express-session" {
  interface SessionData {
    canvaOauth?: { state: string; verifier: string };
  }
}

export const templateRoutes = Router();

/* ───────────── 템플릿 ───────────── */
templateRoutes.get(
  "/channels/:cid/templates",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    res.json({ items: await listTemplates(getDb(), ch.id), current: ch.cardTemplate });
  }),
);

templateRoutes.get(
  "/channels/:cid/templates/preview",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const key = String(req.query.key ?? "");
    const page = parse(z.coerce.number().int().min(0).max(7).default(0), req.query.page);
    try {
      const jpg = await renderPreview(getDb(), key, ch, page);
      const thumb = req.query.size === "sm" ? await sharp(jpg).resize(360, 450).jpeg({ quality: 82 }).toBuffer() : jpg;
      res.setHeader("content-type", "image/jpeg");
      res.setHeader("cache-control", "private, max-age=300");
      res.send(thumb);
    } catch (e) {
      if (e instanceof TemplateNotFound) throw new HttpError(404, e.message);
      if (e instanceof TemplatePreviewPageError) throw new HttpError(400, e.message);
      throw new HttpError(422, `미리보기를 만들 수 없습니다: ${(e as Error).message}`);
    }
  }),
);

/** 배경 이미지 업로드(요청 본문 = 이미지 파일 그대로) */
templateRoutes.post(
  "/channels/:cid/templates",
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "12mb" }),
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, "PNG·JPG·WEBP 이미지 파일을 올려 주세요.");
    const q = parse(
      z.object({
        name: z.string().trim().min(1).max(40),
        layout: z.enum(["classic", "magazine", "minimal"]).default("classic"),
        tone: z.enum(["dark", "light"]).default("dark"),
        overlay: z.coerce.number().int().min(0).max(80).default(0),
        allChannels: z.enum(["0", "1"]).default("0"),
      }),
      req.query,
    );
    let bg: Buffer;
    try {
      bg = await normalizeBackground(req.body);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const db = getDb();
    const [t] = await db
      .insert(cardTemplates)
      .values({ channelId: q.allChannels === "1" ? null : ch.id, name: q.name, layout: q.layout, textTone: q.tone, overlay: q.overlay, background: bg, createdBy: actorOf(req) })
      .returning({ id: cardTemplates.id });
    await audit(db, { actor: actorOf(req), action: "create", entity: "card_template", entityId: t.id, channelId: ch.id, detail: { name: q.name } });
    res.status(201).json({ key: `custom:${t.id}` });
  }),
);

templateRoutes.patch(
  "/channels/:cid/templates/:id",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), layout: z.enum(["classic", "magazine", "minimal"]).optional(), textTone: z.enum(["dark", "light"]).optional(), overlay: z.number().int().min(0).max(80).optional() }), req.body);
    const db = getDb();
    const upd = await db
      .update(cardTemplates)
      .set(body)
      .where(and(eq(cardTemplates.id, id), isNull(cardTemplates.deletedAt), sql`(${cardTemplates.channelId} is null or ${cardTemplates.channelId} = ${ch.id})`))
      .returning({ id: cardTemplates.id });
    if (!upd.length) throw new HttpError(404, "템플릿을 찾을 수 없습니다.");
    clearPreviewCache();
    await audit(db, { actor: actorOf(req), action: "update", entity: "card_template", entityId: id, channelId: ch.id, detail: body });
    res.json({ ok: true });
  }),
);

templateRoutes.post(
  "/channels/:cid/templates/:id/delete",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const id = intParam(req.params.id);
    const db = getDb();
    const upd = await db
      .update(cardTemplates)
      .set({ deletedAt: new Date() })
      .where(and(eq(cardTemplates.id, id), isNull(cardTemplates.deletedAt), sql`(${cardTemplates.channelId} is null or ${cardTemplates.channelId} = ${ch.id})`))
      .returning({ id: cardTemplates.id });
    if (!upd.length) throw new HttpError(404, "템플릿을 찾을 수 없습니다.");
    // 이 템플릿을 기본으로 쓰던 채널은 기본 레이아웃으로
    await db.update(channels).set({ cardTemplate: "builtin:classic" }).where(eq(channels.cardTemplate, `custom:${id}`));
    clearPreviewCache();
    await audit(db, { actor: actorOf(req), action: "delete", entity: "card_template", entityId: id, channelId: ch.id });
    res.json({ ok: true });
  }),
);

/** 채널 기본 템플릿·Canva 브랜드 템플릿 지정 */
templateRoutes.put(
  "/channels/:cid/design",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(z.object({ cardTemplate: z.string().max(40).optional(), canvaBrandTemplateId: z.string().trim().max(100).nullable().optional() }), req.body);
    const db = getDb();
    if (body.cardTemplate) {
      try {
        await resolveStyle(db, body.cardTemplate, ch.id);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    await db
      .update(channels)
      .set({ ...(body.cardTemplate ? { cardTemplate: body.cardTemplate } : {}), ...(body.canvaBrandTemplateId !== undefined ? { canvaBrandTemplateId: body.canvaBrandTemplateId || null } : {}), updatedAt: new Date() })
      .where(eq(channels.id, ch.id));
    await audit(db, { actor: actorOf(req), action: "update_design", entity: "channel", entityId: ch.id, channelId: ch.id, detail: body });
    res.json({ ok: true });
  }),
);

/* ───────────── 글자 필드 (복사·CSV) ───────────── */
async function itemFields(ch: typeof channels.$inferSelect, itemId: number) {
  const db = getDb();
  const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, itemId), eq(contentItems.channelId, ch.id)));
  if (!item) throw new HttpError(404, "항목을 찾을 수 없습니다.");
  if (!item.currentRevisionId) throw new HttpError(400, "초안이 없습니다.");
  const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId));
  const payload = rev.payload as Record<string, unknown>;
  return { item, rev, fields: cardFields(item.kind, payload, { sourceOrg: await sourceOrgFor(db, item, payload), checkedDate: kstToday(), channelName: ch.name }) };
}

templateRoutes.get(
  "/channels/:cid/items/:id/fields",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const { fields } = await itemFields(ch, intParam(req.params.id));
    res.json({ fields });
  }),
);

/** Canva '대량 제작'용 CSV — 엑셀에서도 한글이 깨지지 않도록 BOM 포함 */
templateRoutes.get(
  "/channels/:cid/export/fields.csv",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 300);
    const db = getDb();
    const rows = ids.length
      ? await db.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.channelId, ch.id), inArray(contentItems.id, ids)))
      : await db.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.channelId, ch.id), eq(contentItems.reviewStatus, "reviewed"), eq(contentItems.excluded, false), sql`${contentItems.currentRevisionId} is not null`)).limit(300);
    const keys = CARD_FIELD_KEYS[ch.contentType] ?? CARD_FIELD_KEYS.notice;
    const lines = [keys.map((k) => k.key).join(",")];
    for (const r of rows) {
      const { fields } = await itemFields(ch, r.id);
      lines.push(fields.map((f) => csvCell(f.value)).join(","));
    }
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="spacepenguin-${ch.slug}-fields.csv"`);
    res.send("﻿" + lines.join("\r\n") + "\r\n");
  }),
);

/* ───────────── Canva ───────────── */
function redirectUri() {
  return `${env.baseUrl}/api/canva/callback`;
}

templateRoutes.get(
  "/canva/status",
  ah(async (_req, res) => {
    res.json({ configured: canvaConfigured(), connected: canvaConnected(), redirectUri: redirectUri(), scopes: CANVA_SCOPES });
  }),
);

templateRoutes.get(
  "/canva/connect",
  ah(async (req, res) => {
    if (!canvaConfigured()) throw new HttpError(400, "먼저 Canva Client ID와 Client secret을 저장하세요.");
    const { verifier, challenge } = pkcePair();
    const state = crypto.randomBytes(16).toString("hex");
    req.session.canvaOauth = { state, verifier };
    req.session.save(() => res.redirect(buildAuthUrl({ challenge, state, redirectUri: redirectUri() })));
  }),
);

templateRoutes.get(
  "/canva/callback",
  ah(async (req, res) => {
    const saved = req.session.canvaOauth;
    const back = (q: string) => res.redirect(`/settings?canva=${q}`);
    if (req.query.error) return back(`error&reason=${encodeURIComponent(String(req.query.error))}`);
    if (!saved || !req.query.state || req.query.state !== saved.state || !req.query.code) return back("error&reason=state");
    delete req.session.canvaOauth;
    try {
      await exchangeCode(getDb(), { code: String(req.query.code), verifier: saved.verifier, redirectUri: redirectUri() });
    } catch (e) {
      return back(`error&reason=${encodeURIComponent((e as Error).message.slice(0, 120))}`);
    }
    await audit(getDb(), { actor: actorOf(req), action: "canva_connect", entity: "canva" });
    await invalidateCanvaLibraryConnection(getDb());kickCanvaLibrary(getDb());
    back("connected");
  }),
);

templateRoutes.post(
  "/canva/disconnect",
  ah(async (req, res) => {
    await disconnectCanva(getDb());
    await invalidateCanvaLibraryConnection(getDb());
    await audit(getDb(), { actor: actorOf(req), action: "canva_disconnect", entity: "canva" });
    res.json({ ok: true });
  }),
);

function canvaHttp(e: unknown): never {
  if (e instanceof CanvaError) throw new HttpError(e.status === 401 ? 401 : 502, e.message);
  throw e;
}

templateRoutes.get(
  "/canva/brand-templates",
  ah(async (_req, res) => {
    try {
      res.json({ items: await listBrandTemplates(getDb()) });
    } catch (e) {
      canvaHttp(e);
    }
  }),
);

templateRoutes.get(
  "/canva/brand-templates/:id/dataset",
  ah(async (req, res) => {
    try {
      res.json({ dataset: await brandTemplateDataset(getDb(), String(req.params.id)) });
    } catch (e) {
      canvaHttp(e);
    }
  }),
);

/** Canva에 글자 채워 새 디자인 만들기 */
templateRoutes.post(
  "/channels/:cid/items/:id/canva",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const body = parse(z.object({ brandTemplateId: z.string().trim().min(1).max(100).optional() }), req.body ?? {});
    const templateId = body.brandTemplateId || ch.canvaBrandTemplateId;
    if (!templateId) throw new HttpError(400, "채널 설정 → 카드 디자인에서 Canva 브랜드 템플릿을 먼저 고르세요.");
    const { item, rev, fields } = await itemFields(ch, intParam(req.params.id));
    if ((rev.payload.cardCopy as { version?: number } | undefined)?.version === 2) throw new HttpError(409, "8장 Canva 원고는 편집기의 새 디자인 만들기를 이용해 주세요.");
    let r;
    try {
      r = await autofillFromBrandTemplate(getDb(), { brandTemplateId: templateId, title: `[우주펭귄상회] ${item.title}`, fields: Object.fromEntries(fields.map((f) => [f.key, f.value])) });
    } catch (e) {
      canvaHttp(e);
    }
    const design = { designId: r.designId, editUrl: r.editUrl, viewUrl: r.viewUrl, revisionId: rev.id, createdAt: new Date().toISOString() };
    await getDb().update(contentItems).set({ canvaDesign: design }).where(eq(contentItems.id, item.id));
    await audit(getDb(), { actor: actorOf(req), action: "canva_autofill", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { designId: r.designId, usedFields: r.usedFields } });
    res.json({ ...design, usedFields: r.usedFields, unusedTemplateFields: r.unusedTemplateFields });
  }),
);

/** Canva에서 다듬은 디자인을 카드 이미지로 가져오기(현재 버전에 연결) */
templateRoutes.post(
  "/channels/:cid/items/:id/canva/import",
  ah(async (req, res) => {
    const ch = await loadChannel(req.params.cid);
    const { item, rev } = await itemFields(ch, intParam(req.params.id));
    if ((rev.payload.cardCopy as { version?: number } | undefined)?.version === 2) throw new HttpError(409, "8장 Canva 원고는 최신 디자인 가져오기로 8장을 함께 가져와 주세요.");
    const d = item.canvaDesign;
    if (!d) throw new HttpError(400, "먼저 'Canva로 디자인 만들기'를 실행하세요.");
    if (d.revisionId !== rev.id) throw new HttpError(409, "Canva 디자인이 이전 버전 내용으로 만들어졌습니다. 내용이 바뀌었으니 Canva 디자인을 다시 만드세요.");
    let url: string;
    try {
      url = await exportDesignPng(getDb(), d.designId);
    } catch (e) {
      canvaHttp(e);
    }
    let png: Buffer;
    try {
      png = (await safeFetch(url, { maxBytes: 25 * 1024 * 1024, accept: "image/png,image/*" })).body;
    } catch (e) {
      throw new HttpError(502, `Canva 이미지 내려받기 실패: ${(e as Error).message}`);
    }
    const meta = await sharp(png).metadata();
    const ratio = (meta.width ?? 1) / (meta.height ?? 1);
    const jpeg = await sharp(png).resize(CARD_W, CARD_H, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
    const hash = sha256(jpeg);
    const db = getDb();
    await db
      .insert(mediaAssets)
      .values({ channelId: ch.id, contentItemId: item.id, revisionId: rev.id, sha256: hash, width: CARD_W, height: CARD_H, bytes: jpeg, source: "canva", templateKey: `canva:${d.designId}` })
      .onConflictDoNothing();
    const [asset] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.revisionId, rev.id), eq(mediaAssets.sha256, hash)));
    await audit(db, { actor: actorOf(req), action: "canva_import", entity: "content_item", entityId: item.id, channelId: ch.id, detail: { designId: d.designId, assetId: asset.id } });
    res.json({ assetId: asset.id, aspectWarning: Math.abs(ratio - CARD_W / CARD_H) > 0.02 ? "Canva 디자인 비율이 4:5가 아니어서 여백을 넣어 맞췄습니다. 1080×1350 크기로 디자인하면 여백이 생기지 않습니다." : null });
  }),
);


