import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountIdentity, containerStatus, createCarouselContainer, createContainer, mediaPermalink, publishContainer, publishingLimit, waitForContainer } from "../server/services/instagram";
import { resolveSecrets } from "../server/services/secrets";
import { connectInstagram } from "../server/services/instagramConnection";
import type { DB } from "../server/db";

const token = "test-only-secret-token";
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { process.env.INSTAGRAM_API_VERSION = "v26.0"; fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.IG_PENGUIN_AUTH_MODE; });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Meta Unified Login accounts", () => {
  it("chooses only the expected username from a multi-account system-user token", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "1", username: "highscoop.official" }, { id: "2", username: "spacepenguin.co" }] }));
    expect(await accountIdentity(token, "facebook", "@SPACEPENGUIN.CO")).toEqual({ ok: true, userId: "2", username: "spacepenguin.co" });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).origin).toBe("https://graph.facebook.com");
    expect(new URL(url).pathname).toBe("/v26.0/me/assigned_instagram_accounts");
    expect(new URL(url).searchParams.get("access_token")).toBeNull();
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("does not save or silently select another assigned account", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "1", username: "highscoop.official" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_mismatch", error: expect.stringContaining("@highscoop.official") });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["unregistered.account", undefined])("keeps an empty list blocked without a trusted target for %s", async expectedUsername => {
    fetcher.mockResolvedValue(response({ data: [] }));
    const result = await accountIdentity(token, "facebook", expectedUsername);
    expect(result).toMatchObject({ ok: false, reason: "no_assigned_accounts", error: expect.stringContaining("목록이 비어") });
    expect(JSON.stringify(result)).not.toContain("권한이 없습니다");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("resolves a missing username only through the assigned ID on the same host and token", async () => {
    const id = "17841458158640250";
    fetcher.mockResolvedValueOnce(response({ data: [{ id }] }))
      .mockResolvedValueOnce(response({ id, username: "spacepenguin.co" }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toEqual({ ok: true, userId: id, username: "spacepenguin.co" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1];
    expect(new URL(url).origin).toBe("https://graph.facebook.com");
    expect(new URL(url).pathname).toBe(`/v26.0/${id}`);
    expect(new URL(url).searchParams.get("fields")).toBe("id,username");
    expect(new URL(url).searchParams.get("access_token")).toBeNull();
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}` } });
  });

  it.each([
    ["different direct ID", { id: "99", username: "spacepenguin.co" }, "invalid_account_response"],
    ["missing direct ID", { username: "spacepenguin.co" }, "invalid_account_response"],
    ["missing direct username", { id: "2" }, "account_identity_incomplete"],
    ["unsafe direct username", { id: "2", username: `https://invalid.example/${token}` }, "account_identity_incomplete"],
    ["different username", { id: "2", username: "highscoop.official" }, "account_mismatch"],
    ["provider error", { error: { code: 190, message: `https://invalid.example/?access_token=${token}` } }, "account_identity_incomplete"],
  ])("rejects %s during username resolution without exposing provider diagnostics", async (_name, body, reason) => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "2" }] })).mockResolvedValueOnce(response(body));
    const result = await accountIdentity(token, "facebook", "spacepenguin.co");
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it.each([
    ["different profile ID", "invalid_account_response"],
    ["different profile username", "account_mismatch"],
    ["failed profile request", "account_identity_incomplete"],
  ])("does not enter the credential-saving transaction after %s", async (failure, reason) => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "2" }] }));
    if (failure === "failed profile request") fetcher.mockRejectedValueOnce(new Error(`private transport detail ${token}`));
    else fetcher.mockResolvedValueOnce(response(failure === "different profile ID" ? { id: "99", username: "spacepenguin.co" } : { id: "2", username: "highscoop.official" }));
    const transaction = vi.fn();
    const db = { select: () => ({ from: () => ({ where: async () => [{ id: 1, slug: "penguin", active: true }] }) }), transaction } as unknown as DB;
    await expect(connectInstagram(db, 1, { token, username: "spacepenguin.co", dailyLimit: 3, authMode: "facebook" }, "test"))
      .rejects.toMatchObject({ status: 400, extra: { code: reason } });
    expect(transaction).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url, init]) => init.method === "GET" && !new URL(url).pathname.endsWith("content_publishing_limit"))).toBe(true);
  });

  it.each([
    null, {}, { data: null }, { data: {} }, { data: [null] },
    { data: [{ user_id: "17841458158640250", username: "spacepenguin.co" }] },
    { data: [{ id: "../../me", username: "spacepenguin.co" }] },
    { data: [{ id: Number("17841458158640250"), username: "spacepenguin.co" }] },
  ])("rejects a malformed account response without treating it as absent permission: %j", async body => {
    fetcher.mockResolvedValue(response(body));
    const result = await accountIdentity(token, "facebook", "spacepenguin.co");
    expect(result).toMatchObject({ ok: false, reason: "invalid_account_response" });
    expect(JSON.stringify(result)).not.toContain("권한이 없습니다");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows at most five validated usernames, never extra response fields or URLs", async () => {
    fetcher.mockResolvedValue(response({ data: Array.from({ length: 7 }, (_, i) => ({ id: String(i + 1), username: `brand_${i + 1}`, token, debug_url: `https://invalid.example/${token}` })) }));
    const result = await accountIdentity(token, "facebook", "spacepenguin.co");
    expect(result).toMatchObject({ ok: false, reason: "account_mismatch", error: expect.stringContaining("@brand_1, @brand_2, @brand_3, @brand_4, @brand_5 외 2개") });
    expect(JSON.stringify(result)).not.toContain("brand_6");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("does not silently drop an unsafe username when its profile cannot be resolved", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "1", username: "spacepenguin.co" }, { id: "2", username: "<script>unsafe</script>" }] }))
      .mockResolvedValueOnce(response({ id: "2", username: "<script>unsafe</script>" }));
    const result = await accountIdentity(token, "facebook", "spacepenguin.co");
    expect(result).toMatchObject({ ok: false, reason: "account_identity_incomplete" });
    expect(JSON.stringify(result)).not.toContain("<script>");
  });

  it("fails closed without profile requests when more than ten usernames need resolution", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "99", username: "spacepenguin.co" }, ...Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1) }))] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_identity_incomplete" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects two different IDs for the expected username as ambiguous", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "1", username: "spacepenguin.co" }, { id: "2", username: "SPACEPENGUIN.CO" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "ambiguous_account" });
  });

  it("rejects conflicting usernames for the same assigned ID", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "1", username: "spacepenguin.co" }, { id: "1", username: "highscoop.official" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "invalid_account_response" });
  });

  it("keeps pagination on the trusted host even when next contains another origin", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "1", username: "highscoop.official" }], paging: { next: "https://untrusted.example/?token=bad", cursors: { after: "next-cursor" } } }))
      .mockResolvedValueOnce(response({ data: [{ id: "2", username: "spacepenguin.co" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: true, userId: "2" });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).origin)).toEqual(["https://graph.facebook.com", "https://graph.facebook.com"]);
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("after")).toBe("next-cursor");
  });

  it("uses a later complete row for the same assigned ID without an extra lookup", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "2" }], paging: { next: "https://ignored.example", cursors: { after: "next" } } }))
      .mockResolvedValueOnce(response({ data: [{ id: "2", username: "spacepenguin.co" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toEqual({ ok: true, userId: "2", username: "spacepenguin.co" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not accept an earlier matching account if a later page is malformed", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "2", username: "spacepenguin.co" }], paging: { next: "https://ignored.example", cursors: { after: "next" } } }))
      .mockResolvedValueOnce(response({ data: [{}] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "invalid_account_response" });
  });

  it("rejects pagination with a missing or repeated cursor", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "2", username: "spacepenguin.co" }], paging: { next: "https://ignored.example" } }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_list_incomplete" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset();
    fetcher.mockImplementation(async () => response({ data: [{ id: "2", username: "spacepenguin.co" }], paging: { next: "https://ignored.example", cursors: { after: "same" } } }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_list_incomplete" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops after ten pages even if an expected handle appeared earlier", async () => {
    let page = 0;
    fetcher.mockImplementation(async () => response({ data: [{ id: "2", username: "spacepenguin.co" }], paging: { next: "https://ignored.example", cursors: { after: String(++page) } } }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_list_incomplete" });
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("preserves Instagram Login for legacy destinations without a mode reference", async () => {
    process.env.IG_PENGUIN_USER_ID = "2"; process.env.IG_PENGUIN_ACCESS_TOKEN = token;
    const legacy = resolveSecrets("instagram", "penguin", { userId: "IG_PENGUIN_USER_ID", accessToken: "IG_PENGUIN_ACCESS_TOKEN" });
    expect(legacy).toMatchObject({ missing: [], invalid: [], values: { authMode: "instagram" } });
    fetcher.mockResolvedValue(response({ user_id: "2", username: "spacepenguin.co" }));
    expect(await accountIdentity(token)).toMatchObject({ ok: true, userId: "2" });
    expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe("graph.instagram.com");
  });

  it("rejects an unknown explicit mode instead of guessing a host", () => {
    process.env.IG_PENGUIN_AUTH_MODE = "something-else";
    const result = resolveSecrets("instagram", "penguin", { userId: "IG_PENGUIN_USER_ID", accessToken: "IG_PENGUIN_ACCESS_TOKEN", authMode: "IG_PENGUIN_AUTH_MODE" });
    expect(result.invalid).toContain("authMode");
  });

  it("carries the chosen host through every publishing request without a live post", async () => {
    fetcher.mockImplementation(async (url: URL) => response(url.pathname.endsWith("content_publishing_limit") ? { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } : url.searchParams.has("fields") ? { status_code: "FINISHED", permalink: "https://www.instagram.com/p/test/" } : { id: "123" }));
    await publishingLimit("2", token, "facebook");
    await createContainer("2", token, "https://example.com/1.jpg", "caption", undefined, "facebook");
    await createCarouselContainer("2", token, ["https://example.com/1.jpg", "https://example.com/2.jpg"], "caption", undefined, "facebook");
    await containerStatus("123", token, "facebook");
    await waitForContainer("123", token, 1, "facebook");
    await publishContainer("2", token, "123", "facebook");
    await mediaPermalink("123", token, "facebook");
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(9);
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(url).origin).toBe("https://graph.facebook.com");
      expect(init.headers.authorization).toBe(`Bearer ${token}`);
      expect(init.redirect).toBe("error");
    }
  });
});

describe("empty assigned lists with operator-confirmed target hints", () => {
  const penguinId = "17841458158640250";
  const profile = { id: penguinId, username: "spacepenguin.co" };
  const quota = { data: [{ quota_usage: 0, config: { quota_total: 100 } }] };
  function connectionDatabase() {
    const transaction = vi.fn();
    const db = { select: () => ({ from: () => ({ where: async () => [{ id: 1, slug: "penguin", active: true }] }) }), transaction } as unknown as DB;
    return { db, transaction };
  }

  it.each([
    ["spacepenguin.co", "17841458158640250"],
    ["alligodang.official", "17841444569239069"],
    ["highscoop.official", "17841416940240854"],
    ["fryday.official.kr", "17841474286823201"],
  ])("confirms %s only after exact direct identity and publishing access using the injected transport", async (username, id) => {
    const injectedFetch = vi.fn().mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ id, username }))
      .mockResolvedValueOnce(response(quota));
    expect(await accountIdentity(token, "facebook", ` @${username.toUpperCase()} `, injectedFetch)).toEqual({ ok: true, userId: id, username });
    expect(fetcher).not.toHaveBeenCalled();
    expect(injectedFetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/v26.0/me/assigned_instagram_accounts", `/v26.0/${id}`, `/v26.0/${id}/content_publishing_limit`,
    ]);
    for (const [url, init] of injectedFetch.mock.calls) {
      expect(new URL(url).origin).toBe("https://graph.facebook.com");
      expect(new URL(url).searchParams.get("access_token")).toBeNull();
      expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}` } });
    }
    expect(new URL(injectedFetch.mock.calls[1][0]).searchParams.get("fields")).toBe("id,username");
    expect(new URL(injectedFetch.mock.calls[2][0]).searchParams.get("fields")).toBe("quota_usage,config");
  });

  it.each([
    ["different ID", { id: "99", username: "spacepenguin.co" }, "account_mismatch"],
    ["different username", { id: penguinId, username: "highscoop.official" }, "account_mismatch"],
    ["missing identity", {}, "invalid_account_response"],
    ["unsafe username", { id: penguinId, username: `https://invalid.example/${token}` }, "invalid_account_response"],
    ["denied profile access", { error: { code: 200, message: `https://invalid.example/${token}` } }, "direct_account_access_failed"],
  ])("does not check quota or save credentials after a direct profile with %s", async (_name, body, reason) => {
    fetcher.mockResolvedValueOnce(response({ data: [] })).mockResolvedValueOnce(response(body));
    const { db, transaction } = connectionDatabase();
    const failure = await connectInstagram(db, 1, { token, username: "spacepenguin.co", dailyLimit: 3, authMode: "facebook" }, "test").catch(error => error);
    expect(failure).toMatchObject({ status: 400, extra: { code: reason } });
    expect(failure.message).not.toContain(token);
    expect(failure.message).not.toContain("https://");
    expect(transaction).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it.each([
    ["permission denial", { error: { code: 200, message: `provider detail ${token}` } }],
    ["empty response", {}],
    ["empty data", { data: [] }],
    ["zero quota total", { data: [{ quota_usage: 0, config: { quota_total: 0 } }] }],
    ["missing usage", { data: [{ config: { quota_total: 100 } }] }],
    ["non-array quota data", { data: { 0: { quota_usage: 0, config: { quota_total: 100 } } } }],
  ])("does not save readable profile credentials after quota %s", async (_name, body) => {
    fetcher.mockResolvedValueOnce(response({ data: [] })).mockResolvedValueOnce(response(profile)).mockResolvedValueOnce(response(body));
    const { db, transaction } = connectionDatabase();
    const failure = await connectInstagram(db, 1, { token, username: "spacepenguin.co", dailyLimit: 3, authMode: "facebook" }, "test").catch(error => error);
    expect(failure).toMatchObject({ status: 400, extra: { code: "direct_publish_access_failed" } });
    expect(failure.message).not.toContain(token);
    expect(transaction).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URL(fetcher.mock.calls[2][0]).pathname).toBe(`/v26.0/${penguinId}/content_publishing_limit`);
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it.each(["profile", "quota"])("does not save credentials when the direct %s request fails in transit", async stage => {
    fetcher.mockResolvedValueOnce(response({ data: [] }));
    if (stage === "quota") fetcher.mockResolvedValueOnce(response(profile));
    fetcher.mockRejectedValueOnce(new Error(`private transport detail ${token}`));
    const { db, transaction } = connectionDatabase();
    const failure = await connectInstagram(db, 1, { token, username: "spacepenguin.co", dailyLimit: 3, authMode: "facebook" }, "test").catch(error => error);
    expect(failure).toMatchObject({ status: 400, extra: { code: stage === "profile" ? "direct_account_access_failed" : "direct_publish_access_failed" } });
    expect(failure.message).not.toContain(token);
    expect(transaction).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(stage === "profile" ? 2 : 3);
  });

  it.each(["provider", "network"])("never uses a hint after an assigned-list %s failure", async failure => {
    if (failure === "network") fetcher.mockRejectedValueOnce(new Error("request failed"));
    else fetcher.mockResolvedValueOnce(response({ error: { code: 190, message: "expired token" } }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([null, "not-an-object", { next: true }, { cursors: "not-an-object" }, { cursors: { after: 123 } }])("never uses a hint after malformed pagination %j", async paging => {
    fetcher.mockResolvedValueOnce(response({ data: [], paging }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "invalid_account_response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty list blocked when its next-page cursor is missing", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [], paging: { next: "https://ignored.example" } }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_list_incomplete" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty list blocked when it still has a next page after ten pages", async () => {
    let page = 0;
    fetcher.mockImplementation(async () => response({ data: [], paging: { next: "https://ignored.example", cursors: { after: String(++page) } } }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_list_incomplete" });
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(fetcher.mock.calls.every(([url]) => new URL(url).pathname.endsWith("assigned_instagram_accounts"))).toBe(true);
  });

  it("does not mistake a partial empty page for a complete empty list", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [], paging: { next: "https://ignored.example", cursors: { after: "next" } } }))
      .mockResolvedValueOnce(response({ data: [{ id: "1", username: "highscoop.official" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_mismatch" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => new URL(url).pathname.endsWith("assigned_instagram_accounts"))).toBe(true);
  });

  it("requires every page to be empty before a direct profile and quota lookup", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [], paging: { next: "https://ignored.example", cursors: { after: "next" } } }))
      .mockResolvedValueOnce(response({ data: [] })).mockResolvedValueOnce(response(profile)).mockResolvedValueOnce(response(quota));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toEqual({ ok: true, userId: penguinId, username: "spacepenguin.co" });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/v26.0/me/assigned_instagram_accounts", "/v26.0/me/assigned_instagram_accounts", `/v26.0/${penguinId}`, `/v26.0/${penguinId}/content_publishing_limit`,
    ]);
  });

  it("never switches a legacy Instagram token to the Facebook host because a target hint exists", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [] }));
    expect(await accountIdentity(token, "instagram", "spacepenguin.co")).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0][0]).origin).toBe("https://graph.instagram.com");
  });

  describe("safe lookup failure diagnostics", () => {
    const privateText = `provider-secret=${token}; https://private.example/?access_token=${token}`;

    it.each([
      [400, 100, 33],
      [400, 190, 463],
      [403, 200, undefined],
    ])("shows only HTTP %s and numeric Graph %s/%s for a failed direct profile", async (status, code, subcode) => {
      fetcher.mockResolvedValueOnce(response({ data: [] })).mockResolvedValueOnce(response({
        error: { code, error_subcode: subcode, message: privateText, type: "PRIVATE_PROVIDER_TYPE", fbtrace_id: "PRIVATE_TRACE", error_data: { access_token: token }, httpStatus: 299, lost: true },
        access_token: token, url: privateText,
      }, status));
      const result = await accountIdentity(token, "facebook", "spacepenguin.co");
      expect(result).toMatchObject({ ok: false, reason: "direct_account_access_failed", error: expect.stringContaining(`[진단: direct_profile / HTTP ${status} / Graph ${code} / subcode ${subcode ?? "-"} / lost=false]`) });
      const shown = JSON.stringify(result);
      for (const forbidden of [token, "https://", "PRIVATE_PROVIDER_TYPE", "PRIVATE_TRACE", "error_data", "299"]) expect(shown).not.toContain(forbidden);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    });

    it("keeps diagnostics separate from the existing error classification", async () => {
      fetcher.mockResolvedValueOnce(response({ error: { code: 190, error_subcode: 463, message: privateText, fbtrace_id: "PRIVATE_TRACE", arbitrary: privateText }, access_token: token }, 400));
      const result = await publishingLimit(penguinId, token, "facebook");
      expect(result).toMatchObject({ ok: false, lost: false, err: { kind: "token_expired", error: `액세스 토큰 만료·무효: ${privateText}` } });
      expect(result.ok ? null : "diagnostic" in result ? result.diagnostic : null).toEqual({ httpStatus: 400, graphCode: 190, graphSubcode: 463 });
    });

    it.each([`190 ${token}`, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, { code: token }])("rejects non-allowlisted Graph number fields: %j", async unsafeCode => {
      fetcher.mockResolvedValueOnce(response({ data: [] })).mockResolvedValueOnce(response({ error: { code: unsafeCode, error_subcode: unsafeCode, message: privateText } }, 400));
      const result = await accountIdentity(token, "facebook", "spacepenguin.co");
      expect(result).toMatchObject({ ok: false, reason: "direct_account_access_failed", error: expect.stringContaining("[진단: direct_profile / HTTP 400 / Graph - / subcode - / lost=false]") });
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("https://");
    });

    it("distinguishes a transport failure without exposing its exception", async () => {
      fetcher.mockResolvedValueOnce(response({ data: [] })).mockRejectedValueOnce(new Error(privateText));
      const result = await accountIdentity(token, "facebook", "spacepenguin.co");
      expect(result).toMatchObject({ ok: false, reason: "direct_account_access_failed", error: expect.stringContaining("[진단: direct_profile / HTTP - / Graph - / subcode - / lost=true]") });
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("https://");
    });

    it("identifies an assigned-list failure without starting another request", async () => {
      fetcher.mockResolvedValueOnce(response({ error: { code: 190, error_subcode: 463, message: privateText, fbtrace_id: "PRIVATE_TRACE" } }, 400));
      const result = await accountIdentity(token, "facebook", "spacepenguin.co");
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("[진단: assigned_accounts / HTTP 400 / Graph 190 / subcode 463 / lost=false]") });
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_TRACE");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("propagates only the safe diagnostic in the existing connection error without saving", async () => {
      fetcher.mockResolvedValueOnce(response({ data: [] })).mockResolvedValueOnce(response({ error: { code: 100, error_subcode: 33, message: privateText, fbtrace_id: "PRIVATE_TRACE" } }, 400));
      const { db, transaction } = connectionDatabase();
      const failure = await connectInstagram(db, 1, { token, username: "spacepenguin.co", dailyLimit: 3, authMode: "facebook" }, "test").catch(error => error);
      expect(failure).toMatchObject({ status: 400, extra: { code: "direct_account_access_failed" }, message: expect.stringContaining("[진단: direct_profile / HTTP 400 / Graph 100 / subcode 33 / lost=false]") });
      expect(failure.message).not.toContain(token);
      expect(failure.message).not.toContain("https://");
      expect(failure.message).not.toContain("PRIVATE_TRACE");
      expect(failure.extra).toEqual({ code: "direct_account_access_failed" });
      expect(transaction).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });
});
