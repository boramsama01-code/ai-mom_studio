import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const controlled = vi.hoisted(() => ({ capture: vi.fn(), load: vi.fn(), image: vi.fn() }));
vi.mock("../server/services/familyEvidence", async original => ({
  ...await original<typeof import("../server/services/familyEvidence")>(),
  captureFamilySourceSnapshot: controlled.capture, loadFamilyEvidence: controlled.load,
  putFamilyEvidence: async (_db: unknown, value: any) => value.payload,
  createFamilyEvidenceSet: async (_db: unknown, item: any, snapshot: any, analysis: any, research: any, sources: any[]) => ({
    evidenceSetId: "unit-evidence", sourceSnapshotId: snapshot.id, sourceAnalysisId: analysis.sourceAnalysisId,
    resourceResearchId: research?.resourceResearchId ?? null, itemId: item.id, channelId: item.channelId,
    createdAt: new Date().toISOString(), facts: analysis.facts, resources: research?.verifiedResources ?? [], sourceIds: [...snapshot.sources, ...sources].map(value => value.id),
  }),
}));
vi.mock("../server/services/familyEditorialImage", () => ({ generateFamilyCoverArtwork: controlled.image }));
import type { DB } from "../server/db";
import type { Channel, ContentItem } from "../shared/schema";
import { channelAiTaskRoles, defaultChannelRoleSettings } from "../shared/channelAi";
import { familyExecutionPlan, proposeFamilyDialogue, type FamilyGenerateInput } from "../server/services/familyEditorial";
import { LlmBudget } from "../server/services/llm";
import { GEMINI_MAX_ATTEMPTS } from "../server/services/gemini";
import { familyEvidenceFixture } from "./fixtures/familyEvidence";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";
import { createFamilyProviderMock } from "./fixtures/familyProvider";
const rows: any[] = [];
const empty = () => { const q: any = { where: () => q, orderBy: () => q, limit: () => q, then: (resolve: any) => Promise.resolve([]).then(resolve) }; return q; };
const db = {
  select: () => ({ from: () => empty() }),
  insert: () => ({ values: (value: any) => { rows.push(value); const q: any = { onConflictDoNothing: () => q, returning: async () => [{ id: value.id }], then: (resolve: any) => Promise.resolve(undefined).then(resolve) }; return q; } }),
  update: () => ({ set: (value: any) => ({ where: async () => { const pending = [...rows].reverse().find(row => row.status === "running"); if (pending) Object.assign(pending, value); } }) }),
} as unknown as DB;
function fixture(limit: number, saved = false) {
  const aiSettings = defaultChannelRoleSettings();
  aiSettings.editorial = { additionalResourcesAutoSearch: false, visitScope: "off" };
  for (const role of channelAiTaskRoles) {
    if (role === "image_generation") aiSettings.roleModels.image_generation = { provider: "openai", model: "gpt-image-unit" };
    else aiSettings.roleModels[role] = { provider: "gemini", model: "gemini-unit" };
  }
  const channel = { id: 2, slug: "current-dialogue", name: "알리고당", audience: "중학생과 부모", editorialGuide: "", version: 1, aiSettings, budget: { llmCallsPerRun: limit } } as Channel;
  const item = { id: 1, channelId: 2, version: 4, currentRevisionId: 30, kind: "science_dialogue", title: "게이츠의 전망" } as ContentItem;
  return { channel, item, revision: { id: 30, payload: saved ? { cardCopy: familyDialogueCardFixture(), ...familyDialogueMetadataFixture() } : {} },
    input: { version: 4, requestId: randomUUID(), formatId: "family_dialogue_8", templateKey: "set:n03", scope: "all", baseRevision: 30 } as FamilyGenerateInput,
    plan: familyExecutionPlan(channel, 30) };
}
beforeEach(() => {
  rows.length = 0; controlled.capture.mockReset().mockResolvedValue(familyEvidenceFixture().snapshot);
  controlled.load.mockReset().mockResolvedValue(familyEvidenceFixture());
  controlled.image.mockReset().mockImplementation(async (context: any) => { expect(context.budget.take()).toBe(true); return { assetId: 991 }; });
  vi.stubEnv("GEMINI_API_KEY", "isolated-unit-not-a-real-key");
  vi.stubEnv("OPENAI_API_KEY", "isolated-unit-not-a-real-key");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([0, 10])("completes an explicit full manual proposal despite legacy channel limit %s and bounded transient retries", async limit => {
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  const f = fixture(limit), mock = createFamilyProviderMock(), attempts = new Map<string, number>();
  const fetcher = vi.fn(async (url: any, init: any) => {
    const request = JSON.parse(init.body);
    // Stable full wire body identifies a single stage across transient retries.
    const identity = JSON.stringify(request), used = (attempts.get(identity) ?? 0) + 1;
    attempts.set(identity, used);
    if (used < GEMINI_MAX_ATTEMPTS) return new Response("isolated busy", { status: 503 });
    return mock.fetch(url, init);
  });
  vi.stubGlobal("fetch", fetcher);
  const before = structuredClone(f.revision.payload), pending = proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.status).toBe("ready");
  expect(result.copy?.pages).toHaveLength(8);
  expect(mock.calls.map(call => call.stage)).toEqual(["article_analysis", "editorial_plan", "card_copy", "caption", "image_brief", "editorial_review"]);
  expect(fetcher).toHaveBeenCalledTimes(6 * GEMINI_MAX_ATTEMPTS);
  expect([...attempts.values()].every(count => count === GEMINI_MAX_ATTEMPTS)).toBe(true);
  expect(result.pageDesigns?.cover.background.assetId).toBe(991);
  expect(controlled.image).toHaveBeenCalledOnce();
  expect(f.revision.payload).toEqual(before);
});
it.each(["caption", "review", "field"] as const)("allows the explicit %s stage at legacy zero without unrelated stages", async scope => {
  const f = fixture(0, true), mock = createFamilyProviderMock();
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, { ...f.input, scope, pageId: "cover", ...(scope === "field" ? { allowedFieldPaths: ["pages.cover.fields.headline"] } : {}) }, f.plan);
  expect(result.status).toBe("ready");
  expect(mock.calls.map(call => call.stage)).toEqual([scope === "review" ? "editorial_review" : scope === "field" ? "partial_copy" : "caption"]);
  expect(controlled.image).not.toHaveBeenCalled();
});
it("preserves an explicit collector zero budget unchanged and performs no provider request", async () => {
  const f = fixture(10), budget = new LlmBudget(0), fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const result = await proposeFamilyDialogue(db, f.item, f.channel, f.revision, f.input, f.plan, { budget });
  expect(result.copy).toBeNull();
  expect(result.reviewFlags).toContainEqual(expect.objectContaining({ code: "budget" }));
  expect(budget.limit).toBe(0); expect(budget.used).toBe(0);
  expect(fetcher).not.toHaveBeenCalled(); expect(controlled.image).not.toHaveBeenCalled();
});

