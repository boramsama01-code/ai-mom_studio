/**
 * Canva Connect API — 자동 채우기(Autofill)와 내보내기(Export)
 * 문서: https://www.canva.dev/docs/connect/
 *
 * - OAuth 2.0 Authorization Code + PKCE(s256), 토큰 교환은 Basic 인증(client id:secret)
 * - 리프레시 토큰은 한 번만 쓸 수 있으므로 갱신할 때마다 새 토큰을 저장
 * - 토큰은 연결 키 저장소(암호화)에 보관, 화면·로그에 노출하지 않음
 * - 자동 채우기는 Canva Pro/Teams/Enterprise 계정의 "브랜드 템플릿"에서 동작(Canva 정책)
 */
import crypto from "node:crypto";
import type { DB } from "../db";
import { saveSecret, deleteSecret } from "../secretStore";

export const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
export const CANVA_API = "https://api.canva.com/rest/v1";
export const CANVA_SCOPES = ["design:content:read", "design:content:write", "design:meta:read", "brandtemplate:meta:read", "brandtemplate:content:read"];

export class CanvaError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
  }
}

export function canvaConfigured() {
  return !!(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET);
}
export function canvaConnected() {
  return !!process.env.CANVA_REFRESH_TOKEN;
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
  u.searchParams.set("client_id", process.env.CANVA_CLIENT_ID ?? "");
  u.searchParams.set("state", a.state);
  u.searchParams.set("redirect_uri", a.redirectUri);
  return u.toString();
}

function basicAuth() {
  return "Basic " + Buffer.from(`${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`).toString("base64");
}

async function saveTokens(db: DB, j: { access_token: string; refresh_token: string; expires_in: number }) {
  await saveSecret(db, "CANVA_ACCESS_TOKEN", j.access_token, "canva");
  await saveSecret(db, "CANVA_REFRESH_TOKEN", j.refresh_token, "canva");
  await saveSecret(db, "CANVA_TOKEN_EXPIRES_AT", String(Date.now() + j.expires_in * 1000), "canva");
}

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${CANVA_API}/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string; message?: string };
  if (!res.ok || !j.access_token || !j.refresh_token) throw new CanvaError(`Canva 토큰 발급 실패: ${j.error_description ?? j.message ?? j.error ?? res.status}`, res.status);
  return j as { access_token: string; refresh_token: string; expires_in: number };
}

export async function exchangeCode(db: DB, a: { code: string; verifier: string; redirectUri: string }, fetchImpl: typeof fetch = fetch) {
  const j = await tokenRequest({ grant_type: "authorization_code", code: a.code, code_verifier: a.verifier, redirect_uri: a.redirectUri }, fetchImpl);
  await saveTokens(db, j);
}

let refreshing: Promise<string> | null = null;
export async function accessToken(db: DB, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!canvaConfigured()) throw new CanvaError("Canva 앱 정보(Client ID/Secret)가 없습니다.");
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
      res.status === 403 ? `권한 부족(Canva 요금제 또는 연결 시 허용한 권한 확인): ${j.message ?? ""}` :
      res.status === 404 ? "Canva에서 템플릿/디자인을 찾을 수 없습니다(ID 확인)." :
      res.status === 429 ? "Canva 호출 한도 초과 — 잠시 후 다시 시도하세요." :
      `Canva 오류(HTTP ${res.status}): ${j.message ?? ""}`;
    throw new CanvaError(msg, res.status, j.code);
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
  if (job.job.status === "failed") throw new CanvaError(`Canva 자동 채우기 실패: ${job.job.error?.message ?? ""}`);
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
  if (job.job.status !== "success" || !job.job.urls?.length) throw new CanvaError(`Canva 내보내기 실패: ${job.job.error?.message ?? job.job.status}`);
  return job.job.urls[0];
}

