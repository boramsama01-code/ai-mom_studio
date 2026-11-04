import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { contentItems, jobs } from "../../shared/schema";
import { getDb } from "../db";
import { actorOf } from "../auth";
import { ah, HttpError, intParam, loadChannel, parse, zVersion } from "./util";
import { CARD_PAGE_UPLOAD_MAX_DATA_URL, cardPageArtworkCredit, createCardPageArtwork, loadCardPageArtworkAsset, type CardPageId } from "../services/cardPageArtwork";
import { cardPageArtworkIdSchema } from "../../shared/cardPageArtworkId";

export const cardPageArtworkRoutes = Router();

const backgroundRequest = z.object({
  version: zVersion,
  requestId: z.string().uuid(),
  pageId: cardPageArtworkIdSchema,
  mode: z.enum(["ai", "upload"]),
  instruction: z.string().trim().max(2000).optional(),
  imageData: z.string().min(1).max(CARD_PAGE_UPLOAD_MAX_DATA_URL).optional(),
}).strict().refine(value => value.mode === "upload" ? !!value.imageData : value.imageData === undefined,
  { path: ["imageData"], message: "파일 업로드에는 이미지 데이터가 필요하며, AI 요청에는 이미지 데이터를 직접 보내지 마세요." })
  .refine(value => value.mode === "ai" || !value.instruction, { path: ["instruction"], message: "그림 지시는 AI 이미지 생성에서만 사용할 수 있습니다." });

async function scope(cid: unknown, id: unknown) {
  const channel = await loadChannel(cid);
  const itemId = intParam(id);
  const [item] = await getDb().select({ id: contentItems.id }).from(contentItems)
    .where(and(eq(contentItems.id, itemId), eq(contentItems.channelId, channel.id)));
  if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
  return { channelId: channel.id, itemId };
}

cardPageArtworkRoutes.post("/channels/:cid/items/:id/card-copy/background", ah(async (req, res) => {
  const target = await scope(req.params.cid, req.params.id);
  const body = parse(backgroundRequest, req.body);
  const result = await createCardPageArtwork(getDb(), { ...target, ...body, pageId: body.pageId as CardPageId, actor: actorOf(req) });
  res.set("Cache-Control", "no-store").json(result);
}));

const storedBackgroundResponse = z.object({
  assetId: z.number().int().positive(),
  version: zVersion,
  pageId: cardPageArtworkIdSchema,
  source: z.enum(["ai", "upload"]),
});

/** Recover a lost upload/AI response using request metadata only, without retaining or resending image data. */
cardPageArtworkRoutes.get("/channels/:cid/items/:id/card-copy/background-requests/:requestId", ah(async (req, res) => {
  const target = await scope(req.params.cid, req.params.id);
  const requestId = parse(z.string().uuid(), req.params.requestId);
  const [job] = await getDb().select().from(jobs).where(and(
    eq(jobs.channelId, target.channelId), eq(jobs.type, "card_render"),
    eq(jobs.dedupeKey, `source-ai:${target.itemId}:${requestId}`),
  )).limit(1);
  if (!job || job.payload.pageBackground !== true || job.payload.itemId !== target.itemId) throw new HttpError(404, "이 페이지 배경 요청의 기록을 찾을 수 없습니다. 업로드가 도착하지 않았을 수 있습니다. 파일과 원고를 확인한 뒤 직접 다시 요청해 주세요.");
  res.set("Cache-Control", "private, no-store");
  if (job.status === "succeeded") {
    const saved = storedBackgroundResponse.safeParse(job.result?.response);
    if (saved.success) return res.json({ status: "succeeded", response: { ...saved.data, credit: cardPageArtworkCredit(saved.data.source), jobId: job.id } });
    return res.json({ status: "failed", error: "요청의 저장 결과를 읽을 수 없습니다. 기존 원고와 배경은 유지했습니다. 자동으로 다시 실행하지 않았습니다." });
  }
  if (job.status === "queued" || job.status === "running") return res.json({ status: "running" });
  if (job.status === "cancelled") return res.json({ status: "cancelled", error: "배경 요청을 취소했습니다. 기존 원고와 배경은 유지했습니다. 이미 시작된 외부 요청의 과금 취소는 보장되지 않습니다." });
  // The provider's raw diagnostics, prompts and request payload never leave this read-only recovery endpoint.
  return res.json({ status: "failed", error: "배경 요청을 완료하지 못했습니다. 기존 원고와 배경은 유지했습니다. 자동 재실행하지 않았으며, 최신 작업을 확인한 뒤 직접 다시 요청할 수 있습니다." });
}));

cardPageArtworkRoutes.get("/channels/:cid/items/:id/card-copy/background/:assetId", ah(async (req, res) => {
  const target = await scope(req.params.cid, req.params.id);
  const asset = await loadCardPageArtworkAsset(getDb(), target.itemId, target.channelId, intParam(req.params.assetId, "assetId"));
  res.set("Cache-Control", "private, no-store").type("image/jpeg").send(asset.bytes);
}));
