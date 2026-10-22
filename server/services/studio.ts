import crypto from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { channels, appSettings, contentItems, sourceDocuments, jobs, studioCards, studioImages, studioRequests, studioRevisions } from "../../shared/schema";
import { channelSlug } from "../../shared/channelKeys";
import { studioContentSchema, type StudioContent, type StudioCard, type StudioJob, type StudioRevision } from "../../shared/studio";
import { conflict, HttpError, parse } from "../routes/util";
import { enqueueJob } from "../worker/queue";
import { audit } from "../audit";
import { loadFonts, wrapText } from "./card";
import { getSetting } from "../seed";

export const studioCardDto = (row: typeof studioCards.$inferSelect): StudioCard => ({ ...row.content, id: row.id, version: row.version, sourceItemId: row.sourceItemId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
export const studioRevisionDto = (r: typeof studioRevisions.$inferSelect): StudioRevision => ({ ...r, createdAt: r.createdAt.toISOString() });
export const studioJobDto = (j: typeof jobs.$inferSelect): StudioJob => ({ id: j.id, status: j.status, lastError: j.lastError, result: j.result, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null });

export async function loadStudioCard(db: DB, id: number) {
  const [row] = await db.select().from(studioCards).where(eq(studioCards.id, id));
  if (!row) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
  return row;
}
export async function loadStudioNotes(db: DB): Promise<{ notes: string; notesVersion: number }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "studio_notes"));
  const result = z.object({ notes: z.string(), version: z.number().int().positive() }).safeParse(row?.value);
  return result.success ? { notes: result.data.notes, notesVersion: result.data.version } : { notes: "", notesVersion: 1 };
}
export async function saveStudioNotes(db: DB, version: number, notes: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193201)`);
    const current = await loadStudioNotes(tx as unknown as DB);
    if (current.notesVersion !== version) conflict(current);
    const value = { notes, version: version + 1 };
    await tx.insert(appSettings).values({ key: "studio_notes", value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return { notes, notesVersion: version + 1 };
  });
}
export async function validateStudioImages(db: DB, cardId: number, content: StudioContent) {
  const ids = [...new Set(content.panels.flatMap(p => p.imageId ? [p.imageId] : []))];
  if (!ids.length) return;
  const own = await db.select({ id: studioImages.id }).from(studioImages).where(and(eq(studioImages.cardId, cardId), inArray(studioImages.id, ids)));
  if (own.length !== ids.length) throw new HttpError(400, "이 콘텐츠에 속한 이미지만 사용할 수 있습니다.");
}
async function validateChannel(db: DB, key: string) {
  const [ch] = await db.select({ id: channels.id }).from(channels).where(eq(channels.slug, channelSlug(key)));
  if (!ch) throw new HttpError(400, key === "highway" ? "Highway 기본 채널을 먼저 추가해 주세요." : "채널을 먼저 추가해 주세요.");
}
export async function createStudioCard(db: DB, content: StudioContent, actor: string, sourceItemId?: number) {
  await validateChannel(db, content.channel);
  if (content.panels.some(p => p.imageId)) throw new HttpError(400, "새 콘텐츠에는 기존 이미지 ID를 넣을 수 없습니다.");
  return db.transaction(async tx => {
    if (sourceItemId) {
      const [source] = await tx.select().from(contentItems).where(eq(contentItems.id, sourceItemId));
      if (!source) throw new HttpError(404, "연결할 수집 콘텐츠가 없습니다.");
      const [existing] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, sourceItemId));
      if (existing) return studioCardDto(existing);
      // Copy explicit source material as editable context; never infer a new channel mapping.
      if (!content.memo) {
        const [document] = source.primarySourceId ? await tx.select().from(sourceDocuments).where(eq(sourceDocuments.id, source.primarySourceId)) : [];
        content = { ...content, memo: JSON.stringify({ sourceTitle: source.title, sourceUrl: document?.originalUrl ?? null, facts: source.edited ?? source.extracted ?? {} }, null, 2).slice(0, 12000) };
      }
    }
    const [card] = await tx.insert(studioCards).values({ content, sourceItemId: sourceItemId ?? null }).onConflictDoNothing().returning();
    if (!card && sourceItemId) {
      const [existing] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, sourceItemId));
      if (existing) return studioCardDto(existing);
    }
    if (!card) throw new HttpError(409, "이미 생성된 콘텐츠입니다. 보드를 새로고침하세요.");
    await tx.insert(studioRevisions).values({ cardId: card.id, version: 1, snapshot: content, instruction: sourceItemId ? "수집 콘텐츠에서 가져오기" : "새 콘텐츠" });
    await audit(tx, { actor, action: "create", entity: "studio_card", entityId: card.id });
    return studioCardDto(card);
  });
}
export async function saveStudioCard(db: DB, cardId: number, version: number, patch: Partial<StudioContent>, actor: string, instruction = "직접 수정") {
  return db.transaction(async tx => {
    const current = await loadStudioCard(tx as unknown as DB, cardId);
    const content = parse(studioContentSchema, { ...current.content, ...patch });
    if (patch.channel && patch.channel !== current.content.channel) await validateChannel(tx as unknown as DB, content.channel);
    await validateStudioImages(tx as unknown as DB, cardId, content);
    const [row] = await tx.update(studioCards).set({ content, version: version + 1, updatedAt: new Date() }).where(and(eq(studioCards.id, cardId), eq(studioCards.version, version))).returning();
    if (!row) conflict(studioCardDto(current));
    await tx.insert(studioRevisions).values({ cardId, version: row.version, snapshot: content, instruction });
    await audit(tx, { actor, action: "update", entity: "studio_card", entityId: cardId, detail: { version: row.version } });
    return studioCardDto(row);
  });
}
export async function studioDetail(db: DB, cardId: number) {
  const card = await loadStudioCard(db, cardId);
  const [revisions, cardJobs] = await Promise.all([
    db.select().from(studioRevisions).where(eq(studioRevisions.cardId, cardId)).orderBy(desc(studioRevisions.id)).limit(60),
    db.select().from(jobs).where(and(eq(jobs.type, "studio_generate"), sql`${jobs.payload}->>'cardId' = ${String(cardId)}`)).orderBy(desc(jobs.id)).limit(20),
  ]);
  return { card: studioCardDto(card), revisions: revisions.map(studioRevisionDto), jobs: cardJobs.map(studioJobDto) };
}
export async function queueStudioGeneration(db: DB, cardId: number, input: { version: number; kind: "text" | "image"; provider: "openai" | "anthropic"; instruction: string; panelIndex?: number; requestId: string }, actor: string) {
  if (await getSetting(db, "global_stop", false)) throw new HttpError(409, "전역 정지 상태입니다. 정지를 해제한 뒤 생성하세요.");
  const inputHash = crypto.createHash("sha256").update(JSON.stringify({ cardId, ...input })).digest("hex");
  return db.transaction(async tx => {
    const card = await loadStudioCard(tx as unknown as DB, cardId);
    const reserved = await tx.insert(studioRequests).values({ requestId: input.requestId, cardId, inputHash }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(studioRequests).where(eq(studioRequests.requestId, input.requestId));
      if (existing.cardId !== cardId || existing.inputHash !== inputHash) throw new HttpError(409, "다른 생성 요청에 사용한 요청 ID입니다.");
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, existing.jobId!));
      if (!job) throw new HttpError(409, "생성 요청 처리 중입니다. 잠시 후 상태를 확인하세요.");
      return { job: studioJobDto(job), duplicate: true };
    }
    if (card.version !== input.version) conflict(studioCardDto(card));
    const queued = await enqueueJob(tx as unknown as DB, {
      type: "studio_generate", maxAttempts: 1, dedupeKey: `studio:${cardId}`, requestedBy: actor,
      payload: { cardId, ...input, snapshot: card.content },
    });
    if (queued.duplicate) throw new HttpError(409, "이 콘텐츠를 생성하고 있습니다. 완료 후 다시 요청하세요.", { jobId: queued.job.id });
    await tx.update(studioRequests).set({ jobId: queued.job.id }).where(eq(studioRequests.requestId, input.requestId));
    await audit(tx, { actor, action: "generate", entity: "studio_card", entityId: cardId, detail: { jobId: queued.job.id, kind: input.kind, provider: input.provider } });
    return { job: studioJobDto(queued.job), duplicate: false };
  });
}

const importedCardSchema = z.object({
  id: z.string().min(1).max(200), title: z.string(), channel: z.string(), format: z.string(), stage: z.string(), dueDate: z.string(), memo: z.string(),
  imagePath: z.string().optional(), version: z.number().int().positive().optional(), createdAt: z.string().max(100).optional(), updatedAt: z.string().max(100).optional(),
}).strict();
export const studioImportSchema = z.object({
  exportedAt: z.string().max(100).optional(),
  cards: z.array(importedCardSchema).max(300),
  settings: z.object({ notes: z.string().max(20000), version: z.number().optional(), updatedAt: z.string().optional() }).optional(),
}).strict();
export async function importStudioBoard(db: DB, input: z.infer<typeof studioImportSchema>, actor: string) {
  // Validate every card before entering the transaction so a malformed backup imports nothing.
  const rows = input.cards.map(c => ({ source: c, content: parse(studioContentSchema, { title: c.title, channel: c.channel, format: c.format, stage: c.stage, dueDate: c.dueDate, memo: c.memo, imagePath: c.imagePath ?? "", characters: c.channel === "highway" ? ["pempem"] : c.channel === "news" ? ["pengpeng"] : ["penguin"] }) }));
  for (const key of new Set(rows.map(r => r.content.channel))) await validateChannel(db, key);
  return db.transaction(async tx => {
    let imported = 0;
    for (const { source, content } of rows) {
      const [card] = await tx.insert(studioCards).values({ content, externalId: `sites:${source.id}`, importedMeta: { id: source.id, version: source.version ?? 1, createdAt: source.createdAt ?? null, updatedAt: source.updatedAt ?? null } }).onConflictDoNothing().returning();
      if (!card) continue;
      await tx.insert(studioRevisions).values({ cardId: card.id, version: 1, snapshot: content, instruction: "기존 Studio Board에서 가져오기" });
      imported++;
    }
    let notesImported = false;
    if (input.settings?.notes) {
      await tx.execute(sql`select pg_advisory_xact_lock(7193201)`);
      // An explicitly cleared memo is still an operator edit, not an empty import target.
      const [existingNotes] = await tx.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, "studio_notes"));
      if (!existingNotes) {
        const value = { notes: input.settings.notes, version: 2 };
        await tx.insert(appSettings).values({ key: "studio_notes", value });
        notesImported = true;
      }
    }
    await audit(tx, { actor, action: "import", entity: "studio_board", detail: { imported, skipped: rows.length - imported, notesImported } });
    return { imported, skipped: rows.length - imported, notesImported };
  });
}

/** Same saved images plus editable dialogue, rendered locally without another paid AI call. */
export async function exportStudioComic(db: DB, cardId: number) {
  const card = await loadStudioCard(db, cardId);
  if (card.content.panels.some(p => !p.imageId)) throw new HttpError(400, "네 컷의 그림을 모두 만든 뒤 다운로드하세요.");
  const fonts = loadFonts();
  const titleLines = wrapText(fonts.bold, card.content.title, 30, 1024);
  if (titleLines.length > 2) throw new HttpError(400, "다운로드용 제목이 너무 깁니다. 두 줄 이내로 줄여 주세요.");
  const elements: string[] = [];
  titleLines.forEach((line, i) => elements.push(`<path d="${fonts.bold.getPath(line, 28, 42 + i * 36, 30).toPathData(2)}" fill="#142b36"/>`));
  const overlays: OverlayOptions[] = [];
  for (const [index, panel] of card.content.panels.entries()) {
    const [image] = await db.select().from(studioImages).where(and(eq(studioImages.id, panel.imageId!), eq(studioImages.cardId, cardId)));
    if (!image) throw new HttpError(400, `${index + 1}컷의 그림을 찾을 수 없습니다.`);
    const x = index % 2 === 0 ? 28 : 552;
    const y = index < 2 ? 106 : 720;
    const lines = wrapText(fonts.regular, panel.dialogue, 24, 484);
    if (lines.length > 3) throw new HttpError(400, `${index + 1}컷 대사가 너무 깁니다. 다운로드용 대사를 세 줄 이내로 줄여 주세요.`);
    const png = await sharp(image.bytes, { limitInputPixels: 40_000_000 }).resize(500, 500, { fit: "contain", background: "white" }).png().toBuffer();
    overlays.push({ input: png, left: x, top: y });
    elements.push(`<rect x="${x}" y="${y}" width="500" height="500" rx="10" fill="none" stroke="#d8e0e3" stroke-width="2"/>`);
    lines.forEach((line, i) => elements.push(`<path d="${fonts.regular.getPath(line, x + 8, y + 532 + i * 30, 24).toPathData(2)}" fill="#142b36"/>`));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${elements.join("")}</svg>`;
  overlays.push({ input: new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng(), left: 0, top: 0 });
  const bytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "white" } }).composite(overlays).png().toBuffer();
  return { bytes, version: card.version };
}
