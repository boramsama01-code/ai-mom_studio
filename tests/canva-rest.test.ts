import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../server/db";
import { buildAuthUrl, CANVA_SCOPES, exchangeCode } from "../server/services/canva";
import { CanvaRestError, getCanvaAssetUploadJob, getCanvaAutofillJob, getCanvaCapabilities, getCanvaDataset, getCanvaDesign, getCanvaExportJob, getCanvaPages, getCanvaPrincipal, submitCanvaAssetUpload, submitCanvaAutofill, submitCanvaExport } from "../server/services/canvaRest";
const db = {} as DB;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const inProgress = { job: { id: "job_isolated", status: "in_progress" } };
const data = { P01_HEADLINE: { type: "text" as const, text: "안전한 원고" }, P02_CAVEAT: { type: "text" as const, text: "" }, P01_IMAGE: { type: "image" as const, asset_id: "asset_isolated" } };
const pages = (count = 8) => ({ items: Array.from({ length: count }, (_, index) => ({ id: `page_${index + 1}`, page_number: index + 1, dimensions: { width: 1080, height: 1350 }, thumbnail: { width: 216, height: 270, url: `https://document-export.canva.com/preview/${index + 1}.png` } })) });
beforeEach(() => {
  vi.stubEnv("CANVA_CLIENT_ID", "isolated-client"); vi.stubEnv("CANVA_CLIENT_SECRET", "never-print-client-secret");
  vi.stubEnv("CANVA_ACCESS_TOKEN", "never-print-access-token"); vi.stubEnv("CANVA_REFRESH_TOKEN", "never-print-refresh-token");
  vi.stubEnv("CANVA_TOKEN_EXPIRES_AT", String(Date.now() + 3600000));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked external request prohibited"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Canva REST read boundaries", () => {
  it("requests current user/team and capabilities without guessing from a subscription name", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ capabilities: ["autofill", "brand_template"] })).mockResolvedValueOnce(json({ team_user: { user_id: "user_1", team_id: "team_1" } }));
    expect(await getCanvaCapabilities(db, { fetchImpl })).toEqual({ capabilities: ["autofill", "brand_template"] });
    expect(await getCanvaPrincipal(db, { fetchImpl })).toEqual({ userId: "user_1", teamId: "team_1" });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["https://api.canva.com/rest/v1/users/me/capabilities", "https://api.canva.com/rest/v1/users/me"]);
    expect(fetchImpl.mock.calls.every(([, request]) => request.method === "GET" && request.redirect === "error")).toBe(true);
    expect(CANVA_SCOPES).toEqual(expect.arrayContaining(["profile:read", "asset:read", "asset:write"]));
    expect(new URL(buildAuthUrl({ challenge: "challenge", state: "state", redirectUri: "https://studio.example/callback" })).searchParams.get("scope")).toContain("asset:write");
  });
  it("distinguishes an explicitly empty capability list from an incomplete capability response", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ capabilities: [] })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ capabilities: null }));
    await expect(getCanvaCapabilities(db, { fetchImpl })).resolves.toEqual({ capabilities: [] });
    for (let index = 0; index < 2; index++) await expect(getCanvaCapabilities(db, { fetchImpl })).rejects.toMatchObject({ code: "invalid_response", reason: "invalid_response", outcomeUnknown: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.every(([, request]) => request.method === "GET")).toBe(true);
  });
  it("uses canvas dimensions and requests a ninth page to reject longer masters", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(pages())).mockResolvedValueOnce(json(pages(9)));
    const valid = await getCanvaPages(db, "design_1", { fetchImpl }); expect(valid.validEightPageMaster).toBe(true); expect(valid.items[0]).toMatchObject({ pageNumber: 1, width: 1080, height: 1350 });
    expect((await getCanvaPages(db, "design_1", { fetchImpl })).validEightPageMaster).toBe(false);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/designs/design_1/pages?offset=1&limit=9");
    const wrong = pages(); wrong.items[1].dimensions.width = 1000; wrong.items[1].thumbnail.width = 1080; wrong.items[1].thumbnail.height = 1350;
    fetchImpl.mockResolvedValueOnce(json(wrong)); expect((await getCanvaPages(db, "design_1", { fetchImpl })).validEightPageMaster).toBe(false);
  });
  it("does not infer missing page dimensions or accept duplicated page numbers", async () => {
    const missing: any = pages(); delete missing.items[0].dimensions;
    const duplicate = pages(); duplicate.items[1].page_number = 1;
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(missing)).mockResolvedValueOnce(json(duplicate));
    expect((await getCanvaPages(db, "design_1", { fetchImpl })).validEightPageMaster).toBe(false);
    expect((await getCanvaPages(db, "design_1", { fetchImpl })).validEightPageMaster).toBe(false);
  });
  it("returns a bounded design identity and rejects an unrelated response", async () => {
    const design = { id: "design_1", title: "8장 마스터", page_count: 8, owner: { user_id: "user_1", team_id: "team_1" }, urls: { edit_url: "https://www.canva.com/design/design_1/edit", view_url: "https://www.canva.com/design/design_1/view" }, updated_at: 123 };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ design })).mockResolvedValueOnce(json({ design: { ...design, id: "another_design" } }));
    expect(await getCanvaDesign(db, "design_1", { fetchImpl })).toMatchObject({ id: "design_1", owner: { userId: "user_1", teamId: "team_1" }, pageCount: 8, updatedAt: 123 });
    await expect(getCanvaDesign(db, "design_1", { fetchImpl })).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("separates design and brand-template datasets and keeps unsupported field types identifiable", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ dataset: { title: { type: "text" }, image: { type: "image" }, sales: { type: "sheet" }, future: { type: "new_widget" } } }));
    expect(await getCanvaDataset(db, { type: "design", id: "design_1" }, { fetchImpl })).toEqual({ title: { type: "text" }, image: { type: "image" }, sales: { type: "sheet" }, future: { type: "unknown" } });
    await getCanvaDataset(db, { type: "brand_template", id: "template_1" }, { fetchImpl });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["https://api.canva.com/rest/v1/designs/design_1/dataset", "https://api.canva.com/rest/v1/brand-templates/template_1/dataset"]);
  });
});

