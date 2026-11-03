import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instagramDiagnosticTargetHints } from "../server/services/instagram";
import { inspectInstagramTokenGrants, shouldInspectInstagramToken, summarizeInstagramTokenGrants } from "../server/services/instagramTokenDiagnostic";
import { INSTAGRAM_DIAGNOSTIC_STAGES } from "../shared/instagramOAuthDiagnostics";

const primary = "17841458158640250", asset = "1445218102004133", page = "1398092400054123", business = "28938016352504966";
const token = "test-only-failed-oauth-token", secret = "test-only-app-secret";
const data = (overrides: Record<string, unknown> = {}) => ({ data: { is_valid: true, app_id: "111", type: "SYSTEM_USER", scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_messages"], granular_scopes: [{ scope: "instagram_basic", target_ids: [primary, asset, page, business] }], ...overrides } });

beforeEach(() => {
  process.env.APP_ENV = "test";
  process.env.META_APP_ID = "111"; process.env.META_APP_SECRET = secret; process.env.INSTAGRAM_API_VERSION = "v26.0";
});
afterEach(() => { vi.restoreAllMocks(); for (const key of ["META_APP_ID", "META_APP_SECRET", "INSTAGRAM_API_VERSION"]) delete process.env[key]; });

describe("private Instagram token grant diagnostics", () => {
  it("compares all four known targets without returning any identifiers", () => {
    const result = summarizeInstagramTokenGrants(data(), "111", " @SPACEPENGUIN.CO ");
    expect(result).toMatchObject({ outcome: "inspected", valid: true, appMatches: true, type: "SYSTEM_USER", scopes: { state: "present", names: ["instagram_basic", "instagram_content_publish", "instagram_manage_messages"], unknownCount: 0, invalidCount: 0 }, granular: { state: "present", grants: [{ scope: "instagram_basic", targets: { state: "present", count: 4, primaryMatch: true, businessAssetMatch: true, linkedPageMatch: true, businessMatch: true, otherTargetPresent: false } }] } });
    for (const id of [primary, asset, page, business, "111"]) expect(JSON.stringify(result)).not.toContain(id);
  });

  it("reports only fixed observed scope names across both API families", () => {
    const names = ["instagram_basic", "instagram_content_publish", "instagram_manage_messages", "instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_messages", "pages_show_list", "pages_read_engagement", "business_management"];
    const result = summarizeInstagramTokenGrants(data({ scopes: [...names, "PRIVATE_UNKNOWN_SCOPE", { token }] }), "111", "spacepenguin.co");
    expect(result.scopes).toEqual({ state: "invalid", names, unknownCount: 1, invalidCount: 1 });
    expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(JSON.stringify(result)).not.toContain(token);
  });

  it("drops provider text, user identity, raw IDs and credentials at every nesting level", () => {
    const privateText = "EAA_PRIVATE_TOKEN https://private.invalid/?code=PRIVATE&state=PRIVATE";
    const otherId = "99999999999999999";
    const result = summarizeInstagramTokenGrants({ message: privateText, data: { ...data().data, user_id: "77777777777777777", application: "PRIVATE_APP", username: "PRIVATE_HANDLE", access_token: token, client_secret: secret, metadata: { url: privateText }, scopes: ["instagram_basic", privateText], granular_scopes: [{ scope: "instagram_basic", target_ids: [primary, otherId], message: privateText, user_id: "77777777777777777" }, { scope: privateText, target_ids: [otherId] }] } }, "111", "spacepenguin.co");
    expect(result.granular).toMatchObject({ state: "present", unknownScopeCount: 1, grants: [{ scope: "instagram_basic", targets: { count: 2, primaryMatch: true, businessAssetMatch: false, otherTargetPresent: true } }] });
    for (const forbidden of [privateText, "PRIVATE", "77777777777777777", primary, otherId, token, secret, "https://"]) expect(JSON.stringify(result)).not.toContain(forbidden);
  });

  it.each([
    [{}, "missing", "missing", "missing"],
    [{ is_valid: "true", app_id: null, type: { token } }, "invalid", "invalid", "other"],
    [{ is_valid: false, app_id: "222", type: "USER" }, false, false, "USER"],
    [{ is_valid: true, app_id: 111, type: "PAGE" }, true, true, "PAGE"],
    [{ is_valid: true, app_id: "111", type: "APP" }, true, true, "APP"],
    [{ is_valid: true, app_id: "111", type: "PRIVATE_TYPE" }, true, true, "other"],
  ])("distinguishes absent, malformed and mismatched token metadata: %j", (input, valid, appMatches, type) => {
    const result = summarizeInstagramTokenGrants({ data: input }, "111", "spacepenguin.co");
    expect(result).toMatchObject({ valid, appMatches, type });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it.each([undefined, null, [], {}, { data: [] }, { data: null }])("rejects a malformed response shape: %j", body => {
    expect(summarizeInstagramTokenGrants(body, "111", "spacepenguin.co")).toEqual({ outcome: "invalid_response" });
  });

  it("does not read inherited provider fields", () => {
    const result = summarizeInstagramTokenGrants({ data: Object.create(data().data) }, "111", "spacepenguin.co");
    expect(result).toMatchObject({ valid: "missing", appMatches: "missing", type: "missing", scopes: { state: "missing" }, granular: { state: "missing" } });
  });

  it.each([[undefined, "missing"], [[], "empty"], [null, "invalid"], ["PRIVATE", "invalid"]])("distinguishes target list state %s", (targets, state) => {
    const result = summarizeInstagramTokenGrants(data({ granular_scopes: [{ scope: "instagram_basic", target_ids: targets }] }), "111", "spacepenguin.co");
    expect(result.granular?.grants[0].targets).toMatchObject({ state, count: 0 });
    if (state === "empty") expect(result.granular?.grants[0].targets.primaryMatch).toBe(false);
    else expect(result.granular?.grants[0].targets.primaryMatch).toBeUndefined();
  });

  it("never coerces unsafe numeric or malformed targets into account IDs", () => {
    const invalid = [Number(primary), "0", "01", "-1", " 123", "1".repeat(41), {}, token];
    const result = summarizeInstagramTokenGrants(data({ granular_scopes: [{ scope: "instagram_basic", target_ids: [asset, ...invalid] }] }), "111", "spacepenguin.co");
    expect(result.granular?.grants[0].targets).toEqual({ state: "invalid", count: 1, invalidCount: invalid.length, businessAssetMatch: true });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("bounds large arrays and does not turn uninspected targets into negative matches", () => {
    const targets = [...Array.from({ length: 100 }, (_, i) => String(1000 + i)), primary];
    const result = summarizeInstagramTokenGrants(data({ scopes: Array.from({ length: 1000 }, () => "PRIVATE"), granular_scopes: [{ scope: "instagram_basic", target_ids: targets }] }), "111", "spacepenguin.co");
    expect(result.scopes).toEqual({ state: "truncated", names: [], unknownCount: 64, invalidCount: 0 });
    expect(result.granular?.grants[0].targets).toEqual({ state: "truncated", count: 100, invalidCount: 0, otherTargetPresent: true });
    expect(JSON.stringify(result)).not.toContain(primary);
  });

  it("marks duplicate and truncated granular lists partial rather than proving absent targets", () => {
    const repeated = { scope: "instagram_basic", target_ids: [primary] };
    const duplicate = summarizeInstagramTokenGrants(data({ granular_scopes: [repeated, { scope: "instagram_basic", target_ids: [asset] }] }), "111", "spacepenguin.co");
    expect(duplicate.granular).toMatchObject({ state: "invalid", duplicateCount: 1, grants: [{ targets: { state: "invalid", primaryMatch: true } }] });
    expect(duplicate.granular?.grants[0].targets.businessAssetMatch).toBeUndefined();
    const oversized = summarizeInstagramTokenGrants(data({ granular_scopes: [repeated, ...Array.from({ length: 64 }, () => ({ scope: "PRIVATE", target_ids: [asset] }))] }), "111", "spacepenguin.co");
    expect(oversized.granular).toMatchObject({ state: "truncated", unknownScopeCount: 63, grants: [{ targets: { state: "truncated", primaryMatch: true } }] });
    expect(oversized.granular?.grants[0].targets.businessAssetMatch).toBeUndefined();
  });

  it("shares account hints defensively and limits page/business comparisons to the observed account", () => {
    const hints = instagramDiagnosticTargetHints("spacepenguin.co"); hints.primaryId = "999";
    expect(instagramDiagnosticTargetHints("spacepenguin.co").primaryId).toBe(primary);
    expect(instagramDiagnosticTargetHints("alligodang.official")).toEqual({ primaryId: "17841444569239069" });
    expect(instagramDiagnosticTargetHints("unknown.account")).toEqual({});
  });

  it("inspects only account lookup and quota failure stages", () => {
    expect(INSTAGRAM_DIAGNOSTIC_STAGES.filter(shouldInspectInstagramToken)).toEqual(["assigned_accounts", "account_profile", "direct_profile", "business_asset", "mapped_profile", "quota"]);
  });

  it("makes exactly one bounded GET with the distinct app credential and never returns its URL", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data()), { headers: { "content-type": "application/json" } }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const result = await inspectInstagramTokenGrants(token, "111", "spacepenguin.co", fetcher);
    expect(fetcher).toHaveBeenCalledOnce(); expect(timeout).toHaveBeenCalledWith(8000);
    const [request, init] = fetcher.mock.calls[0], url = new URL(request);
    expect(url.origin).toBe("https://graph.facebook.com"); expect(url.pathname).toBe("/v26.0/debug_token");
    expect([...url.searchParams.keys()].sort()).toEqual(["access_token", "input_token"]);
    expect(url.searchParams.get("input_token")).toBe(token); expect(url.searchParams.get("access_token")).toBe(`111|${secret}`);
    expect(init).toMatchObject({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) });
    expect(result).toMatchObject({ outcome: "inspected", httpStatus: 200, valid: true, appMatches: true });
    for (const forbidden of [token, secret, "https://", primary, asset, page, business]) expect(JSON.stringify(result)).not.toContain(forbidden);
  });

  it.each(["wrong_app", "missing_secret", "invalid_version"])("skips inspection if configuration changed: %s", async change => {
    if (change === "wrong_app") process.env.META_APP_ID = "222";
    if (change === "missing_secret") delete process.env.META_APP_SECRET;
    if (change === "invalid_version") process.env.INSTAGRAM_API_VERSION = "PRIVATE";
    const fetcher = vi.fn();
    expect(await inspectInstagramTokenGrants(token, "111", "spacepenguin.co", fetcher)).toEqual({ outcome: "configuration_changed" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports only bounded numeric provider errors without retry or raw exception data", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: 100, error_subcode: 33, message: token, error_data: { client_secret: secret }, fbtrace_id: "PRIVATE" } }), { status: 400 }));
    expect(await inspectInstagramTokenGrants(token, "111", "spacepenguin.co", fetcher)).toEqual({ outcome: "provider_error", httpStatus: 400, graphCode: 100, graphSubcode: 33 });
    expect(fetcher).toHaveBeenCalledOnce();
    const invalidCodes = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: "100", error_subcode: 2 ** 32 } }), { status: 400 }));
    expect(await inspectInstagramTokenGrants(token, "111", "spacepenguin.co", invalidCodes)).toEqual({ outcome: "provider_error", httpStatus: 400 });
  });

  it("handles transport loss and invalid JSON without exposing request credentials", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`PRIVATE https://graph.facebook.com/debug_token?input_token=${token}&access_token=111|${secret}`));
    expect(await inspectInstagramTokenGrants(token, "111", "spacepenguin.co", fetcher)).toEqual({ outcome: "unavailable", lost: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const malformed = vi.fn().mockImplementation(async () => new Response("PRIVATE invalid JSON"));
    expect(await inspectInstagramTokenGrants(token, "111", "spacepenguin.co", malformed)).toEqual({ outcome: "invalid_response", httpStatus: 200 });
    expect(malformed).toHaveBeenCalledOnce();
  });
});
