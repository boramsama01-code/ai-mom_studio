import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, expect, it } from "vitest";
import { resetDb, setTestEnv } from "./helpers";

setTestEnv();
const { createApp } = await import("../server/app");
const { closeDb } = await import("../server/db");
const token = crypto.randomBytes(32).toString("base64url");
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
beforeEach(async () => {
  await resetDb();
  process.env.APP_PRIVATE_LINK_SHA256 = hash(token);
});
afterAll(async () => { delete process.env.APP_PRIVATE_LINK_SHA256; await closeDb(); });

it("전용 링크는 운영 세션을 만들고 기존 CSRF 보호를 유지한다", async () => {
  const app = createApp();
  expect((await request(app).get("/api/studio/cards")).status).toBe(401);
  const agent = request.agent(app);
  const entry = await agent.post("/api/auth/private-link").send({ token });
  expect(entry.status).toBe(200);
  expect(entry.headers["cache-control"]).toBe("no-store");
  expect(String(entry.headers["set-cookie"])).toContain("HttpOnly");
  expect(String(entry.headers["set-cookie"])).toContain("SameSite=Lax");
  expect(entry.body).not.toHaveProperty("token");
  expect(entry.body.csrf).toBeTruthy();
  expect((await agent.get("/api/auth/me")).body.user).toBe("admin");
  expect((await agent.get("/api/studio/cards")).status).toBe(200);
  expect((await agent.post("/api/studio/cards").send({})).status).toBe(403);
  expect((await agent.post("/api/studio/cards").set("x-csrf-token", entry.body.csrf).set("Origin", "https://other.example").send({})).status).toBe(403);
});

it("잘못된 링크·다른 출처는 거부하고 미설정 시 닫힌 상태를 유지한다", async () => {
  const app = createApp();
  expect((await request(app).post("/api/auth/private-link").send({ token: "bad" })).status).toBe(401);
  expect((await request(app).post("/api/auth/private-link").send({ token: crypto.randomBytes(32).toString("base64url") })).status).toBe(401);
  expect((await request(app).post("/api/auth/private-link").set("Origin", "https://other.example").send({ token })).status).toBe(403);
  delete process.env.APP_PRIVATE_LINK_SHA256;
  expect((await request(app).post("/api/auth/private-link").send({ token })).status).toBe(404);
});

it("링크 교체는 이전 링크와 그 링크로 만든 세션도 폐기한다", async () => {
  const app = createApp();
  const agent = request.agent(app);
  expect((await agent.post("/api/auth/private-link").send({ token })).status).toBe(200);
  const replacement = crypto.randomBytes(32).toString("base64url");
  process.env.APP_PRIVATE_LINK_SHA256 = hash(replacement);
  expect((await agent.get("/api/studio/cards")).status).toBe(401);
  expect((await agent.get("/api/auth/me")).body.user).toBeNull();
  expect((await agent.post("/api/auth/private-link").send({ token })).status).toBe(401);
  expect((await agent.post("/api/auth/private-link").send({ token: replacement })).status).toBe(200);
  expect((await agent.get("/api/studio/cards")).status).toBe(200);
});

it("반복된 접속 시도를 제한한다", async () => {
  const app = createApp();
  for (let i = 0; i < 30; i++) await request(app).post("/api/auth/private-link").send({ token: "bad" });
  expect((await request(app).post("/api/auth/private-link").send({ token: "bad" })).status).toBe(429);
});
