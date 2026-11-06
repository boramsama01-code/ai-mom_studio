import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({ primary: null as any, saved: null as any, summaryBudget: null as any, copyBudget: null as any,
  attempts: 0, family: vi.fn() }));
vi.mock("../server/content", () => ({ createRevision: async (_db: unknown, value: any) => { state.saved = value; return { id: 900 }; } }));
vi.mock("../server/services/itemSources", () => ({ itemPrimarySource: async () => state.primary }));
vi.mock("../server/services/familySourceDraft", () => ({ generateFamilySourceDraft: state.family }));
vi.mock("../server/services/llm", async original => ({
  ...await original<typeof import("../server/services/llm")>(),
  draftScience: async (args: any) => {
    state.summaryBudget = args.budget;
    for (let i = 0; i < 3; i++) {
      if (!args.budget.take()) return { ok: false, kind: "budget", error: "isolated exhausted" };
      state.attempts++;
    }
    return { ok: true, data: { topic: "제공된 원문의 요약", evidence: [] }, model: args.model, usage: { inputTokens: 3, outputTokens: 3 }, droppedEvidence: 0 };
  },
  generateCardCopy: async (args: any) => {
    state.copyBudget = args.budget;
    for (let i = 0; i < 3; i++) {
      if (!args.budget.take()) return { ok: false, kind: "budget", error: "isolated exhausted" };
      state.attempts++;
    }
    return { ok: true, data: cardCopyFixture(), model: args.model, usage: { inputTokens: 3, outputTokens: 3 }, droppedEvidence: 0 };
  },
}));
import type { DB } from "../server/db";
import { generateDialogueDraft } from "../server/worker/generate";
import { LlmBudget } from "../server/services/llm";
import { cardCopyFixture } from "./fixtures/cardCopy";
function fixture(saved = false, limit = 0) {
  const channel = { id: 2, active: true, slug: "science-dialogue", cardTemplate: "builtin:classic", budget: { llmCallsPerRun: limit },
    aiSettings: { summary: { provider: "gemini", model: "gemini-summary-unit" }, copy: { provider: "gemini", model: "gemini-copy-unit" }, image: { provider: "openai", model: "gpt-image-unit" } } };
  const item = { id: 101, channelId: 2, kind: "science_dialogue", version: 1, currentRevisionId: saved ? 30 : null, primarySourceId: null, title: "수동 원고" };
  const revision = { id: 30, payload: { cardCopy: cardCopyFixture() } };
  const query = (table?: any) => {
    let name = table ? getTableName(table) : "";
    const q: any = { from(t: any) { name = getTableName(t); return q; }, where: () => q, for: () => q, set: () => q,
      then(resolve: any) { return Promise.resolve(name === "channels" ? [channel] : name === "content_items" ? [item] : name === "content_revisions" ? [revision] : name === "source_documents" ? [state.primary] : []).then(resolve); } };
    return q;
  };
  const db: any = { select: () => query(), update: (table: any) => query(table), transaction: (work: any) => work(db) };
  return { db: db as DB, channel, item, revision };
}
beforeEach(() => { Object.assign(state, { primary: null, saved: null, summaryBudget: null, copyBudget: null, attempts: 0 }); state.family.mockReset().mockResolvedValue({ ok: true }); });

it.each([0, 10])("allows a legacy-zero/%s manual summary and card to share all six bounded attempts", async limit => {
  const { db } = fixture(false, limit);
  expect(await generateDialogueDraft(db, 101)).toMatchObject({ ok: true, warnings: [] });
  expect(state.attempts).toBe(6);
  expect(state.copyBudget).toBe(state.summaryBudget);
  expect(state.summaryBudget.limit).toBe(6); expect(state.summaryBudget.take()).toBe(false);
  expect(state.saved.payload.cardCopy).toEqual(cardCopyFixture());
});
it("refreshes a saved card's source summary without regenerating the operator's card", async () => {
  const { db, revision } = fixture(true);
  expect(await generateDialogueDraft(db, 101)).toMatchObject({ ok: true });
  expect(state.attempts).toBe(3); expect(state.copyBudget).toBeNull();
  expect(state.summaryBudget.limit).toBe(3);
  expect(state.saved.payload.cardCopy).toEqual(revision.payload.cardCopy);
});
it("retains an explicitly supplied collector zero budget for a legacy draft", async () => {
  const { db } = fixture(), budget = new LlmBudget(0);
  expect(await generateDialogueDraft(db, 101, new Date(), undefined, undefined, { budget })).toMatchObject({ ok: false, error: "isolated exhausted" });
  expect(state.summaryBudget).toBe(budget); expect(budget.used).toBe(0);
  expect(state.attempts).toBe(0); expect(state.saved).toBeNull(); expect(state.copyBudget).toBeNull();
});
it("forwards the same explicit collection budget through the new Family source branch", async () => {
  const { db } = fixture(), budget = new LlmBudget(0);
  state.primary = { id: 1, kind: "official", fetchStatus: "ok", fetchedText: "제공된 원문 본문입니다. ".repeat(20), originalUrl: "https://example.test/article", title: "테스트 원문" };
  await generateDialogueDraft(db, 101, new Date(), undefined, undefined, { budget, requestId: "same-request" });
  expect(state.family).toHaveBeenCalledOnce();
  expect(state.family.mock.calls[0][4]).toMatchObject({ budget, requestId: "same-request" });
  expect(state.family.mock.calls[0][4].budget).toBe(budget);
  expect(budget.used).toBe(0); expect(state.attempts).toBe(0);
});

