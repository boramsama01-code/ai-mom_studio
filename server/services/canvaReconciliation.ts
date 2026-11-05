/** An operator can recover an orphaned design with read-only validation and one explicit export. */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import { canvaMasters, canvaRenderJobs, contentItems, contentRevisions } from "../../shared/schema";
import { evidenceBindingSchema, familyCardCopySchema, pageDesignsSchema } from "../../shared/familyDialogue";
import { canvaVariant, validateCanvaDataset, resolveCanvaProfile, storedCanvaProfileSnapshot, type CanvaProfileSnapshot } from "../../shared/canvaEditorial";
import { canvaReconcileRequestSchema, canvaReconciliations, type CanvaReconcileRequest, type CanvaReconciliation } from "../../shared/canvaReconciliation";
import { audit } from "../audit";
import { HttpError } from "../routes/util";
import { canvaInputHash } from "./canvaEditorialAssets";
import * as rest from "./canvaRest";

type Job = typeof canvaRenderJobs.$inferSelect;
type Request = CanvaReconcileRequest & { channelId: number; itemId: number; jobId: number; actor: string };
const principalKey = (value: rest.CanvaPrincipal) => `${value.teamId}:${value.userId}`;

/** Distinguishes an explicit new recovery from replaying an earlier HTTP response. */
export function canvaRecoveryToken(job: Pick<Job, "id" | "requestId" | "sourceVersion" | "status" | "phase" | "updatedAt" | "autofillJobId" | "exportJobId" | "designId">): string | null {
  return job.status === "result_unknown" ? canvaInputHash({ id: job.id, requestId: job.requestId, sourceVersion: job.sourceVersion, phase: job.phase, updatedAt: job.updatedAt.toISOString(), autofillJobId: job.autofillJobId, exportJobId: job.exportJobId, designId: job.designId }) : null;
}

function replay(job: Job, request: Request): boolean {
  const accepted = canvaReconciliations(job.result).find(record => record.recoveryToken === request.expectedRecoveryToken);
  if (!accepted) return false;
  if (accepted.designId !== request.designId || accepted.sourceVersion !== request.version) throw new HttpError(409, "같은 복구 요청으로 다른 디자인이나 원고 버전을 연결할 수 없습니다.", { code: "reconciliation_conflict" });
  return true;
}
function assertUnknown(job: Job, request: Request) {
  if (job.status !== "result_unknown" || canvaRecoveryToken(job) !== request.expectedRecoveryToken) throw new HttpError(409, "Canva 작업 상태가 바뀌었습니다. 저장된 결과를 다시 확인한 뒤 연결해 주세요.", { code: "reconciliation_conflict" });
  if (job.designId && job.designId !== request.designId) throw new HttpError(409, "이미 확인한 Canva 디자인과 다른 ID입니다. 이 작업에 연결된 디자인을 가져와 주세요.", { code: "design_mismatch" });
}

