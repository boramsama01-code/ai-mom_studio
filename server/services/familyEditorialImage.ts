import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { contentItems, mediaAssets } from "../../shared/schema";
import { familyEditorialStages } from "../../shared/familyEvidenceDb";
import { stageProvenance } from "../../shared/aiProvenance";
import type { GenerationRun, ReviewFlag, VisualBrief } from "../../shared/familyDialogue";
import type { FamilyStageContext } from "./familyEditorialStages";
import { familyHash } from "./familyEvidence";
import { CARD_PAGE_ARTWORK_KIND, normalizeCardPageArtwork } from "./cardPageArtwork";
import { generateStudioImage } from "./studioAi";
import { currentGenerationSignal, assertGenerationActive } from "./generationContext";
import { AiServiceError } from "./llm";
import { sha256 } from "./text";

/** One paid cover stage inside the already admitted editorial job. It never saves card text. */
export async function generateFamilyCoverArtwork(context: FamilyStageContext, input: { version: number; brief: VisualBrief }): Promise<{ assetId: number | null; reviewFlag?: ReviewFlag }> {
  const selected = context.plan.roles.image_generation;
  const inputHash = familyHash({ stage: "image_generation", sourceSnapshotId: context.plan.sourceSnapshotId, contentRevision: context.baseRevision, selection: selected, brief: input.brief });
  const rows = await context.db.select().from(familyEditorialStages).where(and(eq(familyEditorialStages.channelId, context.channelId), eq(familyEditorialStages.contentItemId, context.itemId), eq(familyEditorialStages.stage, "image_generation"), eq(familyEditorialStages.inputHash, inputHash))).orderBy(desc(familyEditorialStages.finishedAt));
  const prior = rows.find(row => row.status === "ready" && typeof row.result.assetId === "number");
  if (prior) {
    const [asset] = await context.db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.id, Number(prior.result.assetId)), eq(mediaAssets.channelId, context.channelId), eq(mediaAssets.contentItemId, context.itemId), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND)));
    if (asset) { context.runs.push({ id: prior.id, stage: "image_generation", status: "ready", baseRevision: prior.baseRevision, inputHash, startedAt: prior.startedAt.toISOString(), finishedAt: prior.finishedAt.toISOString(), provenance: prior.provenance as GenerationRun["provenance"], error: null }); return { assetId: asset.id }; }
  }
  const recovery = (message: string) => ({ assetId: null, reviewFlag: { path: "pageDesigns.cover.background", code: "cover_image_incomplete", message: `${message} 카드 문구는 보존했습니다. 표지에서 '배경 자동 만들기'를 직접 다시 요청하거나 이미지를 붙여넣어 주세요.` } });
  if (rows.length && context.allowPaidRetry === false) return recovery("이전 표지 요청의 결과가 확정되지 않아 수집 워커가 유료 요청을 반복하지 않았습니다.");
  const abandoned = rows.filter(row => row.status === "running" && row.requestId !== context.requestId && row.startedAt.getTime() < Date.now() - 180_000);
  if (abandoned.length) await context.db.update(familyEditorialStages).set({ status: "failed", result: { error: "이전 이미지 요청의 결과·사용량을 확인하지 못했습니다. 운영자가 새 요청을 시작했습니다." }, finishedAt: new Date() }).where(and(inArray(familyEditorialStages.id, abandoned.map(row => row.id)), eq(familyEditorialStages.status, "running")));
  const remainingMs = 160_000 - (Date.now() - (context.startedAt ?? Date.now()));
  if (remainingMs < 15_000 || context.budget.used >= context.budget.limit) return recovery("이번 실행의 시간·호출 예산을 사용해 표지를 시작하지 않았습니다.");
  const [item] = await context.db.select({ version: contentItems.version, currentRevisionId: contentItems.currentRevisionId }).from(contentItems).where(and(eq(contentItems.id, context.itemId), eq(contentItems.channelId, context.channelId)));
  if (!item || item.version !== input.version || item.currentRevisionId !== context.baseRevision) return recovery("원고가 바뀌어 이전 문구의 유료 표지를 시작하지 않았습니다.");
  await assertGenerationActive(context.db);
  const id = randomUUID(), startedAt = new Date(), controller = new AbortController(), parentSignal = currentGenerationSignal();
  const stop = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", stop, { once: true });
  if (parentSignal?.aborted) stop();
  const deadline = setTimeout(() => controller.abort(new Error("표지 생성 대기 한도")), Math.min(75_000, remainingMs));
  deadline.unref();
  const initialProvenance = stageProvenance(context.plan, "image_generation");
  // Persist before network I/O. An abandoned running row is an unknown paid
  // outcome, never an invitation for an automatic image retry.
  try {
    const admitted = await context.db.insert(familyEditorialStages).values({ id, channelId: context.channelId, contentItemId: context.itemId, stage: "image_generation", inputHash, requestId: context.requestId, baseRevision: context.baseRevision, status: "running", result: { status: "running" }, provenance: initialProvenance, startedAt, finishedAt: startedAt }).onConflictDoNothing().returning({ id: familyEditorialStages.id });
    if (!admitted.length) return recovery("같은 표지를 다른 실행이 처리 중이어서 유료 요청을 중복 실행하지 않았습니다.");
    const [completed] = await context.db.select().from(familyEditorialStages).where(and(eq(familyEditorialStages.channelId, context.channelId), eq(familyEditorialStages.contentItemId, context.itemId), eq(familyEditorialStages.stage, "image_generation"), eq(familyEditorialStages.inputHash, inputHash), eq(familyEditorialStages.status, "ready"))).orderBy(desc(familyEditorialStages.finishedAt)).limit(1);
    if (completed && typeof completed.result.assetId === "number") {
      const [asset] = await context.db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.id, completed.result.assetId), eq(mediaAssets.contentItemId, context.itemId), eq(mediaAssets.channelId, context.channelId), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND)));
      if (asset) {
        await context.db.update(familyEditorialStages).set({ status: "cancelled", result: { reusedCompletedStage: true }, finishedAt: new Date() }).where(eq(familyEditorialStages.id, id));
        context.runs.push({ id: completed.id, stage: "image_generation", status: "ready", baseRevision: completed.baseRevision, inputHash, startedAt: completed.startedAt.toISOString(), finishedAt: completed.finishedAt.toISOString(), provenance: completed.provenance as GenerationRun["provenance"], error: null });
        return { assetId: asset.id };
      }
    }
    if (!context.budget.take()) {
      await context.db.update(familyEditorialStages).set({ status: "cancelled", result: { notStarted: "budget" }, provenance: { ...initialProvenance, usageStatus: "known", inputTokens: 0, outputTokens: 0, status: "not_started" }, finishedAt: new Date() }).where(eq(familyEditorialStages.id, id));
      return recovery("이번 실행의 호출 예산을 사용해 표지를 시작하지 않았습니다.");
    }
    const generated = await generateStudioImage({ provider: "openai", model: selected.model, purpose: "cover", signal: controller.signal,
      prompt: JSON.stringify({ visualSubject: input.brief.visualSubject, composition: input.brief.composition, mood: input.brief.mood, palette: input.brief.palette, textSafeArea: input.brief.textSafeArea, avoidElements: input.brief.avoidElements, imagePrompt: input.brief.imagePrompt, outputRule: "No lettering, logo, mascot redesign or counterfeit documentary news photograph. The Korean card text is rendered separately." }) });
    context.budget.inputTokens += generated.usage.inputTokens; context.budget.outputTokens += generated.usage.outputTokens;
    if (generated.usageStatus === "usage_unknown") context.budget.usageUnknown = true;
    const normalized = await normalizeCardPageArtwork(generated.bytes, generated.mimeType), hash = sha256(normalized.bytes), finishedAt = new Date();
    const provenance = stageProvenance(context.plan, "image_generation", generated.provenance);
    parentSignal?.throwIfAborted();
    const assetId = await context.db.transaction(async tx => {
      // Immutable proposal asset stays attached to the requested old revision if
      // a user edits meanwhile; the proposal's CAS prevents applying it later.
      await tx.insert(mediaAssets).values({ channelId: context.channelId, contentItemId: context.itemId, revisionId: context.baseRevision, kind: CARD_PAGE_ARTWORK_KIND, source: "ai", templateKey: generated.model, sha256: hash, ...normalized }).onConflictDoNothing({ target: [mediaAssets.revisionId, mediaAssets.sha256] });
      const [asset] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.revisionId, context.baseRevision), eq(mediaAssets.sha256, hash), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND), eq(mediaAssets.contentItemId, context.itemId), eq(mediaAssets.channelId, context.channelId)));
      if (!asset) throw new Error("이미지 저장 충돌");
      await tx.update(familyEditorialStages).set({ status: "ready", result: { assetId: asset.id }, provenance, finishedAt }).where(eq(familyEditorialStages.id, id));
      return asset.id;
    });
    context.runs.push({ id, stage: "image_generation", status: "ready", baseRevision: context.baseRevision, inputHash, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), provenance, error: null });
    return { assetId };
  } catch (error) {
    const finishedAt = new Date(), message = error instanceof AiServiceError ? error.message : controller.signal.aborted ? "표지 응답을 대기 한도 안에 확인하지 못해 자동 재호출하지 않았습니다." : "표지를 생성하거나 저장하지 못했습니다. 자동 재호출하지 않았습니다.";
    const provenance = { ...initialProvenance, status: parentSignal?.aborted ? "cancelled" as const : "failed" as const };
    await context.db.update(familyEditorialStages).set({ status: "failed", result: { error: message }, provenance, finishedAt }).where(eq(familyEditorialStages.id, id));
    context.runs.push({ id, stage: "image_generation", status: parentSignal?.aborted ? "cancelled" : "failed", baseRevision: context.baseRevision, inputHash, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), provenance, error: message });
    return recovery(message);
  } finally { clearTimeout(deadline); parentSignal?.removeEventListener("abort", stop); }
}
