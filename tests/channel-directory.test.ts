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
});
