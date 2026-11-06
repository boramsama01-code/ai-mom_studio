import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AiExecutionPlan } from "../shared/aiProvenance";
import { channelAiTaskRoles, type AiSelection } from "../shared/channelAi";
import { callTool } from "../server/services/llm";
import { GEMINI_MAX_ATTEMPTS } from "../server/services/gemini";
import { createManualCardCopyBudget, createManualFamilyBudget, createManualSourceBudget, manualFamilyStages, manualTextStageRequests } from "../server/services/manualAiBudget";

const gemini = { provider: "gemini", model: "gemini-unit" } as AiSelection;
const openai = { provider: "openai", model: "gpt-unit" } as AiSelection;
function plan(provider: "gemini" | "openai" = "gemini"): AiExecutionPlan {
  return { roles: Object.fromEntries(channelAiTaskRoles.map(role => [role, { provider: role === "image_generation" ? "openai" : provider }])) } as AiExecutionPlan;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("derives a finite full-family budget from every possible stage, not a large replacement constant", () => {
  const stages = manualFamilyStages("all", plan());
  expect(stages.map(stage => stage.stage)).toEqual(["article_analysis", "editorial_plan", "resource_search", "resource_research", "card_copy", "caption", "image_brief", "editorial_review", "image_generation"]);
  expect(stages.slice(0, -1).every(stage => stage.maxRequests === GEMINI_MAX_ATTEMPTS)).toBe(true);
  const budget = createManualFamilyBudget("all", plan());
  expect(budget.limit).toBe(8 * GEMINI_MAX_ATTEMPTS + 1);
  for (let i = 0; i < budget.limit; i++) expect(budget.take()).toBe(true);
  expect(budget.take()).toBe(false);
  expect(budget.used).toBe(budget.limit);
  // Non-Gemini research has no search adapter and structured outputs have no repair loop.
  expect(createManualFamilyBudget("all", plan("openai")).limit).toBe(8);
});

it.each(["caption", "review", "page", "field"] as const)("reserves only one %s stage and its allowed provider attempts", scope => {
  expect(createManualFamilyBudget(scope, plan()).limit).toBe(GEMINI_MAX_ATTEMPTS);
  expect(createManualFamilyBudget(scope, plan("openai")).limit).toBe(1);
});
it("reserves no image-brief requests for a logo or a reading profile's text-only page", () => {
  expect(createManualFamilyBudget("image_brief", plan(), { pageId: "outro" }).limit).toBe(0);
  expect(createManualFamilyBudget("image_brief", plan(), { templateKey: "reading-ink-lime-v1", pageId: "news_summary" }).limit).toBe(0);
  expect(createManualFamilyBudget("image_brief", plan(), { templateKey: "reading-ink-lime-v1", pageId: "discussion" }).limit).toBe(GEMINI_MAX_ATTEMPTS);
});
it("includes extraction and subsequent stages in one notice budget, but preserves a saved card", () => {
  expect(createManualSourceBudget({ summary: gemini, copy: gemini, hasSavedCopy: false, notice: true, familyPlan: plan() }).limit).toBe(GEMINI_MAX_ATTEMPTS + 8 * GEMINI_MAX_ATTEMPTS + 1);
  expect(createManualSourceBudget({ summary: gemini, copy: gemini, hasSavedCopy: true, notice: true, familyPlan: plan() }).limit).toBe(GEMINI_MAX_ATTEMPTS);
  expect(createManualSourceBudget({ summary: openai, copy: gemini, hasSavedCopy: false, notice: true }).limit).toBe(2 + GEMINI_MAX_ATTEMPTS);
  expect(createManualSourceBudget({ summary: gemini, copy: gemini, hasSavedCopy: false }).limit).toBe(2 * GEMINI_MAX_ATTEMPTS);
  expect(createManualSourceBudget({ summary: openai, copy: gemini, hasSavedCopy: true }).limit).toBe(1);
  expect(manualTextStageRequests("anthropic", true)).toBe(2);
});
it("counts a requested discussion analysis refresh separately from card copy", () => {
  expect(createManualCardCopyBudget({ summary: gemini, copy: gemini, refreshAnalysis: true }).limit).toBe(2 * GEMINI_MAX_ATTEMPTS);
  expect(createManualCardCopyBudget({ summary: gemini, copy: openai, refreshAnalysis: false }).limit).toBe(1);
});
it("keeps Gemini transient recovery capped, then refuses an additional request from the same budget", async () => {
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubEnv("GEMINI_API_KEY", "isolated-unit-not-a-real-key");
  const fetcher = vi.fn(async () => new Response("isolated busy", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const budget = createManualFamilyBudget("review", plan());
  const args = { provider: "gemini" as const, model: "gemini-unit", system: "unit", user: "unit", toolName: "unit", toolDescription: "unit",
    inputSchema: { type: "object" }, zod: z.object({ ok: z.boolean() }), structured: true, budget };
  const pending = callTool(args);
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: false, kind: "api" });
  expect(fetcher).toHaveBeenCalledTimes(GEMINI_MAX_ATTEMPTS);
  expect(budget.used).toBe(GEMINI_MAX_ATTEMPTS);
  expect(await callTool(args)).toMatchObject({ ok: false, kind: "budget" });
  expect(fetcher).toHaveBeenCalledTimes(GEMINI_MAX_ATTEMPTS);
});

