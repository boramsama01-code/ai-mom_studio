import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, contentRevisions, type Channel, type ContentItem } from "../../shared/schema";
import { emptyPayload } from "../../shared/payloads";
import type { AiExecutionPlan } from "../../shared/aiProvenance";
import { createRevision } from "../content";
import { familyExecutionPlan, familyMetadataFromPayload, proposeFamilyDialogue } from "./familyEditorial";
import { assertGenerationActive, completeGenerationResult } from "./generationContext";
import { LlmBudget } from "./llm";
import { HttpError } from "../routes/util";

/** New article-backed drafts use v2. Existing v1/v2 decks never enter this path. */
export async function generateFamilySourceDraft(db: DB, item: ContentItem, channel: Channel, templateKey: string, options: { budget?: LlmBudget; plan?: AiExecutionPlan; explicitRetry?: boolean; requestId?: string } = {}) {
  const initial = await db.transaction(async tx => {
    const [locked] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
    if (!locked || locked.version !== item.version || locked.currentRevisionId !== item.currentRevisionId) throw new HttpError(409, "초안을 준비하는 동안 원고가 변경됐습니다. 최신 작업은 유지했습니다.");
    await assertGenerationActive(tx as unknown as DB);
    const [saved] = locked.currentRevisionId ? await tx.select().from(contentRevisions).where(eq(contentRevisions.id, locked.currentRevisionId)) : [];
    if (saved?.payload.cardCopy) throw new HttpError(409, "이미 저장된 카드가 있습니다. 원문 새로고침은 카드를 변환하지 않습니다. 새 8장 제안을 직접 선택해 주세요.");
    const revision = saved ?? await createRevision(tx, { contentItemId: item.id, author: "system", payload: emptyPayload(item.kind, item.title), note: "새 뉴스 자동 제작의 원문 작업본 · 아직 검토 전" });
    const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
    return { revision, item: fresh };
  });
  const plan = { ...(options.plan ?? familyExecutionPlan(channel, initial.revision.id)), contentRevision: initial.revision.id };
  const proposal = await proposeFamilyDialogue(db, initial.item, channel, initial.revision, { version: item.version, requestId: options.requestId ?? randomUUID(), formatId: "family_dialogue_8", templateKey, scope: "all", baseRevision: initial.revision.id }, plan, { budget: options.budget, allowPaidRetry: options.explicitRetry === true });
  const analysis = proposal.sourceAnalysis;
  if (!analysis) return { ok: false as const, error: proposal.reviewFlags[0]?.message ?? "원문 분석을 완료하지 못했습니다. 저장된 기사와 기존 입력은 유지했습니다." };
  const metadata = proposal.copy ? familyMetadataFromPayload(proposal as unknown as Record<string, unknown>) : null;
  const warnings = proposal.reviewFlags.map(flag => `8장 자동 제작: ${flag.message}`).slice(0, 7);
  if (!proposal.copy) warnings.unshift("기사 분석은 저장했습니다. 8장 카드 문구는 완성하지 못했습니다. 카드 편집의 자동 제작에서 완료된 분석을 이어서 사용할 수 있습니다.");
  const sourcePayload: Record<string, unknown> = { ...initial.revision.payload };
  const shortFacts = analysis.facts.map(fact => fact.statement).filter(text => text.length <= 400);
  const question = proposal.editorialPlan?.coreQuestion ?? (typeof sourcePayload.key_question === "string" ? sourcePayload.key_question : "");
  if (item.kind === "science_dialogue") Object.assign(sourcePayload, { topic: item.title, key_question: question, background: [shortFacts[0] ?? "", shortFacts[1] ?? "", shortFacts[2] ?? ""], scientific_basis: analysis.articleCore, discussion_questions: [question, proposal.parentGuide?.optionalFollowup ?? "", proposal.parentGuide?.optionalDeepening ?? ""], misconceptions: analysis.cannotConclude.filter(text => text.length <= 300).slice(0, 5) });
  else Object.assign(sourcePayload, { title: item.title, summary: analysis.articleCore, verified_facts: analysis.facts.filter(fact => ["reported_event", "research_finding"].includes(fact.claimType) && fact.statement.length <= 400).map(fact => fact.statement), under_verification: [...analysis.cannotConclude, ...analysis.missingInformation].filter(text => text.length <= 400).slice(0, 6), discussion_questions: [question, proposal.parentGuide?.optionalFollowup ?? "", proposal.parentGuide?.optionalDeepening ?? ""] });
  const stageRuns = proposal.generationRuns ?? [], summaryRun = stageRuns.find(run => run.stage === "article_analysis" && run.status === "ready"), copyRun = stageRuns.find(run => run.stage === "card_copy" && run.status === "ready");
  sourcePayload.aiWorkflow = { version: 1, summary: { provider: summaryRun?.provenance?.provider ?? plan.roles.article_analysis.provider, model: summaryRun?.provenance?.actualModel ?? "unknown" }, copy: copyRun ? { provider: copyRun.provenance?.provider ?? plan.roles.card_copy.provider, model: copyRun.provenance?.actualModel ?? "unknown" } : null, warnings: warnings.map(message => message.slice(0, 700)).slice(0, 8) };
  // Keep all completed stages visible even when card generation is partial. Their
  // immutable evidence/cache records are reused by the next explicit request.
  sourcePayload.generationRuns = stageRuns;
  if (metadata && proposal.copy) Object.assign(sourcePayload, metadata, { cardCopy: proposal.copy, rendererProvider: "canva" });
  const result = await db.transaction(async tx => {
    const [locked] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
    await assertGenerationActive(tx as unknown as DB);
    if (!locked || locked.version !== item.version || locked.currentRevisionId !== initial.revision.id) throw new HttpError(409, "자동 제작 중 원고가 바뀌었습니다. 최신 문구는 유지하고 완료된 AI 단계는 기록에 남겼습니다.");
    const revision = await createRevision(tx, { contentItemId: item.id, author: "llm", payload: sourcePayload, model: copyRun?.provenance?.actualModel ?? summaryRun?.provenance?.actualModel ?? null, promptVersion: "family-dialogue-v2.1", note: proposal.copy ? "새 기사 자동 8장 제작 · 검토와 실제 발행은 별도" : "기사 분석 완료 · 8장 편집은 이어서 복구 가능" });
    if (metadata?.captionPackage && metadata.dependencies.caption === "current") {
      sourcePayload.captionPackage = { ...metadata.captionPackage, contentRevision: revision.id };
      await tx.update(contentRevisions).set({ payload: sourcePayload }).where(eq(contentRevisions.id, revision.id));
    }
    await tx.update(contentItems).set({ edited: sourcePayload, version: item.version + 1, reviewStatus: "pending", relevance: "relevant", evidenceStatus: analysis.facts.some(fact => fact.sourceScope === "manual_paste") ? "needs_review" : "secondary_only", updatedAt: new Date() }).where(eq(contentItems.id, item.id));
    const [fresh] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
    await completeGenerationResult(tx as unknown as DB, { ...fresh, generationWarnings: warnings, generationStages: stageRuns });
    return revision;
  });
  const usage = stageRuns.reduce((sum, run) => ({ inputTokens: sum.inputTokens + (run.provenance?.inputTokens ?? 0), outputTokens: sum.outputTokens + (run.provenance?.outputTokens ?? 0) }), { inputTokens: 0, outputTokens: 0 });
  return { ok: true as const, revisionId: result.id, usage, model: copyRun?.provenance?.actualModel ?? summaryRun?.provenance?.actualModel ?? "unknown", warnings };
}
