/** Caption changes reuse the exact verified export bytes, with a new local revision binding. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { canvaRenderJobs, contentItems, contentRevisions, mediaAssets } from '../../shared/schema';
import { captionPackageSchema, familyCardCopySchema, pageDesignsSchema } from '../../shared/familyDialogue';
import { audit } from '../audit';
import { HttpError } from '../routes/util';
import { assertCanvaReusableArtifact } from './canvaPublication';
import { canvaInputHash } from './canvaEditorialAssets';

type Item = typeof contentItems.$inferSelect;
type Revision = typeof contentRevisions.$inferSelect;
type Args = { item: Item; previousRevision: Revision; nextRevision: Revision; payload: Record<string, unknown>; actor: string };

/** Caller must hold the item's transaction lock and have created nextRevision as current.
 * A mismatch simply leaves the caption saved with the existing render-review requirement.
 * An actual corrupt export aborts the transaction instead of disguising it as reusable. */
export async function reuseCanvaForCaption(tx: DB, args: Args): Promise<{ payload: Record<string, unknown>; assetId?: number }> {
  const { item, previousRevision, nextRevision, payload, actor } = args;
  if (payload.rendererProvider !== 'canva' || previousRevision.payload.rendererProvider !== 'canva') return { payload };
  if (item.id !== previousRevision.contentItemId || item.id !== nextRevision.contentItemId || nextRevision.id === previousRevision.id) throw new HttpError(409, '캡션을 연결할 현재 원고 버전을 다시 확인해 주세요.');
  for (const key of ['cardCopy', 'pageDesigns', 'evidenceBinding']) if (!isDeepStrictEqual(payload[key], previousRevision.payload[key])) return { payload };
  const copy = familyCardCopySchema.safeParse(payload.cardCopy), designs = pageDesignsSchema.safeParse(payload.pageDesigns), caption = captionPackageSchema.safeParse(payload.captionPackage);
  if (!copy.success || !designs.success || !caption.success || caption.data.contentRevision !== nextRevision.id) return { payload };
  const oldTrace = previousRevision.payload.canvaExport as Record<string, unknown> | undefined;
  if (!oldTrace || typeof oldTrace.requestHash !== 'string' || typeof oldTrace.canvaDesignId !== 'string' || typeof oldTrace.exportJobId !== 'string') return { payload };
  const [job] = await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.channelId, item.channelId), eq(canvaRenderJobs.contentItemId, item.id), eq(canvaRenderJobs.status, 'ready'), eq(canvaRenderJobs.phase, 'complete'), eq(canvaRenderJobs.requestHash, oldTrace.requestHash), eq(canvaRenderJobs.designId, oldTrace.canvaDesignId), eq(canvaRenderJobs.exportJobId, oldTrace.exportJobId))).limit(1);
  if (!job?.outputAssetId || !job.outputRevisionId) return { payload };
  const [renderRevision] = await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id, job.outputRevisionId), eq(contentRevisions.contentItemId, item.id)));
  const [cover] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, job.outputAssetId), eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.channelId, item.channelId)));
  if (!renderRevision || !cover) throw new HttpError(409, '재사용할 Canva 출력 저장본을 찾을 수 없습니다. 원래 8장 파일을 확인해 주세요.');
  for (const key of ['cardCopy', 'pageDesigns', 'evidenceBinding']) if (!isDeepStrictEqual(payload[key], renderRevision.payload[key])) return { payload };
  const proof = await assertCanvaReusableArtifact(tx, { item: { ...item, currentRevisionId: renderRevision.id }, revision: renderRevision, asset: cover });
  if (!proof) return { payload };
  const [current] = await tx.select({ revisionId: contentItems.currentRevisionId, version: contentItems.version }).from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.channelId, item.channelId))).for('update');
  if (!current || current.revisionId !== nextRevision.id || current.version !== item.version) throw new HttpError(409, '캡션 저장 중 원고가 변경되었습니다. 현재 저장본을 다시 확인해 주세요.');

  const pages: Array<{ id: number; sha256: string; title: string; altText?: string }> = [], originals: Array<{ id: number; sha256: string; page: number }> = [];
  const originalOrder = job.result!.originals as Array<{ id: number; sha256: string; page: number }>;
  for (let index = 0; index < 8; index++) {
    const original = proof.originals.find(value => value.id === originalOrder[index].id)!, jpeg = proof.pages[index];
    for (const source of [original, jpeg]) {
      const [cloned] = await tx.insert(mediaAssets).values({ channelId: item.channelId, contentItemId: item.id, revisionId: nextRevision.id, kind: source.kind, source: source.source, templateKey: source.templateKey, sha256: source.sha256, mime: source.mime, width: source.width, height: source.height, bytes: source.bytes, cloudinaryPublicId: source.cloudinaryPublicId, cloudinaryUrl: source.cloudinaryUrl }).returning({ id: mediaAssets.id, sha256: mediaAssets.sha256 });
      if (source === original) originals.push({ ...cloned, page: index + 1 });
      else pages.push({ ...cover.carousel!.pages[index], ...cloned });
    }
  }
  await tx.update(mediaAssets).set({ carousel: { ...cover.carousel!, pages } }).where(eq(mediaAssets.id, pages[0].id));
  const input = { ...job.input, payload: { ...payload, captionPackage: { ...caption.data, contentRevision: previousRevision.id } }, title: item.title, copy: copy.data, pageDesigns: designs.data };
  const requestId = randomUUID(), requestHash = canvaInputHash({ purpose: 'caption_rebind', itemId: item.id, previousRevisionId: previousRevision.id, nextRevisionId: nextRevision.id, reusedFromJobId: job.id, inputHash: canvaInputHash(input) });
  const result = { ...job.result, pages, originals, contentRevision: previousRevision.id, reusedFromJobId: job.id, reuseReason: 'caption_only', reusedAt: new Date().toISOString() };
  // Existing reconciliation evidence belongs to the original import. Preserve it
  // as provenance without making the caption-only job another recovery request.
  delete (result as Record<string, unknown>).reconciled;
  delete (result as Record<string, unknown>).reconciliation;
  delete (result as Record<string, unknown>).reconciliationHistory;
  const [reused] = await tx.insert(canvaRenderJobs).values({ channelId: item.channelId, contentItemId: item.id, sourceRevisionId: previousRevision.id, sourceVersion: item.version, masterId: job.masterId, requestId, requestHash, purpose: 'caption_rebind', principal: job.principal, input, status: 'ready', phase: 'complete', autofillJobId: job.autofillJobId, exportJobId: job.exportJobId, designId: job.designId, designUpdatedAt: job.designUpdatedAt, editUrl: job.editUrl, outputAssetId: pages[0].id, outputRevisionId: nextRevision.id, result }).returning();
  const boundPayload = { ...payload, canvaExport: { ...oldTrace, requestHash, contentRevision: previousRevision.id, reusedFromJobId: job.id, reusedByJobId: reused.id }, dependencies: { ...(payload.dependencies as Record<string, unknown>), render: 'current' } };
  await tx.update(contentItems).set({ canvaDesign: { designId: job.designId!, editUrl: job.editUrl, viewUrl: null, revisionId: nextRevision.id, createdAt: String(job.result!.exportedAt) } }).where(eq(contentItems.id, item.id));
  await audit(tx, { actor, action: 'canva_export_reused_for_caption', entity: 'canva_render', entityId: reused.id, channelId: item.channelId, detail: { reusedFromJobId: job.id, sourceRevisionId: renderRevision.id, revisionId: nextRevision.id, publicationHashes: pages.map(page => page.sha256), originalHashes: originals.map(page => page.sha256), externalRequests: 0 } });
  return { payload: boundPayload, assetId: pages[0].id };
}
