/** Isolated PostgreSQL; every provider is mocked and no production API is called. */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { login, resetDb, setTestEnv } from "./helpers";
import { defaultChannelAiSettings } from "../shared/channelAi";
setTestEnv();
const provider = vi.hoisted(() => ({ text: vi.fn() }));
vi.mock("../server/services/studioAi", async original => ({ ...await original<object>(), generateStudioText: provider.text }));
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { channels, jobs, studioRevisions } = await import("../shared/schema");
const { resolveChannelAiSettings } = await import("../server/services/channelAi");
const { claimJob } = await import("../server/worker/queue");
const { processStudioJob } = await import("../server/worker/studio");
let app: ReturnType<typeof createApp>;
beforeAll(async () => { await resetDb(); app = createApp(); });
beforeEach(() => {
  provider.text.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "isolated-gemini-secret"); vi.stubEnv("OPENAI_API_KEY", "isolated-openai-secret"); vi.stubEnv("ANTHROPIC_API_KEY", "isolated-claude-secret");
  vi.stubEnv("GEMINI_MODEL", "gemini-default"); vi.stubEnv("OPENAI_MODEL", "gpt-default"); vi.stubEnv("OPENAI_IMAGE_MODEL", "gpt-image-default"); vi.stubEnv("ANTHROPIC_MODEL", "claude-default");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request in isolated AI settings test"); }));
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await closeDb(); });
async function fixture() {
  const { agent, csrf } = await login(app), headers = { "x-csrf-token": csrf };
  const response = await agent.post("/api/channels").set(headers).send({ name: "역할별 AI 테스트", slug: `ai-${crypto.randomUUID()}` });
  expect(response.status).toBe(201);
  return { agent, headers, channel: response.body as typeof channels.$inferSelect, db: getDb() };
}

describe("channel AI configuration on real PostgreSQL", () => {
  it("applies role defaults to existing and new channels and exposes no credentials", async () => {
    const f = await fixture();
    const list = await f.agent.get("/api/channels");
    expect(list.status).toBe(200);
    for (const channel of list.body) {
      expect(channel.effectiveAiSettings).toMatchObject({ summary: { provider: "gemini", model: "gemini-4-argon" }, copy: { provider: "openai", model: "gpt-6-astra" }, image: { provider: "openai", model: "gpt-image-2.5-sunburst" } });
      expect(channel.aiAvailability).toEqual({ gemini: true, openai: true, anthropic: true });
    }
    expect(JSON.stringify(list.body)).not.toContain("isolated-");
    expect(await resolveChannelAiSettings(f.db, f.channel.id, "summary")).toEqual({ provider: "gemini", model: "gemini-4-argon" });
  });

  it("isolates settings by channel and serializes competing updates with the existing version contract", async () => {
    const first = await fixture(), second = await fixture();
    const one = defaultChannelAiSettings(), two = defaultChannelAiSettings();
    one.copy = { provider: "anthropic", model: "claude-first" }; two.copy = { provider: "gemini", model: "gemini-second" };
    const results = await Promise.all([one, two].map(aiSettings => first.agent.patch(`/api/channels/${first.channel.id}`).set(first.headers).send({ version: first.channel.version, aiSettings })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const saved = results.find(result => result.status === 200)!.body;
    expect(await resolveChannelAiSettings(first.db, first.channel.id, "copy")).toEqual(saved.aiSettings.copy);
    expect(await resolveChannelAiSettings(second.db, second.channel.id, "copy")).toEqual({ provider: "openai", model: "gpt-6-astra" });
    expect((await first.agent.patch(`/api/channels/${first.channel.id}`).set(first.headers).send({ version: saved.version, aiSettings: { ...one, image: { provider: "gemini", model: "gemini-image" } } })).status).toBe(400);
  });

  it("pins queued work to the admitted model, deduplicates after settings/key changes and stores actual model provenance", async () => {
    const f = await fixture(), aiSettings = defaultChannelAiSettings();
    aiSettings.copy = { provider: "gemini", model: "gemini-before-queue" };
    aiSettings.image.model = "gpt-image-before-queue";
    const changed = await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: 1, aiSettings });
    expect(changed.status).toBe(200);
    const created = await f.agent.post("/api/studio/cards").set(f.headers).send({ title: "작업의 모델 고정", channel: f.channel.slug });
    expect(created.status).toBe(201);
    const intent = { version: created.body.version, kind: "text", textTarget: "fill", requestId: crypto.randomUUID() };
    const started = await f.agent.post(`/api/studio/cards/${created.body.id}/generate`).set(f.headers).send(intent);
    expect(started.status).toBe(202);
    const [queued] = await f.db.select().from(jobs).where(eq(jobs.id, started.body.job.id));
    expect(queued.payload).toMatchObject({ ai: { provider: "gemini", model: "gemini-before-queue" }, provider: "gemini" });
    expect(queued.channelId).toBe(f.channel.id);
    await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: changed.body.version, aiSettings: { ...aiSettings, copy: { provider: "openai", model: "gpt-after-queue" } } });
    vi.stubEnv("GEMINI_MODEL", "gemini-global-changed"); vi.stubEnv("GEMINI_API_KEY", "");
    const duplicate = await f.agent.post(`/api/studio/cards/${created.body.id}/generate`).set(f.headers).send(intent);
    expect(duplicate.status).toBe(202); expect(duplicate.body.duplicate).toBe(true); expect(duplicate.body.job.id).toBe(queued.id);
    provider.text.mockResolvedValue({ title: "생성 제목", script: "검증용 원고", caption: "검증용 캡션", panels: Array.from({ length: 4 }, () => ({ scene: "장면", dialogue: "문구" })), provider: "gemini", model: "gemini-before-queue", usage: { inputTokens: 1, outputTokens: 1 } });
    const claimed = await claimJob(f.db, "channel-ai-model-worker", ["studio_generate"]);
    expect(claimed?.id).toBe(queued.id);
    expect(await processStudioJob(f.db, claimed!, "channel-ai-model-worker")).toBe(true);
    expect(provider.text).toHaveBeenCalledTimes(1);
    expect(provider.text.mock.calls[0][0]).toMatchObject({ provider: "gemini", model: "gemini-before-queue" });
    const revisions = await f.db.select().from(studioRevisions).where(eq(studioRevisions.cardId, created.body.id)).orderBy(studioRevisions.id);
    expect(revisions.at(-1)).toMatchObject({ provider: "gemini", model: "gemini-before-queue" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an unavailable selected provider explicit instead of silently charging another AI", async () => {
    const f = await fixture(), aiSettings = defaultChannelAiSettings(); aiSettings.copy = { provider: "gemini", model: "gemini-writer" };
    await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: 1, aiSettings });
    const created = await f.agent.post("/api/studio/cards").set(f.headers).send({ title: "API 미연결", channel: f.channel.slug });
    vi.stubEnv("GEMINI_API_KEY", "");
    const generated = await f.agent.post(`/api/studio/cards/${created.body.id}/generate`).set(f.headers).send({ version: 1, kind: "text", textTarget: "fill", requestId: crypto.randomUUID() });
    expect(generated.status).toBe(503); expect(generated.body.error).toContain("Gemini");
    expect(await f.db.select().from(jobs).where(eq(jobs.channelId, f.channel.id))).toHaveLength(0);
    expect(provider.text).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
