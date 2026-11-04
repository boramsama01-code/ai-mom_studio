/** Real PostgreSQL locks/transactions. Canva and image downloads are mocked; no production or paid request. */
import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableName } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { approvals, canvaAssetUploads, canvaMasters, canvaRenderJobs, contentItems, contentRevisions, mediaAssets } from "../shared/schema";
import { CANVA_MAPPING_VERSION, canvaDisplayTextFields, canvaVariant, expectedCanvaDataset, snapshotCanvaProfile } from "../shared/canvaEditorial";
import { READING_PROFILE_LOGO_ID, readingProfileDesigns, readingProfileForTemplateKey } from "../shared/readingCardProfiles";
import { CardOverflowError } from "../server/services/card";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";
import { createFamilyPgFixture } from './fixtures/familyEvidencePg';
import { resetDb, setTestEnv } from "./helpers";

setTestEnv();
const api = vi.hoisted(() => ({ principal: vi.fn(), capabilities: vi.fn(), design: vi.fn(), pages: vi.fn(), dataset: vi.fn(), submitAutofill: vi.fn(), getAutofill: vi.fn(), submitExport: vi.fn(), getExport: vi.fn(), submitUpload: vi.fn(), getUpload: vi.fn(), prepare: vi.fn(), download: vi.fn(), jpegs: vi.fn(), layout: vi.fn(), sourceApproved: vi.fn() }));
vi.mock("../server/services/canvaRest", async original => ({ ...await original<object>(), getCanvaPrincipal: api.principal, getCanvaCapabilities: api.capabilities, getCanvaDesign: api.design, getCanvaPages: api.pages, getCanvaDataset: api.dataset, submitCanvaAutofill: api.submitAutofill, getCanvaAutofillJob: api.getAutofill, submitCanvaExport: api.submitExport, getCanvaExportJob: api.getExport, submitCanvaAssetUpload: api.submitUpload, getCanvaAssetUploadJob: api.getUpload }));
vi.mock("../server/services/canvaEditorialAssets", async original => ({ ...await original<object>(), prepareCanvaImages: api.prepare, downloadCanvaExport: api.download, publicationJpegs: api.jpegs }));
vi.mock("../shared/readingCanvaMasters", () => ({ readingMasterSourceApproved: api.sourceApproved }));
vi.mock("../server/services/readingCard", async original => ({ ...await original<object>(), layoutReadingCard: api.layout }));
const { getDb, closeDb } = await import("../server/db");
const { createRevision } = await import("../server/content");
const { registerCanvaMaster, enqueueCanvaRender, resumeCanvaJob, runCanvaJobs, acceptCanvaImport } = await import("../server/services/canvaEditorial");
const { reconcileCanvaJob, canvaRecoveryToken } = await import("../server/services/canvaReconciliation");
const { canvaInputHash } = await import("../server/services/canvaEditorialAssets");
const { CanvaRestError } = await import("../server/services/canvaRest");
const { loadCardPages } = await import("../server/services/cardCarousel");
const { sha256 } = await import("../server/services/text");
let pngs: Buffer[], jpegs: Buffer[], recoveryDesignId: string;
beforeAll(async () => {
  await resetDb();
  pngs = await Promise.all(Array.from({ length: 8 }, (_, index) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 25 * index, g: 70, b: 120 } } }).png().toBuffer()));
  jpegs = await Promise.all(pngs.map(png => sharp(png).jpeg({ quality: 95 }).toBuffer()));
});
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const mock of Object.values(api)) mock.mockReset();
  // A real design cannot belong to fixtures from different contents. Preserve
  // prior rows for inspection, but give every test its own provider identity.
  recoveryDesignId = `Drecovered_${randomUUID()}`;
  // Tests share only this isolated DB; leave prior fixtures inspectable but not runnable.
  await getDb().update(canvaRenderJobs).set({ status: "cancelled" });
  api.principal.mockResolvedValue({ userId: "user_test", teamId: "team_test" });
  api.capabilities.mockResolvedValue({ capabilities: ["autofill"] });
  api.design.mockResolvedValue({ id: "generated_design", title: "Canva recovery fixture", owner: { userId: "user_test", teamId: "team_test" }, pageCount: 8, updatedAt: 123, editUrl: "https://www.canva.com/design/generated_design/edit" });
  api.pages.mockResolvedValue({ validEightPageMaster: true, items: Array.from({ length: 8 }, (_, index) => ({ id: `page_${index + 1}`, pageNumber: index + 1, width: 1080, height: 1350 })) });
  api.getAutofill.mockResolvedValue({ id: "autofill_known", status: "in_progress" });
  api.getExport.mockResolvedValue({ id: "export_known", status: "in_progress" });
  api.getUpload.mockResolvedValue({ id: "upload_known", status: "in_progress" });
  api.submitAutofill.mockResolvedValue({ id: "autofill_new", status: "in_progress" });
  api.submitExport.mockResolvedValue({ id: "export_new", status: "in_progress" });
  api.submitUpload.mockResolvedValue({ id: "upload_new", status: "in_progress" });
  api.download.mockResolvedValue(pngs); api.jpegs.mockResolvedValue(jpegs);
  api.layout.mockReturnValue({ svg: "<svg/>", textRuns: [] });
  // Synthetic fixture identity only; production has no approved reading source yet.
  api.sourceApproved.mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request in isolated Canva recovery test"); }));
});

