import express from "express";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), where: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }) }), getPool: vi.fn() }));
vi.mock("../server/services/instagramConnection", () => ({ connectInstagram: mocks.connect }));
const { requireOperator } = await import("../server/auth");
const { instagramOAuthRoutes } = await import("../server/routes/instagramOAuth");
const { instagramOAuthConfig, newInstagramOAuth, validateInstagramOAuthState, INSTAGRAM_OAUTH_TTL_MS } = await import("../server/services/instagramOAuth");
const { HttpError } = await import("../server/routes/util");

function app() {
  const result = express(); result.use(express.json());
  result.use(session({ secret: "test-only-session-secret", resave: false, saveUninitialized: false }));
  result.post("/test-login", (req, res) => { req.session.user = "admin"; req.session.csrf = "test-csrf"; res.json({ ok: true }); });
  result.use("/api", requireOperator, instagramOAuthRoutes);
  result.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof HttpError ? error.message : "error" }));
  return result;
}

let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.APP_ENV = "test"; process.env.ADMIN_USERNAME = "admin"; process.env.APP_BASE_URL = "https://studio.example";
  process.env.INSTAGRAM_API_VERSION = "v26.0"; process.env.META_APP_ID = "111"; process.env.META_INSTAGRAM_CONFIG_ID = "222"; process.env.META_APP_SECRET = "test-only-app-secret";
  mocks.where.mockReset().mockResolvedValue([{ id: 1, slug: "penguin", active: true, budget: { dailyPublishLimit: 7 } }]);
  mocks.connect.mockReset().mockResolvedValue({ username: "spacepenguin.co" });
  fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "test-only-system-user-token" }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); for (const key of ["META_APP_ID", "META_INSTAGRAM_CONFIG_ID", "META_APP_SECRET"]) delete process.env[key]; });

async function start() {
  const application = app(), agent = request.agent(application);
  await agent.post("/test-login");
  const begun = await agent.post("/api/studio/instagram/1/oauth/start").set("x-csrf-token", "test-csrf").send({});
  expect(begun.status).toBe(200);
  const url = new URL(begun.body.url);
  return { application, agent, url, state: url.searchParams.get("state")! };
}

describe("operator-bound Meta Unified Login", () => {
  it("reports missing setup without leaking the app secret", () => {
    expect(instagramOAuthConfig()).toMatchObject({ configured: true, appId: "111", redirectUri: "https://studio.example/api/studio/instagram/oauth/callback" });
    expect(JSON.stringify(instagramOAuthConfig())).not.toContain("test-only-app-secret");
    delete process.env.META_INSTAGRAM_CONFIG_ID;
    expect(instagramOAuthConfig()).toMatchObject({ configured: false, missing: ["META_INSTAGRAM_CONFIG_ID"] });
  });

  it("requires login and CSRF to start, and retains the current daily limit", async () => {
    const application = app();
    expect((await request(application).post("/api/studio/instagram/1/oauth/start").send({})).status).toBe(401);
    const agent = request.agent(application); await agent.post("/test-login");
    expect((await agent.post("/api/studio/instagram/1/oauth/start").send({})).status).toBe(403);
    const { url, agent: connected, state } = await start();
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("config_id")).toBe("222");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.has("scope")).toBe(false);
    const done = await connected.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-auth-code" });
    expect(done.headers.location).toBe("/instagram?instagram=connected");
    expect(mocks.connect).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ username: "spacepenguin.co", dailyLimit: 7, authMode: "facebook", expiresAt: null }), "admin");
    expect(done.text).not.toContain("test-only-system-user-token");
  });

  it("rejects a foreign session, wrong state, and a replay before token exchange", async () => {
    const { application, agent, state } = await start();
    const callback = "/api/studio/instagram/oauth/callback";
    expect((await request(application).get(callback).query({ state, code: "test-code" })).status).toBe(401);
    const foreign = request.agent(application); await foreign.post("/test-login");
    expect((await foreign.get(callback).query({ state, code: "test-code" })).headers.location).toContain("reason=state");
    expect((await agent.get(callback).query({ state: "wrong-state", code: "test-code" })).headers.location).toContain("reason=state");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await agent.get(callback).query({ state, code: "test-code" })).headers.location).toContain("instagram=connected");
    expect((await agent.get(callback).query({ state, code: "test-code" })).headers.location).toContain("reason=state");
    expect(fetcher).toHaveBeenCalledOnce(); expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("expires old state and never accepts future or malformed timestamps", () => {
    const pending = newInstagramOAuth({ channelId: 1, username: "spacepenguin.co", dailyLimit: 3 }, 1000);
    expect(validateInstagramOAuthState(pending, pending.state, 1000 + INSTAGRAM_OAUTH_TTL_MS)).toBe("expired");
    expect(validateInstagramOAuthState(pending, pending.state, 999)).toBe("expired");
    expect(validateInstagramOAuthState({ ...pending, createdAt: NaN }, pending.state)).toBe("expired");
  });

  it("consumes a denial and reports a fixed reason without trusting provider text", async () => {
    const { agent, state } = await start();
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, error: "secret-provider-text" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=denied");
    expect(done.text).not.toContain("secret-provider-text"); expect(fetcher).not.toHaveBeenCalled();
  });

  it("never accepts another channel from callback parameters and reports mismatches safely", async () => {
    const { agent, state } = await start();
    mocks.connect.mockRejectedValue(new HttpError(400, "provider-detail", { code: "account_mismatch" }));
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code", channelId: "999", username: "other.account" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=account_mismatch");
    expect(mocks.connect).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ username: "spacepenguin.co" }), "admin");
  });
});
