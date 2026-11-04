import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { cardCopyFixture } from "./fixtures/cardCopy";

const state = vi.hoisted(() => ({ attemptedCalls: 0, draftInvocations: 0, copyInvocations: 0, reported: null as any, snapshot: null as any, saved: null as any, summaryArgs: null as any, copyArgs: null as any, summaryFails: true, copyUnavailable: false, itemIds: [101, 102], onDiscovery: null as (() => void) | null }));
vi.mock("../server/seed", () => ({ getSetting: async () => false }));
vi.mock("../server/content", () => ({ createRevision: async (_db: unknown, value: unknown) => { state.saved = value; return { id: 901 }; } }));
vi.mock("../server/services/itemSources", () => ({ itemPrimarySource: async () => null }));
vi.mock("../server/worker/discovery", () => ({
  upsertNaverDoc: vi.fn(),
  runDiscovery: async () => { state.onDiscovery?.(); return { counts: { discoveryQueries: 1 }, errors: [], itemIds: state.itemIds, supporting: new Map(), settings: { autoDraft: true } }; },
}));
vi.mock("../server/services/newsSearch", async original => ({ ...await original<object>(), createNewsSearch: () => ({ search: vi.fn(), counts: {}, warnings: [] }) }));
vi.mock("../server/services/llm", async original => ({
  ...await original<object>(),
  // Models two attempted reservations, not an HTTP response. The provider suite separately injects HTTP 503.
  draftScience: async (args: any) => {
    const { budget } = args; state.summaryArgs = args;
    state.draftInvocations++;
    expect(budget.take()).toBe(true); state.attemptedCalls++;
    if (state.summaryFails) {
      budget.usageUnknown = true;
      expect(budget.take()).toBe(false);
      return { ok: false, kind: "budget", error: "이번 실행의 LLM 호출 한도 도달" };
    }
    budget.inputTokens += 10; budget.outputTokens += 5;
    return { ok: true, data: { topic: "보존할 요약", evidence: [] }, model: args.model, usage: { inputTokens: 10, outputTokens: 5 }, droppedEvidence: 0 };
  },
  generateCardCopy: async (args: any) => {
    state.copyInvocations++; state.copyArgs = args;
    if (state.copyUnavailable) return { ok: false, kind: "not_configured", error: "선택한 카드 문구 AI 미연결" };
    if (!args.budget.take()) return { ok: false, kind: "budget", error: "이번 실행의 LLM 호출 한도 도달" };
    state.attemptedCalls++; args.budget.inputTokens += 8; args.budget.outputTokens += 4;
    return { ok: true, data: cardCopyFixture(), model: args.model, usage: { inputTokens: 8, outputTokens: 4 }, droppedEvidence: 0 };
  },
}));
beforeEach(() => {
  Object.assign(state, { attemptedCalls: 0, draftInvocations: 0, copyInvocations: 0, reported: null, snapshot: null, saved: null, summaryArgs: null, copyArgs: null, summaryFails: true, copyUnavailable: false, itemIds: [101, 102], onDiscovery: null });
});
afterEach(() => vi.unstubAllEnvs());

function fixture(limit = 1) {
  const channel = { id: 2, active: true, slug: "science-dialogue", contentType: "science_dialogue", cardTemplate: "builtin:classic", aiSettings: {
    summary: { provider: "gemini", model: "gemini-summary-before" }, copy: { provider: "openai", model: "gpt-copy-before" }, image: { provider: "openai", model: "gpt-image-before" },
  }, budget: { naverCallsPerRun: 0, fetchCallsPerRun: 0, fetchTargetsPerRun: 0, resultsPerRun: 1, llmCallsPerRun: limit } };
  const item = { id: 101, channelId: 2, kind: "science_dialogue", title: "fixture", version: 1, currentRevisionId: null, primarySourceId: null, reviewStatus: "pending" };
  function query(action: string, table?: any) {
    let name = table ? getTableName(table) : "";
    const q: any = {
      from(t: any) { name = getTableName(t); return q; }, values(value: any) { if (name === "runs") state.snapshot = structuredClone(value.snapshot); return q; }, where() { return q; }, orderBy() { return q; }, for() { return q; },
      set(value: any) { if (name === "runs") state.reported = value; return q; },
      returning() { return Promise.resolve([{ id: 1 }]); },
      then(resolve: any, reject: any) { return Promise.resolve(action === "select" ? name === "channels" ? [structuredClone(channel)] : name === "content_items" ? [item] : [] : []).then(resolve, reject); },
    };
    return q;
  }
  const db: any = { select: () => query("select"), insert: (table: any) => query("insert", table), update: (table: any) => query("update", table), transaction: (work: any) => work(db) };
  return { db, channel };
}

