import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { login, resetDb, setTestEnv } from "./helpers";
setTestEnv();
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { seedIfNeeded } = await import("../server/seed");
let app: ReturnType<typeof createApp>;
beforeAll(async () => { await resetDb(); app = createApp(); });
afterAll(async () => { await closeDb(); });
describe("shared channel directory", () => {
  it("requires login and CSRF to create a channel", async () => {
    expect((await request(app).post("/api/channels").send({ name: "blocked" })).status).toBe(401);
    const { agent } = await login(app);
    expect((await agent.post("/api/channels").send({ name: "blocked" })).status).toBe(403);
  });
  it("creates, renames and reuses a channel without changing existing content", async () => {
    const { agent, csrf } = await login(app); const H = { "x-csrf-token": csrf };
    expect((await agent.post("/api/channels").set(H).send({ name: " " })).status).toBe(400);
    const created = await agent.post("/api/channels").set(H).send({ name: "새 채널", accentColor: "#51635A" });
    expect(created.status).toBe(201);
    expect(created.body.budget.dailyPublishLimit).toBe(0);
    expect(created.body.budget.discovery.enabled).toBe(false);
    const ch = created.body;
    const card = await agent.post("/api/studio/cards").set(H).send({ title: "보존할 원고", channel: ch.slug });
    expect(card.status).toBe(201);
    const renamed = await agent.patch(`/api/channels/${ch.id}`).set(H).send({ version: ch.version, name: "수정된 채널" });
    expect(renamed.status).toBe(200); expect(renamed.body.slug).toBe(ch.slug);
    expect((await agent.patch(`/api/channels/${ch.id}`).set(H).send({ version: ch.version, name: "충돌" })).status).toBe(409);
    await seedIfNeeded(getDb());
    const list = (await agent.get("/api/channels")).body;
    expect(list.find((c: { id: number }) => c.id === ch.id).name).toBe("수정된 채널");
    expect((await agent.get(`/api/studio/cards/${card.body.id}`)).body.card.channel).toBe(ch.slug);
    expect((await agent.post("/api/studio/cards").set(H).send({ title: "잘못된 채널", channel: "missing-channel" })).status).toBe(400);
    for (const key of ["penguin", "highway", "fryday", "news"]) expect((await agent.post("/api/studio/cards").set(H).send({ title: key, channel: key })).status).toBe(201);
  });
  it("persists order for all clients without rewriting channels, and appends new channels", async () => {
    const { agent, csrf } = await login(app); const H = { "x-csrf-token": csrf };
    const before = (await agent.get("/api/channels")).body;
    const previousIds = before.map((c: { id: number }) => c.id);
    const ids = [...previousIds].reverse();
    expect((await request(app).put("/api/channels/order").send({ ids, previousIds })).status).toBe(401);
    expect((await agent.put("/api/channels/order").send({ ids, previousIds })).status).toBe(403);
    const saved = await agent.put("/api/channels/order").set(H).send({ ids, previousIds });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual([...before].reverse());
    await seedIfNeeded(getDb());
    const other = await login(app);
    expect((await other.agent.get("/api/channels")).body.map((c: { id: number }) => c.id)).toEqual(ids);
    const added = await agent.post("/api/channels").set(H).send({ name: "마지막 채널" });
    expect(added.status).toBe(201);
    expect((await agent.get("/api/channels")).body.map((c: { id: number }) => c.id)).toEqual([...ids, added.body.id]);
  });
  it("rejects incomplete, duplicate and stale orders without losing a saved order", async () => {
    const { agent, csrf } = await login(app); const H = { "x-csrf-token": csrf };
    const before = (await agent.get("/api/channels")).body.map((c: { id: number }) => c.id);
    for (const ids of [before.slice(1), [...before.slice(0, -1), before[0]], [...before.slice(0, -1), 999999]]) {
      expect((await agent.put("/api/channels/order").set(H).send({ ids, previousIds: before })).status).toBe(400);
    }
    const ids = [...before].reverse();
    expect((await agent.put("/api/channels/order").set(H).send({ ids, previousIds: before })).status).toBe(200);
    expect((await agent.put("/api/channels/order").set(H).send({ ids: before, previousIds: before })).status).toBe(409);
    expect((await agent.get("/api/channels")).body.map((c: { id: number }) => c.id)).toEqual(ids);
  });

  it("archives and restores without deleting cards or changing stored order", async () => {
    const { agent, csrf } = await login(app); const H = { "x-csrf-token": csrf };
    const created = await agent.post("/api/channels").set(H).send({ name: "보관 테스트" });
    const ch = created.body;
    const card = await agent.post("/api/studio/cards").set(H).send({ title: "계속 보존", channel: ch.slug, script: "직접 쓴 원고" });
    const before = (await agent.get("/api/channels")).body.map((c: { id: number }) => c.id);
    const archived = await agent.patch(`/api/channels/${ch.id}`).set(H).send({ version: ch.version, active: false });
    expect(archived.status).toBe(200);
    await seedIfNeeded(getDb());
    const listed = (await agent.get("/api/channels")).body;
    expect(listed.map((c: { id: number }) => c.id)).toEqual(before);
    expect(listed.find((c: { id: number }) => c.id === ch.id).active).toBe(false);
    expect((await agent.get(`/api/studio/cards/${card.body.id}`)).body.card.script).toBe("직접 쓴 원고");
    expect((await agent.post("/api/studio/cards").set(H).send({ title: "차단", channel: ch.slug })).status).toBe(409);
    const { runCollect } = await import("../server/worker/collect");
    await expect(runCollect(getDb(), ch.id, { trigger: "cli" })).rejects.toThrow("보관된 채널");
    expect((await agent.put("/api/channels/order").set(H).send({ ids: [...before].reverse(), previousIds: before })).status).toBe(200);
    const restored = await agent.patch(`/api/channels/${ch.id}`).set(H).send({ version: archived.body.version, active: true });
    expect(restored.status).toBe(200);
    expect((await agent.post("/api/studio/cards").set(H).send({ title: "복원 후 새 작업", channel: ch.slug })).status).toBe(201);
    expect((await agent.get(`/api/studio/cards/${card.body.id}`)).body.card.channel).toBe(ch.slug);
  });
});
