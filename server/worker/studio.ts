import { creativeProfileFor } from "../../shared/creativeProfile";
import { generateExperience } from "../services/experienceAi";
import crypto from "node:crypto";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { jobs, studioCards, studioImages, studioRevisions, type Job } from "../../shared/schema";
import { studioContentSchema, studioGenerationSchema, type StudioContent } from "../../shared/studio";
import { generateStudioCaption, generateStudioImage, generateStudioPanel, generateStudioText } from "../services/studioAi";
import { applyStudioText, studioChangedTextFields, studioImageContext, studioInstruction } from "../../shared/studioWorkflow";
import { assertStudioActive, loadStudioCard, validateStudioChannel } from "../services/studio";
import { claimJob, completeJob, failJob, heartbeat, recoverExpired } from "./queue";
import { loadStoredSecrets } from "../secretStore";
import { env } from "../env";
import { AiServiceError } from "../services/llm";
import { getSetting } from "../seed";
import { STUDIO_CHARACTER_GUIDE, studioCharacterById } from "../../shared/studioCharacters";
import { studioPanelReferences } from "../services/studioCharacters";
import { assertGenerationActive, withGenerationContext } from "../services/generationContext";
import { invalidateStudioPublication, lockStudioPublication } from "../services/studioPublicationState";
import { channelBrandName } from "../../shared/branding";
import { studioGenerationFeedback, type StudioImageProgress } from "../../shared/studioGenerationFeedback";
import { aiExecutionSchema, aiModelMatches, type AiExecution } from "../../shared/channelAi";
import { channelAiSelection } from "../services/channelAi";
import { providerExecutionSchema, type ProviderExecution } from "../../shared/aiProvenance";

