import type { AiProvider } from "../../shared/aiProviders";
import type { AiSelection } from "../../shared/channelAi";
import type { AiExecutionPlan } from "../../shared/aiProvenance";
import type { FamilyPageId } from "../../shared/familyDialogue";
import { readingImageSlot, readingProfileForTemplateKey } from "../../shared/readingCardProfiles";
import { GEMINI_MAX_ATTEMPTS } from "./gemini";
import { LlmBudget } from "./llm";

type FamilyScope = "all" | "page" | "field" | "caption" | "image_brief" | "review";
type PlannedStage = { stage: string; maxRequests: number };

/** Counts possible HTTP attempts, not tokens, provider quota or permission to retry. */
export function manualTextStageRequests(provider: AiProvider, legacyFormatRepair = false): number {
  return provider === "gemini" ? GEMINI_MAX_ATTEMPTS : legacyFormatRepair ? 2 : 1;
}

export function manualFamilyStages(scope: FamilyScope, plan: AiExecutionPlan, options: { templateKey?: string; pageId?: FamilyPageId } = {}): PlannedStage[] {
  const text = (stage: string, role: keyof AiExecutionPlan["roles"]): PlannedStage => ({
    stage, maxRequests: manualTextStageRequests(plan.roles[role].provider),
  });
  if (scope === "caption") return [text("caption", "caption")];
  if (scope === "review") return [text("editorial_review", "editorial_review")];
  if (scope === "page" || scope === "field") return [text("partial_copy", "card_copy")];
  const pageId = options.pageId ?? "cover", profile = readingProfileForTemplateKey(options.templateKey);
  const canBrief = pageId !== "outro" && (!profile || readingImageSlot(profile, pageId)?.kind === "artwork");
  if (scope === "image_brief") return canBrief ? [text("image_brief", "image_brief")] : [];
  // Before planning, a scientific definition or supplied supporting sources may
  // require research. Reserve each possible stage once; caches and skipped
  // optional work do not spend a reservation.
  return [
    text("article_analysis", "article_analysis"),
    text("editorial_plan", "card_copy"),
    ...(plan.roles.resource_research.provider === "gemini" ? [text("resource_search", "resource_research")] : []),
    text("resource_research", "resource_research"),
    text("card_copy", "card_copy"),
    text("caption", "caption"),
    ...(canBrief ? [text("image_brief", "image_brief")] : []),
    text("editorial_review", "editorial_review"),
    // The cover helper makes one OpenAI image request only when a cover is needed.
    { stage: "image_generation", maxRequests: 1 },
  ];
}

export function createManualFamilyBudget(scope: FamilyScope, plan: AiExecutionPlan, options: { templateKey?: string; pageId?: FamilyPageId } = {}): LlmBudget {
  return new LlmBudget(manualFamilyStages(scope, plan, options).reduce((sum, stage) => sum + stage.maxRequests, 0));
}

/** Summary/extraction followed by an optional card draft, sharing one request budget. */
export function createManualSourceBudget(options: {
  summary: AiSelection; copy: AiSelection; hasSavedCopy: boolean;
  notice?: boolean; familyPlan?: AiExecutionPlan; templateKey?: string;
}): LlmBudget {
  const summary = manualTextStageRequests(options.summary.provider, options.notice);
  if (options.hasSavedCopy) return new LlmBudget(summary);
  const next = options.familyPlan
    ? manualFamilyStages("all", options.familyPlan, { templateKey: options.templateKey }).reduce((sum, stage) => sum + stage.maxRequests, 0)
    : manualTextStageRequests(options.copy.provider);
  return new LlmBudget(summary + next);
}

export function createManualCardCopyBudget(options: { summary: AiSelection; copy: AiSelection; refreshAnalysis: boolean }): LlmBudget {
  return new LlmBudget(manualTextStageRequests(options.copy.provider)
    + (options.refreshAnalysis ? manualTextStageRequests(options.summary.provider) : 0));
}

