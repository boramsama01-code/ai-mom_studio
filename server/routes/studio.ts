import { channelSlug } from "../../shared/channelKeys";
import { Router, raw } from "express";
import { count, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { actorOf } from "../auth";
import { channels, jobs, studioCards, studioImages, studioRevisions } from "../../shared/schema";
import { studioContentSchema, studioCreateSchema, studioGenerationSchema, studioPatchSchema } from "../../shared/studio";
import { ah, HttpError, intParam, parse } from "./util";
import { setStudioTrash, createStudioCard, importStudioBoard, loadStudioNotes, queueStudioGeneration, saveStudioCard, saveStudioNotes, studioCardDto, studioCardsWithOutput, studioDetail, studioImportSchema, studioJobDto } from "../services/studio";
import { studioAiStatus } from "../services/studioAi";
import { kickInlineStudio } from "../worker/studio";
import { checkStudioExport, exportStudioZip, renderStudioOutput } from "../services/studioExport";
import { importStudioPanelImage } from "../services/studioImageImport";
import { STUDIO_IMAGE_MAX_BYTES, STUDIO_IMAGE_TYPES } from "../../shared/studioImageImport";
import sharp from "sharp";
import { cardDesign } from "../../shared/cardDesigns";
import { renderCollectionPreview } from "../services/cardDesignSamples";

export const studioRoutes = Router();
studioRoutes.use("/studio", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
studioRoutes.get("/studio/cards", ah(async (req, res) => {
  const db = getDb();
  const trash = parse(z.enum(["0", "1"]).default("0"), req.query.trash) === "1";
  const cards = await db.select().from(studioCards).where(trash ? isNotNull(studioCards.trashedAt) : isNull(studioCards.trashedAt)).orderBy(desc(studioCards.updatedAt));
  const [total] = await db.select({ count: count() }).from(studioCards).where(isNotNull(studioCards.trashedAt));
  res.json({ trashCount: total.count, cards: await studioCardsWithOutput(db, cards), ...await loadStudioNotes(db), ai: studioAiStatus() });
}));
studioRoutes.post("/studio/cards", ah(async (req, res) => {
  const { sourceItemId, ...content } = parse(studioCreateSchema, req.body);
  res.status(201).json(await createStudioCard(getDb(), content, actorOf(req), sourceItemId));
}));
studioRoutes.post("/studio/export-check", ah(async (req, res) => {
  res.json(checkStudioExport(parse(studioContentSchema, req.body)));
}));
const designPreviewCache = new Map<string, Buffer>();
studioRoutes.get("/studio/design-preview", ah(async (req, res) => {
  const key = String(req.query.key ?? "");
  if (!key.startsWith("set:") || !cardDesign(key.slice(4))) throw new HttpError(404, "디자인을 찾을 수 없습니다.");
  const page = parse(z.coerce.number().int().min(0).max(4).default(0), req.query.page);
  const small = req.query.size === "sm";
  const channel = req.query.channel === undefined ? undefined : parse(z.string().min(1).max(100), req.query.channel);
  const [selected] = channel ? await getDb().select().from(channels).where(eq(channels.slug, channelSlug(channel))) : [];
  if (channel && !selected) throw new HttpError(404, "채널을 찾을 수 없습니다.");
  const cacheKey = `${key}|${page}|${small}|${selected?.name ?? ""}`;
  let bytes = designPreviewCache.get(cacheKey);
  if (!bytes) {
    const image = await renderCollectionPreview(key.slice(4), page, selected?.name);
    bytes = small ? await sharp(image).resize(360, 450).jpeg({ quality: 85 }).toBuffer() : image;
    if (designPreviewCache.size >= 120) designPreviewCache.clear();
    designPreviewCache.set(cacheKey, bytes);
  }
  res.type("image/jpeg").set("Cache-Control", "private, max-age=300").send(bytes);
}));
studioRoutes.get("/studio/cards/:id", ah(async (req, res) => {
  const db = getDb();
  const detail = await studioDetail(db, intParam(req.params.id));
  // Reopening a saved job also recovers a queue paused by a free-instance restart.
  if (detail.jobs.some(job => job.status === "queued" || job.status === "running")) kickInlineStudio(db);
  res.json(detail);
}));
studioRoutes.get("/studio/cards/:id/export.png", ah(async (req, res) => {
  const id = intParam(req.params.id);
  const version = req.query.version === undefined ? undefined : parse(z.coerce.number().int().positive(), req.query.version);
  const exported = await renderStudioOutput(getDb(), id, version);
  if (exported.content.format === "카드뉴스" && req.query.page === undefined) throw new HttpError(400, "카드뉴스는 ZIP으로 내려받거나 미리보기 페이지를 선택하세요.");
  const page = req.query.page === undefined ? 0 : parse(z.coerce.number().int().min(0).max(5), req.query.page);
  res.type("image/png").set("Content-Disposition", `${req.query.preview === "1" ? "inline" : "attachment"}; filename="studio-${id}-v${exported.version}.png"`).send(await exported.page(page));
}));
studioRoutes.get("/studio/cards/:id/export.zip", ah(async (req, res) => {
  const id = intParam(req.params.id);
  const version = req.query.version === undefined ? undefined : parse(z.coerce.number().int().positive(), req.query.version);
  const output = await exportStudioZip(getDb(), id, version);
  res.type("application/zip").set("Content-Disposition", `attachment; filename="studio-${id}-v${output.version}.zip"`).send(output.bytes);
}));
studioRoutes.patch("/studio/cards/:id", ah(async (req, res) => {
  const { version, ...patch } = parse(studioPatchSchema, req.body);
  res.json(await saveStudioCard(getDb(), intParam(req.params.id), version, patch, actorOf(req)));
}));
for (const action of ["trash", "untrash"] as const) {
  studioRoutes.post(`/studio/cards/:id/${action}`, ah(async (req, res) => {
    const { version } = parse(z.object({ version: z.number().int().positive() }).strict(), req.body);
    res.json(await setStudioTrash(getDb(), intParam(req.params.id), version, action === "trash", actorOf(req)));
  }));
}
studioRoutes.post("/studio/cards/:id/panels/:panelIndex/image", raw({ type: STUDIO_IMAGE_TYPES, limit: STUDIO_IMAGE_MAX_BYTES }), ah(async (req, res) => {
  const id = intParam(req.params.id);
  const panelIndex = parse(z.coerce.number().int().min(0).max(3), req.params.panelIndex);
  const { version } = parse(z.object({ version: z.coerce.number().int().positive() }).strict(), req.query);
  res.status(201).json(await importStudioPanelImage(getDb(), id, panelIndex, version, req.body, actorOf(req)));
}));
studioRoutes.post("/studio/cards/:id/generate", ah(async (req, res) => {
  const input = parse(studioGenerationSchema, req.body);
  const configured = studioAiStatus();
  if (!(input.kind === "image" ? configured.image : configured.text[input.provider])) throw new HttpError(503, `${input.kind === "image" || input.provider === "openai" ? "OpenAI" : "Claude"} 연결을 먼저 설정하세요.`, { code: "ai_not_configured" });
  const result = await queueStudioGeneration(getDb(), intParam(req.params.id), input, actorOf(req));
  kickInlineStudio(getDb());
  res.status(202).json(result);
}));
studioRoutes.post("/studio/cards/:id/restore", ah(async (req, res) => {
  const input = parse(z.object({ version: z.number().int().positive(), revisionId: z.number().int().positive() }).strict(), req.body);
  const id = intParam(req.params.id);
  const [revision] = await getDb().select().from(studioRevisions).where(eq(studioRevisions.id, input.revisionId));
  if (!revision || revision.cardId !== id) throw new HttpError(404, "이 콘텐츠의 기록을 찾을 수 없습니다.");
  res.json(await saveStudioCard(getDb(), id, input.version, revision.snapshot, actorOf(req), `기록 #${revision.id} 적용`));
}));
studioRoutes.get("/studio/jobs/:id", ah(async (req, res) => {
  const [job] = await getDb().select().from(jobs).where(eq(jobs.id, intParam(req.params.id)));
  if (!job || job.type !== "studio_generate") throw new HttpError(404, "생성 요청을 찾을 수 없습니다.");
  if (job.status === "queued" || job.status === "running") kickInlineStudio(getDb());
  res.json(studioJobDto(job));
}));
studioRoutes.get("/studio/images/:id", ah(async (req, res) => {
  const [image] = await getDb().select().from(studioImages).where(eq(studioImages.id, intParam(req.params.id)));
  if (!image) throw new HttpError(404, "이미지를 찾을 수 없습니다.");
  res.type(image.mimeType).set("X-Content-Type-Options", "nosniff").send(image.bytes);
}));
studioRoutes.patch("/studio/notes", ah(async (req, res) => {
  const input = parse(z.object({ notes: z.string().max(20000), version: z.number().int().positive() }).strict(), req.body);
  res.json(await saveStudioNotes(getDb(), input.version, input.notes));
}));
studioRoutes.post("/studio/import", ah(async (req, res) => {
  res.json(await importStudioBoard(getDb(), parse(studioImportSchema, req.body), actorOf(req)));
}));