const payloadSchema = studioGenerationSchema.safeExtend({ cardId: z.number().int().positive(), snapshot: studioContentSchema, ai: aiExecutionSchema.optional() });
const activeJobs = new Map<number, { controller: AbortController; work: Promise<boolean> }>();
let stopping = false;
const promptTraceSchema = z.object({ toolName: z.string().min(1).max(160), inputSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function textExecution(value: unknown, ai: Pick<AiExecution, "provider" | "model">, status: ProviderExecution["status"]): ProviderExecution {
  const parsed = providerExecutionSchema.safeParse(value);
  const execution: ProviderExecution = parsed.success ? parsed.data : { provider: ai.provider, requestedModel: ai.model, actualModel: null, requestId: null, usageStatus: "usage_unknown", inputTokens: null, outputTokens: null, status };
  return execution.usageStatus === "known" && execution.inputTokens !== null && execution.outputTokens !== null ? execution
    : { ...execution, usageStatus: "usage_unknown", inputTokens: null, outputTokens: null };
}

/** One panel is one paid request. Existing art is a reference and is never deleted. */
async function drawStudioPanel(db: DB, cardId: number, content: StudioContent, panelIndex: number, instruction: string, signal: AbortSignal, ai: AiExecution) {
  signal.throwIfAborted();
  const panel = content.panels[panelIndex];
  const refs = content.characters.length ? await studioPanelReferences(panel) : [];
  if (panel.imageId) {
    const [existing] = await db.select().from(studioImages).where(and(eq(studioImages.id, panel.imageId), eq(studioImages.cardId, cardId)));
    if (existing) refs.push(`data:${existing.mimeType};base64,${existing.bytes.toString("base64")}`);
  }
  signal.throwIfAborted();
  const referenceGuide = content.characters.length
    ? "첨부 첫 이미지는 가족 외형 기준이며 네 명 모두를 그리라는 뜻이 아니다. 그 다음 이미지는 선택한 포즈 순서의 개별 참조다. 기존 컷이 있으면 마지막 이미지로 첨부된다. 장면에 필요한 선택된 등장인물만 그린다. 캐릭터 기준 이미지와 기존 컷의 외형을 유지한다."
    : refs.length ? "첨부 이미지는 기존 컷이다. 기존 컷의 외형과 요청한 장면을 유지하며 지정하지 않은 펭귄 마스코트를 추가하지 않는다."
      : "첨부된 참조 이미지는 없다. 요청한 장면만 그리고 지정하지 않은 펭귄 마스코트를 추가하지 않는다.";
  const image = await generateStudioImage({
    prompt: `${content.characters.length ? STUDIO_CHARACTER_GUIDE : ""}\n이번 콘텐츠의 선택된 등장인물: ${content.characters.map(id => studioCharacterById(id).name).join(", ") || "없음"}\n${studioImageContext(content, panelIndex)}\n수정 지시: ${instruction}\n${referenceGuide} 패널 하나만, 말풍선·글자·자막 없이 그린다. 대사는 별도로 편집한다.`,
    referenceImages: refs, signal, model: ai.model,
  });
  if (image.bytes.length > 20 * 1024 * 1024) throw new Error("생성 이미지가 저장 한도를 초과했습니다.");
  const meta = await sharp(image.bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (meta.format !== "png") throw new Error("생성 이미지 형식이 올바르지 않습니다.");
  return image;
}

/** Commit each panel with its progress; a later failure/cancel cannot erase earlier successes. */
async function drawStudioBatch(db: DB, job: Job, workerId: string, payload: z.infer<typeof payloadSchema>, instruction: string, signal: AbortSignal, progress: StudioImageProgress, ai: AiExecution) {
  let content = payload.snapshot;
  let expectedVersion = payload.version;
  for (const [position, panelIndex] of progress.panelIndexes.entries()) {
    await checkStudioJob(db, job.id, workerId, signal);
    const before = await loadStudioCard(db, payload.cardId);
    assertStudioActive(before);
    if (before.version !== expectedVersion) throw new Error("생성 전 콘텐츠가 수정되었습니다. 최신 내용에서 필요한 컷만 다시 요청하세요.");
    progress.activePanelIndex = panelIndex;
    progress.message = `${panelIndex + 1}컷 생성 중입니다. 완료한 그림은 컷마다 저장합니다.`;
    const started = await db.update(jobs).set({ result: { ...progress } }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId))).returning({ id: jobs.id });
    if (!started.length) throw new Error("생성 작업의 실행 권한이 만료되었습니다.");
    // Check cancellation immediately before starting another paid request, not only on the timer.
    await checkStudioJob(db, job.id, workerId, signal);
    const image = await drawStudioPanel(db, payload.cardId, content, panelIndex, instruction, signal, ai);
    const applied = await db.transaction(async tx => {
      const guardDb = tx as unknown as DB;
      const current = await lockStudioPublication(guardDb, payload.cardId);
      assertStudioActive(current);
      await assertGenerationActive(guardDb);
      const canApply = current.version === expectedVersion;
      if (canApply) await invalidateStudioPublication(guardDb, current);
      const [stored] = await tx.insert(studioImages).values({ cardId: payload.cardId, panelIndex, bytes: image.bytes, mimeType: image.mimeType, model: image.model }).returning({ id: studioImages.id });
      const candidate: StudioContent = { ...content, stage: "review", panels: content.panels.map((p, i) => i === panelIndex ? { ...p, imageId: stored.id } : p) };
      const updated = await tx.update(studioCards).set({ content: candidate, version: expectedVersion + 1, updatedAt: new Date() }).where(and(eq(studioCards.id, payload.cardId), eq(studioCards.version, expectedVersion))).returning({ id: studioCards.id });
      const applied = updated.length > 0;
      const [revision] = await tx.insert(studioRevisions).values({ cardId: payload.cardId, version: expectedVersion + 1, snapshot: candidate, instruction, provider: "openai", model: image.model, applied }).returning({ id: studioRevisions.id });
      const next: StudioImageProgress = {
        ...progress, revisionId: revision.id, activePanelIndex: null, applied,
        completedPanels: [...progress.completedPanels, { panelIndex, imageId: stored.id, revisionId: revision.id, version: expectedVersion + 1, applied }],
        remainingPanelIndexes: progress.panelIndexes.slice(position + 1),
        partial: position + 1 < progress.panelIndexes.length,
        message: applied ? `${position + 1}/${progress.panelIndexes.length}컷을 저장했습니다.` : "생성 중 직접 수정한 내용은 유지했습니다. 생성 그림은 기록에 보관했으며 남은 컷은 호출하지 않았습니다.",
      };
      await assertGenerationActive(guardDb);
      if (!applied || position === progress.panelIndexes.length - 1) await completeJob(guardDb, job.id, workerId, { ...next });
      else await tx.update(jobs).set({ result: { ...next } }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)));
      return { applied, next, candidate };
    });
    // Update in-memory progress only after the transaction commits.
    Object.assign(progress, applied.next);
    if (!applied.applied) return true;
    content = applied.candidate;
    expectedVersion++;
  }
  return true;
}

