import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../server/env";
import { callTool, LlmBudget } from "../server/services/llm";
import { generateStudioCaption, generateStudioText } from "../server/services/studioAi";
import { testGemini } from "../server/services/connectionTest";
import { geminiRequest } from "../server/services/gemini";
import { studioGenerationSchema } from "../shared/studio";
import { z } from "zod";

const draft = { title: "초안", script: "본문", caption: "캡션", panels: Array.from({ length: 4 }, () => ({ scene: "펭귄", dialogue: "안녕" })) };
const input = { provider: "gemini" as const, directive: "원문으로 작성", content: { title: "원문 제목", channel: "penguin", format: "웹툰" } };
const response = (data: unknown, finishReason = "STOP") => new Response(JSON.stringify({
  modelVersion: "gemini-2.5-flash", candidates: [{ finishReason, content: { parts: [{ thought: true, text: "not output" }, { text: JSON.stringify(data) }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
}));

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "gemini-unit-secret"); vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", "openai-unit-secret"); vi.stubEnv("AI_PROVIDER", "auto");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini provider", () => {
  it("routes drafts and captions to Gemini with server-only keys and validated structured output", async () => {
    const mock = vi.fn().mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response({ caption: "새 캡션" })); vi.stubGlobal("fetch", mock);
    expect(env.aiProvider).toBe("gemini");
    const result = await generateStudioText(input);
    expect(result).toMatchObject({ ...draft, provider: "gemini", usage: { inputTokens: 10, outputTokens: 25 } });
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("gemini-unit-secret");
    expect(init.redirect).toBe("error");
    expect(init.body).not.toContain("secret");
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseJsonSchema.required).toContain("panels");
    expect(body).not.toHaveProperty("tools");
    expect(await generateStudioCaption(input)).toMatchObject({ caption: "새 캡션", provider: "gemini" });
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 402, 403, 404, 408, 429, 500, 502, 504])("stops on ambiguous/permanent HTTP %s without fallback, retry or upstream disclosure", async status => {
    const mock = vi.fn().mockResolvedValue(new Response("gemini-unit-secret", { status })); vi.stubGlobal("fetch", mock);
    const error = await generateStudioText(input).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected a provider error");
    expect(error.message).toContain(`Gemini HTTP ${status}`);
    expect(error.message).not.toContain("gemini-unit-secret");
    expect(mock).toHaveBeenCalledOnce();
  });
  it.each(["MAX_TOKENS", "SAFETY"])("does not accept partial or blocked output (%s)", async reason => {
    const mock = vi.fn().mockResolvedValue(response(draft, reason)); vi.stubGlobal("fetch", mock);
    await expect(generateStudioText(input)).rejects.toThrow(reason === "MAX_TOKENS" ? "출력 한도에서 잘렸습니다" : "생성을 거절했습니다");
    expect(mock).toHaveBeenCalledOnce();
  });
  it("rejects malformed JSON, oversized responses and network errors without leaking credentials", async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response("gemini-unit-secret"))
      .mockResolvedValueOnce(new Response("x".repeat(2_000_001)))
      .mockRejectedValueOnce(new Error("gemini-unit-secret")); vi.stubGlobal("fetch", mock);
    await expect(generateStudioText(input)).rejects.toThrow("응답 형식");
    await expect(generateStudioText(input)).rejects.toThrow("저장 한도");
    await expect(generateStudioText(input)).rejects.toThrow("Gemini 연결 오류");
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it("keeps explicit provider selection and refuses missing keys or exhausted local budgets", async () => {
    const mock = vi.fn(); vi.stubGlobal("fetch", mock); vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("AI_PROVIDER", "gemini");
    expect(env.aiProvider).toBe("gemini"); expect(env.aiConfigured).toBe(false);
    await expect(generateStudioText(input)).rejects.toThrow("미연결");
    vi.stubEnv("GEMINI_API_KEY", "gemini-unit-secret");
    const result = await callTool({ provider: "gemini", system: "rules", user: "source", toolName: "extract", toolDescription: "extract", inputSchema: { type: "object" }, zod: z.object({}), budget: new LlmBudget(0) });
    expect(result).toMatchObject({ ok: false, kind: "budget" }); expect(mock).not.toHaveBeenCalled();
  });
  it("checks model access with GET only and does not claim free eligibility", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("{}"));
    expect(await testGemini(mock)).toMatchObject({ ok: true, message: expect.stringContaining("별도로 확인") });
    expect(mock.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash");
    expect(mock.mock.calls[0][1]).not.toHaveProperty("body");
    expect(mock).toHaveBeenCalledOnce();
  });
  it("accepts Gemini for text but keeps image generation restricted to OpenAI", () => {
    const payload = { version: 1, provider: "gemini", kind: "text", textTarget: "fill", requestId: "11111111-1111-4111-8111-111111111111" };
    expect(studioGenerationSchema.safeParse(payload).success).toBe(true);
    expect(studioGenerationSchema.safeParse({ ...payload, kind: "image", panelIndex: 0 }).success).toBe(false);
  });
});

