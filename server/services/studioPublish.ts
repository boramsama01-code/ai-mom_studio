import { expectedInstagramUsername } from "../../shared/channelInstagram";
import sharp from "sharp";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { approvals, channels, contentItems, contentRevisions, deliveries, destinations, mediaAssets, studioCards } from "../../shared/schema";
import { studioContentSchema } from "../../shared/studio";
import { studioAltTexts } from "../../shared/altText";
import type { StudioPublishPreview, StudioPublishStatus } from "../../shared/studioPublish";
import { channelSlug } from "../../shared/channelKeys";
import { assertStudioActive, loadStudioCard, studioCardDto } from "./studio";
import { lockStudioPublication } from "./studioPublicationState";
import { renderStudioOutput } from "./studioExport";
import { conflict, HttpError } from "../routes/util";
import { sha256 } from "./text";
import { validateCaptions } from "./cardModel";
import { resolveSecrets } from "./secrets";
import { env } from "../env";
import { getSetting } from "../seed";
import { approveItem } from "../worker/publish";
import { audit } from "../audit";

export async function studioPublishStatus(db: DB, cardId: number): Promise<StudioPublishStatus> {
  const card = await loadStudioCard(db, cardId);
  const [ch] = await db.select().from(channels).where(eq(channels.slug, channelSlug(card.content.channel)));
  if (!ch) throw new HttpError(404, "채널을 찾을 수 없습니다.");
  const dests = await db.select().from(destinations).where(and(eq(destinations.channelId, ch.id), eq(destinations.platform, "instagram")));
  const choices = dests.map(d => { const sec = resolveSecrets(d.platform, ch.slug, d.secretRefs); return { id: d.id, label: d.label, enabled: d.enabled, configured: !sec.missing.length && !sec.invalid.length }; });
  const blockers: string[] = [];
  if (card.trashedAt) blockers.push("휴지통에서 콘텐츠를 복원하세요.");
  if (!ch.active) blockers.push("채널을 복원하세요.");
  if (await getSetting(db, "global_stop", false)) blockers.push("전체 작업이 일시 정지돼 있습니다.");
  if (!choices.some(d => d.enabled && d.configured)) blockers.push("인스타그램 게시 계정을 연결하세요.");
  if (!env.cloudinaryConfigured) blockers.push("API 키 관리에서 Cloudinary를 연결하세요.");
  if (!env.instagramApiVersion) blockers.push("API 키 관리에서 Instagram API 버전을 입력하세요.");
  if (ch.budget.dailyPublishLimit < 1) blockers.push("채널의 하루 발행 한도를 1건 이상으로 설정하세요.");
  if (env.dryRun || !env.autoPublish) blockers.push("서버가 모의 실행 또는 발행 중지 상태입니다.");
  const history = card.sourceItemId ? await db.select({ id: deliveries.id, status: deliveries.status, lastError: deliveries.lastError, externalUrl: deliveries.externalUrl, scheduledAt: approvals.scheduledAt }).from(deliveries).innerJoin(approvals, eq(deliveries.approvalId, approvals.id)).where(eq(approvals.contentItemId, card.sourceItemId)).orderBy(desc(deliveries.id)).limit(20) : [];
  return { channelId: ch.id, channelName: ch.name, expectedUsername: expectedInstagramUsername(ch.slug), ready: !blockers.length, blockers, dailyLimit: ch.budget.dailyPublishLimit, dryRun: env.dryRun, autoPublish: env.autoPublish, destinations: choices, deliveries: history.map(d => ({ ...d, scheduledAt: d.scheduledAt.toISOString() })) };
}

async function previewDto(db: DB, card: typeof studioCards.$inferSelect): Promise<StudioPublishPreview> {
  const assetId = Number(card.importedMeta?.generatedAssetId);
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
  if (!asset || !card.sourceItemId || asset.contentItemId !== card.sourceItemId) throw new HttpError(409, "발행 미리보기를 다시 만들어 주세요.");
  const [item] = await db.select({ revision: contentItems.currentRevisionId }).from(contentItems).where(eq(contentItems.id, card.sourceItemId));
  if (!item || item.revision !== asset.revisionId) throw new HttpError(409, "연결된 원고가 바뀌었습니다. 제작보드에서 내용을 저장하고 다시 미리보기해 주세요.");
  return { cardId: card.id, version: card.version, channelId: asset.channelId, itemId: card.sourceItemId, revisionId: asset.revisionId, assetId, caption: card.content.caption,
    pages: asset.carousel?.pages.map(p => ({ id: p.id, title: p.title, altText: p.altText ?? "" })) ?? [{ id: asset.id, title: card.content.title, altText: card.content.title }] };
}