async function checkStudioJob(db: DB, jobId: number, workerId: string, signal: AbortSignal, lock = false) {
  signal.throwIfAborted();
  if (stopping || await getSetting(db, "global_stop", false)) throw new Error("전역 정지 상태로 생성을 중단했습니다.");
  const query = db.select({ id: jobs.id, leaseExpiresAt: jobs.leaseExpiresAt }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)));
  const [active] = await (lock ? query.for("update") : query);
  if (!active?.leaseExpiresAt || active.leaseExpiresAt.getTime() <= Date.now()) throw new Error("생성 작업의 실행 권한이 만료되어 결과를 적용하지 않았습니다.");
  signal.throwIfAborted();
}

/** Cancellation is also observed across processes; it reaches the active provider HTTP request. */
export function processStudioJob(db: DB, job: Job, workerId: string): Promise<boolean> {
  const existing = activeJobs.get(job.id);
  if (existing) return existing.work;
  const controller = new AbortController();
  if (stopping) controller.abort(new Error("서버 종료로 생성을 중단했습니다."));
  let checking = false;
  const monitor = setInterval(() => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    void checkStudioJob(db, job.id, workerId, controller.signal).catch(error => controller.abort(error)).finally(() => { checking = false; });
  }, 1000);
  monitor.unref();
  const work = withGenerationContext({ signal: controller.signal, assertActive: guardDb => checkStudioJob(guardDb, job.id, workerId, controller.signal, true) },
    () => runStudioJob(db, job, workerId, controller.signal)).finally(() => { clearInterval(monitor); activeJobs.delete(job.id); });
  activeJobs.set(job.id, { controller, work });
  return work;
}