export async function reconcileCanvaJob(db: DB, request: Request): Promise<Job> {
  const checked = canvaReconcileRequestSchema.safeParse({ version: request.version, designId: request.designId, confirmed: request.confirmed, expectedRecoveryToken: request.expectedRecoveryToken });
  if (!checked.success) throw new HttpError(400, "연결할 디자인 ID와 현재 원고 버전·확인을 다시 확인해 주세요.");
  const where = and(eq(canvaRenderJobs.id, request.jobId), eq(canvaRenderJobs.channelId, request.channelId), eq(canvaRenderJobs.contentItemId, request.itemId));
  const [before] = await db.select().from(canvaRenderJobs).where(where);
  if (!before) throw new HttpError(404, "이 콘텐츠의 Canva 작업을 찾을 수 없습니다.");
  if (replay(before, request)) return before;
  assertUnknown(before, request);
  const [initialItem] = await db.select().from(contentItems).where(and(eq(contentItems.id, request.itemId), eq(contentItems.channelId, request.channelId)));
  if (!initialItem?.currentRevisionId || initialItem.version !== request.version) throw new HttpError(409, "원고가 변경되었습니다. 최신 저장본을 연 뒤 Canva 8장과 대조해 주세요.", { code: "source_changed" });

  // These are read-only provider calls. No transaction is held across the network,
  // and all item/job conditions are rechecked under locks before queueing work.
  const [principal, design, pages] = await Promise.all([rest.getCanvaPrincipal(db), rest.getCanvaDesign(db, request.designId), rest.getCanvaPages(db, request.designId)]);
  if (principalKey(principal) !== before.principal) throw new HttpError(409, "원래 작업의 Canva 계정·팀으로 다시 연결해 주세요.", { code: "account_changed" });
  if (design.id !== request.designId || principalKey(design.owner) !== before.principal) throw new HttpError(422, "현재 연결한 Canva 사용자·팀이 소유한 디자인만 이 작업에 연결할 수 있습니다.", { code: "design_owner_mismatch" });
  if (design.pageCount !== 8 || !pages.validEightPageMaster) throw new HttpError(422, "연결할 디자인은 정확히 1080×1350 크기의 8장이어야 합니다.", { code: "page_mismatch" });
  if (design.updatedAt === null) throw new HttpError(422, "디자인의 수정 버전을 확인할 수 없어 연결하지 않았습니다.", { code: "design_version_unavailable" });
  let dataset: Awaited<ReturnType<typeof rest.getCanvaDataset>> | null = null;
  try { dataset = await rest.getCanvaDataset(db, { type: "design", id: request.designId }); }
  catch (error) { if (!(error instanceof rest.CanvaRestError)) throw error; /* An edited copy need not retain master dataset access. */ }

  return db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, request.itemId), eq(contentItems.channelId, request.channelId))).for("update");
    const [job] = await tx.select().from(canvaRenderJobs).where(where).for("update");
    if (!item || !job) throw new HttpError(404, "콘텐츠와 Canva 작업을 찾을 수 없습니다.");
    if (replay(job, request)) return job;
    assertUnknown(job, request);
    if (item.version !== request.version || !item.currentRevisionId || item.currentRevisionId !== initialItem.currentRevisionId) throw new HttpError(409, "디자인을 확인하는 동안 원고가 바뀌었습니다. 최신 저장본으로 다시 연결해 주세요.", { code: "source_changed" });
    if (job.principal !== before.principal) throw new HttpError(409, "Canva 연결 계정이 바뀌었습니다. 현재 작업을 다시 확인해 주세요.", { code: "account_changed" });
    const [pending] = await tx.select({ id: canvaRenderJobs.id }).from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId, item.id), ne(canvaRenderJobs.id, job.id), inArray(canvaRenderJobs.status, ["queued", "running"]))).limit(1);
    if (pending) throw new HttpError(409, "진행 중인 Canva 작업을 먼저 확인해 주세요.");
    const [registeredMaster] = await tx.select({ id: canvaMasters.id }).from(canvaMasters).where(eq(canvaMasters.sourceId, request.designId)).limit(1);
    if (registeredMaster) throw new HttpError(422, "공용 마스터 자체는 연결할 수 없습니다. 이 콘텐츠용 복사본을 Canva에서 만든 뒤 연결해 주세요.", { code: "master_is_not_output" });
    // Different item locks must not allow two contents to claim the same orphan.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`canva-reconcile-design:${request.designId}`}, 0))`);
    const [otherContent] = await tx.select({ id: canvaRenderJobs.id }).from(canvaRenderJobs).where(and(eq(canvaRenderJobs.designId, request.designId), ne(canvaRenderJobs.contentItemId, item.id))).limit(1);
    if (otherContent) throw new HttpError(409, "다른 콘텐츠에 연결된 Canva 디자인입니다. 이 콘텐츠용 복사본을 만들어 연결해 주세요.", { code: "design_already_linked" });
    const [revision] = await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id, item.currentRevisionId), eq(contentRevisions.contentItemId, item.id)));
    if (!revision) throw new HttpError(409, "현재 원고 저장본을 찾을 수 없습니다.");
    const copy = familyCardCopySchema.safeParse(revision.payload.cardCopy), pageDesigns = pageDesignsSchema.safeParse(revision.payload.pageDesigns), evidence = evidenceBindingSchema.safeParse(revision.payload.evidenceBinding);
    if (!copy.success || !pageDesigns.success || !evidence.success) throw new HttpError(422, "현재 8장 원고와 근거·이미지 설정을 먼저 저장해 주세요.");
    const source = job.input as CanvaProfileSnapshot & { datasetHash: string; artworkCredits?: Record<string, string> };
    const input = { payload: revision.payload, title: item.title, copy: copy.data, pageDesigns: pageDesigns.data, evidenceSetId: evidence.data.evidenceSetId,
      ...storedCanvaProfileSnapshot(source), datasetHash: source.datasetHash, ...(source.artworkCredits ? { artworkCredits: source.artworkCredits } : {}) };
    // Reconciliation only exports a user-confirmed existing design. An older
    // profile becoming unavailable must not launch Autofill or block recovery.
    let matchesProfile = true, profile: ReturnType<typeof resolveCanvaProfile>;
    try { profile = resolveCanvaProfile(source); }
    catch { matchesProfile = false; }
    const history = canvaReconciliations(job.result);
    if (history.length >= 20) throw new HttpError(422, "이 작업의 명시적 복구 한도에 도달했습니다. 연결·디자인 상태를 확인해 주세요.");
    const firstOriginal = history.at(-1)?.original;
    const reconciliation: CanvaReconciliation = {
      version: 1, recoveryToken: request.expectedRecoveryToken, designId: request.designId, sourceRevisionId: revision.id, sourceVersion: item.version, sourceInputHash: canvaInputHash(input),
      requestTitleMatched: !!design.title?.trim().endsWith(` · ${job.requestId.slice(0, 8)}`),
      datasetCheck: dataset === null ? "unavailable" : matchesProfile && canvaInputHash(dataset) === source.datasetHash && !validateCanvaDataset(dataset, canvaVariant(copy.data), profile).length ? "matches" : "different",
      original: firstOriginal ?? { sourceRevisionId: job.sourceRevisionId, sourceVersion: job.sourceVersion, purpose: job.purpose as "create" | "import", requestId: job.requestId, requestHash: job.requestHash, inputHash: canvaInputHash(job.input) },
      reconciledAt: new Date().toISOString(),
    };
    const priorExports = Array.isArray(job.result?.previousExportJobIds) ? job.result.previousExportJobIds.filter((value): value is string => typeof value === "string") : [];
    const result: Record<string, unknown> = { ...job.result, reconciled: true, reconciliation, reconciliationHistory: history, previousExportJobIds: [...new Set([...priorExports, ...(job.exportJobId ? [job.exportJobId] : [])])], reconciledProviderIds: [...(Array.isArray(job.result?.reconciledProviderIds) ? job.result.reconciledProviderIds : []), { recoveryToken: request.expectedRecoveryToken, autofillJobId: job.autofillJobId, exportJobId: job.exportJobId, phase: job.phase }] };
    for (const key of ["downloadUrls", "pages", "originals", "contentRevision", "exportedAt"]) delete result[key];
    const [saved] = await tx.update(canvaRenderJobs).set({ sourceRevisionId: revision.id, sourceVersion: item.version, purpose: "import", input, status: "queued", phase: "export_prepare", designId: request.designId, designUpdatedAt: String(design.updatedAt), editUrl: design.editUrl, autofillJobId: null, exportJobId: null, outputAssetId: null, outputRevisionId: null, result, startedAt: new Date(), leaseOwner: null, leaseUntil: null, nextRunAt: new Date(), errorCode: null, errorMessage: null, updatedAt: new Date() }).where(where).returning();
    await audit(tx as DB, { actor: request.actor, action: "canva_design_reconciled", entity: "canva_render", entityId: job.id, channelId: request.channelId, detail: { designId: request.designId, recoveryToken: request.expectedRecoveryToken, originalRequestHash: job.requestHash, sourceRevisionId: revision.id, sourceInputHash: reconciliation.sourceInputHash, originalSourceRevisionId: reconciliation.original.sourceRevisionId, requestTitleMatched: reconciliation.requestTitleMatched, datasetCheck: reconciliation.datasetCheck, requiresTextReview: true, newAutofill: false } });
    return saved;
  });
}