describe('manually reconciling an unknown Canva design on PostgreSQL', () => {
  function request(f: Awaited<ReturnType<typeof fixture>>, overrides: { version?: number; designId?: string; expectedRecoveryToken?: string } = {}) {
    return { channelId: 2, itemId: f.item.id, jobId: f.job.id, version: f.item.version, designId: recoveryDesignId, confirmed: true as const, expectedRecoveryToken: canvaRecoveryToken(f.job)!, actor: 'test-operator', ...overrides };
  }
  function designFor(f: Awaited<ReturnType<typeof fixture>>, id = recoveryDesignId) {
    api.design.mockResolvedValue({ id, title: `${f.item.title} · ${f.job.requestId.slice(0, 8)}`, owner: { userId: 'user_test', teamId: 'team_test' }, pageCount: 8, updatedAt: 123, editUrl: `https://www.canva.com/design/${id}/edit` });
  }
  it('serializes duplicate confirmations, preserves the original request, and only exports the existing design', async () => {
    const f = await fixture('autofill_submitting', { status: 'result_unknown' }); designFor(f);
    const intent = request(f), results = await Promise.all([reconcileCanvaJob(f.db, intent), reconcileCanvaJob(f.db, intent)]);
    expect(results.map(value => value.id)).toEqual([f.job.id, f.job.id]);
    const linked = await saved(f.job.id);
    expect(linked).toMatchObject({ status: 'queued', phase: 'export_prepare', purpose: 'import', requestId: f.job.requestId, requestHash: f.job.requestHash, autofillJobId: null, exportJobId: null, result: { reconciled: true, reconciliation: { sourceRevisionId: f.revision.id, sourceInputHash: canvaInputHash(linked.input), requestTitleMatched: true, original: { sourceRevisionId: f.revision.id, requestHash: f.job.requestHash } } } });
    expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitExport).not.toHaveBeenCalled();
    await Promise.all([runCanvaJobs(f.db, 1), runCanvaJobs(f.db, 1)]);
    expect(api.submitExport).toHaveBeenCalledOnce(); expect(api.submitExport.mock.calls[0][1]).toBe(recoveryDesignId);
    const lookups = api.design.mock.calls.length;
    await reconcileCanvaJob(f.db, intent);
    expect(api.design).toHaveBeenCalledTimes(lookups); expect(api.submitExport).toHaveBeenCalledOnce();
    api.getExport.mockResolvedValue({ id: 'export_new', status: 'success', result: { urls: ['https://export-download.canva.com/isolated.zip'] } });
    await runNow(f.job.id); const reviewed = await runNow(f.job.id);
    expect(reviewed).toMatchObject({ status: 'needs_review', purpose: 'import', result: { reconciled: true, reconciliation: { recoveryToken: intent.expectedRecoveryToken } } });
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].currentRevisionId).toBe(f.revision.id);
    expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled();
  });
  it('rebases only onto the requested current source and accepts a renamed copy with mandatory review', async () => {
    const f = await fixture('autofill_submitting', { status: 'result_unknown' }); designFor(f);
    const copy = familyDialogueCardFixture(); copy.pages.find(page => page.id === 'cover')!.fields.headline = '새로 저장한 중심 질문';
    const revision = await f.db.transaction(tx => createRevision(tx, { contentItemId: f.item.id, author: 'operator', payload: { ...f.revision.payload, cardCopy: copy } }));
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    api.design.mockResolvedValue({ id: recoveryDesignId, title: '사용자가 바꾼 제목', owner: { userId: 'user_test', teamId: 'team_test' }, pageCount: 8, updatedAt: 123, editUrl: null });
    api.dataset.mockRejectedValue(new CanvaRestError('필드 접근 제한', 403, 'permission_denied'));
    await expect(reconcileCanvaJob(f.db, request(f))).rejects.toMatchObject({ status: 409, extra: { code: 'source_changed' } });
    const linked = await reconcileCanvaJob(f.db, request(f, { version: f.item.version + 1 }));
    expect(linked).toMatchObject({ sourceRevisionId: revision.id, sourceVersion: f.item.version + 1, purpose: 'import', requestHash: f.job.requestHash, input: { copy }, result: { reconciliation: { requestTitleMatched: false, datasetCheck: 'unavailable', original: { sourceRevisionId: f.revision.id, sourceVersion: f.item.version }, sourceInputHash: canvaInputHash(linked.input) } } });
    expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitExport).not.toHaveBeenCalled();
  });
  it('rechecks the item lock after provider reads and rejects a simultaneous source edit', async () => {
    const f = await fixture('autofill_submitting', { status: 'result_unknown' }); designFor(f);
    let reading!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { reading = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    const pages = await api.pages(); api.pages.mockImplementation(async () => { reading(); await wait; return pages; });
    const outcome = reconcileCanvaJob(f.db, request(f)).then(value => ({ value }), error => ({ error }));
    await entered;
    try { await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id)); } finally { release(); }
    expect(await outcome).toMatchObject({ error: { status: 409, extra: { code: 'source_changed' } } });
    expect(await saved(f.job.id)).toMatchObject({ status: 'result_unknown', designId: null }); expect(api.submitExport).not.toHaveBeenCalled();
  });
  it.each(['account', 'owner', 'team', 'pages', 'missing_version'])('rejects %s mismatch without changing the unknown outcome', async mismatch => {
    const f = await fixture('autofill_submitting', { status: 'result_unknown' }); designFor(f);
    if (mismatch === 'account') api.principal.mockResolvedValue({ userId: 'another_user', teamId: 'team_test' });
    if (mismatch === 'owner' || mismatch === 'team') api.design.mockResolvedValue({ id: recoveryDesignId, title: f.item.title, owner: { userId: mismatch === 'owner' ? 'another_user' : 'user_test', teamId: mismatch === 'team' ? 'another_team' : 'team_test' }, pageCount: 8, updatedAt: 123, editUrl: null });
    if (mismatch === 'pages') api.pages.mockResolvedValue({ validEightPageMaster: false, items: [] });
    if (mismatch === 'missing_version') api.design.mockResolvedValue({ id: recoveryDesignId, owner: { userId: 'user_test', teamId: 'team_test' }, pageCount: 8, updatedAt: null, editUrl: null });
    await expect(reconcileCanvaJob(f.db, request(f))).rejects.toMatchObject({ status: mismatch === 'account' ? 409 : 422 });
    expect(await saved(f.job.id)).toMatchObject({ status: 'result_unknown', designId: null }); expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitExport).not.toHaveBeenCalled();
  });
  it('does not allow concurrent different contents to claim the same orphaned design', async () => {
    const first = await fixture('autofill_submitting', { status: 'result_unknown' }), second = await fixture('autofill_submitting', { status: 'result_unknown' }); designFor(first);
    const results = await Promise.allSettled([reconcileCanvaJob(first.db, request(first)), reconcileCanvaJob(second.db, request(second))]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(value => value.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, extra: { code: 'design_already_linked' } });
    expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitExport).not.toHaveBeenCalled();
  });
  it('distinguishes replaying the original recovery from explicitly recovering a later unknown export', async () => {
    const f = await fixture('export_submitting', { status: 'result_unknown', designId: recoveryDesignId, autofillJobId: 'autofill_original' }); designFor(f);
    const first = request(f); await reconcileCanvaJob(f.db, first);
    api.submitExport.mockRejectedValueOnce(new CanvaRestError('응답 미확정', undefined, 'result_unknown', true)).mockResolvedValue({ id: 'export_after_confirmation', status: 'in_progress' });
    const unknown = await runNow(f.job.id); expect(unknown).toMatchObject({ status: 'result_unknown', phase: 'export_submitting' });
    const token = canvaRecoveryToken(unknown)!; expect(token).not.toBe(first.expectedRecoveryToken);
    await reconcileCanvaJob(f.db, first); await runCanvaJobs(f.db, 1); expect(api.submitExport).toHaveBeenCalledOnce();
    await expect(reconcileCanvaJob(f.db, { ...first, designId: 'Danother_design' })).rejects.toMatchObject({ status: 409 });
    await reconcileCanvaJob(f.db, { ...first, expectedRecoveryToken: token }); await runNow(f.job.id);
    expect(api.submitExport).toHaveBeenCalledTimes(2); expect(api.submitAutofill).not.toHaveBeenCalled();
    expect(await saved(f.job.id)).toMatchObject({ purpose: 'import', exportJobId: 'export_after_confirmation', result: { reconciled: true, reconciliationHistory: [expect.objectContaining({ recoveryToken: first.expectedRecoveryToken })] } });
  });
  it('allows an images-phase unknown job to recover through a manually completed design without resending assets', async () => {
    const f = await fixture('images', { status: 'result_unknown', errorCode: 'asset_result_unknown' }); designFor(f);
    await f.db.insert(canvaAssetUploads).values({ principal: f.job.principal, sha256: f.image.hash, status: 'unknown', errorCode: 'result_unknown' });
    await reconcileCanvaJob(f.db, request(f)); await runNow(f.job.id);
    expect(api.submitExport).toHaveBeenCalledOnce(); expect(api.submitUpload).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
    expect(await uploadFor(f.image.hash)).toMatchObject({ status: 'unknown', uploadJobId: null });
  });
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await closeDb(); });

