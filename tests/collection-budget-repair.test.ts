import { afterEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const state = vi.hoisted(() => ({ attemptedCalls: 0, draftInvocations: 0, reported: null as any }));
vi.mock("../server/seed", () => ({ getSetting: async () => false }));
vi.mock("../server/content", () => ({ createRevision: async () => ({ id: 901 }) }));
vi.mock("../server/services/itemSources", () => ({ itemPrimarySource: async () => null }));
vi.mock("../server/worker/discovery", () => ({
  upsertNaverDoc: vi.fn(),
  runDiscovery: async () => ({ counts: { discoveryQueries: 1 }, errors: [], itemIds: [101, 102], supporting: new Map(), settings: { autoDraft: true } }),
}));
vi.mock("../server/services/newsSearch", async original => ({ ...await original<object>(), createNewsSearch: () => ({ search: vi.fn(), counts: {}, warnings: [] }) }));
vi.mock("../server/services/llm", async original => ({
  ...await original<object>(),
  // Models two attempted reservations, not an HTTP response. The provider suite separately injects HTTP 503.
  draftScience: async ({ budget }: any) => {
    state.draftInvocations++;
    expect(budget.take()).toBe(true); state.attemptedCalls++;
    expect(budget.take()).toBe(false);
    return { ok: false, kind: "budget", error: "이번 실행의 LLM 호출 한도 도달" };
  },
}));
afterEach(() => vi.unstubAllEnvs());

it("shares the collection budget with auto-draft and counts a failed attempt without invoking the next item", async () => {
  vi.stubEnv("AUTO_GENERATE", "true"); vi.stubEnv("AI_PROVIDER", "gemini"); vi.stubEnv("GEMINI_API_KEY", "unit-key-never-used");
  const { runCollect } = await import("../server/worker/collect");
  const channel = { id: 2, active: true, slug: "science-dialogue", contentType: "science_dialogue", cardTemplate: "builtin:classic", budget: { naverCallsPerRun: 0, fetchCallsPerRun: 0, fetchTargetsPerRun: 0, resultsPerRun: 1, llmCallsPerRun: 1 } };
  const item = { id: 101, channelId: 2, kind: "science_dialogue", title: "fixture", version: 1, currentRevisionId: null, primarySourceId: null, reviewStatus: "pending" };
  function query(action: string, table?: any) {
    let name = table ? getTableName(table) : "";
    const q: any = {
      from(t: any) { name = getTableName(t); return q; }, values() { return q; }, where() { return q; }, orderBy() { return q; }, for() { return q; },
      set(value: any) { if (name === "runs") state.reported = value; return q; },
      returning() { return Promise.resolve([{ id: 1 }]); },
      then(resolve: any, reject: any) { return Promise.resolve(action === "select" ? name === "channels" ? [channel] : name === "content_items" ? [item] : [] : []).then(resolve, reject); },
    };
    return q;
  }
  const db: any = { select: () => query("select"), insert: (table: any) => query("insert", table), update: (table: any) => query("update", table), transaction: (work: any) => work(db) };
  await runCollect(db, 2, { trigger: "manual" });
  expect(state.attemptedCalls).toBe(1);
  expect(state.draftInvocations).toBe(1);
  expect(state.reported.actualCalls.llm).toBe(1);
  expect(state.reported.llmUsage).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0 });
});
