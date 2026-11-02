import { validSubcategory } from "../../shared/channelCategories";
import { lockStudioPublication, invalidateStudioPublication } from "./studioPublicationState";
import { validateExperienceMedia } from "./experienceMedia";
import { readIdea } from "../../shared/ideaBank";
import { itemPrimarySource } from "./itemSources";
import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { channels, appSettings, approvals, deliveries, mediaAssets, contentItems, sourceDocuments, jobs, studioCards, studioImages, studioRequests, studioRevisions } from "../../shared/schema";
import { channelSlug, normalizeStudioChannel } from "../../shared/channelKeys";
import { studioContentSchema, type StudioGeneration, type StudioContent, type StudioCard, type StudioJob, type StudioRevision } from "../../shared/studio";
import { conflict, HttpError, parse } from "../routes/util";
import { enqueueJob } from "../worker/queue";
import { audit } from "../audit";
import { renderStudioOutput } from "./studioExport";
import { getSetting } from "../seed";

export const studioCardDto = (row: typeof studioCards.$inferSelect): StudioCard => ({ ...studioContentSchema.parse(row.content), id: row.id, version: row.version, sourceItemId: row.sourceItemId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), trashedAt: row.trashedAt?.toISOString() ?? null });
/** Attach immutable source output without copying rendered pages into the four-panel editor. */
export async function studioCardsWithOutput(db: DB, rows: Array<typeof studioCards.$inferSelect>): Promise<StudioCard[]> {
  const itemIds = rows.flatMap(row => row.sourceItemId ? [row.sourceItemId] : []);
  if (!itemIds.length) return rows.map(studioCardDto);
  const outputs = await db.select({ id: mediaAssets.id, channelId: mediaAssets.channelId, itemId: mediaAssets.contentItemId, revisionId: mediaAssets.revisionId, carousel: mediaAssets.carousel, currentRevisionId: contentItems.currentRevisionId })
    .from(mediaAssets).innerJoin(contentItems, eq(contentItems.id, mediaAssets.contentItemId))
    .where(and(inArray(mediaAssets.contentItemId, itemIds), eq(mediaAssets.kind, "card"))).orderBy(desc(mediaAssets.id));
  return rows.map(row => {
    const dto = studioCardDto(row);
    const own = outputs.filter(o => o.itemId === row.sourceItemId);
    const output = own.find(o => o.id === row.importedMeta?.generatedAssetId) ?? own[0];
    if (output) dto.sourceOutput = { assetId: output.id, channelId: output.channelId, itemId: output.itemId, revisionId: output.revisionId, stale: output.revisionId !== output.currentRevisionId || !!(row.importedMeta?.studioPublication && row.importedMeta?.publishedVersion !== row.version),
      pages: output.carousel?.pages.map(p => ({ id: p.id, title: p.title, altText:p.altText })) ?? [{ id: output.id, title: row.content.title }], coverCredit: output.carousel?.cover.credit ?? "" };
    return dto;
  });
}
export const studioRevisionDto = (r: typeof studioRevisions.$inferSelect): StudioRevision => ({ ...r, snapshot: studioContentSchema.parse(r.snapshot), createdAt: r.createdAt.toISOString() });
export const studioJobDto = (j: typeof jobs.$inferSelect): StudioJob => ({ id: j.id, status: j.status, lastError: j.lastError, result: j.result, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null });

export async function loadStudioCard(db: DB, id: number, lock = false) {
  const query = db.select().from(studioCards).where(eq(studioCards.id, id));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
  return row;
}
export function assertStudioActive(card: { trashedAt: Date | null }) {
  if (card.trashedAt) throw new HttpError(409, "휴지통에 있는 콘텐츠입니다. 내 콘텐츠의 휴지통에서 복원한 뒤 작업하세요.");
}