async function fixture(phase: string, patch: Partial<typeof canvaRenderJobs.$inferInsert> = {}, options: { scientific?: boolean } = {}) {
  const db = getDb();
  const { item, revision, copy, metadata } = await createFamilyPgFixture(db, { channelId: 2, rendererProvider: 'canva', scientific: options.scientific });
  // Synthetic supported display dataset for recovery tests; no live master is asserted ready.
  const dataset = { ...expectedCanvaDataset(canvaVariant(copy)), ...Object.fromEntries(Object.keys(canvaDisplayTextFields(copy)).map(name => [name, { type: "text" }])) }; api.dataset.mockResolvedValue(dataset);
  const image = { field: "P01_IMAGE", bytes: Buffer.from(`isolated-image-${randomUUID()}`), hash: "" }; image.hash = sha256(image.bytes);
  api.prepare.mockResolvedValue([image]);
  const [master] = await db.insert(canvaMasters).values({ channelId: 2, sourceId: `master_${randomUUID()}`, sourceType: "design", sourceUpdatedAt: "123", ...canvaVariant(copy), templateVersion: randomUUID(), principal: "team_test:user_test", dataset, datasetHash: canvaInputHash(dataset), pageIds: Array.from({ length: 8 }, (_, index) => `page_${index + 1}`), validatedAt: new Date() }).returning();
  const requestId = randomUUID(), intent = { channelId: 2, itemId: item.id, version: item.version, masterId: master.id, importFromJobId: null };
  const uploadedImages = Object.fromEntries(Object.entries(dataset).filter(([, field]) => field.type === "image").map(([field]) => [field, { assetId: `asset_${field}`, hash: image.hash }]));
  const [job] = await db.insert(canvaRenderJobs).values({ channelId: 2, contentItemId: item.id, sourceRevisionId: revision.id, sourceVersion: item.version, masterId: master.id, requestId, requestHash: canvaInputHash(intent), principal: master.principal, phase, input: { payload: revision.payload, title: item.title, copy, pageDesigns: metadata.pageDesigns, evidenceSetId: metadata.evidenceBinding.evidenceSetId, mappingVersion: CANVA_MAPPING_VERSION, datasetHash: master.datasetHash }, result: phase === "images" ? null : { uploadedImages }, ...patch }).returning();
  return { db, item, revision, copy, metadata, master, job, image, request: { ...intent, importFromJobId: undefined, requestId, actor: "test-operator" } };
}
async function saved(id: number) { return (await getDb().select().from(canvaRenderJobs).where(eq(canvaRenderJobs.id, id)))[0]; }
async function runNow(id: number) { await getDb().update(canvaRenderJobs).set({ nextRunAt: new Date(0) }).where(eq(canvaRenderJobs.id, id)); await runCanvaJobs(getDb(), 1); return saved(id); }
async function uploadFor(hash: string) { return (await getDb().select().from(canvaAssetUploads).where(and(eq(canvaAssetUploads.principal, "team_test:user_test"), eq(canvaAssetUploads.sha256, hash))))[0]; }