describe("bounded Gemini recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("recovers a 503 using the same request, model and key after backoff", async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response("private upstream detail", { status: 503 })).mockResolvedValueOnce(response(draft));
    vi.stubGlobal("fetch", mock);
    const pending = generateStudioText(input);
    await vi.advanceTimersByTimeAsync(1124);
    expect(mock).toHaveBeenCalledOnce();
    vi.stubEnv("GEMINI_MODEL", "different-model");
    vi.stubEnv("GEMINI_API_KEY", "changed-unit-secret");
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ...draft, provider: "gemini" });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0]).toBe(mock.mock.calls[0][0]);
    expect(mock.mock.calls[1][1].body).toBe(mock.mock.calls[0][1].body);
    expect(mock.mock.calls[1][1].headers["x-goog-api-key"]).toBe("gemini-unit-secret");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops after three 503 responses with an actionable, sanitized message", async () => {
    const times: number[] = [];
    const mock = vi.fn().mockImplementation(() => {
      times.push(Date.now());
      return new Response("gemini-unit-secret private upstream detail", { status: 503 });
    });
    vi.stubGlobal("fetch", mock);
    const pending = generateStudioCaption(input).catch(error => error as Error);
    await vi.runAllTimersAsync();
    const error = await pending;
    if (!(error instanceof Error)) throw new Error("Expected a provider error");
    expect(error.message).toContain("총 3회");
    expect(error.message).toContain("직접 편집");
    expect(error.message).not.toMatch(/secret|private upstream/);
    expect(times.map(time => time - times[0])).toEqual([0, 1125, 3250]);
    expect(mock.mock.calls.every(([url]) => String(url).startsWith("https://generativelanguage.googleapis.com/"))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors the longer Retry-After and Google RetryInfo for a temporary 429", async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: {
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3s" },
      ],
    } }), { status: 429, headers: { "Retry-After": "2" } })).mockResolvedValueOnce(response(draft));
    vi.stubGlobal("fetch", mock);
    const pending = generateStudioText(input);
    await vi.advanceTimersByTimeAsync(3124);
    expect(mock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject(draft);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each(["rate_limit_exceeded", "too_many_requests"])("retries the explicit temporary code %s", async code => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code } }), { status: 429 })).mockResolvedValueOnce(response(draft));
    vi.stubGlobal("fetch", mock);
    const pending = generateStudioText(input);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject(draft);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: "quota_exceeded" },
    { message: "Daily quota exhausted" },
    { details: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] },
    { message: "Quota exceeded for metric requests per minute, limit: 0" },
    { details: [{ quotaId: "GenerateRequestsPerMinute", quotaValue: "0" }] },
    { message: "Spend cap exceeded" },
    { message: "Insufficient credits" },
  ])("does not retry confirmed quota/billing limits, even with a retry hint (%j)", async error => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 429, headers: { "Retry-After": "1" } }));
    vi.stubGlobal("fetch", mock);
    await expect(generateStudioText(input)).rejects.toThrow("할당량·결제 상태");
    expect(mock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors an HTTP-date Retry-After without starting the next request early", async () => {
    const date = new Date(Date.now() + 4000).toUTCString();
    const mock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": date } })).mockResolvedValueOnce(response(draft));
    vi.stubGlobal("fetch", mock);
    const pending = generateStudioText(input);
    await vi.advanceTimersByTimeAsync(4124);
    expect(mock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject(draft);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("returns a long Retry-After to the user instead of shortening it and sending again", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 503, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", mock);
    await expect(generateStudioText(input)).rejects.toThrow("최소 60초");
    expect(mock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts transient attempts against the caller's existing LLM budget", async () => {
    const mock = vi.fn().mockImplementation(() => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", mock);
    const budget = new LlmBudget(2);
    const pending = callTool({ provider: "gemini", system: "rules", user: "source", toolName: "extract", toolDescription: "extract", inputSchema: { type: "object" }, zod: z.object({}), budget });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, kind: "api", error: expect.stringContaining("총 2회") });
    expect(budget.used).toBe(2);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("uses one total deadline across retries and never replays a timed-out call", async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", mock);
    const pending = generateStudioText(input);
    const rejected = expect(pending).rejects.toThrow("응답 대기 시간이 초과");
    await vi.advanceTimersByTimeAsync(90_000);
    await rejected;
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can cancel during backoff without sending another request", async () => {
    const controller = new AbortController();
    const mock = vi.fn().mockImplementation(() => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", mock);
    const rejected = expect(generateStudioText({ ...input, signal: controller.signal })).rejects.toThrow("취소했습니다");
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error("private cancel detail"));
    await rejected;
    await vi.runAllTimersAsync();
    expect(mock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled response body at the deadline and does not retry it", async () => {
    const cancelled = vi.fn();
    const mock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })));
    vi.stubGlobal("fetch", mock);
    const rejected = expect(geminiRequest({}, { timeoutMs: 100 })).rejects.toThrow("응답 대기 시간이 초과");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledOnce();
  });

  it("does not retry a successful response blocked by safety, even after recovering a 503", async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(response(draft, "SAFETY"));
    vi.stubGlobal("fetch", mock);
    const rejected = expect(generateStudioText(input)).rejects.toThrow("생성을 거절했습니다");
    await vi.runAllTimersAsync();
    await rejected;
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
