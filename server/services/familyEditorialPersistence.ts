import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { DB } from "../db";
import { contentItems, contentRevisions, jobs, studioCards } from "../../shared/schema";
import { familyCardCopySchema, familyFieldValue, pageDesignsSchema, parentGuideSchema, captionPackageSchema, type CardCopyV2, type FamilyDialogueMetadata } from "../../shared/familyDialogue";
import { familyMetadataFromPayload, familySourceCredits, selectedFamilyResources, synchronizeFamilyQuestion } from "./familyEditorial";
import { familyEvidenceView, loadFamilyEvidence, validateFamilyEvidenceReferences } from "./familyEvidence";
import { assertCardPageArtworkOwnership } from "./cardPageArtwork";
import { assertStudioActive } from "./studio";
import { conflict, HttpError } from "../routes/util";
import { createRevision } from "../content";
import { audit } from "../audit";
import { sha256 } from "./text";
import { reuseCanvaForCaption } from "./canvaCaptionReuse";

export const familySaveSchema = z.object({ version: z.number().int().positive(), copy: familyCardCopySchema, pageDesigns: pageDesignsSchema, fieldLocks: z.record(z.string().min(1).max(240), z.boolean()), parentGuide: parentGuideSchema.nullable().optional(), captionPackage: captionPackageSchema.nullable().optional(), proposalJobId: z.number().int().positive().optional() }).strict();
export const familyCaptionConfirmSchema = z.object({ version: z.number().int().positive(), publicationDraftVersion: z.number().int().nonnegative(), textConfirmed: z.literal(true) }).strict();
/** Reading a preview verifies ownership without persisting an unreviewed proposal. */
export async function assertFamilyEvidenceForCopy(db: DB, item: { id: number; channelId: number }, copy: CardCopyV2, metadata: FamilyDialogueMetadata) {
  const bundle = await loadFamilyEvidence(db, item, metadata.evidenceBinding);
  const errors = validateFamilyEvidenceReferences(copy, bundle, metadata.editorialPlan, metadata.parentGuide);
  if (errors.length) throw new HttpError(422, errors[0].message, { code: errors[0].code, field: errors[0].path, reviewFlags: errors });
  return bundle;
}
export async function familyProposalMetadata(db: DB, item: { id: number; channelId: number; version: number }, revisionId: number, jobId: number): Promise<{ metadata: FamilyDialogueMetadata; copy: CardCopyV2 }> {
  const [proposal] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.channelId, item.channelId), eq(jobs.type, "card_copy_generate"), eq(jobs.status, "succeeded")));
  const response = proposal?.result?.response as Record<string, unknown> | undefined;
  if (!proposal || proposal.payload.itemId !== item.id || proposal.payload.version !== item.version || response?.revisionId !== revisionId || response?.lateResult === true || proposal.payload.formatId !== "family_dialogue_8") throw new HttpError(409, "제안 이후 원고 버전이 바뀌었습니다. 현재 문구는 유지했으니 최신 원고를 확인해 주세요.");
  const copy = familyCardCopySchema.safeParse(response.copy), metadata = familyMetadataFromPayload(response);
  if (!copy.success || !metadata) throw new HttpError(409, "완성된 8장 제안과 고정 근거를 찾을 수 없습니다. 현재 원고를 유지했습니다.");
  return { metadata, copy: copy.data };
}