/** A paid request is attempted once. Lease expiry marks it failed instead of charging again. */
async function runStudioJob(db: DB, job: Job, workerId: string, signal: AbortSignal): Promise<boolean> {
  let timer: ReturnType<typeof setInterval> | undefined;
  let imageProgress: StudioImageProgress | undefined;
  let textMetadata: { provenance: ProviderExecution; promptTrace: z.infer<typeof promptTraceSchema> | null; binding: { jobId: number; operatorRequestId: string | null; cardId: number; sourceVersion: number } } | undefined;
  try {
    const payload = payloadSchema.parse(job.payload);
    await checkStudioJob(db, job.id, workerId, signal);
    const instruction = studioInstruction(payload);
    if (await getSetting(db, "global_stop", false)) throw new Error("전역 정지 상태로 생성을 실행하지 않았습니다.");
    const card = await loadStudioCard(db, payload.cardId);
    assertStudioActive(card);
    const [active] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)));
    if (!active) throw new Error("생성 작업의 실행 권한이 만료되었습니다.");
    const channel = await validateStudioChannel(db, card.content.channel);
    // Older queued jobs have no AI snapshot; resolve once before their first paid call.
    const ai = payload.ai ?? channelAiSelection(channel, payload.kind === "image" ? "image" : "copy", { provider: payload.textTarget === "experience" ? "openai" : payload.provider });
    if (!aiModelMatches(ai.provider, ai.model, payload.kind === "image" ? "image" : "copy")) throw new AiServiceError("저장된 생성 요청의 AI와 모델이 일치하지 않습니다. 채널 설정을 확인하고 새 요청을 만들어 주세요.", "parse");
    if (card.version !== payload.version) throw new Error("생성 전 콘텐츠가 수정되었습니다. 최신 내용에서 다시 요청하세요.");
    timer = setInterval(() => { void heartbeat(db, job.id, workerId).catch(() => undefined); }, 30_000);
    timer.unref();
    if (payload.kind === "image") {
      const panelIndexes = payload.panelIndexes ?? [payload.panelIndex!];
      imageProgress = { cardId: card.id, kind: "image", panelIndex: payload.panelIndex ?? null, panelIndexes, completedPanels: [], remainingPanelIndexes: [...panelIndexes], activePanelIndex: null, applied: false, partial: false, message: "그림 생성을 준비합니다." };
      return await drawStudioBatch(db, job, workerId, payload, instruction, signal, imageProgress, ai);
    }
    let content: StudioContent = payload.snapshot;
    let provider = ai.provider;
    let model: string;
    textMetadata = { provenance: textExecution(undefined, ai, "failed"), promptTrace: null,
      binding: { jobId: job.id, operatorRequestId: payload.requestId ?? null, cardId: card.id, sourceVersion: payload.version } };
    const rememberExecution = (generated: unknown) => {
      const observed = generated as { provenance?: unknown; promptTrace?: unknown };
      textMetadata!.provenance = textExecution(observed?.provenance, ai, "completed");
      const trace = promptTraceSchema.safeParse(observed?.promptTrace); textMetadata!.promptTrace = trace.success ? trace.data : null;
    };
    {
      const options = {
        provider: ai.provider, model: ai.model, directive: instruction,
        content: { title: content.title, channel: content.channel, channelName: channel ? channelBrandName(channel) : content.channel, brandGuide: channel ? [channel.editorialGuide, creativeProfileFor(channel).tone, creativeProfileFor(channel).assetGuide, `콘텐츠 서체 가이드: ${creativeProfileFor(channel).font}`].filter(Boolean).join("\n") : "", format: content.format, brief: content.memo, script: content.script, caption: content.caption, panels: content.panels.map(p => ({ scene: p.scene, dialogue: p.dialogue })) },
        referenceText: content.characters.length ? STUDIO_CHARACTER_GUIDE : "",
        signal,
      };
      if (payload.textTarget === "experience") {
        const generated=await generateExperience(db,card.id,content,payload.instruction, ai.model);
        rememberExecution(generated);
        content=generated.content; model=generated.model; provider="openai";
      } else if (payload.textTarget === "caption") {
        const generated = await generateStudioCaption(options);
        rememberExecution(generated);
        model = generated.model; provider = generated.provider;
        content = studioContentSchema.parse({ ...content, caption: generated.caption });
      } else if (payload.textTarget === "panel") {
        const generated = await generateStudioPanel({ ...options, panelIndex: payload.panelIndex! });
        rememberExecution(generated);
        model = generated.model; provider = generated.provider;
        content = studioContentSchema.parse({ ...content, stage: "review", panels: content.panels.map((panel, index) => index === payload.panelIndex ? { ...panel, scene: generated.scene, dialogue: generated.dialogue } : panel) });
      } else {
        const generated = await generateStudioText(options);
        rememberExecution(generated);
        model = generated.model; provider = generated.provider;
        content = applyStudioText(content, generated, payload.textTarget);
      }
    }
    await db.transaction(async tx => {
      const current = await lockStudioPublication(tx as unknown as DB, card.id);
      assertStudioActive(current);
      await assertGenerationActive(tx as unknown as DB);
      const [lease] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId))).for("update");
      if (!lease) throw new Error("생성 작업의 실행 권한이 만료되어 결과를 적용하지 않았습니다.");
      if (current.version === payload.version) await invalidateStudioPublication(tx as unknown as DB, current);
      // A user may keep editing while generation runs. Preserve their newer edits and retain the generated candidate in history.
      const updated = await tx.update(studioCards).set({ content, version: payload.version + 1, updatedAt: new Date() }).where(and(eq(studioCards.id, card.id), eq(studioCards.version, payload.version))).returning();
      const applied = updated.length > 0;
      const [revision] = await tx.insert(studioRevisions).values({ cardId: card.id, version: payload.version + 1, snapshot: content, instruction, provider, model, applied }).returning({ id: studioRevisions.id });
      const result = { cardId: card.id, revisionId: revision.id, applied, kind: payload.kind, textTarget: payload.textTarget, changedFields: payload.kind === "text" ? studioChangedTextFields(payload.snapshot, content) : [], panelIndex: payload.panelIndex ?? null, ...textMetadata, binding: { ...textMetadata!.binding, revisionId: revision.id }, message: applied ? "생성 결과를 저장했습니다." : "생성 중 직접 수정한 내용은 유지했습니다. 기록에서 생성 결과를 확인하고 적용하세요." };
      await assertGenerationActive(tx as unknown as DB);
      await completeJob(tx as unknown as DB, job.id, workerId, result);
      return result;
    });
    return true;
  } catch (e) {
    if (textMetadata) {
      const observed = e as { provenance?: unknown; promptTrace?: unknown };
      const parsed = providerExecutionSchema.safeParse(observed?.provenance);
      if (parsed.success) textMetadata.provenance = textExecution(parsed.data, { provider: parsed.data.provider, model: parsed.data.requestedModel }, parsed.data.status);
      const trace = promptTraceSchema.safeParse(observed?.promptTrace); if (trace.success) textMetadata.promptTrace = trace.data;
      // Preserve known provider facts even when output validation or result application fails.
      // A cancelled or reassigned job is never rewritten by this worker.
      await db.update(jobs).set({ result: { kind: "text", applied: false, ...textMetadata, binding: { ...textMetadata.binding, revisionId: null } } })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)));
    }
    // Provider adapters use fixed safe messages. Never return upstream response bodies or credentials.
    const ownMessage = /^(휴지통에 있는 콘텐츠입니다|보관된 채널입니다|전역 정지 상태로|생성 전 콘텐츠가|캐릭터 기준 이미지가|생성 이미지가|생성 이미지 형식이|생성 작업의 실행 권한이)/.test((e as Error).message ?? "");
    const message = signal.aborted ? "생성을 중단해 결과를 적용하지 않았습니다. 공급자의 처리·과금 여부는 확인할 수 없습니다." : e instanceof z.ZodError ? "생성 결과의 형식이 올바르지 않아 적용하지 않았습니다." : e instanceof AiServiceError || ownMessage ? (e as Error).message : "생성 처리 또는 결과 저장에 실패했습니다. 연결과 작업 상태를 확인하세요.";
    if (imageProgress) await db.update(jobs).set({ result: { ...imageProgress, partial: imageProgress.completedPanels.length > 0, errorKind: studioGenerationFeedback(message).kind, message: `${message} 이미 저장된 컷은 유지했습니다. 나머지 컷은 자동으로 다시 호출하지 않습니다.` } }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)));
    await failJob(db, job, workerId, `${message} 자동 재시도하지 않았습니다.`, false);
    return false;
  } finally { if (timer) clearInterval(timer); }
}

let running: Promise<void> | null = null;
export function kickInlineStudio(db: DB): boolean {
  if (stopping || !env.inlineWorker) return false;
  if (running) return true;
  const workerId = `studio-${crypto.randomBytes(4).toString("hex")}`;
  running = (async () => {
    try {
      await loadStoredSecrets(db);
      await recoverExpired(db);
      for (let i = 0; i < 8; i++) {
        if (stopping || await getSetting(db, "global_stop", false)) break;
        const job = await claimJob(db, workerId, ["studio_generate"]);
        if (!job) break;
        await processStudioJob(db, job, workerId);
      }
    } catch { console.error("Studio 생성 대기열 처리에 실패했습니다. 저장된 작업은 다음 실행에서 확인합니다."); }
    finally { running = null; }
  })();
  return true;
}
export async function waitStudioIdle() { while (running) await running; }

/** Stop claims, abort active provider requests, then let guarded result transactions finish. */
export async function stopInlineStudio(): Promise<void> {
  stopping = true;
  for (const { controller } of activeJobs.values()) controller.abort(new Error("서버 종료로 생성을 중단했습니다."));
  await Promise.allSettled([...activeJobs.values()].map(({ work }) => work));
  await waitStudioIdle();
}


