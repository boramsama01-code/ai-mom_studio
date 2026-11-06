/** Export a real user-created copy without creating a design, master or dataset. */
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { canvaLibraryDesigns, canvaMasters, canvaRenderJobs, contentItems, contentRevisions } from '../../shared/schema';
import { evidenceBindingSchema, familyCardCopySchema, pageDesignsSchema } from '../../shared/familyDialogue';
import { CANVA_MANUAL_MAPPING_VERSION, canvaManualImportRequestSchema, canvaManualSnapshotSchema, type CanvaManualImportRequest, type CanvaManualSnapshot } from '../../shared/canvaManualImport';
import { CANVA_READING_MASTERS } from '../../shared/canvaMasterCatalog';
import { HttpError } from '../routes/util';
import { audit } from '../audit';
import { familyMetadataFromPayload } from './familyEditorial';
import { assertFamilyEvidenceForCopy } from './familyEditorialPersistence';
import { canvaInputHash } from './canvaEditorialAssets';
import * as rest from './canvaRest';

type Job = typeof canvaRenderJobs.$inferSelect;
export const canvaPrincipalKey = (principal: rest.CanvaPrincipal) => `${principal.teamId}:${principal.userId}`;
export const canvaManualPagesHash = (pages: Awaited<ReturnType<typeof rest.getCanvaPages>>) => canvaInputHash(pages.items.map(({ id, pageNumber, width, height }) => ({ id, pageNumber, width, height })));
export function assertManualCanvaVersion(binding: CanvaManualSnapshot, design: rest.CanvaDesignMetadata, pages?: Awaited<ReturnType<typeof rest.getCanvaPages>>) {
  if (design.id !== binding.designId || canvaPrincipalKey(design.owner) !== binding.principal) throw new HttpError(409, '가져올 Canva 복사본의 소유 계정·팀이 바뀌었습니다.', { code: 'design_owner_mismatch' });
  if (design.updatedAt !== binding.designUpdatedAt || pages && (!pages.validEightPageMaster || canvaManualPagesHash(pages) !== binding.pagesHash)) throw new HttpError(409, 'Canva 복사본이 수정되었습니다. 현재 원고와 대조할 최신 디자인을 다시 가져와 주세요.', { code: 'design_changed' });
}

export function manualCanvaBinding(job: Pick<Job, 'input' | 'masterId' | 'purpose' | 'designId' | 'principal'>): CanvaManualSnapshot | null {
  if (job.input.manualImport === undefined && job.masterId !== null) return null;
  const parsed = canvaManualSnapshotSchema.safeParse(job.input.manualImport);
  if (!parsed.success || job.masterId !== null || !['import', 'caption_rebind'].includes(job.purpose)
      || job.input.mappingVersion !== CANVA_MANUAL_MAPPING_VERSION || job.input.datasetHash !== null
      || parsed.data.designId !== job.designId || parsed.data.principal !== job.principal
      || job.input.profileId !== undefined || job.input.folderTemplate !== undefined) {
    throw new HttpError(409, '수동으로 가져온 Canva 디자인의 고정 기록을 확인할 수 없습니다. 기존 원고와 출력은 보존했습니다.', { code: 'canva_manual_binding_mismatch' });
  }
  return parsed.data;
}

/** Caller serializes the design binding using the same lock as reconciliation. */
export async function assertManualCanvaCopy(db: DB, designId: string, itemId: number) {
  const [master] = await db.select({ id: canvaMasters.id }).from(canvaMasters).where(eq(canvaMasters.sourceId, designId)).limit(1);
  const [original] = await db.select({ id: canvaLibraryDesigns.id }).from(canvaLibraryDesigns).where(eq(canvaLibraryDesigns.sourceId, designId)).limit(1);
  if (master || original || CANVA_READING_MASTERS.some(value => value.sourceId === designId)) {
    throw new HttpError(422, '공용 원본 템플릿은 가져올 수 없습니다. Canva에서 이 콘텐츠용 복사본을 만든 뒤 연결해 주세요.', { code: 'master_is_not_output' });
  }
  const [other] = await db.select({ id: canvaRenderJobs.id }).from(canvaRenderJobs).where(and(eq(canvaRenderJobs.designId, designId), ne(canvaRenderJobs.contentItemId, itemId))).limit(1);
  if (other) throw new HttpError(409, '다른 콘텐츠에 연결된 Canva 디자인입니다. 이 콘텐츠용 복사본을 만들어 주세요.', { code: 'design_already_linked' });
}

function replay(job: Job | undefined, requestHash: string): Job | null {
  if (!job) return null;
  if (job.requestHash !== requestHash) throw new HttpError(409, '같은 요청 ID로 다른 디자인이나 원고를 가져올 수 없습니다.', { code: 'request_conflict' });
  manualCanvaBinding(job);
  return job;
}

