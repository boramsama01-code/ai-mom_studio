import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const { claudeCreate } = vi.hoisted(() => ({ claudeCreate: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: claudeCreate }; } }));
import { env } from "../server/env";
import { callTool, LlmBudget, verifyEvidence } from "../server/services/llm";
import { generateStudioCaption, generateStudioImage, generateStudioText, studioAiStatus } from "../server/services/studioAi";
import { openaiFailureMessage } from "../server/services/openaiError";
import { testOpenai } from "../server/services/connectionTest";

const draft = { title: "새 이야기", script: "본문", caption: "캡션", panels: Array.from({ length: 4 }, () => ({ scene: "우주복 펭귄", dialogue: "안녕" })) };
const input = { directive: "마지막 대사를 짧게", content: { title: "기존 제목", channel: "penguin", format: "웹툰", script: "기존 본문" } };
const response = (data: unknown, name = "save_studio_draft") => new Response(JSON.stringify({ status: "completed", model: "gpt-6.1-sol", output: [{ type: "function_call", name, arguments: JSON.stringify(data) }], usage: { input_tokens: 12, output_tokens: 30 } }), { status: 200 });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "unit-openai-key");
  vi.stubEnv("OPENAI_MODEL", "");
  vi.stubEnv("OPENAI_IMAGE_MODEL", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "unit-claude-key");
  vi.stubEnv("ANTHROPIC_MODEL", "claude-test");
  vi.stubEnv("AI_PROVIDER", "auto");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("AI provider routing", () => {
  it("requests only a caption with one paid call and no full-draft rewrite", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ caption: "캡션만 개선" }, "save_studio_caption"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateStudioCaption(input);
    expect(result.caption).toBe("캡션만 개선");
    expect(result).not.toHaveProperty("panels");
    expect(fetchMock).toHaveBeenCalledOnce();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.tools[0].parameters.required).toEqual(["caption"]);
    expect(sent.tool_choice).toEqual({ type: "function", name: "save_studio_caption" });
  });
  it("uses GPT by default, stores no provider conversation, and returns usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(draft));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateStudioText(input);
    expect(result.provider).toBe("openai");
    expect(result.panels).toHaveLength(4);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 30 });
    const [url, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(sent.model).toBe("gpt-6.1-sol");
    expect(sent.store).toBe(false);
    expect(sent.tool_choice).toEqual({ type: "function", name: "save_studio_draft" });
    expect(sent.input).toContain("마지막 대사를 짧게");
    expect(sent.input).toContain("기존 본문");
    expect(init.body).not.toContain("unit-openai-key");
    expect(claudeCreate).not.toHaveBeenCalled();
  });

  it("uses Claude only when requested and retains encrypted-store environment defaults", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    claudeCreate.mockResolvedValue({ model: "claude-test", content: [{ type: "tool_use", name: "save_studio_draft", id: "x", input: draft }], usage: { input_tokens: 3, output_tokens: 5 }, stop_reason: "tool_use" });
    const result = await generateStudioText({ ...input, provider: "anthropic" });
    expect(result.provider).toBe("anthropic"); expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(env.aiProvider).toBe("anthropic");
    vi.stubEnv("AI_PROVIDER", "openai");
    expect(env.aiConfigured).toBe(false);
    expect(studioAiStatus().text).toEqual({ openai: false, anthropic: true });
  });

  it("does not silently fall back or retry a paid call after API error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"secret-key-must-not-leak"}', { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateStudioText(input)).rejects.toThrow("크레딧 부족");
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(claudeCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed comic output without replacing the user's draft or retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ...draft, panels: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateStudioText(input)).rejects.toThrow("출력 형식 오류");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains source evidence verification and enforces legacy invocation budgets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }, "extract")); vi.stubGlobal("fetch", fetchMock);
    const result = await callTool({ system: "rules", user: "source", toolName: "extract", toolDescription: "Extract", inputSchema: { type: "object" }, zod: z.object({ ok: z.boolean() }), budget: new LlmBudget(0) });
    expect(result.ok).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
    const verified = verifyEvidence({ evidence: [{ source_id: 1, quote: "10월 20일", field: "date" }, { source_id: 1, quote: "가짜 일정", field: "date" }] }, [{ source_id: 1, kind: "official", title: "공고", text: "접수는 10월 20일 시작", url: "https://example.com", published: null }]);
    expect(verified.dropped).toBe(1); expect(verified.data.evidence).toHaveLength(1);
  });
});

describe("Studio images", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  it("edits with server-provided reference bytes and returns durable PNG bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 20, output_tokens: 50 } })));
    vi.stubGlobal("fetch", fetchMock);
    const reference = `data:image/png;base64,${png.toString("base64")}`;
    const result = await generateStudioImage({ prompt: "표정만 놀라게", referenceImages: [reference] });
    expect(result.bytes).toEqual(png);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/edits");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.images).toEqual([{ image_url: reference }]); expect(sent.n).toBe(1);
    expect(sent.model).toBe("gpt-image-2.5-sunburst");
  });
  it("rejects remote reference URLs before any network call", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(generateStudioImage({ prompt: "edit", referenceImages: ["http://169.254.169.254/latest/meta-data"] })).rejects.toThrow("참조 이미지");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not auto retry timeout errors or expose raw upstream errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("unit-openai-key")); vi.stubGlobal("fetch", fetchMock);
    await expect(generateStudioImage({ prompt: "draw" })).rejects.toThrow("자동으로 재호출하지 않았습니다");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("checks OpenAI model access without billable generation", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  const result = await testOpenai(fetchMock);
  expect(result.ok).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("https://api.openai.com/v1/models/"))).toBe(true);
});

describe("safe and actionable OpenAI failures", () => {
  it.each([
    [401, "invalid_api_key", "unit-openai-key must never leak", "API 키가 유효하지"],
    [401, null, "unit-openai-key", "원인을 확정할 수 없습니다"],
    [403, null, "unit-openai-key", "접근이 거부"],
    [403, null, "Your organization must be verified to use this model. unit-openai-key", "조직 인증이 필요"],
    [429, "insufficient_quota", "unit-openai-key", "API 크레딧"],
    [404, "model_not_found", "unit-openai-key", "모델을 찾을 수 없거나"],
  ])("classifies %s/%s without exposing provider bodies", async (status, code, message, expected) => {
    const result = await openaiFailureMessage(new Response(JSON.stringify({ error: { code, message } }), { status }));
    expect(result).toContain(expected);
    expect(result).toContain(`HTTP ${status}`);
    expect(result).not.toContain("unit-openai-key");
  });
  it("bounds large/malformed provider error bodies", async () => {
    const result = await openaiFailureMessage(new Response("unit-openai-key".repeat(5000), { status: 403 }));
    expect(result).toContain("접근이 거부");
    expect(result).not.toContain("unit-openai-key");
    expect(await openaiFailureMessage(new Response("not-json", { status: 401 }))).toContain("HTTP 401");
  });
  it("uses the same safe diagnosis for free connection checks and stops on first rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "secret" } }), { status: 401 }));
    const result = await testOpenai(fetchMock);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("API 키가 유효하지");
    expect(result.message).not.toContain("secret");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
