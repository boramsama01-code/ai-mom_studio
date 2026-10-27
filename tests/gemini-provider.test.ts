import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../server/env";
import { callTool, LlmBudget } from "../server/services/llm";
import { generateStudioCaption, generateStudioText } from "../server/services/studioAi";
import { testGemini } from "../server/services/connectionTest";
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
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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
  it.each([429, 403, 500])("stops on HTTP %s without paid fallback, retry or upstream error disclosure", async status => {
    const mock = vi.fn().mockResolvedValue(new Response("gemini-unit-secret", { status })); vi.stubGlobal("fetch", mock);
    await expect(generateStudioText(input)).rejects.toThrow(`Gemini HTTP ${status}`);
    expect(mock).toHaveBeenCalledOnce();
  });
  it.each(["MAX_TOKENS", "SAFETY"])("does not accept partial or blocked output (%s)", async reason => {
    const mock = vi.fn().mockResolvedValue(response(draft, reason)); vi.stubGlobal("fetch", mock);
    await expect(generateStudioText(input)).rejects.toThrow("출력 형식 오류");
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
