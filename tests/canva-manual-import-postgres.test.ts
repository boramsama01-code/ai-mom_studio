/** Real PostgreSQL/API/PNG persistence; synthetic Canva only, no paid or SNS calls. */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approvals, auditLogs, canvaLibraryDesigns, canvaMasters, canvaRenderJobs, contentItems, contentRevisions, mediaAssets } from '../shared/schema';
import { CANVA_MANUAL_MAPPING_VERSION } from '../shared/canvaManualImport';
import { CANVA_READING_MASTERS } from '../shared/canvaMasterCatalog';
import { createFamilyPgFixture } from './fixtures/familyEvidencePg';
import { login, resetDb, setTestEnv } from './helpers';
if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) throw Error('Explicit isolated TEST_DATABASE_URL ending _test required');
setTestEnv();
const provider = vi.hoisted(() => ({ principal: vi.fn(), design: vi.fn(), pages: vi.fn(), capabilities: vi.fn(), dataset: vi.fn(), autofill: vi.fn(), upload: vi.fn(), submit: vi.fn(), poll: vi.fn(), download: vi.fn(), jpegs: vi.fn() }));
vi.mock('../server/services/canvaRest', async original => ({ ...await original<object>(), getCanvaPrincipal: provider.principal, getCanvaDesign: provider.design, getCanvaPages: provider.pages,
  getCanvaCapabilities: provider.capabilities, getCanvaDataset: provider.dataset, submitCanvaAutofill: provider.autofill, submitCanvaAssetUpload: provider.upload, submitCanvaExport: provider.submit, getCanvaExportJob: provider.poll }));
