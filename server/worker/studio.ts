import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { jobs, studioCards, studioImages, studioRevisions, type Job } from "../../shared/schema";
import { studioContentSchema, studioGenerationSchema, type StudioContent } from "../../shared/studio";
import { generateStudioCaption, generateStudioImage, generateStudioText } from "../services/studioAi";
import { applyStudioText, studioImageContext, studioInstruction } from "../../shared/studioWorkflow";
import { assertStudioActive, loadStudioCard, validateStudioChannel } from "../services/studio";
import { claimJob, completeJob, failJob, heartbeat, recoverExpired } from "./queue";
import { loadStoredSecrets } from "../secretStore";
import { env } from "../env";
import { AiServiceError } from "../services/llm";
import { getSetting } from "../seed";

const payloadSchema = studioGenerationSchema.safeExtend({ cardId: z.number().int().positive(), snapshot: studioContentSchema });
const characterGuide = `우주펭귄상회 가족의 고향은 남극성-09. 펭펭은 Alligodang의 지구 특파원, 펨펨은 전 우주기관 연구원으로 고입 전문 Highscoop를 안내한다. 김펭귄은 식품공학 대학원생으로 Fryday에서 감자튀김을 연구한다. 김펭키는 행성 탐사 과학자를 꿈꾸는 학생이다. 둥근 우주 헬멧, 옆모습, 뾰족한 검은 부리, 작은 흰 점 눈, 길고 가느다란 흑백 몸, 일정한 선 두께를 유지한다. Highscoop는 특목고 중심 고입 채널이며 입시 사실은 제공한 근거에서만 사용한다.`;