/** Snapshot precisely the ordered pages visible in the approval UI. No AI/template rewrite. */
export async function prepareStudioPublication(db: DB, cardId: number, version: number, actor: string) {
  const original = await loadStudioCard(db, cardId);
  assertStudioActive(original);
  if (original.version !== version) conflict(studioCardDto(original));
  if (original.sourceItemId && !original.importedMeta?.studioPublication) throw new HttpError(409, "수집한 콘텐츠는 원고·카드 화면에서 최종 승인하세요.");
  const content = studioContentSchema.parse(original.content);
  const captionErrors = validateCaptions({ instagram: content.caption, telegram: "" });
  if (captionErrors.length) throw new HttpError(400, captionErrors.join(" "));
  if (original.importedMeta?.publishedVersion === version) return previewDto(db, original);
  const output = await renderStudioOutput(db, cardId, version);
  const pages: Buffer[] = [];
  for (let i = 0; i < output.pageCount; i++) pages.push(await sharp(await output.page(i)).flatten({ background: "#ffffff" }).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer());
  const altTexts = studioAltTexts(content);
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const current = await lockStudioPublication(dbtx, cardId);
    assertStudioActive(current);
    if (current.version !== version) conflict(studioCardDto(current));
    if (current.importedMeta?.publishedVersion === version) return previewDto(dbtx, current);
    const [ch] = await tx.select().from(channels).where(eq(channels.slug, channelSlug(content.channel)));
    if (!ch?.active) throw new HttpError(409, "게시할 채널을 확인하세요.");
    let itemId = current.sourceItemId;
    if (!itemId) {
      const [item] = await tx.insert(contentItems).values({ channelId: ch.id, kind: "current_dialogue", origin: "studio", title: content.title, relevance: "relevant", evidenceStatus: "needs_review", scheduleStatus: "not_applicable" }).returning();
      itemId = item.id;
    }
    const [last] = await tx.select({ no: contentRevisions.revisionNo }).from(contentRevisions).where(eq(contentRevisions.contentItemId, itemId)).orderBy(desc(contentRevisions.revisionNo)).limit(1);
    const [rev] = await tx.insert(contentRevisions).values({ contentItemId: itemId, revisionNo: (last?.no ?? 0) + 1, author: "operator", payload: { title: content.title, summary: content.caption, studioCardId: cardId, studioVersion: version }, note: "제작보드 최종 이미지" }).returning();
    const manifest: NonNullable<typeof mediaAssets.$inferInsert.carousel> = { version: 1, altVersion: 1, pages: [], cover: { kind: "typography", credit: "제작보드 완성 이미지" } };
    // A tiny JPEG comment binds page position, allowing identical images in one deck.
    for (const [i, raw] of pages.entries()) {
      const comment = Buffer.from(`studio:${cardId}:${version}:${i}`);
      const marker = Buffer.alloc(4); marker.writeUInt16BE(0xfffe); marker.writeUInt16BE(comment.length + 2, 2);
      const bytes = Buffer.concat([raw.subarray(0, 2), marker, comment, raw.subarray(2)]);
      const [asset] = await tx.insert(mediaAssets).values({ channelId: ch.id, contentItemId: itemId, revisionId: rev.id, kind: i === 0 ? "card" : "card_page", source: "studio", sha256: sha256(bytes), bytes, mime: "image/jpeg", width: 1080, height: 1350 }).returning();
      manifest.pages.push({ id: asset.id, sha256: asset.sha256, title: `${content.title} · ${i + 1}`, altText: altTexts[i] });
    }
    const assetId = manifest.pages[0].id;
    await tx.update(mediaAssets).set({ carousel: manifest }).where(eq(mediaAssets.id, assetId));
    await tx.update(contentItems).set({ title: content.title, currentRevisionId: rev.id, reviewStatus: "pending", publishStatus: "waiting", updatedAt: new Date() }).where(eq(contentItems.id, itemId));
    const [saved] = await tx.update(studioCards).set({ sourceItemId: itemId, importedMeta: { ...current.importedMeta, studioPublication: true, publishedVersion: version, generatedAssetId: assetId } }).where(eq(studioCards.id, cardId)).returning();
    await audit(tx, { actor, action: "prepare_publication", entity: "studio_card", entityId: cardId, detail: { version, itemId, assetId, pageCount: pages.length } });
    return previewDto(dbtx, saved);
  });
}

export async function approveStudioPublication(db: DB, cardId: number, input: { version: number; assetId: number; destinationId: number; scheduledAt: string }, actor: string) {
  const status = await studioPublishStatus(db, cardId);
  if (!status.ready) throw new HttpError(409, status.blockers.join(" "));
  if (!status.destinations.some(d => d.id === input.destinationId && d.enabled && d.configured)) throw new HttpError(400, "게시할 인스타그램 계정을 확인하세요.");
  const scheduledAt = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) throw new HttpError(400, "예약 시간을 현재 이후로 선택하세요.");
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const card = await lockStudioPublication(dbtx, cardId);
    assertStudioActive(card);
    if (card.version !== input.version || card.importedMeta?.publishedVersion !== input.version || card.importedMeta?.generatedAssetId !== input.assetId) throw new HttpError(409, "미리보기 이후 수정됐습니다. 최신 이미지·캡션으로 다시 확인하세요.");
    const preview = await previewDto(dbtx, card);
    const prior = await tx.select({ id: approvals.id }).from(approvals).innerJoin(deliveries, eq(deliveries.approvalId, approvals.id)).where(and(eq(approvals.contentItemId, preview.itemId), eq(approvals.revisionId, preview.revisionId), inArray(deliveries.status, ["scheduled", "processing", "succeeded", "unknown"])));
    if (prior.length) throw new HttpError(409, "이 버전은 이미 발행을 요청했습니다. 아래 발행 상태를 확인하세요.");
    await tx.update(contentItems).set({ reviewStatus: "reviewed" }).where(eq(contentItems.id, preview.itemId));
    const result = await approveItem(dbtx, { itemId: preview.itemId, revisionId: preview.revisionId, mediaAssetId: preview.assetId, altTextVersion: 1, destinationIds: [input.destinationId], captions: { instagram: preview.caption, telegram: "" }, scheduledAt, actor });
    if (!result.ok) throw new HttpError(409, result.error);
    return { approvalId: result.approval.id, scheduledAt: result.approval.scheduledAt };
  });
}

