import { Router, raw } from "express";
import { z } from "zod";
import { getDb } from "../db";
import { actorOf } from "../auth";
import { studioContentSchema } from "../../shared/studio";
import { ZIP_MAX_BYTES } from "../../shared/zipImport";
import { importCardNewsZip } from "../services/zipImport";
import { importedCard, suggestImportedCaption } from "../services/importedCarousel";
import { studioAiStatus } from "../services/studioAi";
import { AiServiceError } from "../services/llm";
import { zipFiles } from "../services/zip";
import { ah, HttpError, intParam, parse } from "./util";

export const zipImportRoutes = Router();
zipImportRoutes.get("/studio/ai-status", ah(async (_req, res) => { res.json(studioAiStatus()); }));
zipImportRoutes.post("/studio/import-zip", raw({ type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"], limit: ZIP_MAX_BYTES }), ah(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "ZIP 파일을 선택해 주세요.");
  const channel = parse(studioContentSchema.shape.channel, req.query.channel);
  res.status(201).json(await importCardNewsZip(getDb(), req.body, channel, actorOf(req)));
}));
zipImportRoutes.post("/studio/cards/:id/imported-ai", ah(async (req, res) => {
  const body = parse(z.object({ version: z.number().int().positive(), provider: z.enum(["openai", "gemini", "anthropic"]).optional(), mode: z.enum(["all", "alt"]).default("all"), instruction: z.string().trim().max(2000).default("기존 초안을 존중하면서 자연스럽게 다듬고, 이미지별 대체텍스트를 작성해 줘.") }).strict(), req.body);
  try { res.json(await suggestImportedCaption(getDb(), intParam(req.params.id), body.version, body.instruction, { provider: body.provider, mode: body.mode })); }
  catch (e) { if (e instanceof AiServiceError) throw new HttpError(502, e.message); throw e; }
}));
zipImportRoutes.get("/studio/cards/:id/original.zip", ah(async (req, res) => {
  const { card, pages } = await importedCard(getDb(), intParam(req.params.id));
  const entries = pages.map((f, i) => ({ name: `page-${String(i + 1).padStart(2, "0")}.${f.mimeType === "image/png" ? "png" : f.mimeType === "image/webp" ? "webp" : "jpg"}`, bytes: f.bytes }));
  entries.push({ name: "caption.txt", bytes: Buffer.from(card.content.caption) });
  res.type("application/zip").set("Content-Disposition", `attachment; filename="original-${card.id}.zip"`).send(zipFiles(entries));
}));