async function canonicalReference(character: string) {
  const candidates = [path.resolve("dist/public/studio-assets", `${character}.png`), path.resolve("client/public/studio-assets", `${character}.png`)];
  let bytes: Buffer | null = null;
  for (const file of candidates) { try { bytes = await fs.readFile(file); break; } catch { /* next packaged asset location */ } }
  if (!bytes) throw new Error("캐릭터 기준 이미지가 없습니다. 배포 파일을 확인하세요.");
  const png = await sharp(bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** A paid request is attempted once. Lease expiry marks it failed instead of charging again. */
export async function processStudioJob(db: DB, job: Job, workerId: string): Promise<boolean> {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const payload = payloadSchema.parse(job.payload);
    const instruction = studioInstruction(payload);
    if (await getSetting(db, "global_stop", false)) throw new Error("전역 정지 상태로 생성을 실행하지 않았습니다.");
    const card = await loadStudioCard(db, payload.cardId);
    assertStudioActive(card);
    const [active] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)));
    if (!active) throw new Error("생성 작업의 실행 권한이 만료되었습니다.");
    await validateStudioChannel(db, card.content.channel);
    if (card.version !== payload.version) throw new Error("생성 전 콘텐츠가 수정되었습니다. 최신 내용에서 다시 요청하세요.");
    timer = setInterval(() => { void heartbeat(db, job.id, workerId).catch(() => undefined); }, 30_000);
    timer.unref();
    let content: StudioContent = payload.snapshot;
    let provider = payload.provider;
    let model: string;
    let image: { bytes: Buffer; mimeType: string; model: string } | null = null;
    if (payload.kind === "text") {
      const options = {
        provider: payload.provider, directive: instruction,
        content: { title: content.title, channel: content.channel, format: content.format, brief: content.memo, script: content.script, caption: content.caption, panels: content.panels.map(p => ({ scene: p.scene, dialogue: p.dialogue })) },
        referenceText: characterGuide,
      };
      if (payload.textTarget === "caption") {
        const generated = await generateStudioCaption(options);
        model = generated.model; provider = generated.provider;
        content = studioContentSchema.parse({ ...content, caption: generated.caption });
      } else {
        const generated = await generateStudioText(options);
        model = generated.model; provider = generated.provider;
        content = applyStudioText(content, generated, payload.textTarget);
      }
    } else {
      const panelIndex = payload.panelIndex!;
      const panel = content.panels[panelIndex];
      const refs = await Promise.all([...new Set(content.characters)].map(canonicalReference));
      if (panel.imageId) {
        const [existing] = await db.select().from(studioImages).where(and(eq(studioImages.id, panel.imageId), eq(studioImages.cardId, card.id)));
        if (existing) refs.push(`data:${existing.mimeType};base64,${existing.bytes.toString("base64")}`);
      }
      if (await getSetting(db, "global_stop", false)) throw new Error("전역 정지 상태로 생성을 실행하지 않았습니다.");
      image = await generateStudioImage({
        prompt: `${characterGuide}\n${studioImageContext(content, panelIndex)}\n수정 지시: ${instruction}\n첨부 캐릭터 기준 이미지와 기존 컷의 외형을 유지한다. 패널 하나만, 말풍선·글자·자막 없이 그린다. 대사는 별도로 편집한다.`,
        referenceImages: refs,
      });
      if (image.bytes.length > 20 * 1024 * 1024) throw new Error("생성 이미지가 저장 한도를 초과했습니다.");
      const meta = await sharp(image.bytes, { limitInputPixels: 40_000_000 }).metadata();
      if (meta.format !== "png") throw new Error("생성 이미지 형식이 올바르지 않습니다.");
      model = image.model;
      provider = "openai";
    }
    const result = await db.transaction(async tx => {
      const current = await loadStudioCard(tx as unknown as DB, card.id, true);
      assertStudioActive(current);
      const [lease] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId))).for("update");
      if (!lease) throw new Error("생성 작업의 실행 권한이 만료되어 결과를 적용하지 않았습니다.");
      if (image) {
        const [stored] = await tx.insert(studioImages).values({ cardId: card.id, panelIndex: payload.panelIndex!, bytes: image.bytes, mimeType: image.mimeType, model: image.model }).returning({ id: studioImages.id });
        content = { ...content, stage: "review", panels: content.panels.map((p, i) => i === payload.panelIndex ? { ...p, imageId: stored.id } : p) };
      }
      // A user may keep editing while generation runs. Preserve their newer edits and retain the generated candidate in history.
      const updated = await tx.update(studioCards).set({ content, version: payload.version + 1, updatedAt: new Date() }).where(and(eq(studioCards.id, card.id), eq(studioCards.version, payload.version))).returning();
      const applied = updated.length > 0;
      const [revision] = await tx.insert(studioRevisions).values({ cardId: card.id, version: payload.version + 1, snapshot: content, instruction, provider, model, applied }).returning({ id: studioRevisions.id });
      return { cardId: card.id, revisionId: revision.id, applied, kind: payload.kind, textTarget: payload.textTarget, panelIndex: payload.panelIndex ?? null, message: applied ? "생성 결과를 저장했습니다." : "생성 중 직접 수정한 내용은 유지했습니다. 기록에서 생성 결과를 확인하고 적용하세요." };
    });
    await completeJob(db, job.id, workerId, result);
    return true;
  } catch (e) {
    // Provider adapters use fixed safe messages. Never return upstream response bodies or credentials.
    const ownMessage = /^(휴지통에 있는 콘텐츠입니다|보관된 채널입니다|전역 정지 상태로|생성 전 콘텐츠가|캐릭터 기준 이미지가|생성 이미지가|생성 이미지 형식이|생성 작업의 실행 권한이)/.test((e as Error).message ?? "");
    const message = e instanceof z.ZodError ? "생성 결과의 형식이 올바르지 않아 적용하지 않았습니다." : e instanceof AiServiceError || ownMessage ? (e as Error).message : "생성 처리 또는 결과 저장에 실패했습니다. 연결과 작업 상태를 확인하세요.";
    await failJob(db, job, workerId, `${message} 자동 재시도하지 않았습니다.`, false);
    return false;
  } finally { if (timer) clearInterval(timer); }
}

let running: Promise<void> | null = null;
export function kickInlineStudio(db: DB): boolean {
  if (!env.inlineWorker) return false;
  if (running) return true;
  const workerId = `studio-${crypto.randomBytes(4).toString("hex")}`;
  running = (async () => {
    try {
      await loadStoredSecrets(db);
      await recoverExpired(db);
      for (let i = 0; i < 8; i++) {
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

