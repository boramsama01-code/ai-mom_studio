/** Canva exports are immutable publication artifacts, not inputs to another renderer. */
import { and, eq, inArray } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { DB } from "../db";
import { canvaRenderJobs, contentItems, contentRevisions, mediaAssets } from "../../shared/schema";
import { captionPackageSchema, familyCardCopySchema, pageDesignsSchema } from "../../shared/familyDialogue";
import { HttpError } from "../routes/util";
import { familyMetadataFromPayload } from "./familyEditorial";
import { assertFamilyEvidenceForCopy } from "./familyEditorialPersistence";
import { loadCardPages } from "./cardCarousel";
import { sha256 } from "./text";

type Item = Pick<typeof contentItems.$inferSelect, "id" | "channelId" | "currentRevisionId"> & Partial<Pick<typeof contentItems.$inferSelect, "publicationDraft">>;
type Revision = Pick<typeof contentRevisions.$inferSelect, "id" | "contentItemId" | "payload">;
type Asset = typeof mediaAssets.$inferSelect;
const id = z.number().int().positive(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const imageIdentity = z.object({ id, sha256: hash });
const exportMetadata = z.object({ rendererProvider: z.literal("canva"), canvaDesignId: z.string().min(1), templateVersion: z.string().min(1), sourceDesignId: z.string().min(1), dataFieldMappingVersion: z.string().min(1), datasetHash: hash, contentRevision: id, evidenceSetId: z.string().min(1), requestHash: hash, autofillJobId: z.string().nullable(), exportJobId: z.string().min(1), designUpdatedAt: z.string().min(1), exportedAt: z.string().datetime() });
const exportResult = z.object({ pages: z.array(imageIdentity).length(8), originals: z.array(imageIdentity.extend({ page: z.number().int().min(1).max(8) })).length(8), templateVersion: z.string().min(1), datasetHash: hash, mappingVersion: z.string().min(1), exportedAt: z.string().datetime(), contentRevision: id, evidenceSetId: z.string().min(1) });
const exportInput = z.object({ payload: z.record(z.string(), z.unknown()), copy: familyCardCopySchema, pageDesigns: pageDesignsSchema, evidenceSetId: z.string().min(1), mappingVersion: z.string().min(1), datasetHash: hash });
function invalid(message: string): never { throw new HttpError(409, message, { code: "canva_publication_mismatch" }); }
type ArtifactInput = { item: Item; revision: Revision; asset: Asset };
export type CanvaArtifactProof = { pages: Asset[]; originals: Asset[]; jobId: number; job: typeof canvaRenderJobs.$inferSelect };

/** Called before preflight and again under approveItem's existing item lock. */
export async function assertCanvaPublication(db: DB, input: ArtifactInput): Promise<CanvaArtifactProof | null> {
  return checkCanvaArtifact(db, input, true);
}

/** Only a local caption-rebind operation may reuse pixels while replacing an old caption.
 * This proves all 16 files and their source/evidence binding; it never approves publication. */
export async function assertCanvaReusableArtifact(db: DB, input: ArtifactInput): Promise<CanvaArtifactProof | null> {
  return checkCanvaArtifact(db, input, false);
}

async function checkCanvaArtifact(db: DB, input: ArtifactInput, requireCurrentCaption: boolean): Promise<CanvaArtifactProof | null> {
  const { item, revision, asset } = input;
  const rawCopy = revision.payload.cardCopy as { version?: unknown } | undefined;
  // Existing v1 publications retain their original contract.
  if (rawCopy?.version !== 2) return null;
  if (revision.payload.rendererProvider !== "canva") {
    if (asset.source === "canva") invalid("현재 원고의 렌더러와 Canva 출력이 다릅니다. 현재 저장본으로 만든 이미지를 선택해 주세요.");
    return null;
  }
  if (item.currentRevisionId !== revision.id || revision.contentItemId !== item.id || asset.contentItemId !== item.id || asset.channelId !== item.channelId || asset.revisionId !== revision.id) invalid("Canva 출력이 현재 원고 버전과 다릅니다. 최신 저장본의 8장을 확인해 주세요.");
  const copy = familyCardCopySchema.safeParse(revision.payload.cardCopy), metadata = familyMetadataFromPayload(revision.payload), exported = exportMetadata.safeParse(revision.payload.canvaExport);
  if (!copy.success || !metadata || !exported.success) invalid("Canva 출력의 원고·근거·생성 기록을 확인할 수 없습니다. 8장 원고를 저장한 뒤 다시 출력해 주세요.");
  const caption = metadata.captionPackage;
  if (requireCurrentCaption && (!caption || caption.contentRevision !== revision.id || metadata.dependencies.caption !== "current" || caption.coreQuestion !== metadata.editorialPlan.coreQuestion)) invalid("캡션이 현재 원고 버전과 연결되지 않았습니다. 현재 원고의 캡션을 확인·저장해 주세요. 카드 이미지가 같다면 기존 8장을 재사용합니다.");
  if (requireCurrentCaption && caption?.origin === "manual") {
    const savedCaption = item.publicationDraft?.captions.instagram;
    if (typeof savedCaption !== "string" || savedCaption.trim() !== caption.fullCaption || sha256(savedCaption) !== caption.confirmation.captionHash) invalid("직접 대조한 뒤 게시 캡션이 다시 바뀌었습니다. 저장된 캡션과 현재 카드를 다시 대조 확인해 주세요.");
  }
  if (asset.kind !== "card" || asset.source !== "canva" || asset.mime !== "image/jpeg" || asset.width !== 1080 || asset.height !== 1350 || asset.carousel?.rendererProvider !== "canva" || !isDeepStrictEqual(asset.carousel.copy, copy.data)) invalid("Canva에서 확정한 8장 출력이 아닙니다. 다른 렌더러의 이미지나 단일 페이지는 승인할 수 없습니다.");

  const [job] = await db.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.channelId, item.channelId), eq(canvaRenderJobs.contentItemId, item.id), eq(canvaRenderJobs.outputRevisionId, revision.id), eq(canvaRenderJobs.outputAssetId, asset.id), eq(canvaRenderJobs.status, "ready"), eq(canvaRenderJobs.phase, "complete")));
  if (!job) invalid("검수가 끝난 Canva 출력 작업을 찾을 수 없습니다. 가져온 디자인의 문구를 먼저 대조해 주세요.");
  const result = exportResult.safeParse(job.result), planned = exportInput.safeParse(job.input);
  if (!result.success || !planned.success) invalid("Canva 출력 기록에 8장 이미지 또는 원본 PNG가 빠져 있습니다. 현재 출력은 승인하지 않았습니다.");
  const trace = exported.data, artifacts = result.data, source = planned.data;
  if (job.designId !== trace.canvaDesignId || job.exportJobId !== trace.exportJobId || job.autofillJobId !== trace.autofillJobId || job.requestHash !== trace.requestHash || job.designUpdatedAt !== trace.designUpdatedAt || job.sourceRevisionId !== trace.contentRevision || artifacts.contentRevision !== job.sourceRevisionId) invalid("Canva 디자인·외부 작업·원고 버전 기록이 서로 다릅니다. 기존 게시 승인은 사용하지 않았습니다.");
  if (asset.templateKey !== `canva:${job.designId}` || artifacts.templateVersion !== trace.templateVersion || artifacts.datasetHash !== trace.datasetHash || source.datasetHash !== trace.datasetHash || artifacts.mappingVersion !== trace.dataFieldMappingVersion || source.mappingVersion !== trace.dataFieldMappingVersion || artifacts.exportedAt !== trace.exportedAt) invalid("Canva 템플릿·출력 버전 정보가 현재 이미지와 일치하지 않습니다.");
  if (trace.evidenceSetId !== metadata.evidenceBinding.evidenceSetId || artifacts.evidenceSetId !== trace.evidenceSetId || source.evidenceSetId !== trace.evidenceSetId || !isDeepStrictEqual(source.payload.evidenceBinding, metadata.evidenceBinding) || !isDeepStrictEqual(source.copy, copy.data) || !isDeepStrictEqual(source.pageDesigns, metadata.pageDesigns)) invalid("Canva 출력 이후 문구·배경·근거가 바뀌었습니다. 현재 원고로 다시 출력해 주세요.");
  if (requireCurrentCaption) {
    const sourceCaption = captionPackageSchema.safeParse(source.payload.captionPackage);
    if (!sourceCaption.success || sourceCaption.data.contentRevision !== job.sourceRevisionId || !isDeepStrictEqual({ ...sourceCaption.data, contentRevision: revision.id }, caption)) invalid("Canva 출력에 연결된 캡션과 현재 캡션 버전이 다릅니다. 현재 원고와 캡션을 확인해 주세요.");
  }

  const manifest = asset.carousel!.pages;
  if (manifest.length !== 8 || artifacts.pages.some((page, index) => page.id !== manifest[index].id || page.sha256 !== manifest[index].sha256) || new Set(artifacts.pages.map(page => page.id)).size !== 8 || new Set(artifacts.originals.map(page => page.id)).size !== 8 || artifacts.originals.some((page, index) => page.page !== index + 1) || artifacts.originals.some(page => artifacts.pages.some(jpeg => jpeg.id === page.id))) invalid("Canva 8장의 순서·파일 목록이 출력 기록과 다릅니다. 일부 페이지만 승인하지 않았습니다.");
  const publicationRows = await db.select({ id: mediaAssets.id, kind: mediaAssets.kind }).from(mediaAssets).where(and(eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.revisionId, revision.id), inArray(mediaAssets.kind, ["card", "carousel_page"])));
  if (publicationRows.length !== 8 || publicationRows.filter(page => page.kind === "card").length !== 1 || publicationRows.some(page => !artifacts.pages.some(expected => expected.id === page.id))) invalid("현재 원고에 정확한 8장 게시 파일이 보존되지 않았습니다.");
  const pages = await loadCardPages(db, asset);
  if (pages.length !== 8 || pages.some((page, index) => page.kind !== (index === 0 ? "card" : "carousel_page") || page.channelId !== item.channelId || page.source !== "canva" || page.mime !== "image/jpeg" || page.width !== 1080 || page.height !== 1350 || page.templateKey !== asset.templateKey || page.sha256 !== artifacts.pages[index].sha256)) invalid("Canva 미리보기와 게시할 8장 JPEG가 서로 다릅니다.");
  const originals = await db.select().from(mediaAssets).where(and(eq(mediaAssets.contentItemId, item.id), eq(mediaAssets.revisionId, revision.id), eq(mediaAssets.kind, "canva_export_original")));
  if (originals.length !== 8 || artifacts.originals.some(expected => {
    const original = originals.find(row => row.id === expected.id);
    return !original || original.channelId !== item.channelId || original.source !== "canva" || original.mime !== "image/png" || original.width !== 1080 || original.height !== 1350 || original.templateKey !== asset.templateKey || original.sha256 !== expected.sha256 || sha256(original.bytes) !== expected.sha256;
  })) invalid("Canva 원본 PNG 8장의 보존 상태나 해시를 확인할 수 없습니다. 손상된 출력은 승인하지 않았습니다.");
  await assertFamilyEvidenceForCopy(db, item, copy.data, metadata);
  return { pages, originals, jobId: job.id, job };
}