describe("Canva durable dispatch and recovery on PostgreSQL", () => {
  it("blocks unchanged legacy static labels before preparing or uploading images", async () => {
    const f = await fixture("images");
    const legacy = expectedCanvaDataset(canvaVariant(f.copy));
    await f.db.update(canvaMasters).set({ dataset: legacy, datasetHash: canvaInputHash(legacy) }).where(eq(canvaMasters.id, f.master.id));
    expect(f.copy.pages.every(page => page.displayOverrides === undefined)).toBe(true);
    const failed = await runNow(f.job.id);
    expect(failed).toMatchObject({ status: "failed", errorCode: "canva_display_profile_unsupported" });
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });

  it("blocks a second autofill under fresh UUIDs and later source versions after an unknown response", async () => {
    const f = await fixture("autofill_prepare");
    api.submitAutofill.mockRejectedValue(new CanvaRestError("응답 미확정", undefined, "result_unknown", true));
    expect(await runNow(f.job.id)).toMatchObject({ status: "result_unknown", phase: "autofill_submitting", autofillJobId: null });
    expect((await enqueueCanvaRender(f.db, f.request)).id).toBe(f.job.id);
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    const requests = await Promise.allSettled([1, 2].map(() => enqueueCanvaRender(f.db, { ...f.request, version: f.item.version + 1, requestId: randomUUID() })));
    expect(requests.map(result => result.status)).toEqual(["rejected", "rejected"]);
    for (const result of requests) if (result.status === "rejected") expect(result.reason).toMatchObject({ status: 409, extra: { code: "result_unknown", jobId: f.job.id } });
    await runCanvaJobs(f.db, 2); expect(api.submitAutofill).toHaveBeenCalledOnce();
  });
  it("recovers a crashed submitting lease as unknown without ever issuing another POST", async () => {
    const f = await fixture("autofill_submitting", { status: "running", leaseOwner: "crashed-worker", leaseUntil: new Date(0) });
    await Promise.all([runCanvaJobs(f.db, 1), runCanvaJobs(f.db, 1)]);
    expect(await saved(f.job.id)).toMatchObject({ status: "result_unknown", autofillJobId: null });
    await expect(resumeCanvaJob(f.db, 2, f.item.id, f.job.id)).rejects.toMatchObject({ status: 409 });
    expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("keeps a POST accepted before a DB ID-write failure unknown instead of making it safely retryable", async () => {
    const f = await fixture("autofill_prepare"), original = f.db.update.bind(f.db); let injected = false;
    vi.spyOn(f.db, "update").mockImplementation(((table: any) => {
      const query = original(table); const set = query.set.bind(query);
      query.set = ((patch: any) => { if (!injected && getTableName(table) === "canva_render_jobs" && patch.autofillJobId) { injected = true; throw new Error("isolated DB write interruption"); } return set(patch); }) as typeof query.set;
      return query;
    }) as typeof f.db.update);
    expect(await runNow(f.job.id)).toMatchObject({ status: "result_unknown", phase: "autofill_submitting", autofillJobId: null });
    await expect(enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect(injected).toBe(true); expect(api.submitAutofill).toHaveBeenCalledOnce();
  });
  it("recovers a known upload ID from a malformed response with GET, including older unknown parent jobs", async () => {
    const f = await fixture("images");
    api.submitUpload.mockRejectedValue(new CanvaRestError("확인할 응답 형식", 502, "invalid_response", true, "upload_known"));
    expect(await runNow(f.job.id)).toMatchObject({ status: "queued", phase: "images" });
    expect(await uploadFor(f.image.hash)).toMatchObject({ status: "polling", uploadJobId: "upload_known" });
    await f.db.update(canvaRenderJobs).set({ status: "result_unknown", errorCode: "result_unknown" }).where(eq(canvaRenderJobs.id, f.job.id));
    await resumeCanvaJob(f.db, 2, f.item.id, f.job.id);
    api.getUpload.mockResolvedValue({ id: "upload_known", status: "success", result: { assetId: "uploaded_asset" } });
    const recovered = await runNow(f.job.id);
    expect(recovered.result).toMatchObject({ uploadedImages: { P01_IMAGE: { assetId: "uploaded_asset", hash: f.image.hash } } });
    expect(api.submitUpload).toHaveBeenCalledOnce(); expect(api.getUpload).toHaveBeenCalledOnce(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("leaves an unknown image upload blocked and never treats it as a known failure", async () => {
    const f = await fixture("images");
    api.submitUpload.mockRejectedValue(new CanvaRestError("업로드 응답 미확정", undefined, "result_unknown", true));
    expect(await runNow(f.job.id)).toMatchObject({ status: "result_unknown", phase: "images" });
    expect(await uploadFor(f.image.hash)).toMatchObject({ status: "unknown", uploadJobId: null });
    await expect(resumeCanvaJob(f.db, 2, f.item.id, f.job.id)).rejects.toMatchObject({ status: 409, extra: { code: "asset_result_unknown" } });
    await expect(enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await runCanvaJobs(f.db, 2); expect(api.submitUpload).toHaveBeenCalledOnce();
  });
  it("retries only the local upload-ID write after a transient DB error, never the accepted POST", async () => {
    const f = await fixture("images"), original = f.db.update.bind(f.db); let injected = false;
    vi.spyOn(f.db, "update").mockImplementation(((table: any) => {
      const query = original(table); const set = query.set.bind(query);
      query.set = ((patch: any) => { if (!injected && getTableName(table) === "canva_asset_uploads" && patch.uploadJobId) { injected = true; throw new Error("isolated upload-ID write interruption"); } return set(patch); }) as typeof query.set;
      return query;
    }) as typeof f.db.update);
    expect(await runNow(f.job.id)).toMatchObject({ status: "queued", phase: "images" });
    expect(await uploadFor(f.image.hash)).toMatchObject({ status: "polling", uploadJobId: "upload_new" });
    api.getUpload.mockResolvedValue({ id: "upload_new", status: "success", result: { assetId: "uploaded_asset" } });
    await runNow(f.job.id);
    expect(injected).toBe(true); expect(api.submitUpload).toHaveBeenCalledOnce(); expect(api.getUpload).toHaveBeenCalledOnce();
  });
  it("retries a confirmed upload rejection only after explicit resume and serializes concurrent resumes", async () => {
    const f = await fixture("images");
    api.submitUpload.mockRejectedValueOnce(new CanvaRestError("한도 도달", 429, "rate_limited", false)).mockResolvedValue({ id: "upload_after_retry", status: "in_progress" });
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed" });
    expect(await uploadFor(f.image.hash)).toMatchObject({ status: "failed", errorCode: "rate_limited" });
    await runCanvaJobs(f.db, 1); expect(api.submitUpload).toHaveBeenCalledOnce();
    await Promise.all([resumeCanvaJob(f.db, 2, f.item.id, f.job.id), resumeCanvaJob(f.db, 2, f.item.id, f.job.id)]);
    await Promise.all([runCanvaJobs(f.db, 1), runCanvaJobs(f.db, 1)]);
    expect(api.submitUpload).toHaveBeenCalledTimes(2); expect(await uploadFor(f.image.hash)).toMatchObject({ status: "polling", uploadJobId: "upload_after_retry" });
  });
  it("gives an explicit resume a fresh bounded wait window without resubmitting its known autofill", async () => {
    const f = await fixture("autofill_polling", { autofillJobId: "autofill_known", startedAt: new Date(Date.now() - 31 * 60_000) });
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed", errorCode: "wait_budget_exceeded" });
    await resumeCanvaJob(f.db, 2, f.item.id, f.job.id);
    expect(await runNow(f.job.id)).toMatchObject({ status: "queued", phase: "autofill_polling" });
    expect(api.getAutofill).toHaveBeenCalledOnce(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("retries a confirmed rejected autofill only on explicit resume", async () => {
    const f = await fixture("autofill_prepare");
    api.submitAutofill.mockRejectedValueOnce(new CanvaRestError("호출 한도", 429, "rate_limited", false)).mockResolvedValue({ id: "autofill_after_retry", status: "in_progress" });
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed", phase: "autofill_submitting" });
    await runCanvaJobs(f.db, 1); expect(api.submitAutofill).toHaveBeenCalledOnce();
    await resumeCanvaJob(f.db, 2, f.item.id, f.job.id); await runNow(f.job.id);
    expect(api.submitAutofill).toHaveBeenCalledTimes(2); expect(await saved(f.job.id)).toMatchObject({ autofillJobId: "autofill_after_retry", phase: "autofill_polling" });
  });
  it("requires a confirmed terminal export and expected job ID before one explicit re-export", async () => {
    const f = await fixture("export_polling", { designId: "generated_design", designUpdatedAt: "123", exportJobId: "export_old", autofillJobId: "autofill_known" });
    api.getExport.mockRejectedValue(new CanvaRestError("출력 만료", 404, "export_expired"));
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed", errorCode: "export_expired" });
    await resumeCanvaJob(f.db, 2, f.item.id, f.job.id); await runNow(f.job.id);
    expect(api.getExport).toHaveBeenCalledTimes(2); expect(api.submitExport).not.toHaveBeenCalled();
    await expect(resumeCanvaJob(f.db, 2, f.item.id, f.job.id, { action: "reexport", expectedExportJobId: "wrong_export" })).rejects.toMatchObject({ status: 409 });
    await Promise.all([1, 2].map(() => resumeCanvaJob(f.db, 2, f.item.id, f.job.id, { action: "reexport", expectedExportJobId: "export_old" })));
    await Promise.all([runCanvaJobs(f.db, 1), runCanvaJobs(f.db, 1)]);
    expect(api.submitExport).toHaveBeenCalledOnce(); expect(api.submitAutofill).not.toHaveBeenCalled();
    expect(await saved(f.job.id)).toMatchObject({ exportJobId: "export_new", phase: "export_polling", result: { previousExportJobIds: ["export_old"] } });
  });
  it("refuses a generic missing export or a Canva design changed after the saved export version", async () => {
    const f = await fixture("export_polling", { status: "failed", errorCode: "not_found", designId: "generated_design", designUpdatedAt: "123", exportJobId: "export_old" });
    await expect(resumeCanvaJob(f.db, 2, f.item.id, f.job.id, { action: "reexport", expectedExportJobId: "export_old" })).rejects.toMatchObject({ status: 409 });
    await f.db.update(canvaRenderJobs).set({ errorCode: "export_expired" }).where(eq(canvaRenderJobs.id, f.job.id));
    await resumeCanvaJob(f.db, 2, f.item.id, f.job.id, { action: "reexport", expectedExportJobId: "export_old" });
    api.design.mockResolvedValue({ id: "generated_design", pageCount: 8, updatedAt: 124, editUrl: null });
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed", errorCode: "design_changed" });
    expect(api.submitExport).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("rejects a changed master layout even when its dataset and page IDs remain identical", async () => {
    const f = await fixture("validate");
    api.design.mockResolvedValue({ id: f.master.sourceId, pageCount: 8, updatedAt: 124, editUrl: null });
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed", errorCode: "master_changed" });
    expect(api.submitUpload).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("checks the master again immediately before Autofill after asset preparation", async () => {
    const f = await fixture("autofill_prepare");
    api.design.mockResolvedValue({ id: f.master.sourceId, pageCount: 8, updatedAt: 124, editUrl: null });
    expect(await runNow(f.job.id)).toMatchObject({ status: "failed", errorCode: "master_changed" });
    expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("allows reviewing an existing edited copy without requiring access to its old master", async () => {
    const f = await fixture("validate", { purpose: "import", designId: "existing_copy" });
    api.dataset.mockRejectedValue(new Error("old master is no longer shared"));
    expect(await runNow(f.job.id)).toMatchObject({ status: "queued", phase: "export_prepare" });
    expect(api.dataset).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it('admits an existing copy after master changes and current layout changes, then waits for explicit review', async () => {
    const f = await fixture('complete', { status: 'failed', designId: 'Dexisting_copy' }, { scientific: true });
    await f.db.update(canvaMasters).set({ status: 'design_changed' }).where(eq(canvaMasters.id, f.master.id));
    const copy = familyDialogueCardFixture(); copy.pages.find(page => page.id === 'perspectives')!.layout = 'columns';
    const revision = await f.db.transaction(tx => createRevision(tx, { contentItemId: f.item.id, author: 'operator', payload: { ...f.revision.payload, cardCopy: copy, editorialPlan: { ...f.metadata.editorialPlan, conceptMode: 'value_definition', keyConcept: '똑똑함' } } }));
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    const makeRequest = () => ({ ...f.request, version: f.item.version + 1, requestId: randomUUID(), importFromJobId: f.job.id, masterId: f.master.id + 99999 });
    const [imported, duplicate] = await Promise.all([enqueueCanvaRender(f.db, makeRequest()), enqueueCanvaRender(f.db, makeRequest())]);
    expect(imported.id).toBe(duplicate.id);
    expect(imported).toMatchObject({ purpose: 'import', status: 'queued', masterId: f.master.id, principal: f.job.principal, designId: 'Dexisting_copy', sourceRevisionId: revision.id, sourceVersion: f.item.version + 1 });
    api.dataset.mockRejectedValue(new Error('old master dataset is no longer accessible'));
    api.design.mockResolvedValue({ id: 'Dexisting_copy', pageCount: 8, updatedAt: 456, owner: { userId: 'user_test', teamId: 'team_test' }, editUrl: 'https://www.canva.com/design/Dexisting_copy/edit' });
    expect(await runNow(imported.id)).toMatchObject({ status: 'queued', phase: 'export_prepare' });
    expect(await runNow(imported.id)).toMatchObject({ status: 'queued', phase: 'export_polling', designUpdatedAt: '456' });
    api.getExport.mockResolvedValue({ id: 'export_new', status: 'success', result: { urls: ['https://export-download.canva.com/isolated.zip'] } });
    await runNow(imported.id);
    const pending = await runNow(imported.id);
    expect(pending).toMatchObject({ status: 'needs_review', phase: 'complete', purpose: 'import' });
    const [pendingRevision] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, pending.outputRevisionId!));
    expect(pendingRevision.payload.dependencies).toMatchObject({ render: 'needs_review' });
    const [current] = await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id));
    expect(current.currentRevisionId).toBe(revision.id); expect(current.version).toBe(f.item.version + 1);
    expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0);
    await acceptCanvaImport(f.db, { channelId: f.item.channelId, itemId: f.item.id, jobId: imported.id, version: current.version, textConfirmedUnchanged: true, actor: 'test-operator' });
    const [accepted] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, pending.outputRevisionId!));
    expect(accepted.payload.dependencies).toEqual({ ...(pendingRevision.payload.dependencies as Record<string, unknown>), render: 'current' });
    const [afterAccept] = await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id));
    expect(afterAccept).toMatchObject({ currentRevisionId: pending.outputRevisionId, version: current.version + 1, reviewStatus: 'review_required', publishStatus: 'waiting' });
    expect(await saved(imported.id)).toMatchObject({ status: 'ready', outputRevisionId: pending.outputRevisionId, outputAssetId: pending.outputAssetId });
    expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0);
    expect(api.submitExport).toHaveBeenCalledOnce(); expect(api.dataset).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled();
  });
  it('retains ready-master, current-variant and stacked-layout requirements for new creation', async () => {
    const f = await fixture('complete', { status: 'failed', designId: 'Dexisting_copy' }, { scientific: true });
    const create = () => enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID() });
    await f.db.update(canvaMasters).set({ status: 'design_changed' }).where(eq(canvaMasters.id, f.master.id));
    await expect(create()).rejects.toMatchObject({ status: 422 });
    await f.db.update(canvaMasters).set({ status: 'ready' }).where(eq(canvaMasters.id, f.master.id));
    const columns = structuredClone(f.copy); columns.pages.find(page => page.id === 'perspectives')!.layout = 'columns';
    await f.db.update(contentRevisions).set({ payload: { ...f.revision.payload, cardCopy: columns } }).where(eq(contentRevisions.id, f.revision.id));
    await expect(create()).rejects.toMatchObject({ status: 422, message: expect.stringContaining('상하 배치') });
    await f.db.update(contentRevisions).set({ payload: { ...f.revision.payload, cardCopy: familyDialogueCardFixture(), editorialPlan: { ...f.metadata.editorialPlan, conceptMode: 'value_definition', keyConcept: '똑똑함' } } }).where(eq(contentRevisions.id, f.revision.id));
    await expect(create()).rejects.toMatchObject({ status: 422, message: expect.stringContaining('마스터') });
    expect(await f.db.select().from(canvaRenderJobs).where(eq(canvaRenderJobs.contentItemId, f.item.id))).toHaveLength(1);
    expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it('never imports another content copy or a master record from another channel', async () => {
    const first = await fixture('complete', { status: 'failed', designId: 'Dfirst_copy' }), second = await fixture('complete', { status: 'failed', designId: 'Dsecond_copy' });
    await expect(enqueueCanvaRender(first.db, { ...first.request, requestId: randomUUID(), importFromJobId: second.job.id })).rejects.toMatchObject({ status: 404 });
    await first.db.update(canvaMasters).set({ channelId: 1 }).where(eq(canvaMasters.id, first.master.id));
    await expect(enqueueCanvaRender(first.db, { ...first.request, requestId: randomUUID(), importFromJobId: first.job.id })).rejects.toMatchObject({ status: 404 });
    expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitExport).not.toHaveBeenCalled();
  });
  it('does not deduplicate a different existing design into a pending import of the same master', async () => {
    const f = await fixture('complete', { status: 'failed', designId: 'Dfirst_copy' });
    const [other] = await f.db.insert(canvaRenderJobs).values({ channelId: 2, contentItemId: f.item.id, sourceRevisionId: f.revision.id, sourceVersion: f.item.version, masterId: f.master.id, requestId: randomUUID(), requestHash: sha256('second-copy-intent'), principal: f.job.principal, input: f.job.input, status: 'failed', phase: 'complete', designId: 'Dsecond_copy' }).returning();
    const pending = await enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID(), importFromJobId: f.job.id });
    await expect(enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID(), importFromJobId: other.id })).rejects.toMatchObject({ status: 409 });
    expect(await saved(pending.id)).toMatchObject({ designId: 'Dfirst_copy', purpose: 'import', status: 'queued' });
    expect(api.submitExport).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("stores eight PNG originals and a single cover plus seven JPEG pages whose bytes/hashes match preview and publishing", async () => {
    const f = await fixture("download", { designId: "generated_design", designUpdatedAt: "123", exportJobId: "export_known" });
    api.getExport.mockResolvedValue({ id: "export_known", status: "success", result: { urls: Array.from({ length: 8 }, (_, index) => `https://export-download.canva.com/opaque-${index}`) } });
    const result = await runNow(f.job.id); expect(result.status).toBe("ready");
    const rows = await f.db.select().from(mediaAssets).where(eq(mediaAssets.revisionId, result.outputRevisionId!));
    const originalManifest = result.result!.originals as Array<{ id: number; page: number; sha256: string }>;
    expect(originalManifest.map(page => page.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(originalManifest.map(page => page.sha256)).toEqual(pngs.map(sha256));
    expect(rows.filter(row => row.kind === 'canva_export_original')).toHaveLength(8);
    const orderedOriginals = originalManifest.map(page => rows.find(row => row.id === page.id));
    expect(orderedOriginals.every(row => row?.kind === 'canva_export_original' && row.mime === 'image/png')).toBe(true);
    expect(orderedOriginals.map(row => row?.sha256)).toEqual(pngs.map(sha256));
    expect(orderedOriginals.map(row => row?.bytes)).toEqual(pngs);
    expect(rows.filter(row => row.kind === "card")).toHaveLength(1); expect(rows.filter(row => row.kind === "carousel_page")).toHaveLength(7);
    const [latestCard] = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.contentItemId, f.item.id), eq(mediaAssets.kind, "card"))).orderBy(desc(mediaAssets.id)).limit(1);
    expect(latestCard.id).toBe(result.outputAssetId); expect(latestCard.carousel?.pages).toHaveLength(8);
    const loaded = await loadCardPages(f.db, latestCard);
    expect(loaded.map(page => page.sha256)).toEqual(jpegs.map(sha256)); expect(loaded.map(page => sha256(page.bytes))).toEqual(jpegs.map(sha256));
    expect(loaded.map(page => page.mime)).toEqual(Array(8).fill("image/jpeg"));
    const [current] = await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id));
    expect(current.currentRevisionId).toBe(result.outputRevisionId); expect(current.version).toBe(f.item.version + 1);
    const [currentRevision] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, current.currentRevisionId!));
    expect(currentRevision.payload.dependencies).toEqual({ ...(f.revision.payload.dependencies as Record<string, unknown>), render: 'current' });
    expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0);
    expect(await f.db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId, f.item.id))).toHaveLength(2);
    await runCanvaJobs(f.db, 1); expect(api.download).toHaveBeenCalledOnce(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
});