/** Lock source → card → jobs, matching rendering and generation; cancelled work never resumes on restore. */
export async function setStudioTrash(db: DB, cardId: number, version: number, trash: boolean, actor: string) {
  return db.transaction(async tx => {
    const initial = await loadStudioCard(tx as unknown as DB, cardId);
    if (initial.sourceItemId) await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, initial.sourceItemId)).for("update");
    const current = await loadStudioCard(tx as unknown as DB, cardId, true);
    if (current.version !== version) conflict(studioCardDto(current));
    if (!!current.trashedAt === trash) return { card: studioCardDto(current), cancelledJobs: 0, cancelledDeliveries: 0, alreadyProcessing: 0 };
    const now = new Date();
    let cancelledJobs = 0, cancelledDeliveries = 0, alreadyProcessing = 0;
    if (trash) {
      const cancelled = await tx.update(jobs).set({ status: "cancelled", finishedAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: "콘텐츠를 휴지통으로 이동해 취소했습니다." })
        .where(and(eq(jobs.type, "studio_generate"), sql`${jobs.payload}->>'cardId' = ${String(cardId)}`, inArray(jobs.status, ["queued", "running"]))).returning({ id: jobs.id });
      cancelledJobs = cancelled.length;
      if (current.sourceItemId) {
        const active = await tx.update(approvals).set({ status: "cancelled", updatedAt: now }).where(and(eq(approvals.contentItemId, current.sourceItemId), eq(approvals.status, "active"))).returning({ id: approvals.id });
        if (active.length) {
          const ids = active.map(a => a.id);
          const stopped = await tx.update(deliveries).set({ status: "cancelled", lastError: "콘텐츠를 휴지통으로 이동해 취소했습니다.", updatedAt: now }).where(and(inArray(deliveries.approvalId, ids), eq(deliveries.status, "scheduled"))).returning({ id: deliveries.id });
          cancelledDeliveries = stopped.length;
          const sent = await tx.select({ id: deliveries.id }).from(deliveries).where(and(inArray(deliveries.approvalId, ids), inArray(deliveries.status, ["processing", "succeeded", "unknown"])));
          alreadyProcessing = sent.length;
          if (!alreadyProcessing) await tx.update(contentItems).set({ publishStatus: "cancelled" }).where(eq(contentItems.id, current.sourceItemId));
        }
      }
    }
    const [saved] = await tx.update(studioCards).set({ trashedAt: trash ? now : null, version: current.version + 1, updatedAt: now }).where(eq(studioCards.id, cardId)).returning();
    await audit(tx, { actor, action: trash ? "trash" : "untrash", entity: "studio_card", entityId: cardId, detail: { cancelledJobs, cancelledDeliveries, alreadyProcessing } });
    return { card: studioCardDto(saved), cancelledJobs, cancelledDeliveries, alreadyProcessing };
  });
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
function validateStudioMode(content: StudioContent) {
  if (!validSubcategory(content.channel, content.subcategory)) throw new HttpError(400, "이 채널의 소분류를 선택해 주세요.");
  if (content.finishedDeck && (content.experience || content.format !== "카드뉴스")) throw new HttpError(400, "완성 이미지는 카드뉴스 형식으로 사용해 주세요.");
}
export async function validateStudioImages(db: DB, cardId: number, content: StudioContent) {
  validateStudioMode(content);
  const ids = [...new Set([...content.panels.flatMap(p => p.imageId ? [p.imageId] : []), ...(content.finishedDeck?.pages.map(p => p.imageId) ?? [])])];
  if (!ids.length) return;
  const own = await db.select({ id: studioImages.id }).from(studioImages).where(and(eq(studioImages.cardId, cardId), inArray(studioImages.id, ids)));
  if (own.length !== ids.length) throw new HttpError(400, "이 콘텐츠에 속한 이미지만 사용할 수 있습니다.");
}
export async function validateStudioChannel(db: DB, key: string) {
  const [ch] = await db.select({ id: channels.id, active: channels.active }).from(channels).where(eq(channels.slug, channelSlug(key)));
  if (!ch) throw new HttpError(400, normalizeStudioChannel(key) === "highscoop" ? "Highscoop 기본 채널을 먼저 추가해 주세요." : "채널을 먼저 추가해 주세요.");
  if (!ch.active) throw new HttpError(409, "보관된 채널입니다. 채널을 복원한 뒤 새 작업을 시작하세요.");
}
export async function createStudioCard(db: DB, content: StudioContent, actor: string, sourceItemId?: number) {
  validateStudioMode(content);
  await validateStudioChannel(db, content.channel);
  if (content.experience && (content.experience.media.length || content.experience.coverId || content.experience.pages.some(p=>p.mediaId))) throw new HttpError(400, "새 작업을 만든 뒤 사진·영상을 올려 주세요.");
  if (content.finishedDeck?.pages.length || content.panels.some(p => p.imageId)) throw new HttpError(400, "새 콘텐츠에는 기존 이미지 ID를 넣을 수 없습니다.");
  return db.transaction(async tx => {
    if (sourceItemId) {
      const [source] = await tx.select().from(contentItems).where(eq(contentItems.id, sourceItemId));
      if (!source) throw new HttpError(404, "연결할 수집 콘텐츠가 없습니다.");
      const [existing] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, sourceItemId));
      if (existing) { assertStudioActive(existing); return studioCardDto(existing); }
      if (!content.subcategory && validSubcategory(content.channel, source.subcategory)) content = { ...content, subcategory: source.subcategory ?? "" };
      const idea = readIdea(source.edited);
      if (idea && source.origin === "idea") {
        content = { ...content, format: idea.format, exportDesign: idea.format === "카드뉴스" ? "set:f01" : content.exportDesign,
          memo: [idea.angle, ...idea.beats, idea.verification, ...idea.references.map(r=>`${r.label}: ${r.url}`)].join("\n\n"),
          script: `${idea.title}\n\n${idea.angle}\n\n${idea.beats.join("\n\n")}`,
          panels: idea.beats.map(scene=>({scene,dialogue:"",imageId:null})) };
      }
      // Copy explicit source material as editable context; never infer a new channel mapping.
      if (!content.memo) {
        const document = await itemPrimarySource(tx as unknown as DB, source);
        content = { ...content, sourceLabel: content.sourceLabel || (document?.originalUrl ? new URL(document.originalUrl).hostname : ""), memo: JSON.stringify({ sourceTitle: source.title, sourceUrl: document?.originalUrl ?? null, facts: source.edited ?? source.extracted ?? {} }, null, 2).slice(0, 12000) };
      }
    }
    const [card] = await tx.insert(studioCards).values({ content, sourceItemId: sourceItemId ?? null }).onConflictDoNothing().returning();
    if (!card && sourceItemId) {
      const [existing] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, sourceItemId));
      if (existing) { assertStudioActive(existing); return studioCardDto(existing); }
    }
    if (!card) throw new HttpError(409, "이미 생성된 콘텐츠입니다. 보드를 새로고침하세요.");
    await tx.insert(studioRevisions).values({ cardId: card.id, version: 1, snapshot: content, instruction: sourceItemId ? "수집 콘텐츠에서 가져오기" : "새 콘텐츠" });
    await audit(tx, { actor, action: "create", entity: "studio_card", entityId: card.id });
    return studioCardDto(card);
  });
}
export async function saveStudioCard(db: DB, cardId: number, version: number, patch: Partial<StudioContent>, actor: string, instruction = "직접 수정") {
  return db.transaction(async tx => {
    const current = await lockStudioPublication(tx as unknown as DB, cardId);
    assertStudioActive(current);
    if (current.version !== version) conflict(studioCardDto(current));
    await invalidateStudioPublication(tx as unknown as DB, current);
    const content = parse(studioContentSchema, { ...current.content, ...patch, ...(patch.channel && patch.channel !== current.content.channel && patch.subcategory === undefined ? { subcategory: "" } : {}) });
    if (current.importedMeta?.studioPublication && patch.channel && patch.channel !== current.content.channel) throw new HttpError(409, "발행 준비한 콘텐츠의 채널은 바꿀 수 없습니다. 다른 채널용 작업을 새로 만들어 주세요.");
    if (patch.channel && patch.channel !== current.content.channel) await validateStudioChannel(tx as unknown as DB, content.channel);
    await validateStudioImages(tx as unknown as DB, cardId, content);
    await validateExperienceMedia(tx as unknown as DB, cardId, content.experience);
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
  return { card: (await studioCardsWithOutput(db, [card]))[0], revisions: revisions.map(studioRevisionDto), jobs: cardJobs.map(studioJobDto) };
}
export async function queueStudioGeneration(db: DB, cardId: number, input: StudioGeneration, actor: string) {
  if (await getSetting(db, "global_stop", false)) throw new HttpError(409, "전역 정지 상태입니다. 정지를 해제한 뒤 생성하세요.");
  const inputHash = crypto.createHash("sha256").update(JSON.stringify({ cardId, ...input })).digest("hex");
  return db.transaction(async tx => {
    const card = await loadStudioCard(tx as unknown as DB, cardId, true);
    assertStudioActive(card);
    await validateStudioChannel(tx as unknown as DB, card.content.channel);
    const reserved = await tx.insert(studioRequests).values({ requestId: input.requestId, cardId, inputHash }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(studioRequests).where(eq(studioRequests.requestId, input.requestId));
      if (existing.cardId !== cardId || existing.inputHash !== inputHash) throw new HttpError(409, "다른 생성 요청에 사용한 요청 ID입니다.");
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, existing.jobId!));
      if (!job) throw new HttpError(409, "생성 요청 처리 중입니다. 잠시 후 상태를 확인하세요.");
      return { job: studioJobDto(job), duplicate: true };
    }
    if (card.version !== input.version) conflict(studioCardDto(card));
    if (input.textTarget === "experience") {
      const e=card.content.experience;
      if (!e || !e.media.length) throw new HttpError(400,"후기에 사용할 사진·영상을 먼저 선택해 주세요.");
      if (!e.notes.trim()) throw new HttpError(400,"직접 경험한 내용을 한 줄 이상 적어 주세요.");
      await validateExperienceMedia(tx as unknown as DB,cardId,e);
    }
    if (input.kind === "image" && !input.instruction && !card.content.panels[input.panelIndex!].scene.trim() && !card.content.panels[input.panelIndex!].dialogue.trim()) {
      throw new HttpError(400, "이 컷의 장면이나 대사를 먼저 작성해 주세요. 빈칸 초안 채우기도 사용할 수 있습니다.");
    }
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
  const rows = input.cards.map(c => ({ source: c, content: parse(studioContentSchema, { title: c.title, channel: c.channel, format: c.format, stage: c.stage, dueDate: c.dueDate, memo: c.memo, imagePath: c.imagePath ?? "", characters: normalizeStudioChannel(c.channel) === "highscoop" ? ["pempem"] : c.channel === "news" ? ["pengpeng"] : ["penguin"] }) }));
  for (const key of new Set(rows.map(r => r.content.channel))) await validateStudioChannel(db, key);
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
  const output = await renderStudioOutput(db, cardId);
  if (output.content.format !== "웹툰") throw new HttpError(400, "웹툰 형식을 선택한 뒤 PNG로 내려받으세요.");
  return { bytes: await output.page(0), version: output.version };
}

