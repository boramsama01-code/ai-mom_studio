/**
 * Canva Connect API — 자동 채우기(Autofill)와 내보내기(Export)
 * 문서: https://www.canva.dev/docs/apps/rest-apis/
 *
 * - OAuth 2.0 Authorization Code + PKCE(s256), 토큰 교환은 Basic 인증(client id:secret)
 * - 리프레시 토큰은 한 번만 쓸 수 있으므로 갱신할 때마다 새 토큰을 저장
 * - 토큰은 연결 키 저장소(암호화)에 보관, 화면·로그에 노출하지 않음
 * - 자동 채우기는 dataset 필드가 있는 디자인·브랜드 템플릿을 지원한다.
 *   플랜 이름으로 추측하지 않고 현재 OAuth 사용자의 autofill capability를 확인한다.
 */
import crypto from "node:crypto";
import type { DB } from "../db";
import { saveSecret, deleteSecret } from "../secretStore";

export const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
export const CANVA_API = "https://api.canva.com/rest/v1";
export const CANVA_SCOPES = ["design:content:read", "design:content:write", "design:meta:read", "brandtemplate:meta:read", "brandtemplate:content:read", "profile:read", "asset:read", "asset:write", "folder:read"];

export class CanvaError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
  }
}

/** Detect missing settings and known placeholders, not undocumented ID formats.
 * Never return stored credentials in an operator-facing diagnostic. */
export function canvaConfigurationProblem(): string | null {
  const id = process.env.CANVA_CLIENT_ID?.trim();
  if (!id || !process.env.CANVA_CLIENT_SECRET?.trim()) return "Canva 개발자 앱에서 발급한 Client ID와 Client secret을 연결 설정에 등록해 주세요.";
  if (["aimom", "your_client_id", "your-client-id", "client_id", "changeme"].includes(id.toLowerCase()))
    return "Canva 앱 ID에 임시값이 등록되어 있습니다. Canva 개발자 앱에서 실제 Client ID와 Client secret을 발급받아 연결 설정을 바꿔 주세요. Canva 계정 이름이나 앱 이름은 Client ID로 사용할 수 없습니다.";
  return null;
}
export function canvaConfigured() { return canvaConfigurationProblem() === null; }
export function canvaConnected() {
  return canvaConfigured() && !!process.env.CANVA_REFRESH_TOKEN?.trim();
}

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(a: { challenge: string; state: string; redirectUri: string }) {
  const u = new URL(CANVA_AUTH_URL);
  u.searchParams.set("code_challenge", a.challenge);
  u.searchParams.set("code_challenge_method", "s256");
  u.searchParams.set("scope", CANVA_SCOPES.join(" "));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.CANVA_CLIENT_ID?.trim() ?? "");
  u.searchParams.set("state", a.state);
  u.searchParams.set("redirect_uri", a.redirectUri);
  return u.toString();
}

function basicAuth() {
  return "Basic " + Buffer.from(`${process.env.CANVA_CLIENT_ID?.trim()}:${process.env.CANVA_CLIENT_SECRET?.trim()}`).toString("base64");
}