/** CAS save: source facts and metadata are read under the same item lock as the new revision. */
export async function saveFamilyCardCopy(db: DB, itemId: number, channelId: number, body: z.infer<typeof familySaveSchema>, actor: string) {
  // Off is not a lock. Old editors may retain false entries for fields removed
  // by an explicit concept-mode/activity change; they must not block saving.
  body = { ...body, fieldLocks: Object.fromEntries(Object.entries(body.fieldLocks).filter(([, enabled]) => enabled)) };
  if (Object.keys(body.fieldLocks).length > 100 || Object.keys(body.fieldLocks).some(path => familyFieldValue(body.copy, path) === undefined)) throw new HttpError(400, "현재 카드의 문구 칸만 잠글 수 있습니다.");
  return db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, itemId), eq(contentItems.channelId, channelId))).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    if (item.version !== body.version) conflict(item);
    const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, itemId));
    if (board) assertStudioActive(board);
    const [current] = item.currentRevisionId ? await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id, item.currentRevisionId), eq(contentRevisions.contentItemId, itemId))) : [];
    if (!current) throw new HttpError(409, "현재 초안을 먼저 저장해 주세요.");
    const previous = familyMetadataFromPayload(current.payload), previousCopy = familyCardCopySchema.safeParse(current.payload.cardCopy);
    const proposal = body.proposalJobId ? await familyProposalMetadata(tx as unknown as DB, item, current.id, body.proposalJobId) : null;
    const trusted = proposal?.metadata ?? previous;
    if (!trusted || !proposal && !previousCopy.success) throw new HttpError(409, "8장 제안을 확인한 뒤 적용해 주세요. 원문 근거와 생성 기록을 임의로 만들 수 없습니다.");
    let metadata: FamilyDialogueMetadata = synchronizeFamilyQuestion(body.copy, { ...trusted, pageDesigns: body.pageDesigns, fieldLocks: body.fieldLocks,
      ...(body.parentGuide !== undefined ? { parentGuide: body.parentGuide } : {}), ...(body.captionPackage !== undefined ? { captionPackage: body.captionPackage } : {}) });
    const baselineCopy = proposal?.copy ?? (previousCopy.success ? previousCopy.data : null);
    const substantiveSame = baselineCopy && isDeepStrictEqual(baselineCopy.pages, body.copy.pages)
      && isDeepStrictEqual(trusted.parentGuide, metadata.parentGuide) && isDeepStrictEqual(trusted.editorialPlan, metadata.editorialPlan);
    const captionUnchanged = isDeepStrictEqual(trusted.captionPackage, metadata.captionPackage);
    const captionCanRebind = !!metadata.captionPackage && trusted.dependencies.caption === "current" && captionUnchanged && !!substantiveSame
      && metadata.captionPackage.contentRevision === current.id && metadata.captionPackage.coreQuestion === metadata.editorialPlan.coreQuestion;
    const visualChanged = !isDeepStrictEqual(trusted.pageDesigns, body.pageDesigns) || !!baselineCopy && baselineCopy.templateKey !== body.copy.templateKey;
    const anythingChanged = !substantiveSame || visualChanged;
    metadata.dependencies = { ...trusted.dependencies,
      caption: metadata.captionPackage ? captionCanRebind ? "current" : "needs_review" : "not_generated",
      visuals: metadata.visualBriefs && Object.keys(metadata.visualBriefs).length ? substantiveSame ? trusted.dependencies.visuals : "needs_review" : "not_generated",
      review: metadata.editorialReview ? anythingChanged ? "needs_review" : trusted.dependencies.review : "not_generated",
      render: "needs_review",
    };
    await assertCardPageArtworkOwnership(tx as unknown as DB, itemId, channelId, body.copy, body.pageDesigns);
    const bundle = await assertFamilyEvidenceForCopy(tx as unknown as DB, item, body.copy, metadata);
    let payload: Record<string, unknown> = { ...current.payload, ...metadata, cardCopy: body.copy };
    if (proposal && !previousCopy.success && current.payload.rendererProvider === undefined) payload.rendererProvider = "canva";
    if (proposal) {
      const completed = metadata.generationRuns.filter(run => run.status === "ready" && run.provenance);
      const summary = completed.filter(run => run.stage === "article_analysis").at(-1), written = completed.filter(run => run.stage === "card_copy" || run.stage === "partial_copy").at(-1);
      const previousWorkflow = current.payload.aiWorkflow as { warnings?: string[] } | undefined;
      if (summary?.provenance && written?.provenance) payload.aiWorkflow = { version: 1, summary: { provider: summary.provenance.provider, model: summary.provenance.actualModel ?? "unknown" }, copy: { provider: written.provenance.provider, model: written.provenance.actualModel ?? "unknown" }, warnings: (previousWorkflow?.warnings ?? []).filter(value => !/^(기사 분석은 저장했습니다\.|8장 자동 제작:|기사 요약은 저장했습니다\. 카드 문구는)/.test(value)) };
    }
    // A plain repeat save must keep the prior render state and current approval.
    if (previous && previousCopy.success && !proposal && isDeepStrictEqual(previousCopy.data, body.copy) && isDeepStrictEqual(previous.pageDesigns, body.pageDesigns) && isDeepStrictEqual(previous.fieldLocks, body.fieldLocks) && isDeepStrictEqual(previous.parentGuide, metadata.parentGuide) && isDeepStrictEqual(previous.captionPackage, metadata.captionPackage)) return { version: item.version, revisionId: current.id, copy: body.copy, ...previous, evidence: familyEvidenceView(bundle), hasSavedCopy: true };
    const revision = await createRevision(tx, { contentItemId: itemId, author: "operator", payload, note: proposal ? "8장 편집 제안 명시 적용 · 근거 버전 보존" : "8장 카드 편집 · 잠금·배경·근거 보존" });
    let retainedOutputAssetId: number | undefined;
    if (captionCanRebind && metadata.captionPackage) {
      metadata = { ...metadata, captionPackage: { ...metadata.captionPackage, contentRevision: revision.id } };
      payload.captionPackage = metadata.captionPackage;
      const reused = await reuseCanvaForCaption(tx as unknown as DB, { item, previousRevision: current, nextRevision: revision, payload, actor });
      payload = reused.payload; retainedOutputAssetId = reused.assetId;
      if (reused.assetId) metadata = familyMetadataFromPayload(payload)!;
      // This is the newly inserted, uncommitted revision; no historical revision is changed.
      await tx.update(contentRevisions).set({ payload }).where(eq(contentRevisions.id, revision.id));
    }
    await tx.update(contentItems).set({ edited: payload, version: item.version + 1, reviewStatus: item.reviewStatus === "reviewed" ? "pending" : item.reviewStatus, updatedAt: new Date() }).where(eq(contentItems.id, itemId));
    await audit(tx, { actor, action: "edit_family_card_copy", entity: "content_item", entityId: itemId, channelId, detail: { revisionId: revision.id, pages: 8, evidenceSetId: metadata.evidenceBinding.evidenceSetId, ...(body.proposalJobId ? { proposalJobId: body.proposalJobId } : {}) } });
    return { version: item.version + 1, revisionId: revision.id, copy: body.copy, ...metadata, evidence: familyEvidenceView(bundle), hasSavedCopy: true, canvaOutputReused: !!retainedOutputAssetId, ...(retainedOutputAssetId ? { retainedOutputAssetId } : {}) };
  });
}

