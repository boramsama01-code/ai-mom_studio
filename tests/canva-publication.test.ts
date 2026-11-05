import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../server/db";
import type { mediaAssets, contentItems } from "../shared/schema";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { snapshotCanvaProfile } from "../shared/canvaEditorial";
import { CANVA_LIBRARY_MAPPING_VERSION } from '../shared/canvaTemplateLibrary';
import { LEGACY_READING_PROFILE_IDS, readingProfileForTemplateKey } from "../shared/readingCardProfiles";
import { sha256 } from "../server/services/text";
const calls = vi.hoisted(() => ({ evidence: vi.fn(), pages: vi.fn() }));
vi.mock("../server/services/familyEditorialPersistence", () => ({ assertFamilyEvidenceForCopy: calls.evidence }));
vi.mock("../server/services/cardCarousel", () => ({ loadCardPages: calls.pages }));
const { assertCanvaPublication, assertCanvaReusableArtifact } = await import("../server/services/canvaPublication");
type Asset = typeof mediaAssets.$inferSelect;
let state: ReturnType<typeof fixture>;
function fixture() {
  const copy = familyDialogueCardFixture(), original = familyDialogueMetadataFixture(1), metadata = familyDialogueMetadataFixture(2);
  const pages = Array.from({ length: 8 }, (_, index) => {
    const bytes = Buffer.from(`isolated-jpeg-${index}`);
    return { id: 101 + index, channelId: 2, contentItemId: 1, revisionId: 2, kind: index === 0 ? "card" : "carousel_page", source: "canva", mime: "image/jpeg", templateKey: "canva:design_test", width: 1080, height: 1350, bytes, sha256: sha256(bytes), carousel: null } as Asset;
  });
  const originals = pages.map((page, index) => { const bytes = Buffer.from(`isolated-png-${index}`); return { ...page, id: 201 + index, kind: "canva_export_original", mime: "image/png", bytes, sha256: sha256(bytes) }; });
  const exportedAt = "2026-11-04T00:00:00.000Z", datasetHash = sha256("dataset"), requestHash = sha256("request");
  const result = { pages: pages.map(page => ({ id: page.id, sha256: page.sha256 })), originals: originals.map((page, index) => ({ id: page.id, sha256: page.sha256, page: index + 1 })), templateVersion: "v1", datasetHash, mappingVersion: "mapping1", exportedAt, contentRevision: 1, evidenceSetId: metadata.evidenceBinding.evidenceSetId };
  pages[0].carousel = { version: 1, rendererProvider: "canva", pages: pages.map(page => ({ id: page.id, sha256: page.sha256, title: "카드" })), copy, cover: { kind: "upload", credit: "Canva" } };
  const trace = { rendererProvider: "canva", canvaDesignId: "design_test", sourceDesignId: "master_test", dataFieldMappingVersion: "mapping1", templateVersion: "v1", datasetHash, requestHash, contentRevision: 1, evidenceSetId: metadata.evidenceBinding.evidenceSetId, autofillJobId: "autofill_test", exportJobId: "export_test", designUpdatedAt: "123", exportedAt };
  const job = { id: 10, designId: "design_test", autofillJobId: "autofill_test", exportJobId: "export_test", sourceRevisionId: 1, requestHash, designUpdatedAt: "123", result, input: { payload: { ...original, cardCopy: copy }, copy, pageDesigns: metadata.pageDesigns, evidenceSetId: metadata.evidenceBinding.evidenceSetId, mappingVersion: "mapping1", datasetHash } };
  return { pages, originals, job: job as typeof job | null, input: { item: { id: 1, channelId: 2, currentRevisionId: 2, publicationDraft: null as (typeof contentItems.$inferSelect)['publicationDraft'] }, revision: { id: 2, contentItemId: 1, payload: { ...metadata, cardCopy: copy, rendererProvider: "canva", canvaExport: trace } as Record<string, any> }, asset: pages[0] } };
}
const db = {
  select(selection?: unknown) {
    let table = "";
    const query: any = { from(value: any) { table = getTableName(value); return query; }, where() { return query; },
      then(resolve: any, reject: any) { return Promise.resolve(table === "canva_render_jobs" ? state.job ? [state.job] : [] : selection ? state.pages.map(page => ({ id: page.id, kind: page.kind })) : state.originals).then(resolve, reject); } };
    return query;
  },
} as unknown as DB;
beforeEach(() => { state = fixture(); calls.evidence.mockReset().mockResolvedValue({}); calls.pages.mockReset().mockImplementation(async () => state.pages); });

