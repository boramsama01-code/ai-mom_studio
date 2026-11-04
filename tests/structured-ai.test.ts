import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ claude: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.claude }; } }));
import { callTool, LlmBudget } from "../server/services/llm";
import { strictOpenAiSchema, strictClaudeSchema } from "../server/services/structuredAi";
const schema = { type: "object", properties: { ok: { type: "boolean" }, count: { type: "integer" }, note: { type: "string", maxLength: 20 }, child: { type: "object", properties: { value: { type: ["string", "null"] } }, required: ["value"] } }, required: ["ok", "count", "child"] };
const validator = z.object({ ok: z.boolean(), count: z.number().int(), note: z.string().max(20).optional(), child: z.object({ value: z.string().nullable() }) });
const data = { ok: false, count: 0, child: { value: null } };
const invoke = (provider: "openai" | "anthropic" | "gemini", model: string, extra: object = {}) => callTool({ provider, model, structured: true, system: "Only supplied evidence", user: "Isolated draft", toolName: "editorial_stage", toolDescription: "Editorial step", inputSchema: schema, zod: validator, budget: new LlmBudget(4), maxTokens: 6500, ...extra });
const openai = (overrides: object = {}) => new Response(JSON.stringify({ id: "resp_isolated", model: "gpt-6-astra-2026-10-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...data, note: null }) }] }], usage: { input_tokens: 14, output_tokens: 29 }, ...overrides }));
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", "isolated-openai-key"); vi.stubEnv("GEMINI_API_KEY", "isolated-gemini-key"); vi.stubEnv("ANTHROPIC_API_KEY", "isolated-claude-key"); mocks.claude.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("native structured provider contracts", () => {
  it("closes nested objects and makes optional wire values nullable without changing the application schema", () => {
    const before = structuredClone(schema), strict: any = strictOpenAiSchema(schema);
    expect(strict.required).toEqual(["ok", "count", "note", "child"]); expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.child.additionalProperties).toBe(false); expect(strict.properties.note.anyOf).toContainEqual({ type: "null" });
    expect(schema).toEqual(before);
    const claude: any = strictClaudeSchema(schema); expect(claude.additionalProperties).toBe(false); expect(claude.properties.note.maxLength).toBeUndefined();
    expect(validator.safeParse({ ...data, note: "x".repeat(21) }).success).toBe(false);
  });
  it("uses Responses JSON output and records requested versus actual model without losing false/zero", async () => {
    const fetcher = vi.fn().mockResolvedValue(openai()); vi.stubGlobal("fetch", fetcher);
    const result = await invoke("openai", "gpt-6-astra");
    expect(result).toMatchObject({ ok: true, data, provenance: { provider: "openai", requestedModel: "gpt-6-astra", actualModel: "gpt-6-astra-2026-10-01", requestId: "resp_isolated", inputTokens: 14, outputTokens: 29, usageStatus: "known" } });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ store: false, model: "gpt-6-astra", max_output_tokens: 6500, text: { format: { type: "json_schema", strict: true } } });
    expect(body).not.toHaveProperty("tools"); expect(body).not.toHaveProperty("tool_choice"); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("isolated-openai-key");
  });
  it.each(["claude-opus-5-5", "claude-fable-5-1"])("uses %s JSON output and collects every text block after thinking", async model => {
    const json = JSON.stringify(data);
    mocks.claude.mockResolvedValue({ id: "msg_isolated", model, stop_reason: "end_turn", content: [{ type: "thinking", thinking: "not public", signature: "opaque" }, { type: "text", text: json.slice(0, 9) }, { type: "text", text: json.slice(9) }], usage: { input_tokens: 4, output_tokens: 50 } });
    const result = await invoke("anthropic", model, { structured: false });
    expect(result).toMatchObject({ ok: true, data, provenance: { actualModel: model, requestId: "msg_isolated" } });
    const body = mocks.claude.mock.calls[0][0];
    expect(body.output_config.format.type).toBe("json_schema"); expect(body.max_tokens).toBe(6500);
    for (const field of ["tools", "tool_choice", "temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(field);
    expect(body.messages).toHaveLength(1); expect(body.messages[0].role).toBe("user");
    expect(JSON.stringify(result)).not.toContain("not public"); expect(mocks.claude).toHaveBeenCalledOnce();
  });
  it.each(["max_tokens", "refusal", "model_context_window_exceeded"])("does not accept or replay a Claude %s outcome even with complete JSON", async stop_reason => {
    mocks.claude.mockResolvedValue({ id: "msg_partial", model: "claude-opus-5-5", stop_reason, content: [{ type: "text", text: JSON.stringify(data) }], usage: { input_tokens: 4, output_tokens: 50 } });
    const result = await invoke("anthropic", "claude-opus-5-5");
    expect(result.ok).toBe(false); expect(mocks.claude).toHaveBeenCalledOnce();
  });
  it("records unavailable usage as unknown rather than a free completed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(openai({ usage: undefined, model: undefined })));
    const result = await invoke("openai", "gpt-6-astra");
    expect(result).toMatchObject({ ok: true, provenance: { requestedModel: "gpt-6-astra", actualModel: null, usageStatus: "usage_unknown", inputTokens: null, outputTokens: null } });
  });
  it.each(["incomplete", "failed", "in_progress"])("does not apply an OpenAI %s result or retry the paid request", async status => {
    const fetcher = vi.fn().mockResolvedValue(openai({ status })); vi.stubGlobal("fetch", fetcher);
    expect((await invoke("openai", "gpt-6-astra")).ok).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("stops after schema-invalid output and bounds the run's shared call budget", async () => {
    const fetcher = vi.fn().mockResolvedValue(openai({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...data, note: "x".repeat(21) }) }] }] })); vi.stubGlobal("fetch", fetcher);
    const budget = new LlmBudget(1);
    expect((await invoke("openai", "gpt-6-astra", { budget })).ok).toBe(false);
    expect(await invoke("openai", "gpt-6-astra", { budget })).toMatchObject({ ok: false, kind: "budget" });
    expect(fetcher).toHaveBeenCalledOnce(); expect(budget.used).toBe(1);
  });
  it("routes Argon through the supported JSON-schema endpoint and counts thinking tokens", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ modelVersion: "gemini-4-argon-001", responseId: "gemini_test", candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "hidden" }, { text: JSON.stringify(data) }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 12, thoughtsTokenCount: 19 } }))); vi.stubGlobal("fetch", fetcher);
    expect(await invoke("gemini", "gemini-4-argon")).toMatchObject({ ok: true, data, provenance: { requestedModel: "gemini-4-argon", actualModel: "gemini-4-argon-001", outputTokens: 31 } });
    expect(fetcher.mock.calls[0][0]).toContain("models/gemini-4-argon:generateContent"); expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.responseJsonSchema).toEqual(schema);
  });
  it("makes no paid call on cancellation and never falls back after a timeout", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("isolated-openai-key")); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(); controller.abort();
    expect(await invoke("openai", "gpt-6-astra", { signal: controller.signal })).toMatchObject({ ok: false, provenance: { status: "cancelled" } });
    expect(fetcher).not.toHaveBeenCalled();
    const result = await invoke("openai", "gpt-6-astra"); expect(result).toMatchObject({ ok: false, provenance: { usageStatus: "usage_unknown", inputTokens: null } });
    expect(fetcher).toHaveBeenCalledOnce(); expect(mocks.claude).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("isolated-openai-key");
  });
});
