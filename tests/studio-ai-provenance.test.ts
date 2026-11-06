import { beforeEach, expect, it, vi } from "vitest";
import { setTestEnv } from "./helpers";
setTestEnv();
const mock = vi.hoisted(() => ({ callTool: vi.fn() }));
vi.mock("../server/services/llm", async original => ({ ...await original<object>(), callTool: mock.callTool }));
const { generateStudioText, generateStudioCaption, generateStudioPanel } = await import("../server/services/studioAi");
const provenance = { provider: "gemini", requestedModel: "gemini-2.5-flash", actualModel: "gemini-2.5-flash-001", requestId: "provider-response-qa", usageStatus: "known", inputTokens: 34, outputTokens: 56, status: "completed" };
const options = { provider: "gemini" as const, model: "gemini-2.5-flash", directive: "사용자 원고를 유지해 주세요", content: { title: "QA", channel: "allligodang", format: "웹툰", panels: Array.from({ length: 4 }, () => ({ scene: "장면", dialogue: "대사" })) } };
beforeEach(() => mock.callTool.mockReset());
it.each([
  ["save_studio_draft", () => generateStudioText(options), { title: "QA", script: "원고", caption: "캡션", panels: options.content.panels }],
  ["save_studio_caption", () => generateStudioCaption(options), { caption: "캡션" }],
  ["save_studio_panel", () => generateStudioPanel({ ...options, panelIndex: 1 }), { scene: "장면", dialogue: "대사" }],
] as const)("%s forwards provider evidence and hashes the exact prompt inputs once", async (toolName, generate, data) => {
  mock.callTool.mockResolvedValue({ ok: true, data, model: provenance.actualModel, usage: { inputTokens: 34, outputTokens: 56 }, provenance });
  const result = await generate();
  expect(result.provenance).toEqual(provenance);
  expect(result.promptTrace).toEqual({ toolName, inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.stringify(result.promptTrace)).not.toContain(options.directive);
  expect(mock.callTool).toHaveBeenCalledOnce();
  expect(mock.callTool.mock.calls[0][0]).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash", maxAttempts: 1, toolName });
});
it("retains truncated response evidence on the safe failure and changes the hash with prompt edits", async () => {
  mock.callTool.mockResolvedValue({ ok: false, kind: "parse", error: "safe incomplete result", provenance: { ...provenance, status: "truncated" } });
  let first: any;
  try { await generateStudioText(options); } catch (error) { first = error; }
  expect(first).toMatchObject({ provenance: { ...provenance, status: "truncated" }, promptTrace: { toolName: "save_studio_draft" } });
  let second: any;
  try { await generateStudioText({ ...options, directive: "바뀐 사용자 지시" }); } catch (error) { second = error; }
  expect(second.promptTrace.inputSha256).not.toBe(first.promptTrace.inputSha256);
  expect(mock.callTool).toHaveBeenCalledTimes(2);
});