/** Synthetic ready masters and mocked provider/layout responses exercise only
 * durable profile routing. They are not evidence of live Canva registration. */
async function readingFixture(phase: string, patch: Partial<typeof canvaRenderJobs.$inferInsert> = {}, key = "reading-ink-lime-v1") {
  const f = await fixture(phase, patch), profile = readingProfileForTemplateKey(key);
  if (!profile) throw new Error("Reading profile fixture missing");
  f.copy.templateKey = profile.templateKey;
  f.copy.pages.find(page => page.id === "outro")!.fields.logoAssetId = READING_PROFILE_LOGO_ID;
  f.metadata.pageDesigns = readingProfileDesigns(profile, f.metadata.pageDesigns);
  Object.assign(f.revision.payload, f.metadata, { cardCopy: f.copy });
  await f.db.update(contentRevisions).set({ payload: f.revision.payload }).where(eq(contentRevisions.id, f.revision.id));
  await f.db.update(contentItems).set({ edited: f.revision.payload }).where(eq(contentItems.id, f.item.id));
  const dataset = expectedCanvaDataset(canvaVariant(f.copy), profile), datasetHash = canvaInputHash(dataset);
  const [existing] = await f.db.select().from(canvaMasters).where(and(
    eq(canvaMasters.channelId, 2), eq(canvaMasters.templateVersion, profile.templateVersion),
    eq(canvaMasters.conceptMode, canvaVariant(f.copy).conceptMode), eq(canvaMasters.hasExternalActivity, false),
  )).limit(1);
  const [master] = await f.db.update(canvaMasters).set({ templateVersion: profile.templateVersion, status: "ready", sourceUpdatedAt: "123", dataset, datasetHash })
    .where(eq(canvaMasters.id, existing?.id ?? f.master.id)).returning();
  const request = { ...f.request, masterId: master.id };
  const intent = { channelId: 2, itemId: f.item.id, version: f.item.version, masterId: master.id, importFromJobId: null };
  const uploadedImages = Object.fromEntries(profile.images.map(slot => [slot.field, { assetId: "asset_" + slot.field, hash: f.image.hash }]));
  const input = { payload: f.revision.payload, title: f.item.title, copy: f.copy, pageDesigns: f.metadata.pageDesigns,
    evidenceSetId: f.metadata.evidenceBinding.evidenceSetId, ...snapshotCanvaProfile(profile), datasetHash, artworkCredits: {} };
  const [job] = await f.db.update(canvaRenderJobs).set({ masterId: master.id, requestHash: canvaInputHash(intent), input,
    result: phase === "images" ? null : { uploadedImages }, updatedAt: new Date() }).where(eq(canvaRenderJobs.id, f.job.id)).returning();
  api.dataset.mockResolvedValue(dataset);
  api.prepare.mockResolvedValue(profile.images.map(slot => ({ ...f.image, field: slot.field })));
  return { ...f, profile, master, job, request, uploadedImages };
}

