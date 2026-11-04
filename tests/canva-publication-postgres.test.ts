/** Real approval transactions and real evidence records. External APIs and export downloads are mocked. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { approvals, canvaMasters, canvaRenderJobs, contentItems, contentRevisions, deliveries, mediaAssets } from "../shared/schema";
import { CANVA_MAPPING_VERSION, canvaVariant, expectedCanvaDataset } from "../shared/canvaEditorial";
import type { CardCopyV2 } from '../shared/familyDialogue';
import { login, resetDb, setTestEnv } from "./helpers";
import { createFamilyPgFixture } from "./fixtures/familyEvidencePg";
setTestEnv();
const api = vi.hoisted(() => ({ export: vi.fn(), design: vi.fn(), download: vi.fn(), jpegs: vi.fn(), identity: vi.fn(), publish: vi.fn() }));
vi.mock("../server/services/canvaRest", async original => ({ ...await original<object>(), getCanvaExportJob: api.export, getCanvaDesign: api.design }));
vi.mock("../server/services/canvaEditorialAssets", async original => ({ ...await original<object>(), downloadCanvaExport: api.download, publicationJpegs: api.jpegs }));
vi.mock("../server/services/instagram", async original => ({ ...await original<object>(), accountIdentity: api.identity, publishContainer: api.publish }));
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const { publicationFixture, publicationAccounts } = await import("./fixtures/publication");
const { runCanvaJobs } = await import("../server/services/canvaEditorial");
const { canvaInputHash } = await import("../server/services/canvaEditorialAssets");
const { approveItem } = await import("../server/worker/publish");
const { cardApprovalHash, loadCardPages } = await import("../server/services/cardCarousel");
const { confirmFamilyCaption } = await import("../server/services/familyEditorialPersistence");
const { createRevision } = await import("../server/content");
let pngs: Buffer[], jpegs: Buffer[];
beforeAll(async () => {
  await resetDb();
  pngs = await Promise.all(Array.from({ length: 8 }, (_, index) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: index * 25, g: 110, b: 60 } } }).png().toBuffer()));
  jpegs = await Promise.all(pngs.map(png => sharp(png).jpeg({ quality: 95 }).toBuffer()));
});
beforeEach(async () => {
  for (const mock of Object.values(api)) mock.mockReset();
  await getDb().update(canvaRenderJobs).set({ status: "cancelled" });
  for (const [key, value] of Object.entries({ CLOUDINARY_CLOUD_NAME: "fixture", CLOUDINARY_API_KEY: "fixture", CLOUDINARY_API_SECRET: "fixture", AUTO_PUBLISH: "true", DRY_RUN: "false", INLINE_WORKER: "false", INSTAGRAM_API_VERSION: "v26.0" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real external API calls prohibited in Canva publication test"); }));
  api.identity.mockImplementation(async (token: string) => ({ ok: true, ...publicationAccounts.get(token)! }));
  api.export.mockResolvedValue({ id: "export_known", status: "success", result: { urls: Array.from({ length: 8 }, (_, index) => `https://export-download.canva.com/opaque-${index}`) } });
  api.design.mockResolvedValue({ id: "generated_design", pageCount: 8, updatedAt: 123, editUrl: "https://www.canva.com/design/generated_design/edit" });
  api.download.mockResolvedValue(pngs); api.jpegs.mockResolvedValue(jpegs);
});
afterEach(() => { expect(api.publish).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(closeDb);

async function exportedFixture() {
  const publication = await publicationFixture("cancelled"), db = getDb();
  const family = await createFamilyPgFixture(db, { channelId: publication.channel.id, rendererProvider: "canva" });
  const dataset = expectedCanvaDataset(canvaVariant(family.copy)), datasetHash = canvaInputHash(dataset);
  const [master] = await db.insert(canvaMasters).values({ channelId: family.item.channelId, sourceId: `master_${randomUUID()}`, sourceType: "design", sourceUpdatedAt: "123", ...canvaVariant(family.copy), templateVersion: randomUUID(), principal: "team_test:user_test", dataset, datasetHash, pageIds: Array.from({ length: 8 }, (_, index) => `page_${index + 1}`), validatedAt: new Date() }).returning();
  const [job] = await db.insert(canvaRenderJobs).values({ channelId: family.item.channelId, contentItemId: family.item.id, sourceRevisionId: family.revision.id, sourceVersion: family.item.version, masterId: master.id, requestId: randomUUID(), requestHash: canvaInputHash({ item: family.item.id, revision: family.revision.id }), principal: master.principal, phase: "download", designId: "generated_design", designUpdatedAt: "123", exportJobId: "export_known", autofillJobId: "autofill_known", input: { payload: family.revision.payload, title: family.item.title, copy: family.copy, pageDesigns: family.metadata.pageDesigns, evidenceSetId: family.metadata.evidenceBinding.evidenceSetId, mappingVersion: CANVA_MAPPING_VERSION, datasetHash } }).returning();
  await runCanvaJobs(db, 1);
  const [completed] = await db.select().from(canvaRenderJobs).where(eq(canvaRenderJobs.id, job.id)); expect(completed.status).toBe("ready");
  const [revision] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, completed.outputRevisionId!));
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, completed.outputAssetId!));
  const captions = { instagram: family.metadata.captionPackage!.fullCaption, telegram: "검토한 원문과 카드의 캡션" };
  await db.update(contentItems).set({ reviewStatus: "reviewed", publicationDraft: { version: 1, captions } }).where(eq(contentItems.id, family.item.id));
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, family.item.id));
  const request = { itemId: item.id, revisionId: revision.id, mediaAssetId: asset.id, destinationIds: [publication.destination.id], publicationDraftVersion: 1, requestId: randomUUID(), captions, scheduledAt: new Date(Date.now() + 3600_000), actor: "test-operator" };
  return { db, item, revision, asset, job: completed, request, publication };
}

it("approves one exact eight-page Canva artifact using real evidence and preserves its JPEG approval hash", async () => {
  const f = await exportedFixture();
  const result = await approveItem(f.db, f.request);
  expect(result.ok, !result.ok ? result.error : undefined).toBe(true); if (!result.ok) throw new Error(result.error);
  expect(result.approval.cardSha256).toBe(cardApprovalHash(await loadCardPages(f.db, f.asset)));
  expect(result.approval.revisionId).toBe(f.revision.id); expect(result.approval.mediaAssetId).toBe(f.asset.id);
  expect(await f.db.select().from(deliveries).where(eq(deliveries.approvalId, result.approval.id))).toHaveLength(1);
  expect(api.identity).toHaveBeenCalledOnce();
});

it("rejects a built-in replacement or a lost original PNG before any account preflight", async () => {
  const f = await exportedFixture();
  await f.db.update(mediaAssets).set({ source: "builtin" }).where(eq(mediaAssets.id, f.asset.id));
  await expect(approveItem(f.db, f.request)).rejects.toMatchObject({ status: 409, extra: { code: "canva_publication_mismatch" } });
  await f.db.update(mediaAssets).set({ source: "canva" }).where(eq(mediaAssets.id, f.asset.id));
  const [original] = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, f.revision.id), eq(mediaAssets.kind, "canva_export_original"))).limit(1);
  await f.db.delete(mediaAssets).where(eq(mediaAssets.id, original.id));
  await expect(approveItem(f.db, f.request)).rejects.toMatchObject({ status: 409, extra: { code: "canva_publication_mismatch" } });
  expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0); expect(api.identity).not.toHaveBeenCalled();
});

it("rechecks Canva binding under the item lock after account preflight awaits", async () => {
  const f = await exportedFixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  api.identity.mockImplementationOnce(async (token: string) => { entered(); await blocked; return { ok: true, ...publicationAccounts.get(token)! }; });
  const work = approveItem(f.db, f.request), outcome = work.then(value => ({ value }), error => ({ error }));
  try {
    await Promise.race([started, outcome.then(result => { throw new Error(`Approval ended before account barrier: ${JSON.stringify(result)}`); })]);
    const [original] = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, f.revision.id), eq(mediaAssets.kind, "canva_export_original"))).limit(1);
    await f.db.update(mediaAssets).set({ bytes: Buffer.from("isolated storage corruption") }).where(eq(mediaAssets.id, original.id));
  } finally { release(); }
  expect(await outcome).toMatchObject({ error: { status: 409, extra: { code: "canva_publication_mismatch" } } });
  expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0);
});

it("blocks an old caption binding and an old render after an immutable content revision changes", async () => {
  const f = await exportedFixture();
  const changed = { ...f.revision.payload, captionPackage: { ...(f.revision.payload.captionPackage as Record<string, unknown>), contentRevision: f.job.sourceRevisionId } };
  await f.db.update(contentRevisions).set({ payload: changed }).where(eq(contentRevisions.id, f.revision.id));
  await expect(approveItem(f.db, f.request)).rejects.toMatchObject({ status: 409 });
  await f.db.update(contentRevisions).set({ payload: f.revision.payload }).where(eq(contentRevisions.id, f.revision.id));
  const [newer] = await f.db.insert(contentRevisions).values({ contentItemId: f.item.id, revisionNo: f.revision.revisionNo + 1, author: "operator", payload: f.revision.payload }).returning();
  await f.db.update(contentItems).set({ currentRevisionId: newer.id }).where(eq(contentItems.id, f.item.id));
  expect(await approveItem(f.db, f.request)).toMatchObject({ ok: false, error: expect.stringContaining("최신 버전") });
  expect(api.identity).not.toHaveBeenCalled(); expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0);
});

it("downloads stored originals as PNG and the publication derivative as JPEG", async () => {
  const f = await exportedFixture(), { agent } = await login(createApp());
  const [original] = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, f.revision.id), eq(mediaAssets.kind, "canva_export_original"))).limit(1);
  const png = await agent.get(`/api/channels/${f.item.channelId}/media/${original.id}?download=1`);
  expect(png.status).toBe(200); expect(png.headers["content-type"]).toContain("image/png"); expect(png.headers["content-disposition"]).toMatch(/\.png"$/);
  const jpeg = await agent.get(`/api/channels/${f.item.channelId}/media/${f.asset.id}?download=1`);
  expect(jpeg.status).toBe(200); expect(jpeg.headers["content-type"]).toContain("image/jpeg"); expect(jpeg.headers["content-disposition"]).toMatch(/\.jpg"$/);
});

async function savedManualCaption(f: Awaited<ReturnType<typeof exportedFixture>>, version = 2) {
  const metadata = f.revision.payload as { editorialPlan: { coreQuestion: string } };
  const captions = { instagram: `직접 확인한 뉴스 설명입니다.\n${metadata.editorialPlan.coreQuestion}\n가족의 다른 생각을 함께 나눠 주세요.`, telegram: '직접 확인한 게시 설명' };
  await f.db.update(contentItems).set({ publicationDraft: { version, captions } }).where(eq(contentItems.id, f.item.id));
  return captions;
}

it('reuses all sixteen exact artifact bytes after a stale caption is manually confirmed without any Canva or AI request', async () => {
  const f = await exportedFixture(), oldPages = await loadCardPages(f.db, f.asset);
  const oldOriginals = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, f.revision.id), eq(mediaAssets.kind, 'canva_export_original')));
  const stale = { ...f.revision.payload, dependencies: { ...(f.revision.payload.dependencies as Record<string, unknown>), caption: 'needs_review' } };
  await f.db.update(contentRevisions).set({ payload: stale }).where(eq(contentRevisions.id, f.revision.id));
  const captions = await savedManualCaption(f);
  for (const mock of [api.export, api.design, api.download, api.jpegs]) mock.mockClear();
  const confirmed = await confirmFamilyCaption(f.db, f.item.id, f.item.channelId, { version: f.item.version, publicationDraftVersion: 2, textConfirmed: true }, 'test-operator');
  expect(confirmed.canvaOutputReused).toBe(true);
  const [cached] = await f.db.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.outputRevisionId, confirmed.revisionId), eq(canvaRenderJobs.purpose, 'caption_rebind')));
  expect(cached).toMatchObject({ status: 'ready', phase: 'complete', designId: f.job.designId, exportJobId: f.job.exportJobId, autofillJobId: f.job.autofillJobId, sourceRevisionId: f.revision.id, result: { reusedFromJobId: f.job.id, reuseReason: 'caption_only', exportedAt: f.job.result!.exportedAt } });
  expect(cached.requestHash).not.toBe(f.job.requestHash); expect(cached.requestId).not.toBe(f.job.requestId);
  const [asset] = await f.db.select().from(mediaAssets).where(eq(mediaAssets.id, cached.outputAssetId!));
  const pages = await loadCardPages(f.db, asset), originals = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, confirmed.revisionId), eq(mediaAssets.kind, 'canva_export_original')));
  expect(pages.map(page => page.id)).not.toEqual(oldPages.map(page => page.id));
  expect(pages.map(page => page.sha256)).toEqual(oldPages.map(page => page.sha256));
  expect(pages.map(page => page.bytes)).toEqual(oldPages.map(page => page.bytes));
  expect(originals.map(page => page.sha256).sort()).toEqual(oldOriginals.map(page => page.sha256).sort());
  expect(originals.map(page => page.bytes.toString('base64')).sort()).toEqual(oldOriginals.map(page => page.bytes.toString('base64')).sort());
  for (const mock of [api.export, api.design, api.download, api.jpegs]) expect(mock).not.toHaveBeenCalled();
  await f.db.update(contentItems).set({ reviewStatus: 'reviewed' }).where(eq(contentItems.id, f.item.id));
  const result = await approveItem(f.db, { ...f.request, revisionId: confirmed.revisionId, mediaAssetId: asset.id, captions, publicationDraftVersion: 2, requestId: randomUUID() });
  expect(result.ok, !result.ok ? result.error : undefined).toBe(true); if (!result.ok) throw new Error(result.error);
  expect(result.approval.cardSha256).toBe(cardApprovalHash(oldPages)); expect(result.approval.revisionId).toBe(confirmed.revisionId); expect(result.approval.mediaAssetId).toBe(asset.id);
});

it('does not reuse old card images when card wording changed before manual caption confirmation', async () => {
  const f = await exportedFixture();
  const copy = structuredClone(f.revision.payload.cardCopy) as CardCopyV2;
  copy.pages.find(page => page.id === 'cover')!.fields.headline = '다르게 고친 표지 문구';
  const updated = await f.db.transaction(tx => createRevision(tx, { contentItemId: f.item.id, author: 'operator', payload: { ...f.revision.payload, cardCopy: copy } }));
  await f.db.update(contentItems).set({ version: f.item.version + 1 }).where(eq(contentItems.id, f.item.id));
  await savedManualCaption(f);
  for (const mock of [api.export, api.design, api.download, api.jpegs]) mock.mockClear();
  const confirmed = await confirmFamilyCaption(f.db, f.item.id, f.item.channelId, { version: f.item.version + 1, publicationDraftVersion: 2, textConfirmed: true }, 'test-operator');
  expect(confirmed.canvaOutputReused).toBe(false); expect(confirmed.revisionId).not.toBe(updated.id);
  expect(await f.db.select().from(mediaAssets).where(eq(mediaAssets.revisionId, confirmed.revisionId))).toHaveLength(0);
  expect(await f.db.select().from(canvaRenderJobs).where(eq(canvaRenderJobs.outputRevisionId, confirmed.revisionId))).toHaveLength(0);
  for (const mock of [api.export, api.design, api.download, api.jpegs]) expect(mock).not.toHaveBeenCalled();
});

it('refuses a corrupt export during caption reuse and rolls the new content revision back', async () => {
  const f = await exportedFixture(); await savedManualCaption(f);
  const [original] = await f.db.select().from(mediaAssets).where(and(eq(mediaAssets.revisionId, f.revision.id), eq(mediaAssets.kind, 'canva_export_original'))).limit(1);
  await f.db.update(mediaAssets).set({ bytes: Buffer.from('corrupt retained original') }).where(eq(mediaAssets.id, original.id));
  await expect(confirmFamilyCaption(f.db, f.item.id, f.item.channelId, { version: f.item.version, publicationDraftVersion: 2, textConfirmed: true }, 'test-operator')).rejects.toMatchObject({ status: 409, extra: { code: 'canva_publication_mismatch' } });
  const [item] = await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id));
  expect(item.currentRevisionId).toBe(f.revision.id); expect(item.version).toBe(f.item.version); expect(item.publicationDraft?.version).toBe(2);
  expect(await f.db.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId, f.item.id), eq(canvaRenderJobs.purpose, 'caption_rebind')))).toHaveLength(0);
});

it('serializes manual caption confirmations and rejects a later publication-caption edit before preflight', async () => {
  const f = await exportedFixture(); const captions = await savedManualCaption(f);
  const body = { version: f.item.version, publicationDraftVersion: 2, textConfirmed: true as const };
  const attempts = await Promise.allSettled([confirmFamilyCaption(f.db, f.item.id, f.item.channelId, body, 'first-operator'), confirmFamilyCaption(f.db, f.item.id, f.item.channelId, body, 'second-operator')]);
  expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(attempts.filter(value => value.status === 'rejected')).toHaveLength(1);
  const [cached] = await f.db.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId, f.item.id), eq(canvaRenderJobs.purpose, 'caption_rebind')));
  const editedCaptions = { ...captions, instagram: `${captions.instagram}\n확인 뒤 새 설명을 더했습니다.` };
  await f.db.update(contentItems).set({ reviewStatus: 'reviewed', publicationDraft: { version: 3, captions: editedCaptions } }).where(eq(contentItems.id, f.item.id));
  await expect(approveItem(f.db, { ...f.request, revisionId: cached.outputRevisionId!, mediaAssetId: cached.outputAssetId!, captions: editedCaptions, publicationDraftVersion: 3, requestId: randomUUID() })).rejects.toMatchObject({ status: 409, extra: { code: 'canva_publication_mismatch' } });
  expect(api.identity).not.toHaveBeenCalled(); expect(await f.db.select().from(approvals).where(eq(approvals.contentItemId, f.item.id))).toHaveLength(0);
});
