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
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=denied&stage=callback");
    expect(done.text).not.toContain("secret-provider-text"); expect(fetcher).not.toHaveBeenCalled();
  });

  it("never accepts another channel from callback parameters and reports mismatches safely", async () => {
    const { agent, state } = await start();
    mocks.connect.mockRejectedValue(new HttpError(400, "provider-detail", { code: "account_mismatch" }));
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code", channelId: "999", username: "other.account" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=account_mismatch&stage=connection_validation");
    expect(mocks.connect).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ username: "spacepenguin.co" }), "admin");
  });

  it("distinguishes a missing OAuth code before attempting any exchange", async () => {
    const { agent, state } = await start();
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, stage: "persistence", graph_code: "999", error_description: "PRIVATE_PROVIDER_TEXT" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=invalid_request&stage=callback");
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("keeps safe token-exchange codes without echoing provider text, credentials or callback fields", async () => {
    const { agent, state } = await start();
    const privateText = "PRIVATE_TOKEN_STATE_CODE https://private.invalid/?access_token=PRIVATE_TOKEN";
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: privateText, error: { code: 190, error_subcode: 463, message: privateText, error_data: { token: privateText }, fbtrace_id: privateText } }), { status: 400 }));
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: privateText, stage: privateText, token: privateText });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=exchange_failed&stage=token_exchange&http_status=400&graph_code=190&graph_subcode=463&lost=false");
    for (const secret of [privateText, "PRIVATE", state, "test-only-app-secret"]) expect(done.text + done.headers.location).not.toContain(secret);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { access_token: "too-short" }, { error: { code: "190", error_subcode: "PRIVATE", message: { token: "PRIVATE" } } }])("diagnoses a malformed token-exchange response safely: %j", async body => {
    const { agent, state } = await start();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=exchange_failed&stage=token_exchange&http_status=200&lost=false");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("reports transport loss without an exception URL or cause", async () => {
    const { agent, state } = await start();
    fetcher.mockRejectedValueOnce(new Error("PRIVATE https://graph.facebook.com/?client_secret=PRIVATE&code=PRIVATE"));
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=exchange_failed&stage=token_exchange&lost=true");
    expect(done.text).not.toContain("PRIVATE"); expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("keeps a changed configuration distinct from a rejected token exchange", async () => {
    const { agent, state } = await start();
    delete process.env.META_APP_SECRET;
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=configuration&stage=configuration");
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["instagram_identity_failed", "assigned_accounts"],
    ["account_identity_incomplete", "account_profile"],
    ["direct_account_access_failed", "direct_profile"],
    ["direct_account_access_failed", "business_asset"],
    ["direct_account_access_failed", "mapped_profile"],
    ["direct_publish_access_failed", "quota"],
    ["publishing_permission", "quota"],
    ["persistence_failed", "persistence"],
  ])("retains %s at %s and drops all unapproved error metadata", async (reason, stage) => {
    const { agent, state } = await start();
    mocks.connect.mockRejectedValue(new HttpError(400, "PRIVATE SQL TOKEN URL", { code: reason, token: "PRIVATE", state, diagnostic: { stage, httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false, message: "PRIVATE", code: "PRIVATE", state } }));
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code" });
    expect(done.headers.location).toBe(`/instagram?instagram=error&reason=${reason}&stage=${stage}&http_status=400&graph_code=100&graph_subcode=33&lost=false`);
    expect(done.text + done.headers.location).not.toContain("PRIVATE");
    expect(done.text + done.headers.location).not.toContain(state);
  });

  it.each([
    new Error("PRIVATE SQL TOKEN URL"),
    new HttpError(500, "PRIVATE SQL TOKEN URL", { code: "PRIVATE", diagnostic: { stage: "PRIVATE", graphCode: "100", cause: "PRIVATE" } }),
    ...["", 0, false, null, {}, []].map(code => new HttpError(400, "PRIVATE", { code })),
  ])("does not trust unknown exceptions or reason/stage values", async error => {
    const { agent, state } = await start();
    mocks.connect.mockRejectedValue(error);
    const done = await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "test-code" });
    expect(done.headers.location).toBe("/instagram?instagram=error&reason=connect_failed&stage=connection_validation");
    expect(done.text).not.toContain("PRIVATE");
  });

  it("logs only fixed failure diagnostics and never logs OAuth secrets or successful connections", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const success = await start();
      await success.agent.get("/api/studio/instagram/oauth/callback").query({ state: success.state, code: "private-success-code" });
      expect(warn).not.toHaveBeenCalled();
      const { agent, state } = await start();
      const privateText = "EAA_PRIVATE_TOKEN https://private.invalid/?access_token=PRIVATE_TOKEN";
      mocks.connect.mockRejectedValue(new HttpError(400, privateText, { code: "direct_account_access_failed", token: privateText, username: "PRIVATE_USERNAME", diagnostic: { stage: "business_asset", httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false, provider_message: privateText, state, code: "private-auth-code", stack: "PRIVATE_STACK" } }));
      await agent.get("/api/studio/instagram/oauth/callback").query({ state, code: "private-auth-code", error_description: privateText });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith("[instagram_oauth]", JSON.stringify({ reason: "direct_account_access_failed", diagnostic: { stage: "business_asset", httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false } }));
      const logged = JSON.stringify(warn.mock.calls);
      for (const secret of ["PRIVATE", "private-auth-code", state, success.state, "test-only-app-secret", "test-only-system-user-token", "https://"]) expect(logged).not.toContain(secret);
    } finally { warn.mockRestore(); }
  });
});