it("shares the collection budget with auto-draft and counts a failed attempt without invoking the next item", async () => {
  vi.stubEnv("AUTO_GENERATE", "true"); vi.stubEnv("AI_PROVIDER", "gemini"); vi.stubEnv("GEMINI_API_KEY", "unit-key-never-used");
  const { runCollect } = await import("../server/worker/collect");
  const { db } = fixture();
  await runCollect(db, 2, { trigger: "manual" });
  expect(state.attemptedCalls).toBe(1);
  expect(state.draftInvocations).toBe(1);
  expect(state.reported.actualCalls.llm).toBe(1);
  expect(state.reported.llmUsage).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0, usageStatus: "usage_unknown" });
});

it("uses configured channel roles despite an unavailable global writer and pins both models before source collection", async () => {
  vi.stubEnv("AUTO_GENERATE", "true"); vi.stubEnv("AI_PROVIDER", "anthropic"); vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("GEMINI_API_KEY", "unit-key-never-used");
  const { runCollect } = await import("../server/worker/collect");
  const { db, channel } = fixture(4);
  state.summaryFails = false; state.itemIds = [101];
  state.onDiscovery = () => {
    channel.aiSettings.summary = { provider: "anthropic", model: "claude-after-start" };
    channel.aiSettings.copy = { provider: "openai", model: "gpt-after-start" };
    channel.cardTemplate = "set:n01";
    vi.stubEnv("GEMINI_MODEL", "gemini-after-start"); vi.stubEnv("OPENAI_MODEL", "gpt-after-start");
  };
  const result = await runCollect(db, 2, { trigger: "schedule" });
  expect(result.counts.drafted).toBe(1);
  expect(state.summaryArgs).toMatchObject({ provider: "gemini", model: "gemini-summary-before" });
  expect(state.copyArgs).toMatchObject({ provider: "openai", model: "gpt-copy-before", templateKey: "builtin:classic" });
  expect(state.copyArgs.budget).toBe(state.summaryArgs.budget);
  expect(state.snapshot.ai).toEqual({ summary: { provider: "gemini", model: "gemini-summary-before" }, copy: { provider: "openai", model: "gpt-copy-before" } });
  expect(state.snapshot.channel.cardTemplate).toBe("builtin:classic");
  expect(state.saved.payload.aiWorkflow).toMatchObject({ summary: state.snapshot.ai.summary, copy: state.snapshot.ai.copy, warnings: [] });
  expect(state.reported.llmUsage).toEqual({ calls: 2, inputTokens: 18, outputTokens: 9, usageStatus: "known" });
  expect(state.attemptedCalls).toBe(2);
});

it("preserves and reports a partial summary when the shared budget is exhausted before copy, without a second paid attempt", async () => {
  vi.stubEnv("AUTO_GENERATE", "true"); vi.stubEnv("GEMINI_API_KEY", "unit-key-never-used");
  const { runCollect } = await import("../server/worker/collect");
  const { db } = fixture(1); state.summaryFails = false;
  const result = await runCollect(db, 2, { trigger: "schedule" });
  expect(result.status).toBe("partial");
  expect(result.counts).toMatchObject({ drafted: 1, copyIncomplete: 1 });
  expect(result.errors).toContainEqual({ scope: "item:101:copy", message: expect.stringContaining("LLM 호출 한도") });
  expect(state.saved.payload.topic).toBe("보존할 요약");
  expect(state.saved.payload.cardCopy).toBeUndefined();
  expect(state.saved.payload.aiWorkflow.warnings).toHaveLength(1);
  expect(state.attemptedCalls).toBe(1); expect(state.draftInvocations).toBe(1); expect(state.copyInvocations).toBe(1);
  expect(state.reported.actualCalls.llm).toBe(1);
});

it("keeps a saved summary and marks copy incomplete when only the copy provider is unavailable", async () => {
  vi.stubEnv("AUTO_GENERATE", "true"); vi.stubEnv("GEMINI_API_KEY", "unit-key-never-used");
  const { runCollect } = await import("../server/worker/collect");
  const { db } = fixture(4); state.summaryFails = false; state.copyUnavailable = true; state.itemIds = [101];
  const result = await runCollect(db, 2, { trigger: "worker" });
  expect(result.counts).toMatchObject({ drafted: 1, copyIncomplete: 1 });
  expect(result.errors).toContainEqual({ scope: "item:101:copy", message: expect.stringContaining("카드 문구 AI 미연결") });
  expect(state.saved.payload.topic).toBe("보존할 요약");
  expect(state.reported.actualCalls.llm).toBe(1);
  expect(state.attemptedCalls).toBe(1);
});
