import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { contentItems, sourceDocuments, studioCards } from "../../shared/schema";
import { ah, HttpError, loadChannel, parse } from "./util";
import { actorOf } from "../auth";
import { normalizeUrl } from "../services/url";
import { ensureSourceWorkspace } from "../services/sourceWorkspace";
import { createRevision } from "../content";
import { emptyPayload } from "../../shared/payloads";
import { audit } from "../audit";
export const captureRoutes = Router();
captureRoutes.post("/channels/:cid/capture", ah(async (req, res) => {
  const ch = await loadChannel(req.params.cid);
  if (!ch.active) throw new HttpError(409, "보관된 채널은 복원한 뒤 자료를 저장해 주세요.");
  const input = parse(z.object({
    url: z.string().trim().url().max(2000).refine(value => { const u = new URL(value); return ["http:","https:"].includes(u.protocol) && !u.username && !u.password; }, "http 또는 https 링크를 입력해 주세요."),
    title: z.string().trim().max(160).optional(),
  }).strict(), req.body);
  const normalized = normalizeUrl(input.url);
  const result = await getDb().transaction(async tx => {
    // No provider call: capture must be fast, cheap and safe to repeat.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"capture:" + ch.id + ":" + normalized}, 0))`);
    let [source] = await tx.select().from(sourceDocuments).where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
    if (!source) [source] = await tx.insert(sourceDocuments).values({
      normalizedUrl: normalized, originalUrl: input.url, kind: "manual",
      title: input.title || new URL(input.url).hostname, fetchStatus: "not_fetched",
    }).onConflictDoNothing().returning();
    if (!source) [source] = await tx.select().from(sourceDocuments).where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
    if (!source) throw new HttpError(409, "자료 저장 상태를 다시 확인해 주세요.");
    let [item] = await tx.select().from(contentItems).where(and(eq(contentItems.channelId, ch.id), eq(contentItems.primarySourceId, source.id)));
    const duplicate = !!item;
    if (item?.excluded) throw new HttpError(409, "이미 제외 목록에 저장한 링크입니다. 수집함의 제외 목록에서 복원해 주세요.", { itemId: item.id });
    if (!item) [item] = await tx.insert(contentItems).values({
      channelId: ch.id, primarySourceId: source.id, kind: ch.contentType, origin: "manual",
      title: input.title || source.title || new URL(input.url).hostname,
      relevance: "uncertain", evidenceStatus: "needs_review",
      scheduleStatus: ch.contentType === "notice" ? "unknown" : "not_applicable",
    }).returning();
    const [workspace] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
    if (workspace?.trashedAt) throw new HttpError(409, "이 링크의 콘텐츠가 휴지통에 있습니다. 복원한 뒤 이어서 편집해 주세요.", { cardId: workspace.id });
    if (!item.currentRevisionId) await createRevision(tx, {
      contentItemId: item.id, author: "operator", payload: emptyPayload(item.kind, item.title), note: "링크 저장 · 본문 확인 전",
    });
    const studioCardId = await ensureSourceWorkspace(tx, item.id);
    if (!studioCardId) {
      const [saved] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
      if (!saved) throw new HttpError(409, "자료의 작업 공간을 다시 확인해 주세요.");
      return { itemId: item.id, studioCardId: saved.id, duplicate, bodyStatus: source.fetchStatus };
    }
    await audit(tx, { actor: actorOf(req), action: duplicate ? "capture_existing" : "capture", entity: "content_item", entityId: item.id, channelId: ch.id });
    return { itemId: item.id, studioCardId, duplicate, bodyStatus: source.fetchStatus };
  });
  res.status(result.duplicate ? 200 : 201).json(result);
}));