vi.mock('../server/services/canvaEditorialAssets', async original => ({ ...await original<object>(), downloadCanvaExport: provider.download, publicationJpegs: provider.jpegs }));
const { getDb, closeDb } = await import('../server/db');
const { createApp } = await import('../server/app');
const { enqueueCanvaManualImport } = await import('../server/services/canvaManualImport');
const { enqueueCanvaRender, runCanvaJobs, acceptCanvaImport, resumeCanvaJob, canvaJobDto } = await import('../server/services/canvaEditorial');
const { assertCanvaReusableArtifact } = await import('../server/services/canvaPublication');
const { reconcileCanvaJob, canvaRecoveryToken } = await import('../server/services/canvaReconciliation');
const { CanvaRestError } = await import('../server/services/canvaRest');
const { createRevision } = await import('../server/content');
const { sha256 } = await import('../server/services/text');
let pngs: Buffer[], jpegs: Buffer[];
const principal = { userId: 'manual_user', teamId: 'manual_team' };
const geometry = () => ({ validEightPageMaster: true, items: Array.from({ length: 8 }, (_, i) => ({ id: `page_${i + 1}`, pageNumber: i + 1, width: 1080, height: 1350, thumbnailUrl: null })) });
beforeAll(async () => {
  await resetDb();
  pngs = await Promise.all(Array.from({ length: 8 }, (_, i) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: i * 25, g: 90, b: 120 } } }).png().toBuffer()));
  jpegs = await Promise.all(pngs.map(png => sharp(png).jpeg({ quality: 95 }).toBuffer()));
});
beforeEach(async () => {
  for (const mock of Object.values(provider)) mock.mockReset();
  await getDb().update(canvaRenderJobs).set({ status: 'cancelled' });
  provider.principal.mockResolvedValue(principal);
  provider.design.mockImplementation(async (_db, id: string) => ({ id, title: '직접 편집한 QA 복사본', owner: principal, pageCount: 8, updatedAt: 123,
    editUrl: `https://www.canva.com/design/${id}/edit`, viewUrl: null }));
  provider.pages.mockImplementation(async () => geometry());
  provider.capabilities.mockResolvedValue({ capabilities: [] });
  provider.submit.mockResolvedValue({ id: 'manual_export', status: 'in_progress' });
  provider.poll.mockResolvedValue({ id: 'manual_export', status: 'success', result: { urls: ['https://export-download.canva.com/fixture'] } });
  provider.download.mockResolvedValue(pngs); provider.jpegs.mockResolvedValue(jpegs);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No real provider call allowed in manual import tests'); }));
});
afterEach(() => {
  expect(provider.autofill).not.toHaveBeenCalled(); expect(provider.upload).not.toHaveBeenCalled(); expect(provider.dataset).not.toHaveBeenCalled();
  expect(provider.capabilities).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
afterAll(closeDb);
async function fixture() {
  const db = getDb(), family = await createFamilyPgFixture(db);
  return { db, ...family, args: { channelId: family.item.channelId, itemId: family.item.id, version: family.item.version, requestId: randomUUID(), designId: `Dmanual_${randomUUID()}`, confirmed: true as const, actor: 'test-operator' } };
}
async function saved(id: number) { return (await getDb().select().from(canvaRenderJobs).where(eq(canvaRenderJobs.id, id)))[0]; }
async function step(id: number) { await getDb().update(canvaRenderJobs).set({ nextRunAt: new Date(0) }).where(eq(canvaRenderJobs.id, id)); await runCanvaJobs(getDb(), 1); return saved(id); }
async function exported(f: Awaited<ReturnType<typeof fixture>>) {
  const job = await enqueueCanvaManualImport(f.db, f.args);
  await step(job.id); await step(job.id); const ready = await step(job.id);
  expect(ready.status).toBe('needs_review'); return ready;
}

describe('manual Canva copies without Autofill on PostgreSQL', () => {
  it('stores genuine export-only provenance, keeps current content, then requires comparison before immutable publication proof', async () => {
    const f = await fixture();
    const [oldAsset] = await f.db.insert(mediaAssets).values({ channelId: f.item.channelId, contentItemId: f.item.id, revisionId: f.revision.id, sha256: sha256(jpegs[0]), bytes: jpegs[0], width: 1080, height: 1350 }).returning();
    const [approval] = await f.db.insert(approvals).values({ channelId: f.item.channelId, contentItemId: f.item.id, revisionId: f.revision.id, mediaAssetId: oldAsset.id, cardSha256: oldAsset.sha256, captions: { instagram: '이전 승인', telegram: '이전 승인' }, approvedBy: 'test', scheduledAt: new Date() }).returning();
    const job = await exported(f);
    expect(job).toMatchObject({ masterId: null, purpose: 'import', autofillJobId: null, sourceRevisionId: f.revision.id, sourceVersion: f.item.version });
    expect(job.input).toMatchObject({ mappingVersion: CANVA_MANUAL_MAPPING_VERSION, datasetHash: null, manualImport: { kind: 'manual_copy', designId: f.args.designId, designUpdatedAt: 123 } });
    expect(await f.db.select().from(canvaMasters)).toHaveLength(0);
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].currentRevisionId).toBe(f.revision.id);
    expect((await f.db.select().from(approvals).where(eq(approvals.id, approval.id)))[0].status).toBe('active');
    expect((job.result!.pages as unknown[])).toHaveLength(8); expect((job.result!.originals as unknown[])).toHaveLength(8);
    const [output] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, job.outputRevisionId!));
    expect(output.payload.canvaExport).toMatchObject({ sourceDesignId: null, datasetHash: null, autofillJobId: null, manualImport: job.input.manualImport });
    await acceptCanvaImport(f.db, { ...f.args, jobId: job.id, textConfirmedUnchanged: true });
    const [item] = await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id));
    const [revision] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId!));
    const [asset] = await f.db.select().from(mediaAssets).where(eq(mediaAssets.id, job.outputAssetId!));
    expect(item).toMatchObject({ version: f.item.version + 1, reviewStatus: 'review_required', publishStatus: 'waiting' });
    expect((await f.db.select().from(approvals).where(eq(approvals.id, approval.id)))[0].status).toBe('invalidated');
    expect(await assertCanvaReusableArtifact(f.db, { item, revision, asset })).toMatchObject({ jobId: job.id, pages: expect.any(Array), originals: expect.any(Array) });
    expect(provider.submit).toHaveBeenCalledExactlyOnceWith(expect.anything(), f.args.designId);
    await expect(acceptCanvaImport(f.db, { ...f.args, version: item.version, jobId: job.id, textConfirmedUnchanged: true })).rejects.toMatchObject({ status: 409 });
    await f.db.update(contentRevisions).set({ payload: { ...revision.payload, canvaExport: { ...(revision.payload.canvaExport as object), manualImport: { ...(job.input.manualImport as object), principal: 'other:user' } } } }).where(eq(contentRevisions.id, revision.id));
    const [tampered] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, revision.id));
    await expect(assertCanvaReusableArtifact(f.db, { item, revision: tampered, asset })).rejects.toMatchObject({ status: 409 });
  });

  it('serializes same-UUID double clicks and replays its receipt offline after a source edit', async () => {
    const f = await fixture(), [a, b] = await Promise.all([enqueueCanvaManualImport(f.db, f.args), enqueueCanvaManualImport(f.db, f.args)]);
    expect(a.id).toBe(b.id);
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    provider.principal.mockRejectedValue(Error('disconnected')); provider.design.mockRejectedValue(Error('disconnected'));
    const calls = provider.principal.mock.calls.length;
    expect((await enqueueCanvaManualImport(f.db, f.args)).id).toBe(a.id); expect(provider.principal.mock.calls.length).toBe(calls);
    await expect(enqueueCanvaManualImport(f.db, { ...f.args, designId: 'Ddifferent_copy' })).rejects.toMatchObject({ status: 409 });
    const other = await fixture(); await expect(enqueueCanvaManualImport(f.db, { ...other.args, requestId: f.args.requestId })).rejects.toMatchObject({ status: 409 });
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('blocks new-UUID duplicates while a job is active', async () => {
    const f = await fixture(), results = await Promise.allSettled([enqueueCanvaManualImport(f.db, f.args), enqueueCanvaManualImport(f.db, { ...f.args, requestId: randomUUID() })]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  });

  it('serializes different content locks when both try to bind the same design', async () => {
    const a = await fixture(), b = await fixture();
    const results = await Promise.allSettled([enqueueCanvaManualImport(a.db, a.args), enqueueCanvaManualImport(b.db, { ...b.args, designId: a.args.designId })]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 409, extra: { code: 'design_already_linked' } } });
  });

  it.each(['catalog', 'registered', 'prepared'] as const)('rejects a %s template original without exporting or creating a master', async kind => {
    const f = await fixture();
    if (kind === 'catalog') await f.db.insert(canvaLibraryDesigns).values({ principal: 'manual_team:manual_user', folderId: 'folder', sourceType: 'design', sourceId: f.args.designId, title: '원본 보존', seenAt: new Date() });
    if (kind === 'registered') await f.db.insert(canvaMasters).values({ channelId: f.item.channelId, conceptMode: 'value_definition', hasExternalActivity: false, templateVersion: randomUUID(), sourceType: 'design', sourceId: f.args.designId, sourceUpdatedAt: '123', principal: 'manual_team:manual_user', dataset: {}, datasetHash: 'a'.repeat(64), pageIds: [], validatedAt: new Date() });
    if (kind === 'prepared') f.args.designId = CANVA_READING_MASTERS[0].sourceId;
    await expect(enqueueCanvaManualImport(f.db, f.args)).rejects.toMatchObject({ status: 422 }); expect(provider.submit).not.toHaveBeenCalled();
    expect(await f.db.select().from(canvaRenderJobs).where(eq(canvaRenderJobs.contentItemId, f.item.id))).toHaveLength(0);
  });

  it.each(['owner', 'id', 'count', 'geometry', 'version'] as const)('rejects invalid live %s metadata', async kind => {
    const f = await fixture(), design = await provider.design(f.db, f.args.designId);
    if (kind === 'owner') design.owner = { ...principal, userId: 'other_user' };
    if (kind === 'id') design.id = 'Dwrong_copy';
    if (kind === 'count') design.pageCount = 7;
    if (kind === 'version') design.updatedAt = null;
    provider.design.mockResolvedValue(design);
    if (kind === 'geometry') provider.pages.mockResolvedValue({ ...geometry(), validEightPageMaster: false });
    await expect(enqueueCanvaManualImport(f.db, f.args)).rejects.toMatchObject({ status: 422 }); expect(provider.submit).not.toHaveBeenCalled();
  });

  it('rechecks the source version after read-only provider validation', async () => {
    const f = await fixture(); provider.pages.mockImplementationOnce(async () => { await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id)); return geometry(); });
    await expect(enqueueCanvaManualImport(f.db, f.args)).rejects.toMatchObject({ status: 409 }); expect(provider.submit).not.toHaveBeenCalled();
  });

  it('rejects account switches during validation and before export', async () => {
    const f = await fixture(); provider.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce({ ...principal, teamId: 'other_team' });
    await expect(enqueueCanvaManualImport(f.db, f.args)).rejects.toMatchObject({ status: 409 });
    provider.principal.mockResolvedValue(principal); const job = await enqueueCanvaManualImport(f.db, f.args);
    provider.principal.mockResolvedValue({ ...principal, teamId: 'other_team' });
    expect(await step(job.id)).toMatchObject({ status: 'failed', errorCode: 'account_changed' }); expect(provider.submit).not.toHaveBeenCalled();
  });

  it.each(['version', 'page_identity'] as const)('pins %s before exporting', async kind => {
    const f = await fixture(), job = await enqueueCanvaManualImport(f.db, f.args);
    if (kind === 'version') provider.design.mockImplementation(async (_db, id) => ({ id, owner: principal, pageCount: 8, updatedAt: 124 }));
    else { const pages = geometry(); pages.items[0].id = 'other_page'; provider.pages.mockResolvedValue(pages); }
    expect(await step(job.id)).toMatchObject({ status: 'failed', errorCode: 'design_changed' }); expect(provider.submit).not.toHaveBeenCalled();
  });

  it('rechecks the principal after export metadata returns', async () => {
    const f=await fixture(),job=await enqueueCanvaManualImport(f.db,f.args);
    provider.pages.mockImplementationOnce(async()=>{provider.principal.mockResolvedValue({...principal,teamId:'switched_during_metadata'});return geometry();});
    expect(await step(job.id)).toMatchObject({status:'failed',errorCode:'account_changed'});expect(provider.submit).not.toHaveBeenCalled();
  });

  it('keeps a lost export response unknown until explicit reconciliation of the real copy', async () => {
    const f = await fixture(), job = await enqueueCanvaManualImport(f.db, f.args);
    provider.submit.mockRejectedValueOnce(new CanvaRestError('Lost export receipt', undefined, 'result_unknown', true));
    const unknown = await step(job.id); expect(unknown).toMatchObject({ status: 'result_unknown', exportJobId: null });
    expect((await enqueueCanvaManualImport(f.db, f.args)).id).toBe(job.id);
    await expect(enqueueCanvaManualImport(f.db, { ...f.args, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(resumeCanvaJob(f.db, f.args.channelId, f.item.id, job.id)).rejects.toMatchObject({ status: 409 });
    expect(provider.submit).toHaveBeenCalledTimes(1);
    const recovered = await reconcileCanvaJob(f.db, { ...f.args, jobId: job.id, expectedRecoveryToken: canvaRecoveryToken(unknown)! });
    expect(recovered.input.manualImport).toMatchObject({ designId: f.args.designId });
    await step(job.id); await step(job.id); expect(await step(job.id)).toMatchObject({ status: 'needs_review' });
    expect(provider.submit).toHaveBeenCalledTimes(2);
  });

  it('preserves late output after a source edit and refuses stale acceptance', async () => {
    const f = await fixture(), job = await enqueueCanvaManualImport(f.db, f.args); await step(job.id); await step(job.id);
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    expect(await step(job.id)).toMatchObject({ status: 'superseded', outputRevisionId: expect.any(Number) });
    await expect(acceptCanvaImport(f.db, { ...f.args, version: f.item.version + 1, jobId: job.id, textConfirmedUnchanged: true })).rejects.toMatchObject({ status: 409 });
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].currentRevisionId).toBe(f.revision.id);
  });

  it('supports a fresh comparison of the same manual copy after the manuscript changes', async () => {
    const f = await fixture(), job = await exported(f);
    const revision = await createRevision(f.db, { contentItemId: f.item.id, author: 'operator', payload: f.revision.payload, note: '다시 대조할 저장본' });
    await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
    const next = await enqueueCanvaRender(f.db, { channelId: f.item.channelId, itemId: f.item.id, version: f.item.version + 1, requestId: randomUUID(), importFromJobId: job.id, actor: 'test-operator' });
    expect(next).toMatchObject({ masterId: null, purpose: 'import', designId: f.args.designId, sourceRevisionId: revision.id, sourceVersion: f.item.version + 1 });
  });

  it('uses real geometry and design version when Canva omits page identities', async () => {
    const f=await fixture();provider.pages.mockResolvedValue({...geometry(),items:geometry().items.map(page=>({...page,id:null}))});
    const job=await exported(f);expect(job.input.manualImport).toMatchObject({designUpdatedAt:123,pagesHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  });

  it('recovers a known export only by polling after process loss', async () => {
    const f=await fixture(),job=await enqueueCanvaManualImport(f.db,f.args);await step(job.id);
    await f.db.update(canvaRenderJobs).set({status:'running',leaseOwner:'terminated-owner',leaseUntil:new Date(0),nextRunAt:new Date(0)}).where(eq(canvaRenderJobs.id,job.id));
    expect(await step(job.id)).toMatchObject({phase:'download',exportJobId:'manual_export'});
    expect(await step(job.id)).toMatchObject({status:'needs_review'});expect(provider.submit).toHaveBeenCalledTimes(1);
  });

  it('marks an interrupted export dispatch unknown instead of submitting again', async () => {
    const f=await fixture(),job=await enqueueCanvaManualImport(f.db,f.args);
    await f.db.update(canvaRenderJobs).set({status:'running',phase:'export_submitting',leaseOwner:'terminated-owner',leaseUntil:new Date(0)}).where(eq(canvaRenderJobs.id,job.id));
    expect(await step(job.id)).toMatchObject({status:'result_unknown',exportJobId:null});expect(provider.submit).not.toHaveBeenCalled();
    await expect(enqueueCanvaManualImport(f.db,{...f.args,requestId:randomUUID()})).rejects.toMatchObject({status:409});
  });

  it('does not save a design modified while its PNGs download', async () => {
    const f=await fixture(),job=await enqueueCanvaManualImport(f.db,f.args);await step(job.id);await step(job.id);
    provider.download.mockImplementationOnce(async()=>{provider.design.mockImplementation(async(_db,id)=>({id,owner:principal,pageCount:8,updatedAt:124}));return pngs;});
    expect(await step(job.id)).toMatchObject({status:'failed',errorCode:'design_changed',outputAssetId:null});
    expect(await f.db.select().from(mediaAssets).where(eq(mediaAssets.contentItemId,f.item.id))).toHaveLength(0);
  });

  it('rejects a source edit during the operator comparison without consuming the output', async () => {
    const f=await fixture(),job=await exported(f);await f.db.update(contentItems).set({version:f.item.version+1}).where(eq(contentItems.id,f.item.id));
    await expect(acceptCanvaImport(f.db,{...f.args,version:f.item.version+1,jobId:job.id,textConfirmedUnchanged:true})).rejects.toMatchObject({status:409});
    expect(await saved(job.id)).toMatchObject({status:'needs_review',outputRevisionId:job.outputRevisionId});
  });

  it('does not let a generic masterless create job bypass the manual-copy binding', async () => {
    const f=await fixture();
    await expect(f.db.insert(canvaRenderJobs).values({channelId:f.item.channelId,contentItemId:f.item.id,sourceRevisionId:f.revision.id,sourceVersion:f.item.version,masterId:null,
      requestId:randomUUID(),requestHash:'a'.repeat(64),purpose:'create',principal:'manual_team:manual_user',input:{},designId:f.args.designId})).rejects.toThrow();
  });

  it('protects the API with login, CSRF, scope and explicit manual-copy confirmation', async () => {
    const f = await fixture(), app = createApp(), url = `/api/channels/${f.item.channelId}/items/${f.item.id}/canva/manual-imports`;
    const body = { version: f.args.version, requestId: f.args.requestId, designId: f.args.designId, confirmed: true };
    expect((await request(app).post(url).send(body)).status).toBe(401);
    const { agent, csrf } = await login(app);
    expect((await agent.post(url).send(body)).status).toBe(403);
    expect((await agent.post(url).set('x-csrf-token', csrf).send({ ...body, confirmed: false })).status).toBe(400);
    expect((await agent.post(url.replace(`/channels/${f.item.channelId}/`, '/channels/1/')).set('x-csrf-token', csrf).send(body)).status).toBe(404);
    const response = await agent.post(url).set('x-csrf-token', csrf).send(body); expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ purpose: 'import', designId: f.args.designId, result: { manualImport: { kind: 'manual_copy' } } });
    const list = await agent.get(url.replace('/manual-imports', '/jobs')); expect(list.body.items.some((value: { id: number }) => value.id === response.body.id)).toBe(true);
    expect(canvaJobDto(await saved(response.body.id)).result).toMatchObject({ manualImport: expect.any(Object) });
    expect(await f.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'canva_manual_import_requested'), eq(auditLogs.entityId, String(response.body.id))))).toHaveLength(1);
  });
});