describe("durable Canva submit and lookup contracts", () => {
  it.each(["design", "brand_template"] as const)("submits a create-only %s autofill once and returns its ID immediately", async type => {
    const fetchImpl = vi.fn().mockResolvedValue(json(inProgress));
    expect(await submitCanvaAutofill(db, { type, id: "master_1", title: "새 원고", data }, { fetchImpl })).toEqual({ id: "job_isolated", status: "in_progress" });
    expect(fetchImpl).toHaveBeenCalledOnce(); const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ type: type === "design" ? "create_from_design" : "create_from_brand_template", [type === "design" ? "design_id" : "brand_template_id"]: "master_1", title: "새 원고", data });
    expect(body.data.P02_CAVEAT.text).toBe(""); expect(body.type).not.toBe("update_design");
  });
  it("exports eight separate PNG pages at the intended dimensions without 400 retry fallback", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(inProgress)).mockResolvedValueOnce(json({ message: "secret provider diagnostic" }, 400));
    await submitCanvaExport(db, "design_1", { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ design_id: "design_1", format: { type: "png", width: 1080, height: 1350, as_single_image: false, pages: [1, 2, 3, 4, 5, 6, 7, 8] } });
    await expect(submitCanvaExport(db, "design_1", { fetchImpl })).rejects.toMatchObject({ code: "invalid_request", outcomeUnknown: false }); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("reads autofill result only from a new-design outcome and preserves job ID on malformed results", async () => {
    const result = { type: "create_design", design: { id: "generated_1", urls: { edit_url: "https://www.canva.com/design/generated_1/edit" } } };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ job: { id: "job_1", status: "success", result } })).mockResolvedValueOnce(json({ job: { id: "job_1", status: "success", result: { type: "update_design", design: { id: "master_1" } } } }));
    expect(await getCanvaAutofillJob(db, "job_1", { fetchImpl })).toMatchObject({ id: "job_1", status: "success", result: { designId: "generated_1" } });
    await expect(getCanvaAutofillJob(db, "job_1", { fetchImpl })).rejects.toMatchObject({ code: "invalid_response", jobId: "job_1", outcomeUnknown: false });
  });
  it("preserves provider page order for exports and rejects credential-bearing or foreign URLs", async () => {
    const urls = Array.from({ length: 8 }, (_, index) => `https://export-download.canva.com/output/${index + 1}.png?sig=value`);
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ job: { id: "job_1", status: "success", urls } })).mockResolvedValueOnce(json({ job: { id: "job_1", status: "success", urls: ["http://169.254.169.254/latest"] } }));
    expect(await getCanvaExportJob(db, "job_1", { fetchImpl })).toEqual({ id: "job_1", status: "success", result: { urls } });
    await expect(getCanvaExportJob(db, "job_1", { fetchImpl })).rejects.toMatchObject({ code: "invalid_response", jobId: "job_1" });
  });
  it("uploads actual binary with UTF-8 base64 metadata and reads asset from job.asset", async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(inProgress)).mockResolvedValueOnce(json({ job: { id: "job_isolated", status: "success", asset: { id: "asset_1", type: "image", name: "표지" } } }));
    expect(await submitCanvaAssetUpload(db, bytes, "표지 이미지.png", { fetchImpl })).toEqual({ id: "job_isolated", status: "in_progress" });
    const request = fetchImpl.mock.calls[0][1]; expect(request.body).toBe(bytes); expect(request.headers["content-type"]).toBe("application/octet-stream");
    expect(JSON.parse(request.headers["asset-upload-metadata"])).toEqual({ name_base64: Buffer.from("표지 이미지.png").toString("base64") });
    expect(await getCanvaAssetUploadJob(db, "job_isolated", { fetchImpl })).toEqual({ id: "job_isolated", status: "success", result: { assetId: "asset_1" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("does not expose raw job errors or treat failed jobs as successful results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ job: { id: "job_1", status: "failed", error: { code: "secret-code", message: "never-print-refresh-token" } } }));
    expect(await getCanvaAssetUploadJob(db, "job_1", { fetchImpl })).toEqual({ id: "job_1", status: "failed", errorCode: "job_failed" });
  });
  it("retains a received POST job ID even if the provider sends an unsupported status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ job: { id: "job_created", status: "new_unsupported_status" } }));
    await expect(submitCanvaExport(db, "design_1", { fetchImpl })).rejects.toMatchObject({ code: "invalid_response", jobId: "job_created", outcomeUnknown: true }); expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("safe Canva failures and request limits", () => {
  it.each([
    { providerCode: "missing_scope", message: "scope profile:read never-print-access-token", code: "permission_denied", reason: "missing_scope" },
    { providerCode: "permission_denied", message: "Not allowed to access design with id 'private-design'", code: "permission_denied", reason: "permission_denied" },
    { providerCode: "permission_denied", message: "Access the autofill feature and other powerful design tools by upgrading your Canva plan here: https://www.canva.com/pricing?private=token", code: "permission_denied", reason: "capability_missing" },
    { providerCode: "permission_denied", message: 'Not allowed to access createAutofillJob, requires one of capabilities ["autofill"]', code: "permission_denied", reason: "capability_missing" },
  ])("keeps $reason separate while retaining the worker's safe rejection code", async ({ providerCode, message, code, reason }) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: providerCode, message }, 403));
    const error = await submitCanvaAutofill(db, { type: "design", id: "master_1", title: "원고 보존", data }, { fetchImpl }).catch(value => value);
    expect(error).toMatchObject({ code, reason, providerCode, outcomeUnknown: false });
    expect(error.message).not.toContain(message); expect(JSON.stringify(error)).not.toContain("private"); expect(JSON.stringify(error)).not.toContain("never-print");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("does not label design access denial or an MCP-only wrapper code as an Autofill plan failure", async () => {
    const message = "This feature requires a Canva plan with access to autofill (such as Canva Pro, Canva Teams, or Canva Enterprise).";
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ code: "permission_denied", message }, 403)).mockResolvedValueOnce(json({ code: "INVALID_ARGUMENT", message }, 400));
    await expect(getCanvaDesign(db, "design_1", { fetchImpl })).rejects.toMatchObject({ code: "permission_denied", reason: "permission_denied" });
    await expect(submitCanvaAutofill(db, { type: "design", id: "master_1", title: "원고 보존", data }, { fetchImpl })).rejects.toMatchObject({ code: "invalid_request", reason: "invalid_request", providerCode: null, outcomeUnknown: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["quota_exceeded", "credit_quota_exceeded", "credit_quota_cooldown", "app_credit_quota_exceeded"])("separates %s from a short request-rate limit without automatically retrying", async providerCode => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: providerCode, message: "never-print-credit-details" }, 429));
    const error = await submitCanvaExport(db, "design_1", { fetchImpl }).catch(value => value);
    expect(error).toMatchObject({ code: "rate_limited", reason: "quota_exceeded", providerCode, outcomeUnknown: false });
    expect(error.message).toContain("사용 한도"); expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([408, 503])("does not turn HTTP %i into a replayable rejection because of an inconsistent error body", async status => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: "missing_scope", message: "provider diagnostic" }, status));
    await expect(submitCanvaExport(db, "design_1", { fetchImpl })).rejects.toMatchObject({ code: "provider_unavailable", reason: "provider_unavailable", outcomeUnknown: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("keeps a confirmed HTTP rejection safe even if its diagnostic body cannot be parsed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not-json never-print-secret", { status: 403 }));
    const error = await submitCanvaExport(db, "design_1", { fetchImpl }).catch(value => value);
    expect(error).toMatchObject({ code: "permission_denied", reason: "permission_denied", providerCode: null, outcomeUnknown: false });
    expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([[401, "auth_required", false], [403, "permission_denied", false], [404, "not_found", false], [429, "rate_limited", false], [503, "provider_unavailable", true]] as const)("classifies HTTP %i without copying secrets from errors", async (status, code, outcomeUnknown) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: "secret-code", message: "never-print-refresh-token" }, status));
    const error = await submitCanvaExport(db, "design_1", { fetchImpl }).catch(value => value);
    expect(error).toBeInstanceOf(CanvaRestError); expect(error).toMatchObject({ code, outcomeUnknown, providerCode: null }); expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("treats transport failure as unknown and never auto-replays the POST", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("never-print-access-token"));
    const error = await submitCanvaExport(db, "design_1", { fetchImpl }).catch(value => value);
    expect(error).toMatchObject({ code: "result_unknown", outcomeUnknown: true }); expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("distinguishes documented export expiry from an unrelated 404 without exposing provider messages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ code: "not_found", message: "export job result has expired" }, 404))
      .mockResolvedValueOnce(json({ code: "not_found", message: "never-print-access-token" }, 404));
    await expect(getCanvaExportJob(db, "export_old", { fetchImpl })).rejects.toMatchObject({ code: "export_expired", outcomeUnknown: false });
    const unrelated = await getCanvaExportJob(db, "export_wrong", { fetchImpl }).catch(error => error);
    expect(unrelated.code).toBe("not_found"); expect(unrelated.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid IDs, remote image values, oversize input and cancelled work before requests", async () => {
    const fetchImpl = vi.fn();
    await expect(getCanvaDesign(db, "../../users/me", { fetchImpl })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(submitCanvaAutofill(db, { type: "design", id: "master_1", title: "x", data: { image: { type: "image", asset_id: "https://attacker.invalid/image" } } }, { fetchImpl })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(submitCanvaAssetUpload(db, Buffer.alloc(20_000_001), "too-large.png", { fetchImpl })).rejects.toMatchObject({ code: "invalid_request" });
    const controller = new AbortController(); controller.abort();
    await expect(submitCanvaExport(db, "design_1", { fetchImpl, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled", outcomeUnknown: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("sanitizes OAuth failures without persisting or printing provider descriptions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "invalid_grant", error_description: "never-print-client-secret" }, 400));
    const error = await exchangeCode(db, { code: "isolated-code", verifier: "isolated-verifier", redirectUri: "https://studio.example/callback" }, fetchImpl).catch(value => value);
    expect(error.message).not.toContain("never-print"); expect(error.code).toBe("auth_required"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([[401, "invalid_client", "Client ID"], [400, "invalid_grant", "PKCE"], [400, "invalid_scope", "권한"]] as const)("explains OAuth HTTP %i %s without exposing provider data or retrying", async (status, providerError, guidance) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: providerError, error_description: "never-print-client-secret", access_token: "never-print-access-token" }, status));
    const error = await exchangeCode(db, { code: "isolated-code", verifier: "isolated-verifier", redirectUri: "https://studio.example/callback" }, fetchImpl).catch(value => value);
    expect(error).toMatchObject({ status, code: "auth_required" });
    expect(error.message).toContain(`HTTP ${status}`); expect(error.message).toContain(providerError); expect(error.message).toContain(guidance);
    expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([[400, "invalid_grant", "PKCE"], [400, "invalid_field", "필수 항목"], [400, "bad_request_body", "본문"], [401, "invalid_access_token", "Client secret"], [400, "unauthorized_client", "개발자 설정"]] as const)("handles Canva's documented code field for HTTP %i %s without exposing the message", async (status, providerCode, guidance) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: providerCode, message: "never-print-client-secret" }, status));
    const error = await exchangeCode(db, { code: "isolated-code", verifier: "isolated-verifier", redirectUri: "https://studio.example/callback" }, fetchImpl).catch(value => value);
    expect(error).toMatchObject({ status, code: "auth_required" });
    expect(error.message).toContain(providerCode); expect(error.message).toContain(guidance);
    expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("falls back to a known OAuth error when the provider code is unknown", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ code: "never-print-code", error: "invalid_grant", message: "never-print-message" }, 400));
    const error = await exchangeCode(db, { code: "isolated-code", verifier: "isolated-verifier", redirectUri: "https://studio.example/callback" }, fetchImpl).catch(value => value);
    expect(error.message).toContain("invalid_grant"); expect(error.message).not.toContain("never-print"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("does not echo unrecognized OAuth errors or accept malformed success responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: "never-print-client-secret", message: "never-print-access-token" }, 400)).mockResolvedValueOnce(json(null));
    const input = { code: "isolated-code", verifier: "isolated-verifier", redirectUri: "https://studio.example/callback" };
    const unknown = await exchangeCode(db, input, fetchImpl).catch(value => value);
    expect(unknown.message).toContain("HTTP 400"); expect(unknown.message).not.toContain("never-print");
    await expect(exchangeCode(db, input, fetchImpl)).rejects.toMatchObject({ status: 200, code: "auth_invalid_response" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