async function saveTokens(db: DB, j: { access_token: string; refresh_token: string; expires_in: number }) {
  await saveSecret(db, "CANVA_ACCESS_TOKEN", j.access_token, "canva");
  await saveSecret(db, "CANVA_REFRESH_TOKEN", j.refresh_token, "canva");
  await saveSecret(db, "CANVA_TOKEN_EXPIRES_AT", String(Date.now() + j.expires_in * 1000), "canva");
}

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch) {
  const problem = canvaConfigurationProblem();
  if (problem) throw new CanvaError(problem, 400, "not_configured");
  let res: Response;
  try { res = await fetchImpl(`${CANVA_API}/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  }); } catch { throw new CanvaError("Canva 인증 응답을 받지 못했습니다. 계정 연결 상태를 확인해 주세요.", undefined, "auth_response_unknown"); }
  const payload: unknown = await res.json().catch(() => null);
  const j = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (!res.ok) {
    // Only documented OAuth error names may leave this boundary. Provider
    // descriptions can contain credentials and must never reach UI or logs.
    const reasons: Record<string, string> = {
      invalid_client: "Client ID와 Client secret이 같은 Canva 앱의 값인지 확인해 주세요.",
      invalid_access_token: "Canva가 앱 인증 정보를 거절했습니다. Client ID와 Client secret을 확인해 주세요.",
      invalid_grant: "인증 코드·갱신 토큰 또는 PKCE 검증이 거절됐습니다. 다시 연결하고 콜백 주소를 확인해 주세요.",
      invalid_scope: "Canva 앱에 등록한 권한과 연결 시 요청한 권한이 일치하는지 확인해 주세요.",
      invalid_request: "인증 요청 형식과 Canva 앱의 콜백 주소를 확인해 주세요.",
      invalid_field: "Canva가 인증 요청의 필수 항목을 거절했습니다. 앱 키와 인증 요청 항목을 확인해 주세요.",
      bad_request_body: "Canva 인증 요청 본문의 형식을 확인해 주세요.",
      unauthorized_client: "이 Canva 앱에서 현재 인증 방식을 사용할 수 있는지 개발자 설정을 확인해 주세요.",
      unauthorized_user: "현재 Canva 계정의 앱 접근 권한을 확인해 주세요.",
      unsupported_grant_type: "Canva 인증 요청의 grant_type을 확인해 주세요.",
      too_many_requests: "Canva 호출 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.",
    };
    // Canva's REST token endpoint returns { code, message }; standard OAuth
    // providers may instead return { error, error_description }.
    const reason = [j.code, j.error].find((value): value is string => typeof value === "string" && Object.hasOwn(reasons, value)) ?? null;
    const advice = reason ? reasons[reason] : res.status === 429 ? "Canva 호출 한도에 도달했습니다. 잠시 후 다시 확인해 주세요." : res.status >= 500 ? "Canva 인증 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 확인해 주세요." : "Canva 앱의 연결 설정을 확인해 주세요.";
    throw new CanvaError(`Canva 인증 요청이 거절되었습니다(HTTP ${res.status}${reason ? `, ${reason}` : ""}). ${advice}`, res.status, "auth_required");
  }
  if (typeof j.access_token !== "string" || !j.access_token.trim() || typeof j.refresh_token !== "string" || !j.refresh_token.trim() || !Number.isFinite(j.expires_in) || Number(j.expires_in) <= 0)
    throw new CanvaError("Canva 인증 서버의 응답 형식을 확인할 수 없습니다. 연결을 완료한 것으로 처리하지 않았습니다.", res.status, "auth_invalid_response");
  return j as { access_token: string; refresh_token: string; expires_in: number };
}

export async function exchangeCode(db: DB, a: { code: string; verifier: string; redirectUri: string }, fetchImpl: typeof fetch = fetch) {
  const j = await tokenRequest({ grant_type: "authorization_code", code: a.code, code_verifier: a.verifier, redirect_uri: a.redirectUri }, fetchImpl);
  await saveTokens(db, j);
}

let refreshing: Promise<string> | null = null;
export async function accessToken(db: DB, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!canvaConfigured()) throw new CanvaError(canvaConfigurationProblem() ?? "Canva 앱 정보(Client ID/Secret)가 없습니다.");
  if (!canvaConnected()) throw new CanvaError("Canva 계정이 연결되지 않았습니다. 채널 설정에서 'Canva 연결'을 눌러 주세요.");
  const exp = Number(process.env.CANVA_TOKEN_EXPIRES_AT || 0);
  if (process.env.CANVA_ACCESS_TOKEN && exp - Date.now() > 60_000) return process.env.CANVA_ACCESS_TOKEN;
  // 리프레시 토큰은 1회용 → 동시에 두 번 갱신하지 않도록 묶음
  refreshing ??= (async () => {
    try {
      const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: process.env.CANVA_REFRESH_TOKEN! }, fetchImpl);
      await saveTokens(db, j);
      return j.access_token;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function disconnectCanva(db: DB) {
  for (const k of ["CANVA_ACCESS_TOKEN", "CANVA_REFRESH_TOKEN", "CANVA_TOKEN_EXPIRES_AT"]) await deleteSecret(db, k).catch(() => undefined);
}

async function api<T>(db: DB, path: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const token = await accessToken(db, fetchImpl);
  const res = await fetchImpl(`${CANVA_API}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string };
  if (!res.ok) {
    const msg =
      res.status === 401 ? "Canva 인증이 만료되었습니다. 다시 연결하세요." :
      res.status === 403 ? "Canva 권한이 부족합니다. 현재 계정·팀, 기능 이용 가능 여부와 연결 권한을 확인하세요." :
      res.status === 404 ? "Canva에서 템플릿/디자인을 찾을 수 없습니다(ID 확인)." :
      res.status === 429 ? "Canva 호출 한도 초과 — 잠시 후 다시 시도하세요." :
      `Canva 요청을 완료하지 못했습니다(HTTP ${res.status}). 기존 콘텐츠를 확인한 뒤 작업 결과를 다시 조회하세요.`;
    throw new CanvaError(msg, res.status, "request_failed");
  }
  return j;
}

export type BrandTemplate = { id: string; title: string; thumbnail?: { url: string } };

export async function listBrandTemplates(db: DB, fetchImpl?: typeof fetch) {
  const j = await api<{ items: BrandTemplate[] }>(db, "/brand-templates", {}, fetchImpl);
  return j.items ?? [];
}

export async function brandTemplateDataset(db: DB, id: string, fetchImpl?: typeof fetch) {
  const j = await api<{ dataset: Record<string, { type: string }> }>(db, `/brand-templates/${encodeURIComponent(id)}/dataset`, {}, fetchImpl);
  return j.dataset ?? {};
}

type AutofillJob = { job: { id: string; status: "in_progress" | "success" | "failed"; result?: { design?: { id: string; url?: string; urls?: { edit_url?: string; view_url?: string } } }; error?: { message?: string } } };

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** 브랜드 템플릿에 글자 채워 새 디자인 만들기 → 편집 링크 반환 */
export async function autofillFromBrandTemplate(
  db: DB,
  a: { brandTemplateId: string; title: string; fields: Record<string, string>; pollMs?: number },
  fetchImpl?: typeof fetch,
) {
  const dataset = await brandTemplateDataset(db, a.brandTemplateId, fetchImpl);
  const data: Record<string, { type: "text"; text: string }> = {};
  const used: string[] = [];
  for (const [name, def] of Object.entries(dataset)) {
    if (def.type !== "text") continue;
    const v = a.fields[name];
    if (v === undefined || v === "") continue;
    data[name] = { type: "text", text: v };
    used.push(name);
  }
  if (!used.length) throw new CanvaError(`템플릿의 글자 필드 이름이 콘텐츠 항목과 하나도 맞지 않습니다. 템플릿 필드: ${Object.keys(dataset).join(", ") || "(없음)"}`);
  let job = await api<AutofillJob>(db, "/autofills", { method: "POST", body: { type: "create_from_brand_template", brand_template_id: a.brandTemplateId, title: a.title.slice(0, 255), data } }, fetchImpl);
  const deadline = Date.now() + 45_000;
  while (job.job.status === "in_progress" && Date.now() < deadline) {
    await sleep(a.pollMs ?? 1500);
    job = await api<AutofillJob>(db, `/autofills/${job.job.id}`, {}, fetchImpl);
  }
  if (job.job.status === "failed") throw new CanvaError("Canva 자동 채우기가 실패했습니다. 템플릿 필드와 연결 계정을 확인하세요.", undefined, "job_failed");
  if (job.job.status !== "success" || !job.job.result?.design) throw new CanvaError("Canva 자동 채우기가 아직 끝나지 않았습니다. 잠시 후 다시 시도하세요.");
  const d = job.job.result.design;
  return { designId: d.id, editUrl: d.urls?.edit_url ?? d.url ?? null, viewUrl: d.urls?.view_url ?? null, usedFields: used, unusedTemplateFields: Object.keys(dataset).filter((k) => !used.includes(k)) };
}

type ExportJob = { job: { id: string; status: "in_progress" | "success" | "failed"; urls?: string[]; error?: { message?: string } } };

/** 디자인을 PNG로 내보내고 다운로드 주소 반환(24시간 유효) */
export async function exportDesignPng(db: DB, designId: string, a: { pollMs?: number } = {}, fetchImpl?: typeof fetch): Promise<string> {
  let job: ExportJob;
  try {
    job = await api<ExportJob>(db, "/exports", { method: "POST", body: { design_id: designId, format: { type: "png", width: 1080, height: 1350 } } }, fetchImpl);
  } catch (e) {
    // 디자인 비율이 달라 크기 지정이 거부되면 원래 크기로 내보낸 뒤 서버에서 맞춘다
    if ((e as CanvaError).status !== 400) throw e;
    job = await api<ExportJob>(db, "/exports", { method: "POST", body: { design_id: designId, format: { type: "png" } } }, fetchImpl);
  }
  const deadline = Date.now() + 60_000;
  while (job.job.status === "in_progress" && Date.now() < deadline) {
    await sleep(a.pollMs ?? 2000);
    job = await api<ExportJob>(db, `/exports/${job.job.id}`, {}, fetchImpl);
  }
  if (job.job.status !== "success" || !job.job.urls?.length) throw new CanvaError("Canva 내보내기 결과를 확인할 수 없습니다. 저장된 작업의 상태를 확인하세요.", undefined, "job_failed");
  return job.job.urls[0];
}