describe("reading profile admission and recovery with synthetic Canva datasets", () => {
  it("rejects an unapproved profile/source pairing before registration or new create", async () => {
    const f = await readingFixture("complete", { status: "failed" });
    api.sourceApproved.mockReturnValue(false);
    await expect(registerCanvaMaster(f.db, { channelId: 2, sourceId: f.master.sourceId, ...canvaVariant(f.copy), templateVersion: f.profile.templateVersion, actor: "test-operator" }))
      .rejects.toMatchObject({ status: 422, extra: { code: "canva_profile_source_unapproved" } });
    await expect(enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID() }))
      .rejects.toMatchObject({ status: 422, extra: { code: "canva_profile_source_unapproved" } });
    expect(api.design).not.toHaveBeenCalled(); expect(api.dataset).not.toHaveBeenCalled();
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("does not register a reading master whose actual mocked dataset is missing its profile image", async () => {
    const profile = readingProfileForTemplateKey("reading-ink-lime-v1")!, copy = familyDialogueCardFixture();
    const dataset = expectedCanvaDataset(canvaVariant(copy), profile); delete dataset.P08_PROFILE_IMAGE;
    api.dataset.mockResolvedValue(dataset);
    const sourceId = "Dmissing_profile_" + randomUUID();
    await expect(registerCanvaMaster(getDb(), { channelId: 2, sourceId, ...canvaVariant(copy), templateVersion: profile.templateVersion, actor: "test-operator" }))
      .rejects.toMatchObject({ status: 422, extra: { code: "dataset_mismatch" } });
    expect(await getDb().select().from(canvaMasters).where(eq(canvaMasters.sourceId, sourceId))).toHaveLength(0);
    expect(api.submitAutofill).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled();
  });
  it("pins the selected profile at admission and submits 46 texts plus four uploaded image fields", async () => {
    const f = await readingFixture("complete", { status: "failed" });
    // This same 46/4 master serves both concept modes and activity variants.
    // Only legacy masters require separate variant registrations.
    await f.db.update(canvaMasters).set({ conceptMode: "scientific_explanation", hasExternalActivity: true }).where(eq(canvaMasters.id, f.master.id));
    const admitted = await enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID() });
    expect(admitted.input).toMatchObject(snapshotCanvaProfile(f.profile));
    expect(api.layout).toHaveBeenCalledTimes(8);
    await f.db.update(canvaRenderJobs).set({ phase: "autofill_prepare", result: { uploadedImages: f.uploadedImages } }).where(eq(canvaRenderJobs.id, admitted.id));
    const submitted = await runNow(admitted.id);
    expect(submitted).toMatchObject({ status: "queued", phase: "autofill_polling", autofillJobId: "autofill_new" });
    const data = api.submitAutofill.mock.calls[0][1].data as Record<string, { type: string; asset_id?: string }>;
    expect(Object.values(data).filter(value => value.type === "text")).toHaveLength(46);
    expect(Object.keys(data).filter(name => data[name].type === "image")).toEqual([
      "P01_COVER_IMAGE", "P04_CONTEXT_IMAGE", "P07_ACTIVITY_IMAGE", "P08_PROFILE_IMAGE",
    ]);
    expect(data.P08_PROFILE_IMAGE.asset_id).toBe("asset_P08_PROFILE_IMAGE");
    expect(data).not.toHaveProperty("P01_IMAGE"); expect(data).not.toHaveProperty("P01_HEADER_BRAND");
    expect(api.submitAutofill).toHaveBeenCalledOnce(); expect(api.submitUpload).not.toHaveBeenCalled();
  });
  it("checks real-layout overflow before admitting an upload or autofill job", async () => {
    const f = await readingFixture("complete", { status: "failed" }, "reading-cobalt-paper-v1");
    api.layout.mockImplementation(() => { throw new CardOverflowError("P02_READING_BODY", "fixture overflow"); });
    await expect(enqueueCanvaRender(f.db, { ...f.request, requestId: randomUUID() }))
      .rejects.toMatchObject({ status: 422, extra: { code: "canva_text_overflow", field: "P02_READING_BODY" } });
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
  it("passes the pinned profile to image retry and rejects a changed snapshot before preparing images", async () => {
    const f = await readingFixture("images", { status: "failed" });
    await resumeCanvaJob(f.db, 2, f.item.id, f.job.id);
    expect(api.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ profile: expect.objectContaining({ id: f.profile.id }), copy: f.copy }));
    api.prepare.mockClear();
    const current = await saved(f.job.id);
    await f.db.update(canvaRenderJobs).set({ status: "failed", input: { ...current.input, profileTemplateVersion: "different-version" } }).where(eq(canvaRenderJobs.id, f.job.id));
    await expect(resumeCanvaJob(f.db, 2, f.item.id, f.job.id))
      .rejects.toMatchObject({ status: 409, extra: { code: "canva_profile_changed" } });
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled();
  });
  it("keeps the original profile through reconciliation after the editor selects a different profile", async () => {
    const f = await readingFixture("autofill_submitting", { status: "result_unknown" });
    const changed = structuredClone(f.copy), other = readingProfileForTemplateKey("reading-cobalt-paper-v1")!;
    changed.templateKey = other.templateKey;
    const revision = await createRevision(f.db, { contentItemId: f.item.id, author: "operator",
      payload: { ...f.revision.payload, cardCopy: changed, pageDesigns: readingProfileDesigns(other, f.metadata.pageDesigns) } });
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    api.design.mockResolvedValue({ id: recoveryDesignId, title: f.item.title, owner: { userId: "user_test", teamId: "team_test" }, pageCount: 8, updatedAt: 123, editUrl: null });
    const linked = await reconcileCanvaJob(f.db, { channelId: 2, itemId: f.item.id, jobId: f.job.id, version: f.item.version + 1,
      designId: recoveryDesignId, confirmed: true, expectedRecoveryToken: canvaRecoveryToken(f.job)!, actor: "test-operator" });
    expect(linked.input).toMatchObject({ ...snapshotCanvaProfile(f.profile), copy: { templateKey: other.templateKey } });
    expect(linked).toMatchObject({ purpose: "import", sourceRevisionId: revision.id, phase: "export_prepare" });
    expect(linked.result).toMatchObject({ reconciliation: { datasetCheck: "matches", sourceInputHash: canvaInputHash(linked.input) } });
    await runNow(f.job.id);
    expect(api.submitExport).toHaveBeenCalledOnce();
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.submitUpload).not.toHaveBeenCalled(); expect(api.submitAutofill).not.toHaveBeenCalled();
  });
});
