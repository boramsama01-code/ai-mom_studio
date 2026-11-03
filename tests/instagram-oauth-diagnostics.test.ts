import { describe, expect, it } from "vitest";
import { instagramOAuthFailureUrl, instagramProviderDiagnostic, readInstagramOAuthFailure, sanitizeInstagramDiagnostic } from "../shared/instagramOAuthDiagnostics";

const privateText = "PRIVATE_TOKEN_CODE_STATE https://private.invalid/?access_token=PRIVATE_SECRET";

describe("safe Instagram OAuth diagnostics", () => {
  it("copies only allowlisted labels, bounded numeric fields and a boolean", () => {
    expect(sanitizeInstagramDiagnostic({ stage: "business_asset", httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false, token: privateText, code: privateText, state: privateText, message: privateText, url: privateText, stack: privateText })).toEqual({ stage: "business_asset", httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false });
    for (const stage of [privateText, "__proto__", "constructor", "toString", null, 0]) expect(sanitizeInstagramDiagnostic({ stage, httpStatus: 400 })).toBeUndefined();
    for (const value of [null, [], privateText]) expect(sanitizeInstagramDiagnostic(value)).toBeUndefined();
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2_147_483_648, "190", privateText, {}, []])("does not coerce or expose an invalid Graph number: %j", value => {
    expect(sanitizeInstagramDiagnostic({ stage: "token_exchange", httpStatus: value, graphCode: value, graphSubcode: value, lost: "true" })).toEqual({ stage: "token_exchange" });
  });

  it("bounds HTTP independently and keeps zero-valued Graph codes", () => {
    expect(sanitizeInstagramDiagnostic({ stage: "quota", httpStatus: 99, graphCode: 0, graphSubcode: 2_147_483_647, lost: true })).toEqual({ stage: "quota", graphCode: 0, graphSubcode: 2_147_483_647, lost: true });
    expect(sanitizeInstagramDiagnostic({ stage: "quota", httpStatus: 600 })).toEqual({ stage: "quota" });
    expect(sanitizeInstagramDiagnostic({ stage: "quota", httpStatus: 599 })).toEqual({ stage: "quota", httpStatus: 599 });
  });

  it("extracts numeric provider errors without retaining their arbitrary data", () => {
    const diagnostic = instagramProviderDiagnostic("token_exchange", 400, { access_token: privateText, error: { code: 190, error_subcode: 463, message: { secret: privateText }, type: privateText, fbtrace_id: privateText, error_data: { url: privateText } } });
    expect(diagnostic).toEqual({ stage: "token_exchange", httpStatus: 400, graphCode: 190, graphSubcode: 463, lost: false });
    for (const body of [null, [], { error: null }, { error: privateText }, { error: { code: "190", error_subcode: privateText } }]) {
      expect(instagramProviderDiagnostic("token_exchange", 200, body)).toEqual({ stage: "token_exchange", httpStatus: 200, lost: false });
    }
  });

  it("constructs a fresh redirect with a fixed key set and sanitizes it on read", () => {
    const location = instagramOAuthFailureUrl("direct_account_access_failed", { stage: "mapped_profile", httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false, code: privateText, state: privateText, message: privateText });
    const query = new URL(location, "https://studio.example").searchParams;
    expect([...query.keys()]).toEqual(["instagram", "reason", "stage", "http_status", "graph_code", "graph_subcode", "lost"]);
    expect(readInstagramOAuthFailure(query)).toEqual({ reason: "direct_account_access_failed", diagnostic: { stage: "mapped_profile", httpStatus: 400, graphCode: 100, graphSubcode: 33, lost: false } });
    expect(location).not.toContain("PRIVATE");
    expect(instagramOAuthFailureUrl(privateText, { stage: privateText, graphCode: 100 })).toBe("/instagram?instagram=error&reason=connect_failed");
  });

  it("rejects duplicate and non-canonical query fields and ignores all OAuth secrets", () => {
    const query = new URLSearchParams({ reason: "direct_publish_access_failed", stage: "quota", http_status: "400", graph_code: "190", graph_subcode: "463", lost: "false", code: privateText, state: privateText, access_token: privateText, error_description: privateText });
    query.append("reason", privateText);
    query.append("graph_code", "100");
    expect(readInstagramOAuthFailure(query)).toEqual({ reason: "connect_failed", diagnostic: { stage: "quota", httpStatus: 400, graphSubcode: 463, lost: false } });
    query.append("stage", "business_asset");
    expect(readInstagramOAuthFailure(query)).toEqual({ reason: "connect_failed" });
    for (const value of ["1e2", "400.0", "0400", "+400", " 400", "-1", "2147483648", "99999999999999999", privateText]) {
      expect(readInstagramOAuthFailure(new URLSearchParams({ reason: "exchange_failed", stage: "token_exchange", http_status: value, graph_code: value, graph_subcode: value, lost: value }))).toEqual({ reason: "exchange_failed", diagnostic: { stage: "token_exchange" } });
    }
  });
});
