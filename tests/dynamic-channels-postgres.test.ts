import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { login, naverResponse, resetDb, setTestEnv } from "./helpers";
setTestEnv();
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { channels, contentItems, contentRevisions, destinations, jobs, studioCards } = await import("../shared/schema");
const { runCollect } = await import("../server/worker/collect");
const { newChannelBudget } = await import("../server/services/channelSettings");
let app: ReturnType<typeof createApp>;
beforeAll(async () => { await resetDb(); app = createApp(); });
afterAll(closeDb);

async function fixture(input: Record<string, unknown> = {}) {
  const { agent, csrf } = await login(app), headers = { "x-csrf-token": csrf };
  const response = await agent.post("/api/channels").set(headers).send({ name: "지역 편집실", slug: `atelier-${crypto.randomUUID()}`, categories: ["지역 소식", "실험"], ...input });
  expect(response.status).toBe(201);
  return { agent, headers, channel: response.body as typeof channels.$inferSelect, db: getDb() };
}

describe("dynamic channels with real PostgreSQL and mocked external search", () => {
  it("creates a fully usable directory row without queuing work or enabling publication", async () => {
    const f = await fixture({ accentColor: "#123456" });
    expect(f.channel).toMatchObject({ contentType: "current_dialogue", categories: ["지역 소식", "실험"], accentColor: "#123456", budget: { naverCallsPerRun: 12, dailyPublishLimit: 0, discovery: { enabled: false, autoDraft: false } } });
    expect(await f.db.select().from(jobs).where(eq(jobs.channelId, f.channel.id))).toHaveLength(0);
    expect(await f.db.select().from(destinations).where(eq(destinations.channelId, f.channel.id))).toHaveLength(0);
    expect((await f.agent.get("/api/channels")).body.find((row: { id: number }) => row.id === f.channel.id)).toMatchObject({ slug: f.channel.slug, categories: f.channel.categories });
    const direct = await fixture({ contentType: "manual", categories: [] });
    expect(direct.channel.budget).toMatchObject({ naverCallsPerRun: 0, fetchCallsPerRun: 0, llmCallsPerRun: 0, dailyPublishLimit: 0 });
  });

  it("uses custom labels in rules, collection, source items and direct Studio editing", async () => {
    const f = await fixture();
    const rule = await f.agent.post(`/api/channels/${f.channel.id}/rules`).set(f.headers).send({ query: "지역 편집 테스트", endpoints: ["news"], subcategory: "지역 소식" });
    expect(rule.status).toBe(201);
    expect(rule.body.created[0].subcategory).toBe("지역 소식");
    expect((await f.agent.post(`/api/channels/${f.channel.id}/rules`).set(f.headers).send({ query: "오분류", endpoints: ["news"], subcategory: "과학" })).status).toBe(400);
    expect((await f.agent.post("/api/collection/collect").set(f.headers).send({ channelId: f.channel.id, subcategory: "지역 소식" })).status).toBe(202);
    let searched = 0;
    const collected = await runCollect(f.db, f.channel.id, { trigger: "manual", collectionOnly: true, subcategory: "지역 소식", naverFetch: (async () => { searched++; return naverResponse([]); }) as typeof fetch });
    expect(searched).toBe(1); expect(collected.counts.rulesProcessed).toBe(1);
    const [item] = await f.db.insert(contentItems).values({ channelId: f.channel.id, kind: "current_dialogue", title: "보존할 지역 원문", origin: "collected" }).returning();
    const assigned = await f.agent.patch(`/api/channels/${f.channel.id}/items/${item.id}/subcategory`).set(f.headers).send({ version: item.version, subcategory: "지역 소식" });
    expect(assigned.status).toBe(200);
    const imported = await f.agent.post("/api/studio/cards").set(f.headers).send({ title: item.title, channel: f.channel.slug, sourceItemId: item.id });
    expect(imported.status).toBe(201); expect(imported.body).toMatchObject({ channel: f.channel.slug, subcategory: "지역 소식" });
    const saved = await f.agent.patch(`/api/studio/cards/${imported.body.id}`).set(f.headers).send({ version: imported.body.version, script: "직접 쓴 지역 원고", subcategory: "실험" });
    expect(saved.status).toBe(200);
    expect((await f.agent.get(`/api/studio/cards/${imported.body.id}`)).body.card).toMatchObject({ channel: f.channel.slug, subcategory: "실험", script: "직접 쓴 지역 원고" });
    expect((await f.agent.patch(`/api/studio/cards/${imported.body.id}`).set(f.headers).send({ version: saved.body.version, subcategory: "과학" })).status).toBe(400);
    const overview = await f.agent.get(`/api/collection/overview?channelId=${f.channel.id}`);
    expect(overview.body.channels[0].categories.map((row: { label: string }) => row.label)).toEqual(["지역 소식", "실험", "미분류"]);
  });

  it("rejects reserved/unknown keys and cannot import another brand's source", async () => {
    const f = await fixture(), other = await fixture();
    for (const slug of ["all", "highway", "news", "science-dialogue", "invalid_key"]) expect((await f.agent.post("/api/channels").set(f.headers).send({ name: "잘못된 채널", slug })).status).toBe(400);
    expect((await f.agent.post("/api/studio/cards").set(f.headers).send({ title: "알 수 없음", channel: "unregistered-brand" })).status).toBe(400);
    const [source] = await f.db.insert(contentItems).values({ channelId: other.channel.id, kind: "current_dialogue", title: "다른 채널 원문" }).returning();
    expect((await f.agent.post("/api/studio/cards").set(f.headers).send({ title: source.title, channel: f.channel.slug, sourceItemId: source.id })).status).toBe(400);
    expect(await f.db.select().from(studioCards).where(eq(studioCards.sourceItemId, source.id))).toHaveLength(0);
  });

  it("serializes duplicate creates and rejects a legacy secret-prefix collision", async () => {
    const f = await fixture(), slug = `concurrent-${crypto.randomUUID()}`;
    const results = await Promise.all([1, 2].map(() => f.agent.post("/api/channels").set(f.headers).send({ name: "중복 요청", slug })));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    await f.db.insert(channels).values({ slug: "legacy_brand", name: "기존 이름", contentType: "manual", accentColor: "#123456", budget: newChannelBudget("manual") });
    expect((await f.agent.post("/api/channels").set(f.headers).send({ name: "이름 충돌", slug: "legacy-brand" })).status).toBe(409);
    expect((await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: f.channel.version, slug: "renamed-key" })).status).toBe(400);
  });

  it.each(["item", "rule", "studio"] as const)("preserves a used category on %s records and allows additions with CAS", async kind => {
    const f = await fixture();
    if (kind === "item") await f.db.insert(contentItems).values({ channelId: f.channel.id, kind: "current_dialogue", title: "분류 유지", subcategory: "지역 소식" });
    if (kind === "rule") expect((await f.agent.post(`/api/channels/${f.channel.id}/rules`).set(f.headers).send({ query: "유지할 검색어", endpoints: ["news"], subcategory: "지역 소식" })).status).toBe(201);
    if (kind === "studio") expect((await f.agent.post("/api/studio/cards").set(f.headers).send({ title: "분류 유지", channel: f.channel.slug, subcategory: "지역 소식" })).status).toBe(201);
    const removed = await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: f.channel.version, categories: [] });
    expect(removed.status).toBe(409); expect(removed.body.error).toContain("사용 중인 소분류");
    const added = await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: f.channel.version, categories: ["지역 소식", "새 분류"] });
    expect(added.status).toBe(200); expect(added.body.categories).toEqual(["지역 소식", "새 분류"]);
    expect((await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: f.channel.version, name: "낡은 수정" })).status).toBe(409);
  });

  it.each(["item", "rule", "studio"] as const)("serializes category removal against a concurrent %s assignment", async kind => {
    const f = await fixture();
    const [item] = kind === "item" ? await f.db.insert(contentItems).values({ channelId: f.channel.id, kind: "current_dialogue", title: "경합 중 분류" }).returning() : [];
    const assign = kind === "item"
      ? f.agent.patch(`/api/channels/${f.channel.id}/items/${item.id}/subcategory`).set(f.headers).send({ version: item.version, subcategory: "지역 소식" })
      : kind === "rule"
      ? f.agent.post(`/api/channels/${f.channel.id}/rules`).set(f.headers).send({ query: "경합 중 검색어", endpoints: ["news"], subcategory: "지역 소식" })
      : f.agent.post("/api/studio/cards").set(f.headers).send({ title: "경합 중 작업", channel: f.channel.slug, subcategory: "지역 소식" });
    const remove = f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: f.channel.version, categories: [] });
    const [assigned, removed] = await Promise.all([assign, remove]);
    const [stored] = await f.db.select().from(channels).where(eq(channels.id, f.channel.id));
    if (removed.status === 200) {
      expect([400, 409]).toContain(assigned.status);
      expect(stored.categories).toEqual([]);
    } else {
      expect(removed.status).toBe(409);
      expect(assigned.status).toBe(kind === "item" ? 200 : 201);
      expect(stored.categories).toContain("지역 소식");
    }
  });

  it("changes future defaults while preserving authored revisions and archived content", async () => {
    const f = await fixture();
    const first = await f.agent.post(`/api/channels/${f.channel.id}/items`).set(f.headers).send({ title: "첫 원고" });
    expect(first.status).toBe(201); expect(first.body.kind).toBe("current_dialogue");
    const [before] = await f.db.select().from(contentItems).where(eq(contentItems.id, first.body.id));
    const [revision] = await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, before.currentRevisionId!));
    const changed = await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: f.channel.version, contentType: "notice", name: "수정한 편집실" });
    expect(changed.status).toBe(200); expect(changed.body.budget).toEqual(f.channel.budget);
    const second = await f.agent.post(`/api/channels/${f.channel.id}/items`).set(f.headers).send({ title: "새 공고" });
    expect(second.status).toBe(201); expect(second.body.kind).toBe("notice");
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, before.id)))[0]).toEqual(before);
    expect((await f.db.select().from(contentRevisions).where(eq(contentRevisions.id, revision.id)))[0]).toEqual(revision);
    const archived = await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: changed.body.version, active: false });
    expect(archived.status).toBe(200);
    expect((await f.agent.post("/api/studio/cards").set(f.headers).send({ title: "보관 중 생성", channel: f.channel.slug })).status).toBe(409);
    expect((await f.agent.get(`/api/channels/${f.channel.id}/items/${before.id}`)).status).toBe(200);
    const restored = await f.agent.patch(`/api/channels/${f.channel.id}`).set(f.headers).send({ version: archived.body.version, active: true });
    expect(restored.status).toBe(200); expect(restored.body.slug).toBe(f.channel.slug);
  });

  it("includes a custom Instagram connection and keeps credential namespaces isolated", async () => {
    const f = await fixture();
    const list = await f.agent.get("/api/studio/instagram/accounts");
    expect(list.body.accounts.find((row: { channelId: number }) => row.channelId === f.channel.id)).toMatchObject({ channelSlug: f.channel.slug, channelName: f.channel.name, expectedUsername: "", destinations: [] });
    const created = await f.agent.post(`/api/channels/${f.channel.id}/destinations`).set(f.headers).send({ platform: "instagram", label: "@atelier.account" });
    expect(created.status).toBe(201); expect(created.body.enabled).toBe(false);
    const prefix = f.channel.slug.toUpperCase().replace(/-/g, "_");
    expect(created.body.secretRefs).toMatchObject({ accessToken: `IG_${prefix}_ACCESS_TOKEN`, userId: `IG_${prefix}_USER_ID` });
    expect((await f.agent.patch(`/api/channels/${f.channel.id}/destinations/${created.body.id}`).set(f.headers).send({ version: created.body.version, secretRefs: { accessToken: "IG_PENGUIN_ACCESS_TOKEN", userId: "IG_PENGUIN_USER_ID" } })).status).toBe(400);
    const detail = await f.agent.get(`/api/channels/${f.channel.id}/destinations`);
    expect(detail.body.items[0].secretRefs).toEqual(created.body.secretRefs);
  });

  it("validates every requested image panel before admitting a batch job", async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "isolated-batch-admission-test-key";
    const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External requests are blocked in batch admission tests"));
    try {
      const f = await fixture();
      const panels = Array.from({ length: 4 }, (_, index) => ({ scene: index === 0 ? "지역 서점" : "", dialogue: "", imageId: null }));
      const card = await f.agent.post("/api/studio/cards").set(f.headers).send({ title: "선택한 장면", channel: f.channel.slug, panels });
      expect(card.status).toBe(201);
      const endpoint = `/api/studio/cards/${card.body.id}/generate`;
      const refused = await f.agent.post(endpoint).set(f.headers).send({ version: 1, kind: "image", panelIndexes: [0, 2], requestId: crypto.randomUUID() });
      expect(refused.status).toBe(400); expect(refused.body.error).toContain("3컷");
      expect((await f.agent.get(`/api/studio/cards/${card.body.id}`)).body.jobs).toHaveLength(0);
      const admitted = await f.agent.post(endpoint).set(f.headers).send({ version: 1, kind: "image", panelIndexes: [0, 2], instruction: "같은 서점에서 대화하는 모습", requestId: crypto.randomUUID() });
      expect(admitted.status).toBe(202);
      const [queued] = await f.db.select().from(jobs).where(eq(jobs.id, admitted.body.job.id));
      expect(queued.payload.panelIndexes).toEqual([0, 2]); expect(queued.status).toBe("queued");
      expect(outbound).not.toHaveBeenCalled();
    } finally {
      outbound.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    }
  });
});
