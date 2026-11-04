import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmBudget } from "../server/services/llm";
import { geminiResearchRequest } from "../server/services/geminiResearch";
const result = (metadata?: object, reason = "STOP") => new Response(JSON.stringify({ modelVersion: "gemini-4-argon", responseId: "grounding_test", candidates: [{ finishReason: reason, content: { parts: [{ text: "원문 후보. 본문에서 만든 링크 https://invented.invalid must not become evidence." }] }, groundingMetadata: metadata }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 12, thoughtsTokenCount: 5 } }));
const invoke = (budget = new LlmBudget(3), signal?: AbortSignal) => geminiResearchRequest({ system: "원자료 조사", user: "동일 연구의 공식 설명을 찾으세요.", model: "gemini-4-argon", budget, signal });
beforeEach(() => vi.stubEnv("GEMINI_API_KEY", "isolated-research-key"));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("actual grounded discovery, not fictional page verification", () => {
  it("attaches real search and returns only observed metadata URLs without claiming a page read", async () => {
    const fetcher = vi.fn().mockResolvedValue(result({ webSearchQueries: ["original study"], groundingChunks: [{ web: { uri: "https://www.nasa.gov/science/", title: "기관 설명" } }, { web: { uri: "javascript:alert(1)", title: "unsafe" } }, { web: { uri: "https://www.nasa.gov/science/", title: "duplicate" } }] })); vi.stubGlobal("fetch", fetcher);
    const budget = new LlmBudget(3), response = await invoke(budget);
    expect(response).toMatchObject({ ok: true, data: { searchPerformed: true, sources: [{ url: "https://www.nasa.gov/science/", title: "기관 설명", verification: "search_result" }] }, provenance: { outputTokens: 17, requestedModel: "gemini-4-argon" } });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ googleSearch: {} }]); expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
    expect(budget.used).toBe(1); expect(budget.outputTokens).toBe(17);
    if (response.ok) expect(response.data.sources.some(source => source.url.includes("invented"))).toBe(false);
  });
  it("reports no actual search evidence when model prose has links but tool metadata is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result()));
    expect(await invoke()).toMatchObject({ ok: true, data: { searchPerformed: false, sources: [], queries: [] } });
  });
  it.each(["MAX_TOKENS", "SAFETY", "OTHER"])("does not accept %s partial research as verified input", async reason => {
    const fetcher = vi.fn().mockResolvedValue(result({}, reason)); vi.stubGlobal("fetch", fetcher);
    expect((await invoke()).ok).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("respects a depleted shared budget and cancellation before doing network work", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await invoke(new LlmBudget(0))).toMatchObject({ ok: false, kind: "budget", provenance: { status: "not_started" } });
    const controller = new AbortController(); controller.abort();
    expect(await invoke(new LlmBudget(3), controller.signal)).toMatchObject({ ok: false, provenance: { status: "cancelled" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not replay ambiguous requests or expose provider bodies as operator errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("isolated-research-key")); vi.stubGlobal("fetch", fetcher);
    const budget = new LlmBudget(3), response = await invoke(budget);
    expect(response).toMatchObject({ ok: false, provenance: { usageStatus: "usage_unknown", inputTokens: null } });
    expect(budget.usageUnknown).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(response)).not.toContain("isolated-research-key");
  });
});
