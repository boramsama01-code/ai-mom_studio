import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callTool, getClient, LlmBudget, openaiRequest } from "../server/services/llm";
import { geminiRequest } from "../server/services/gemini";
import { generateStudioImage } from "../server/services/studioAi";
import { withGenerationContext } from "../server/services/generationContext";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "unit-only-openai");
  vi.stubEnv("GEMINI_API_KEY", "unit-only-gemini");
  vi.stubEnv("ANTHROPIC_API_KEY", "unit-only-anthropic");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const request = { system: "rules", user: "source", toolName: "save", toolDescription: "test", inputSchema: { type: "object" }, zod: z.object({}) };

function stalledFetch() {
  let received: AbortSignal | undefined;
  const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    received = init.signal as AbortSignal;
    if (received.aborted) reject(received.reason);
    else received.addEventListener("abort", () => reject(received?.reason), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, signal: () => received };
}

describe("durable generation context cancellation reaches provider calls", () => {
  it.each(["openai", "gemini", "image"] as const)("aborts %s requests without a replay or content result", async provider => {
    const mocked = stalledFetch(), controller = new AbortController();
    const pending = withGenerationContext({ signal: controller.signal, assertActive: async () => undefined }, () => provider === "openai"
      ? openaiRequest("/responses", {}) : provider === "gemini" ? geminiRequest({}) : generateStudioImage({ prompt: "isolated test" }));
    const rejected = expect(pending).rejects.toThrow("취소했습니다");
    controller.abort(new Error("private detail never returned"));
    await rejected;
    expect(mocked.signal()?.aborted).toBe(true);
    expect(mocked.fetcher).toHaveBeenCalledOnce();
  });

  it("passes the same cancellation to Anthropic and reserves only the attempted call", async () => {
    const controller = new AbortController(), budget = new LlmBudget(2);
    let received: AbortSignal | null | undefined;
    const create = vi.spyOn(getClient().messages, "create").mockImplementation(((_body: unknown, opts: { signal?: AbortSignal }) => {
      received = opts.signal;
      return new Promise((_resolve, reject) => received!.addEventListener("abort", () => reject(received!.reason), { once: true }));
    }) as any);
    const pending = withGenerationContext({ signal: controller.signal, assertActive: async () => undefined }, () => callTool({ ...request, budget, provider: "anthropic" }));
    controller.abort(new Error("private detail"));
    expect(await pending).toMatchObject({ ok: false, kind: "api", error: expect.stringContaining("취소했습니다") });
    expect(received?.aborted).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(budget.used).toBe(1);
  });

  it("does not reserve a call or contact a provider for a context cancelled before execution", async () => {
    const controller = new AbortController(), budget = new LlmBudget(2), fetcher = vi.fn();
    controller.abort(); vi.stubGlobal("fetch", fetcher);
    const result = await withGenerationContext({ signal: controller.signal, assertActive: async () => undefined }, () => callTool({ ...request, budget, provider: "openai" }));
    expect(result).toMatchObject({ ok: false, kind: "api" });
    expect(budget.used).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels a stalled OpenAI response body without returning an incomplete result", async () => {
    const controller = new AbortController(), cancelled = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }))));
    const pending = withGenerationContext({ signal: controller.signal, assertActive: async () => undefined }, () => openaiRequest("/responses", {}));
    const rejected = expect(pending).rejects.toThrow("취소했습니다");
    await Promise.resolve(); controller.abort(); await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("shares one call budget across failures and transient Gemini HTTP retries", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const budget = new LlmBudget(3);
    const first = callTool({ ...request, budget, provider: "gemini" });
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ ok: false, kind: "api" });
    expect(await callTool({ ...request, budget, provider: "gemini" })).toMatchObject({ ok: false, kind: "budget" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(budget.used).toBe(3);
  });
});