/** Manual fallback uses the already saved publication textarea. It neither calls
 * an AI nor labels an old AI summary as the operator's current wording. */
export async function confirmFamilyCaption(db: DB, itemId: number, channelId: number, body: z.infer<typeof familyCaptionConfirmSchema>, actor: string) {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, itemId), eq(contentItems.channelId, channelId))).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    if (item.version !== body.version) conflict(item);
    const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, itemId));
    if (board) assertStudioActive(board);
    const [current] = item.currentRevisionId ? await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id, item.currentRevisionId), eq(contentRevisions.contentItemId, itemId))) : [];
    const copy = familyCardCopySchema.safeParse(current?.payload.cardCopy), metadata = current ? familyMetadataFromPayload(current.payload) : null;
    if (!current || !copy.success || !metadata) throw new HttpError(409, "8장 카드 원고를 먼저 저장해 주세요.");
    const publication = item.publicationDraft;
    if (!publication || publication.version !== body.publicationDraftVersion) throw new HttpError(409, "게시 캡션이 다른 곳에서 변경됐습니다. 입력을 유지했으니 최신 저장본과 다시 대조해 주세요.");
    const fullCaption = publication.captions.instagram;
    if (!fullCaption.trim()) throw new HttpError(400, "게시 준비의 Instagram 캡션을 먼저 입력하고 저장해 주세요.");
    if (!fullCaption.includes(metadata.editorialPlan.coreQuestion)) throw new HttpError(422, "현재 카드의 중심 질문을 캡션에도 같은 문장으로 남긴 뒤 대조 확인해 주세요.", { code: "caption_question_mismatch" });
    const bundle = await assertFamilyEvidenceForCopy(tx as unknown as DB, item, copy.data, metadata);
    const existing = metadata.captionPackage;
    if (existing?.origin === "manual" && existing.contentRevision === current.id && existing.fullCaption === fullCaption && existing.confirmation.captionHash === sha256(fullCaption) && metadata.dependencies.caption === "current") return { version: item.version, revisionId: current.id, copy: copy.data, ...metadata, evidence: familyEvidenceView(bundle), hasSavedCopy: true, publicationDraft: publication, canvaOutputReused: current.payload.rendererProvider === "canva" && metadata.dependencies.render === "current" };
    const caption = { origin: "manual" as const, contentRevision: current.id, coreQuestion: metadata.editorialPlan.coreQuestion, sourceCredit: familySourceCredits(bundle.snapshot, selectedFamilyResources(copy.data, bundle.evidenceSet.resources)), fullCaption,
      confirmation: { comparedRevision: current.id, publicationDraftVersion: publication.version, confirmedAt: new Date().toISOString(), captionHash: sha256(fullCaption) } };
    const nextMetadata = { ...metadata, captionPackage: caption, dependencies: { ...metadata.dependencies, caption: "current" as const, review: metadata.editorialReview ? "needs_review" as const : "not_generated" as const } };
    let payload: Record<string, unknown> = { ...current.payload, ...nextMetadata };
    const revision = await createRevision(tx, { contentItemId: itemId, author: "operator", payload, note: "현재 카드와 직접 작성한 게시 캡션 대조 확인 · AI 호출 없음" });
    nextMetadata.captionPackage.contentRevision = revision.id;
    payload.captionPackage = nextMetadata.captionPackage;
    const reused = await reuseCanvaForCaption(tx as unknown as DB, { item, previousRevision: current, nextRevision: revision, payload, actor });
    payload = reused.payload;
    const finalMetadata = familyMetadataFromPayload(payload)!;
    await tx.update(contentRevisions).set({ payload }).where(eq(contentRevisions.id, revision.id));
    await tx.update(contentItems).set({ edited: payload, version: item.version + 1, reviewStatus: "pending", updatedAt: new Date() }).where(eq(contentItems.id, itemId));
    await audit(tx, { actor, action: "confirm_manual_family_caption", entity: "content_item", entityId: itemId, channelId, detail: { revisionId: revision.id, comparedRevision: current.id, publicationDraftVersion: publication.version, captionHash: caption.confirmation.captionHash } });
    return { version: item.version + 1, revisionId: revision.id, copy: copy.data, ...finalMetadata, evidence: familyEvidenceView(bundle), hasSavedCopy: true, publicationDraft: publication, canvaOutputReused: !!reused.assetId, ...(reused.assetId ? { retainedOutputAssetId: reused.assetId } : {}) };
  });
}