export async function enqueueCanvaManualImport(db: DB, args: CanvaManualImportRequest & { channelId: number; itemId: number; actor: string }) {
  const parsed = canvaManualImportRequestSchema.safeParse({ version: args.version, requestId: args.requestId, designId: args.designId, confirmed: args.confirmed });
  if (!parsed.success) throw new HttpError(400, '현재 원고 버전과 Canva 디자인·확인을 다시 확인해 주세요.');
  const requestHash = canvaInputHash({ kind: 'manual_canva_import', channelId: args.channelId, itemId: args.itemId, ...parsed.data });
  const requestWhere = and(eq(canvaRenderJobs.channelId, args.channelId), eq(canvaRenderJobs.requestId, args.requestId));
  const [existing] = await db.select().from(canvaRenderJobs).where(requestWhere);
  const repeated = replay(existing, requestHash); if (repeated) return repeated;
  const [before] = await db.select().from(contentItems).where(and(eq(contentItems.id, args.itemId), eq(contentItems.channelId, args.channelId)));
  if (!before) throw new HttpError(404, '콘텐츠를 찾을 수 없습니다.');
  if (before.version !== args.version || !before.currentRevisionId) throw new HttpError(409, '원고가 바뀌었습니다. 최신 저장본으로 다시 가져와 주세요.', { code: 'source_changed' });
  // Validate only through GET. No export can happen until the durable job exists.
  const [principal, design, pages] = await Promise.all([rest.getCanvaPrincipal(db), rest.getCanvaDesign(db, args.designId), rest.getCanvaPages(db, args.designId)]);
  const principalId = canvaPrincipalKey(principal);
  if (design.id !== args.designId || canvaPrincipalKey(design.owner) !== principalId) throw new HttpError(422, '현재 연결한 Canva 사용자·팀이 소유한 복사본만 가져올 수 있습니다.', { code: 'design_owner_mismatch' });
  if (design.pageCount !== 8 || !pages.validEightPageMaster || pages.items.length !== 8) throw new HttpError(422, '정확히 1080×1350 크기의 8장 디자인을 연결해 주세요.', { code: 'page_mismatch' });
  if (design.updatedAt === null) throw new HttpError(422, 'Canva 디자인의 수정 버전을 확인할 수 없어 가져오지 않았습니다.', { code: 'design_version_unavailable' });
  if (canvaPrincipalKey(await rest.getCanvaPrincipal(db)) !== principalId) throw new HttpError(409, '디자인 확인 중 Canva 계정·팀이 바뀌었습니다. 다시 확인해 주세요.', { code: 'account_changed' });
  const manualImport: CanvaManualSnapshot = { version: 1, kind: 'manual_copy', designId: args.designId, principal: principalId, designUpdatedAt: design.updatedAt, pagesHash: canvaManualPagesHash(pages), capturedAt: new Date().toISOString() };

  return db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, args.itemId), eq(contentItems.channelId, args.channelId))).for('update');
    const [current] = await tx.select().from(canvaRenderJobs).where(requestWhere);
    const repeated = replay(current, requestHash); if (repeated) return repeated;
    if (!item || item.version !== args.version || item.currentRevisionId !== before.currentRevisionId) throw new HttpError(409, '디자인 확인 중 원고가 바뀌었습니다. 최신 저장본으로 다시 가져와 주세요.', { code: 'source_changed' });
    const [pending] = await tx.select({ id: canvaRenderJobs.id }).from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId, item.id), or(inArray(canvaRenderJobs.status, ['queued', 'running', 'result_unknown']), and(eq(canvaRenderJobs.status, 'needs_review'), eq(canvaRenderJobs.sourceVersion, item.version), eq(canvaRenderJobs.sourceRevisionId, item.currentRevisionId!))))).limit(1);
    if (pending) throw new HttpError(409, '진행 중이거나 문구 대조를 기다리는 Canva 작업부터 확인해 주세요.', { code: 'canva_import_active', jobId: pending.id });
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`canva-reconcile-design:${args.designId}`}, 0))`);
    await assertManualCanvaCopy(tx as DB, args.designId, item.id);
    const [revision] = await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id, item.currentRevisionId!), eq(contentRevisions.contentItemId, item.id)));
    const copy = familyCardCopySchema.safeParse(revision?.payload.cardCopy), pageDesigns = pageDesignsSchema.safeParse(revision?.payload.pageDesigns), evidence = evidenceBindingSchema.safeParse(revision?.payload.evidenceBinding);
    const metadata = revision && familyMetadataFromPayload(revision.payload);
    if (!revision || !copy.success || !pageDesigns.success || !evidence.success || !metadata) throw new HttpError(422, '8장 원고와 근거·이미지 설정을 먼저 저장해 주세요.');
    await assertFamilyEvidenceForCopy(tx as DB, item, copy.data, metadata);
    const input = { payload: revision.payload, title: item.title, copy: copy.data, pageDesigns: pageDesigns.data, evidenceSetId: evidence.data.evidenceSetId,
      mappingVersion: CANVA_MANUAL_MAPPING_VERSION, datasetHash: null, manualImport };
    const [job] = await tx.insert(canvaRenderJobs).values({ channelId: args.channelId, contentItemId: item.id, sourceRevisionId: revision.id, sourceVersion: item.version,
      masterId: null, requestId: args.requestId, requestHash, purpose: 'import', principal: principalId, input, phase: 'export_prepare', designId: args.designId,
      designUpdatedAt: String(design.updatedAt), editUrl: design.editUrl, result: { manualImport } }).returning();
    await audit(tx as DB, { actor: args.actor, action: 'canva_manual_import_requested', entity: 'canva_render', entityId: job.id, channelId: args.channelId,
      detail: { designId: args.designId, sourceRevisionId: revision.id, sourceVersion: item.version, requiresTextReview: true, newAutofill: false } });
    return job;
  });
}
