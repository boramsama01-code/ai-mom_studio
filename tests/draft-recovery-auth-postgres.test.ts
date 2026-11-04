import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { login, resetDb, setTestEnv, TEST_PASSWORD } from "./helpers";

setTestEnv();
const { createApp } = await import("../server/app");
const { closeDb } = await import("../server/db");
const app = createApp();
const outbound = vi.fn(() => { throw new Error("Recovery namespace tests must never contact an external provider"); });

beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch", outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });

function cookieOf(response: request.Response) {
  const header = response.headers["set-cookie"] as string[] | string | undefined;
  const cookie = (Array.isArray(header) ? header : header ? [header] : []).find(value => value.startsWith("spacepenguin.sid="));
  if (!cookie) throw new Error("Authenticated test response did not renew its session cookie");
  return cookie.split(";")[0];
}
function privateResponse(response: request.Response) {
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toMatch(/\bno-store\b/);
  return response.body;
}

// Real Express sessions are persisted in the isolated PostgreSQL test database.
// The recovery identifier is only a local-draft namespace, never a credential.
describe("session-bound draft recovery namespace", () => {
  it("returns a non-cacheable null namespace for unauthenticated visitors", async () => {
    const response = await request(app).get("/api/auth/me");
    expect(privateResponse(response)).toMatchObject({ user: null, csrf: null, recoveryScope: null });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("keeps the namespace stable across authenticated reads and rolling cookie renewal", async () => {
    const { agent, csrf } = await login(app);
    const first = await agent.get("/api/auth/me");
    const initial = privateResponse(first);
    expect(initial.recoveryScope).toMatch(/^[a-f0-9]{64}$/);
    expect(initial.recoveryScope).not.toBe(csrf);
    expect(initial.recoveryScope).not.toBe(initial.user);
    expect(cookieOf(first)).not.toContain(initial.recoveryScope);
    expect((await agent.get("/api/channels")).status).toBe(200);
    for (let index = 0; index < 3; index++) {
      const response = await agent.get("/api/auth/me");
      expect(privateResponse(response)).toMatchObject({ user: "admin", csrf, recoveryScope: initial.recoveryScope });
      expect(cookieOf(response)).toBe(cookieOf(first));
    }
  });

  it("uses separate recovery namespaces for two sessions of the same operator", async () => {
    const first = await login(app), second = await login(app);
    const a = privateResponse(await first.agent.get("/api/auth/me"));
    const b = privateResponse(await second.agent.get("/api/auth/me"));
    expect(a.user).toBe(b.user);
    expect(a.recoveryScope).toMatch(/^[a-f0-9]{64}$/);
    expect(b.recoveryScope).toMatch(/^[a-f0-9]{64}$/);
    expect(a.recoveryScope).not.toBe(b.recoveryScope);
    expect(privateResponse(await first.agent.get("/api/auth/me")).recoveryScope).toBe(a.recoveryScope);
  });

  it("clears the namespace on logout and creates a different one after the next login", async () => {
    const { agent } = await login(app);
    const before = await agent.get("/api/auth/me"), scope = privateResponse(before).recoveryScope;
    const cookie = cookieOf(before);
    const loggedOut = await agent.post("/api/auth/logout").send({});
    expect(privateResponse(loggedOut)).toMatchObject({ ok: true });
    expect(privateResponse(await agent.get("/api/auth/me"))).toMatchObject({ user: null, csrf: null, recoveryScope: null });
    // Replaying a destroyed session cookie must not recover its namespace or access.
    expect(privateResponse(await request(app).get("/api/auth/me").set("Cookie", cookie))).toMatchObject({ user: null, recoveryScope: null });
    expect((await request(app).get("/api/channels").set("Cookie", cookie)).status).toBe(401);
    const loginAgain = await agent.post("/api/auth/login").send({ username: "admin", password: TEST_PASSWORD });
    expect(privateResponse(loginAgain).user).toBe("admin");
    const after = await agent.get("/api/auth/me");
    expect(privateResponse(after).recoveryScope).toMatch(/^[a-f0-9]{64}$/);
    expect(after.body.recoveryScope).not.toBe(scope);
    expect(cookieOf(after)).not.toBe(cookie);
  });

  it("regenerates the namespace on a fresh login even without a preceding logout", async () => {
    const { agent } = await login(app);
    const before = await agent.get("/api/auth/me"), oldCookie = cookieOf(before);
    const initial = privateResponse(before);
    const renewed = await agent.post("/api/auth/login").send({ username: "admin", password: TEST_PASSWORD });
    expect(privateResponse(renewed).user).toBe("admin");
    const current = privateResponse(await agent.get("/api/auth/me"));
    expect(current.recoveryScope).not.toBe(initial.recoveryScope);
    expect(current.csrf).not.toBe(initial.csrf);
    expect((await request(app).get("/api/channels").set("Cookie", oldCookie)).status).toBe(401);
  });

  it("does not accept a recovery scope as CSRF, a bearer token, or a session cookie", async () => {
    const { agent, csrf } = await login(app);
    const { recoveryScope } = privateResponse(await agent.get("/api/auth/me"));
    const input = { title: "격리 인증 회귀 초안" };
    const wrongCsrf = await agent.post("/api/studio/cards").set("x-csrf-token", recoveryScope).send(input);
    expect(wrongCsrf.status).toBe(403);
    expect(wrongCsrf.body.error).toContain("보안 토큰");
    expect((await request(app).get("/api/channels").set("Authorization", `Bearer ${recoveryScope}`)).status).toBe(401);
    expect((await request(app).get("/api/channels").set("x-csrf-token", recoveryScope)).status).toBe(401);
    expect((await request(app).get("/api/channels").set("Cookie", `spacepenguin.sid=${recoveryScope}`)).status).toBe(401);
    expect(privateResponse(await request(app).get("/api/auth/me").set("Authorization", `Bearer ${recoveryScope}`))).toMatchObject({ user: null, csrf: null, recoveryScope: null });
    // A valid session plus its actual CSRF still permits an isolated draft write.
    expect((await agent.post("/api/studio/cards").set("x-csrf-token", csrf).send(input)).status).toBe(201);
    expect(privateResponse(await agent.get("/api/auth/me")).recoveryScope).toBe(recoveryScope);
  });
});
