import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { channelAiSettingsSchema, defaultChannelAiSettings, legacyChannelAiSettings, resolveAiSelection } from "../shared/channelAi";
import { channelCreateSchema } from "../shared/channelSettings";
import { callTool, LlmBudget } from "../server/services/llm";
import { generateStudioImage } from "../server/services/studioAi";

const models = { gemini: "gemini-default", openai: "gpt-default", anthropic: "claude-default", image: "gpt-image-default" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("per-channel AI role contracts", () => {
  it("uses Gemini summaries, GPT copy and OpenAI images independently of global preference", () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    expect(resolveAiSelection(null, "summary", models)).toEqual({ provider: "gemini", model: "gemini-4-argon" });
    expect(resolveAiSelection(undefined, "copy", models)).toEqual({ provider: "openai", model: "gpt-6-astra" });
    expect(resolveAiSelection(null, "image", models)).toEqual({ provider: "openai", model: "gpt-image-2.5-sunburst" });
  });

  it("isolates saved models by channel and discards incompatible models on a temporary provider override", () => {
    const first = defaultChannelAiSettings(), second = defaultChannelAiSettings();
    first.summary = { provider: "anthropic", model: "claude-source" };
    first.copy = { provider: "openai", model: "gpt-editor" };
    first.image.model = "gpt-image-editorial";
    expect(resolveAiSelection(first, "copy", models)).toEqual({ provider: "openai", model: "gpt-editor" });
    expect(resolveAiSelection(first, "copy", models, { provider: "gemini" })).toEqual({ provider: "gemini", model: "gemini-default" });
    expect(resolveAiSelection(first, "copy", models, { provider: "openai" }).model).toBe("gpt-editor");
    expect(resolveAiSelection(first, "summary", models)).toEqual({ provider: "anthropic", model: "claude-source" });
    expect(resolveAiSelection(second, "image", models).model).toBe("gpt-image-default");
    expect(second).toEqual(defaultChannelAiSettings());
  });

  it.each([
    { copy: { provider: "openai", model: "gemini-wrong" } },
    { summary: { provider: "gemini", model: "gpt-wrong" } },
    { image: { provider: "gemini", model: "gemini-image" } },
    { image: { provider: "openai", model: "dall-e-3" } },
    { copy: { provider: "openai", model: "gpt-image-1" } },
    { image: { provider: "openai", model: "https://untrusted.invalid/model" } },
    { copy: { provider: "openai", model: "gpt-valid", apiKey: "never-store-me" } },
    { summary: { provider: "gemini", model: "../model" } },
    { copy: { provider: "openai", model: "sk-not-a-model" } },
  ])("rejects unsupported or credential-shaped model configuration %j", patch => {
    expect(channelAiSettingsSchema.safeParse({ ...defaultChannelAiSettings(), ...patch }).success).toBe(false);
  });

  it("validates new custom channel settings and treats blank model names as explicit inheritance", () => {
    const aiSettings = { ...defaultChannelAiSettings(), copy: { provider: "openai", model: "   " } };
    const parsed = channelCreateSchema.parse({ name: "새 편집실", aiSettings });
    expect(legacyChannelAiSettings(parsed.aiSettings).copy.model).toBe("");
    expect(channelCreateSchema.safeParse({ name: "새 편집실", aiSettings: { ...aiSettings, secret: "not-allowed" } }).success).toBe(false);
  });
});

describe("resolved model reaches the selected provider without changing global settings", () => {
  const invoke = (provider: "gemini" | "openai", model: string) => callTool({ provider, model, system: "원문 사실만 사용", user: "isolated source", toolName: "extract", toolDescription: "extract", inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, zod: z.object({ ok: z.boolean() }), budget: new LlmBudget(1), maxAttempts: 1 });

  it("sends an explicit Gemini model in the fixed endpoint, keeping the API key out of the body", async () => {
    vi.stubEnv("GEMINI_API_KEY", "isolated-gemini-secret"); vi.stubEnv("GEMINI_MODEL", "gemini-global");
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }] })));
    vi.stubGlobal("fetch", fake);
    expect(await invoke("gemini", "gemini-channel")).toMatchObject({ ok: true, model: "gemini-channel" });
    expect(fake.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-channel:generateContent");
    expect(fake.mock.calls[0][1].body).not.toContain("isolated-gemini-secret");
    expect(process.env.GEMINI_MODEL).toBe("gemini-global");
  });

  it("sends an explicit GPT model once, preserving the no-provider-conversation contract", async () => {
    vi.stubEnv("OPENAI_API_KEY", "isolated-openai-secret"); vi.stubEnv("OPENAI_MODEL", "gpt-global");
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "function_call", name: "extract", arguments: '{"ok":true}' }] })));
    vi.stubGlobal("fetch", fake);
    expect(await invoke("openai", "gpt-channel")).toMatchObject({ ok: true, model: "gpt-channel" });
    expect(JSON.parse(fake.mock.calls[0][1].body)).toMatchObject({ model: "gpt-channel", store: false });
    expect(fake).toHaveBeenCalledTimes(1); expect(process.env.OPENAI_MODEL).toBe("gpt-global");
  });

  it("uses the saved image model for both request and image provenance", async () => {
    vi.stubEnv("OPENAI_API_KEY", "isolated-image-secret"); vi.stubEnv("OPENAI_IMAGE_MODEL", "gpt-image-global");
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] })));
    vi.stubGlobal("fetch", fake);
    const result = await generateStudioImage({ prompt: "abstract comparison, no text", purpose: "cover", model: "gpt-image-channel" });
    expect(result.model).toBe("gpt-image-channel");
    expect(JSON.parse(fake.mock.calls[0][1].body).model).toBe("gpt-image-channel");
    expect(process.env.OPENAI_IMAGE_MODEL).toBe("gpt-image-global");
  });
});
