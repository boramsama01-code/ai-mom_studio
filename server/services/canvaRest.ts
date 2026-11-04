/** Canva Connect REST boundary. Submit once, persist the returned ID, then poll in durable workers. */
import { z } from "zod";
import type { DB } from "../db";
import type { CanvaDataset, CanvaField } from "../../shared/canvaEditorial";
import { canvaProviderErrorCodeSchema, type CanvaFailureReason, type CanvaProviderErrorCode } from "../../shared/canvaCapabilities";
import { accessToken, CANVA_API, CanvaError } from "./canva";

export type CanvaRestOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal };
export type CanvaRestErrorCode = "not_connected" | "auth_required" | "permission_denied" | "not_found" | "export_expired" | "rate_limited" | "invalid_request" | "provider_unavailable" | "result_unknown" | "invalid_response" | "cancelled" | "job_failed";
export class CanvaRestError extends CanvaError {
  public reason: CanvaFailureReason;
  public providerCode: CanvaProviderErrorCode | null;
  constructor(message: string, status: number | undefined, public override code: CanvaRestErrorCode, public outcomeUnknown = false, public jobId: string | null = null, detail: { reason?: CanvaFailureReason; providerCode?: CanvaProviderErrorCode | null } = {}) {
    super(message, status, code); this.name = "CanvaRestError";
    this.reason = detail.reason ?? code; this.providerCode = detail.providerCode ?? null;
  }
}
const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const sizeSchema = z.number().finite().positive().max(100000);
const fieldKeySchema = z.string().min(1).max(255).refine(key => !/[\u0000-\u001f]/.test(key) && !["__proto__", "prototype", "constructor"].includes(key));
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
/** Canva-owned URLs only. No credentials, alternate schemes, arbitrary host or unbounded signed URL. */
const canvaUrl = z.string().max(8192).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")); }
  catch { return false; }
});
const linksSchema = z.object({ edit_url: canvaUrl.optional(), view_url: canvaUrl.optional() });
const ownerSchema = z.object({ user_id: idSchema, team_id: idSchema });
const thumbnailSchema = z.object({ url: canvaUrl, width: sizeSchema.optional(), height: sizeSchema.optional() });
const jobHeaderSchema = z.object({ id: idSchema, status: z.enum(["in_progress", "success", "failed"]) });
const inputFieldSchema = z.union([z.object({ type: z.literal("text"), text: z.string().max(10000) }).strict(), z.object({ type: z.literal("image"), asset_id: idSchema }).strict()]);
const inputDataSchema = z.record(fieldKeySchema, inputFieldSchema).refine(data => Object.keys(data).length > 0 && Object.keys(data).length <= 200);
const sourceSchema = z.object({ type: z.enum(["design", "brand_template"]), id: idSchema }).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown, input = false, jobId: string | null = null, submitted = false): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CanvaRestError(input ? "Canva 요청 항목의 형식·길이를 확인해 주세요." : "Canva 응답 형식을 확인할 수 없습니다. 저장된 작업 ID로 결과를 다시 확인하세요.", input ? 400 : 502, input ? "invalid_request" : "invalid_response", submitted, jobId);
  return parsed.data;
}
const validId = (value: string) => validate(idSchema, value, true);
function httpError(status: number, submitted: boolean, path: string, failure?: unknown) {
  const parsedCode = canvaProviderErrorCodeSchema.safeParse(object(failure) ? failure.code : undefined);
  const providerCode = parsedCode.success ? parsedCode.data : null;
  const providerMessage = object(failure) && typeof failure.message === "string" && failure.message.length <= 4000 ? failure.message : "";
  const detail = { providerCode };
  // Do not let an inconsistent error body turn an uncertain POST into a known rejection.
  if (status >= 500 || status === 408) return new CanvaRestError("Canva가 요청 결과를 확인해 주지 못했습니다. 중복 생성을 피하려고 자동 재요청하지 않았습니다.", status, "provider_unavailable", submitted, null, detail);
  if (providerCode === "missing_scope" || providerCode === "invalid_scope") return new CanvaRestError("Canva 연결에 필요한 권한이 빠져 있습니다. Canva 연결 설정에서 계정을 다시 연결하고 요청한 권한을 승인해 주세요.", status, "permission_denied", false, null, { ...detail, reason: "missing_scope" });
  if (providerCode && ["invalid_access_token", "revoked_access_token", "invalid_grant"].includes(providerCode)) return new CanvaRestError("Canva 인증이 만료되었거나 해제되었습니다. 계정을 다시 연결해 주세요.", status, "auth_required", false, null, detail);
  if (providerCode && ["quota_exceeded", "credit_quota_exceeded", "credit_quota_cooldown", "app_credit_quota_exceeded"].includes(providerCode)) return new CanvaRestError("Canva 기능 이용량 또는 크레딧 한도에 도달했습니다. 계정·앱의 사용 한도를 확인한 뒤 다시 요청해 주세요. 기존 원고와 작업 기록은 유지했습니다.", status, "rate_limited", false, null, { ...detail, reason: "quota_exceeded" });
  // A 403 alone does not prove a plan problem. Only the documented Autofill
  // capability message, on an Autofill endpoint, can refine resource denial.
  const autofillCapabilityDenied = status === 403 && providerCode === "permission_denied" && /^\/autofills(?:\/|$)/.test(path) && (
    /requires (?:one of )?capabilities \[\s*["']autofill["']/i.test(providerMessage)
    || /access the autofill feature[\s\S]*upgrading your canva plan/i.test(providerMessage)
    || /requires a canva plan with access to autofill/i.test(providerMessage)
  );
  if (autofillCapabilityDenied) return new CanvaRestError("현재 연결한 Canva 계정·팀에서 자동 채우기를 사용할 수 없습니다. 이 기능이 포함된 플랜과 연결한 계정·팀을 확인해 주세요. 원본 디자인과 원고는 유지했습니다.", status, "permission_denied", false, null, { ...detail, reason: "capability_missing" });
  const [code, message]: [CanvaRestErrorCode, string] = status === 401 ? ["auth_required", "Canva 인증이 만료되었습니다. 계정을 다시 연결해 주세요."]
    : status === 403 ? ["permission_denied", "Canva 디자인·자료에 접근할 권한이 부족합니다. 현재 연결한 계정·팀과 해당 자료의 접근 권한을 확인해 주세요."]
    : status === 404 ? ["not_found", "Canva 디자인·템플릿 또는 작업을 찾을 수 없습니다. 현재 계정과 ID를 확인해 주세요."]
    : status === 429 ? ["rate_limited", "Canva 호출 한도에 도달했습니다. 잠시 후 저장된 작업의 결과를 확인해 주세요."]
    : ["invalid_request", "Canva가 요청 항목을 거절했습니다. 디자인·데이터 필드·이미지 형식을 확인해 주세요."];
  return new CanvaRestError(message, status, code, false, null, detail);
}
async function responseJson(response: Response, signal: AbortSignal, submitted: boolean): Promise<unknown> {
  const maxBytes = 2_000_000;
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) { await response.body?.cancel(); throw new CanvaRestError("Canva 응답이 저장 한도를 초과했습니다.", 502, "invalid_response", submitted); }
  const reader = response.body?.getReader();
  if (!reader) throw new CanvaRestError("Canva 응답이 비어 있습니다.", 502, "invalid_response", submitted);
  const chunks: Uint8Array[] = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new CanvaRestError("Canva 응답이 저장 한도를 초과했습니다.", 502, "invalid_response", submitted); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new CanvaRestError("Canva 결과를 읽을 수 없습니다. 이미 접수됐을 수 있어 새로 생성하지 않았습니다.", 502, "invalid_response", submitted); }
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
async function rest(db: DB, path: string, options: CanvaRestOptions, request: { method?: "GET" | "POST"; json?: unknown; bytes?: Buffer; name?: string } = {}): Promise<unknown> {
  const submitted = request.method === "POST";
  if (options.signal?.aborted) throw new CanvaRestError("Canva 요청을 취소했습니다.", undefined, "cancelled");
  const fetchImpl = options.fetchImpl ?? fetch;
  let token: string;
  try { token = await accessToken(db, fetchImpl); }
  catch { throw new CanvaRestError("Canva 연결 정보를 확인할 수 없습니다. 계정을 다시 연결해 주세요.", 401, "not_connected"); }
  const signal = AbortSignal.any([AbortSignal.timeout(request.bytes ? 60_000 : 20_000), ...(options.signal ? [options.signal] : [])]);
  let sent = false;
  try {
    signal.throwIfAborted(); sent = true;
    const response = await fetchImpl(`${CANVA_API}${path}`, {
      method: request.method ?? "GET", redirect: "error", signal,
      headers: { authorization: `Bearer ${token}`, ...(request.bytes ? {
        "content-type": "application/octet-stream",
        "asset-upload-metadata": JSON.stringify({ name_base64: Buffer.from(request.name!, "utf8").toString("base64") }),
      } : request.json !== undefined ? { "content-type": "application/json" } : {}) },
      ...(request.bytes ? { body: request.bytes as unknown as BodyInit } : request.json !== undefined ? { body: JSON.stringify(request.json) } : {}),
    });
    if (!response.ok) {
      let failure: unknown;
      try { failure = await responseJson(response, signal, false); } catch { /* HTTP rejection remains known even when its diagnostic body is malformed. */ }
      // Only this documented terminal outcome permits an explicit new export.
      // Other 404s can mean an inaccessible/wrong ID and must not be guessed to be expiry.
      if (!submitted && response.status === 404 && /^\/exports\/[a-zA-Z0-9_-]+$/.test(path)) {
        if (object(failure) && failure.code === "not_found" && failure.message === "export job result has expired") {
          throw new CanvaRestError("Canva 출력 파일의 보관 기간이 끝났습니다. 기존 디자인을 확인한 뒤 다시 내보내 주세요.", 404, "export_expired");
        }
      }
      try { await response.body?.cancel(); } catch { /* Provider error contents never leave this boundary. */ }
      throw httpError(response.status, submitted, path, failure);
    }
    return await responseJson(response, signal, submitted);
  } catch (error) {
    if (error instanceof CanvaRestError) throw error;
    if (options.signal?.aborted) throw new CanvaRestError("Canva 대기를 중단했습니다. 이미 접수된 작업의 결과는 저장된 작업 ID로 확인해 주세요.", undefined, "cancelled", submitted && sent);
    throw new CanvaRestError("Canva 응답을 받지 못했습니다. 처리 결과가 미확정이므로 자동 재요청하지 않았습니다.", undefined, "result_unknown", submitted && sent);
  }
}

export type CanvaPrincipal = { userId: string; teamId: string };
export type CanvaDesignMetadata = { id: string; title: string | null; pageCount: number | null; owner: CanvaPrincipal; editUrl: string | null; viewUrl: string | null; updatedAt: number | null };
export type CanvaPageMetadata = { id: string | null; pageNumber: number; width: number | null; height: number | null; thumbnailUrl: string | null };
export type CanvaRestJob<T> = { id: string; status: "in_progress" | "success" | "failed"; result?: T; errorCode?: "job_failed" };
export type CanvaAutofillResult = { designId: string; editUrl: string | null; viewUrl: string | null };
export type CanvaExportResult = { urls: string[] };
export type CanvaAssetResult = { assetId: string };

export async function getCanvaCapabilities(db: DB, options: CanvaRestOptions = {}): Promise<{ capabilities: string[] }> {
  const parsed = z.object({ capabilities: z.array(z.string().max(80).regex(/^[a-z_]+$/)).max(50) }).safeParse(await rest(db, "/users/me/capabilities", options));
  if (!parsed.success) throw new CanvaRestError("Canva 기능 확인 응답이 불완전합니다. 계정의 사용 가능 여부를 단정하지 않았으니 연결 상태를 다시 확인해 주세요.", 502, "invalid_response");
  return { capabilities: parsed.data.capabilities };
}
export async function getCanvaPrincipal(db: DB, options: CanvaRestOptions = {}): Promise<CanvaPrincipal> {
  const value = validate(z.object({ team_user: ownerSchema }), await rest(db, "/users/me", options));
  return { userId: value.team_user.user_id, teamId: value.team_user.team_id };
}
export async function getCanvaDesign(db: DB, id: string, options: CanvaRestOptions = {}): Promise<CanvaDesignMetadata> {
  const value = validate(z.object({ design: z.object({ id: idSchema, title: z.string().max(1000).optional(), owner: ownerSchema, page_count: z.number().int().min(0).max(500).optional(), urls: linksSchema.optional(), updated_at: z.number().int().nonnegative().optional() }) }), await rest(db, `/designs/${validId(id)}`, options));
  const design = value.design;
  if (design.id !== id) throw new CanvaRestError("요청한 Canva 디자인과 응답 ID가 다릅니다.", 502, "invalid_response");
  return { id: design.id, title: design.title ?? null, pageCount: design.page_count ?? null, owner: { userId: design.owner.user_id, teamId: design.owner.team_id }, editUrl: design.urls?.edit_url ?? null, viewUrl: design.urls?.view_url ?? null, updatedAt: design.updated_at ?? null };
}
export async function getCanvaPages(db: DB, id: string, options: CanvaRestOptions = {}): Promise<{ items: CanvaPageMetadata[]; validEightPageMaster: boolean }> {
  const page = z.object({ id: idSchema.optional(), page_number: z.number().int().min(1).max(500), dimensions: z.object({ width: sizeSchema, height: sizeSchema }).optional(), thumbnail: thumbnailSchema.optional() });
  const value = validate(z.object({ items: z.array(page).max(9) }), await rest(db, `/designs/${validId(id)}/pages?offset=1&limit=9`, options));
  const items = value.items.map(item => ({ id: item.id ?? null, pageNumber: item.page_number, width: item.dimensions?.width ?? null, height: item.dimensions?.height ?? null, thumbnailUrl: item.thumbnail?.url ?? null }));
  return { items, validEightPageMaster: items.length === 8 && items.every((item, index) => item.pageNumber === index + 1 && item.width === 1080 && item.height === 1350) };
}
export async function getCanvaDataset(db: DB, source: { type: "design" | "brand_template"; id: string }, options: CanvaRestOptions = {}): Promise<CanvaDataset> {
  const parsed = validate(sourceSchema, source, true);
  const value = validate(z.object({ dataset: z.record(fieldKeySchema, z.object({ type: z.string().min(1).max(80) })).optional() }), await rest(db, `/${parsed.type === "design" ? "designs" : "brand-templates"}/${parsed.id}/dataset`, options));
  const entries = Object.entries(value.dataset ?? {});
  if (entries.length > 200) throw new CanvaRestError("Canva 템플릿 필드가 지원 한도를 초과했습니다.", 502, "invalid_response");
  return Object.fromEntries(entries.map(([key, field]) => [key, { type: ["text", "image", "chart", "sheet"].includes(field.type) ? field.type : "unknown" }]));
}
function job<T>(response: unknown, kind: "autofill" | "export" | "asset", submitted: boolean, expectedId?: string): CanvaRestJob<T> {
  const raw = object(response) && object(response.job) ? response.job : null;
  const possibleId = idSchema.safeParse(raw?.id);
  const id = possibleId.success ? possibleId.data : null;
  const header = validate(jobHeaderSchema, raw, false, id, submitted);
  if (expectedId && header.id !== expectedId) throw new CanvaRestError("요청한 Canva 작업과 응답 ID가 다릅니다.", 502, "invalid_response", submitted, expectedId);
  if (header.status === "failed") return { ...header, errorCode: "job_failed" };
  if (header.status === "in_progress") return header;
  let result: CanvaAutofillResult | CanvaExportResult | CanvaAssetResult;
  if (kind === "autofill") {
    const parsed = validate(z.object({ type: z.literal("create_design"), design: z.object({ id: idSchema, urls: linksSchema.optional(), url: canvaUrl.optional() }) }), raw!.result, false, header.id, submitted);
    result = { designId: parsed.design.id, editUrl: parsed.design.urls?.edit_url ?? parsed.design.url ?? null, viewUrl: parsed.design.urls?.view_url ?? null };
  } else if (kind === "export") {
    const urls = validate(z.array(canvaUrl).min(1).max(8), raw!.urls, false, header.id, submitted);
    result = { urls };
  } else {
    const asset = validate(z.object({ id: idSchema, type: z.literal("image") }), raw!.asset, false, header.id, submitted);
    result = { assetId: asset.id };
  }
  return { ...header, result: result as T };
}
export async function submitCanvaAutofill(db: DB, input: { type: "design" | "brand_template"; id: string; title: string; data: Record<string, CanvaField> }, options: CanvaRestOptions = {}): Promise<CanvaRestJob<CanvaAutofillResult>> {
  const parsed = validate(sourceSchema.extend({ title: z.string().min(1).max(255), data: inputDataSchema }).strict(), input, true);
  const body = { type: parsed.type === "design" ? "create_from_design" : "create_from_brand_template", ...(parsed.type === "design" ? { design_id: parsed.id } : { brand_template_id: parsed.id }), title: parsed.title, data: parsed.data };
  if (Buffer.byteLength(JSON.stringify(body)) > 256000) throw new CanvaRestError("Canva 자동 채우기 입력이 너무 큽니다.", 400, "invalid_request");
  return job(await rest(db, "/autofills", options, { method: "POST", json: body }), "autofill", true);
}
export async function getCanvaAutofillJob(db: DB, jobId: string, options: CanvaRestOptions = {}): Promise<CanvaRestJob<CanvaAutofillResult>> {
  return job(await rest(db, `/autofills/${validId(jobId)}`, options), "autofill", false, jobId);
}
export async function submitCanvaExport(db: DB, designId: string, options: CanvaRestOptions = {}): Promise<CanvaRestJob<CanvaExportResult>> {
  return job(await rest(db, "/exports", options, { method: "POST", json: { design_id: validId(designId), format: { type: "png", width: 1080, height: 1350, as_single_image: false, pages: [1, 2, 3, 4, 5, 6, 7, 8] } } }), "export", true);
}
export async function getCanvaExportJob(db: DB, jobId: string, options: CanvaRestOptions = {}): Promise<CanvaRestJob<CanvaExportResult>> {
  return job(await rest(db, `/exports/${validId(jobId)}`, options), "export", false, jobId);
}
export async function submitCanvaAssetUpload(db: DB, bytes: Buffer, name: string, options: CanvaRestOptions = {}): Promise<CanvaRestJob<CanvaAssetResult>> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 20_000_000) throw new CanvaRestError("Canva 이미지 파일은 1바이트 이상 20MB 이하여야 합니다.", 400, "invalid_request");
  validate(z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f]/.test(value)), name, true);
  return job(await rest(db, "/asset-uploads", options, { method: "POST", bytes, name }), "asset", true);
}
export async function getCanvaAssetUploadJob(db: DB, jobId: string, options: CanvaRestOptions = {}): Promise<CanvaRestJob<CanvaAssetResult>> {
  return job(await rest(db, `/asset-uploads/${validId(jobId)}`, options), "asset", false, jobId);
}