function bindProfile(key = 'cardnews14-cinematic-v1') {
  const profile = readingProfileForTemplateKey(key)!;
  const { mappingVersion, ...binding } = snapshotCanvaProfile(profile);
  Object.assign(state.job!.input, binding, { mappingVersion });
  Object.assign(state.job!.result, binding, { mappingVersion, templateVersion: profile.templateVersion });
  Object.assign(state.input.revision.payload.canvaExport, binding, { dataFieldMappingVersion: mappingVersion, templateVersion: profile.templateVersion });
  state.input.revision.payload.cardCopy.templateKey = profile.templateKey;
  return [state.job!.input, state.job!.result, state.input.revision.payload.canvaExport] as Record<string, unknown>[];
}

describe("Canva approval artifact binding", () => {
  it('accepts the immutable folder design snapshot and rejects its loss in any publication record',async()=>{
    const snapshot={designId:'Dsource',sourceUpdatedAt:'123',datasetHash:state.job!.input.datasetHash,pageIds:Array.from({length:8},(_,index)=>`page_${index+1}`),title:'직접 편집한 원본',imagePolicy:'preserve_canva'};
    const source=state.job!.input as Record<string,unknown>,result=state.job!.result as Record<string,unknown>,trace=state.input.revision.payload.canvaExport;
    Object.assign(source,{mappingVersion:CANVA_LIBRARY_MAPPING_VERSION,folderTemplate:snapshot});
    Object.assign(result,{mappingVersion:CANVA_LIBRARY_MAPPING_VERSION,folderTemplate:snapshot});
    Object.assign(trace,{sourceDesignId:'Dsource',dataFieldMappingVersion:CANVA_LIBRARY_MAPPING_VERSION,folderTemplate:snapshot});
    expect((await assertCanvaPublication(db,state.input))?.jobId).toBe(10);
    for(const record of [source,result,trace]){
      delete record.folderTemplate;
      await expect(assertCanvaPublication(db,state.input)).rejects.toMatchObject({extra:{code:'canva_publication_mismatch'}});
      record.folderTemplate=snapshot;
    }
    trace.folderTemplate={...snapshot,sourceUpdatedAt:'124'};
    await expect(assertCanvaPublication(db,state.input)).rejects.toMatchObject({extra:{code:'canva_publication_mismatch'}});
  });
  it("accepts one frozen output with the same current caption, evidence, order and original hashes", async () => {
    const proof = await assertCanvaPublication(db, state.input);
    expect(proof?.jobId).toBe(10); expect(proof?.pages).toHaveLength(8);
    expect(calls.evidence).toHaveBeenCalledOnce(); expect(calls.pages).toHaveBeenCalledWith(db, state.input.asset);
  });
  it("does not change the existing v1 publication contract", async () => {
    state.input.revision.payload.cardCopy = { version: 1 };
    expect(await assertCanvaPublication(db, state.input)).toBeNull(); expect(calls.evidence).not.toHaveBeenCalled(); expect(calls.pages).not.toHaveBeenCalled();
  });
  it.each(LEGACY_READING_PROFILE_IDS)('accepts the historical %s export without source fingerprint fields', async key => {
    const records = bindProfile(key);
    for (const record of records) { expect(record).not.toHaveProperty('sourceLayoutSha256'); expect(record).not.toHaveProperty('sourceAssetsSha256'); }
    expect((await assertCanvaPublication(db, state.input))?.jobId).toBe(10);
  });
  it('validates a completed export against its stored source after the catalog changes', async () => {
    // These are preserved historical hashes, deliberately different from the
    // current profile. An immutable 16-file export needs no new provider call.
    for (const record of bindProfile()) Object.assign(record, { sourceLayoutSha256: '3'.repeat(64), sourceAssetsSha256: '4'.repeat(64) });
    expect((await assertCanvaPublication(db, state.input))?.jobId).toBe(10);
    expect((await assertCanvaReusableArtifact(db, state.input))?.jobId).toBe(10);
  });
  it.each([
    [0, 'sourceLayoutSha256'], [1, 'sourceLayoutSha256'], [2, 'sourceLayoutSha256'],
    [0, 'sourceAssetsSha256'], [1, 'sourceAssetsSha256'], [2, 'sourceAssetsSha256'],
  ] as const)('blocks a changed fingerprint in artifact record %s / %s', async (index, field) => {
    bindProfile()[index][field] = '0'.repeat(64);
    await expect(assertCanvaPublication(db, state.input)).rejects.toMatchObject({ status: 409, extra: { code: 'canva_publication_mismatch' } });
    expect(calls.pages).not.toHaveBeenCalled(); expect(calls.evidence).not.toHaveBeenCalled();
  });
  it.each(['sourceLayoutSha256', 'sourceAssetsSha256', 'both'] as const)('does not downgrade a new export by removing %s from every stored record', async missing => {
    for (const record of bindProfile()) {
      if (missing !== 'sourceAssetsSha256') delete record.sourceLayoutSha256;
      if (missing !== 'sourceLayoutSha256') delete record.sourceAssetsSha256;
    }
    await expect(assertCanvaPublication(db, state.input)).rejects.toMatchObject({ status: 409, extra: { code: 'canva_publication_mismatch' } });
    expect(calls.pages).not.toHaveBeenCalled(); expect(calls.evidence).not.toHaveBeenCalled();
  });
  it.each(["caption_revision", "caption_review", "caption_changed", "evidence", "copy", "background", "renderer", "revision", "job", "order", "missing_page", "builtin_page", "second_cover", "original_hash", "missing_original"])("blocks %s mismatches before an approval can be stored", async mutation => {
    const payload = state.input.revision.payload;
    if (mutation === "caption_revision") payload.captionPackage.contentRevision = 1;
    if (mutation === "caption_review") payload.dependencies.caption = "needs_review";
    if (mutation === "caption_changed") payload.captionPackage.fullCaption = "다른 원고의 캡션";
    if (mutation === "evidence") payload.evidenceBinding = { ...payload.evidenceBinding, evidenceSetId: "foreign-evidence" };
    if (mutation === "copy") { payload.cardCopy = structuredClone(payload.cardCopy); payload.cardCopy.pages[0].fields.headline = "출력 뒤 바뀐 제목"; }
    if (mutation === "background") { payload.pageDesigns = structuredClone(payload.pageDesigns); payload.pageDesigns.cover.background.color = "#ffffff"; }
    if (mutation === "renderer") payload.rendererProvider = "builtin";
    if (mutation === "revision") state.input.item.currentRevisionId = 3;
    if (mutation === "job") state.job = null;
    if (mutation === "order") state.input.asset.carousel!.pages.reverse();
    if (mutation === "missing_page") state.job!.result.pages.pop();
    if (mutation === "builtin_page") state.pages[3].source = "builtin";
    if (mutation === "second_cover") state.pages[7].kind = "card";
    if (mutation === "original_hash") state.originals[2].bytes = Buffer.from("corrupted PNG bytes");
    if (mutation === "missing_original") state.originals.pop();
    await expect(assertCanvaPublication(db, state.input)).rejects.toMatchObject({ status: 409, extra: { code: "canva_publication_mismatch" } });
    expect(calls.evidence).not.toHaveBeenCalled();
  });
  it("propagates the existing immutable-evidence validator's failure", async () => {
    calls.evidence.mockRejectedValue(new Error("고정 근거 소유권이 다릅니다"));
    await expect(assertCanvaPublication(db, state.input)).rejects.toThrow("고정 근거 소유권");
    expect(calls.evidence.mock.calls[0][2]).toEqual(state.input.revision.payload.cardCopy);
  });
  it('can prove unchanged image artifacts for caption replacement without authorizing a stale caption for publication', async () => {
    state.input.revision.payload.dependencies.caption = 'needs_review'; state.input.revision.payload.captionPackage = null;
    await expect(assertCanvaPublication(db, state.input)).rejects.toMatchObject({ status: 409 });
    const proof = await assertCanvaReusableArtifact(db, state.input);
    expect(proof?.pages).toHaveLength(8); expect(proof?.originals).toHaveLength(8); expect(proof?.jobId).toBe(10);
    state.originals[0].bytes = Buffer.from('changed original');
    await expect(assertCanvaReusableArtifact(db, state.input)).rejects.toMatchObject({ status: 409 });
  });
  it('requires the current saved publication caption to match an explicit manual confirmation', async () => {
    const old = state.input.revision.payload.captionPackage, fullCaption = `  직접 확인한 캡션\n${old.coreQuestion}\n  `;
    const manual = { origin: 'manual' as const, contentRevision: 1, coreQuestion: old.coreQuestion, fullCaption, sourceCredit: old.sourceCredit, confirmation: { comparedRevision: 1, publicationDraftVersion: 7, confirmedAt: '2026-11-04T00:00:00.000Z', captionHash: sha256(fullCaption) } };
    state.job!.input.payload.captionPackage = manual as any;
    state.input.revision.payload.captionPackage = { ...manual, contentRevision: 2 };
    state.input.item.publicationDraft = { version: 7, captions: { instagram: fullCaption, telegram: '' } };
    expect((await assertCanvaPublication(db, state.input))?.jobId).toBe(10);
    state.input.item.publicationDraft = { version: 8, captions: { instagram: `${fullCaption}\n확인 뒤 수정`, telegram: '' } };
    await expect(assertCanvaPublication(db, state.input)).rejects.toMatchObject({ status: 409, extra: { code: 'canva_publication_mismatch' } });
  });
});
