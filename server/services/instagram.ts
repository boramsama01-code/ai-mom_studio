import { altTextError } from "../../shared/altText";
/**
 * Instagram 게시 — 기존 Instagram Login과 Meta Unified Login을 명시적으로 구분한다.
 * 저장한 authMode에 따라 호스트를 고르며 토큰 문자열로 방식을 추정하지 않는다.
 * 흐름: 컨테이너 생성 → creation_id 즉시 보관 → 상태 폴링 → FINISHED 확인 → publish → media_id 저장
 * API 버전은 INSTAGRAM_API_VERSION으로 지정(코드에 최신 버전을 가정하지 않음).
 * 문서: https://developers.facebook.com/docs/instagram-platform/content-publishing/
 */
import { env } from "../env";

export type InstagramAuthMode = "instagram" | "facebook";
const HOSTS: Record<InstagramAuthMode, string> = { instagram: "https://graph.instagram.com", facebook: "https://graph.facebook.com" };
const INSTAGRAM_USERNAME = /^[a-zA-Z0-9._]{1,30}$/;
const MAX_IDENTITY_LOOKUPS = 10;

/**
 * Lookup hints observed in the operator's Meta app dashboard on 2026-11-03.
 * These IDs select a request target; they are never evidence of token access.
 * Only a complete empty assigned list may use a hint, followed by fresh exact
 * profile validation AND a publishing-limit GET requiring both instagram_basic
 * and instagram_content_publish with the same token.
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started/
 * https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
 */
const INSTAGRAM_TARGET_HINTS = new Map<string, string>([
  ["spacepenguin.co", "17841458158640250"],
  ["alligodang.official", "17841444569239069"],
  ["highscoop.official", "17841416940240854"],
  ["fryday.official.kr", "17841474286823201"],
]);

function instagramId(value: unknown): string | undefined {
  // Graph normally returns strings. Never turn an already rounded JSON number
  // into a different account ID (Instagram IDs can exceed MAX_SAFE_INTEGER).
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

/** Read the account identity from the token, never accept a user-entered account ID. */
export async function accountIdentity(token: string, authMode: InstagramAuthMode = "instagram", expectedUsername?: string, fetchImpl: typeof fetch = fetch) {
  if (authMode === "facebook") {
    const accounts = new Map<string, { userId: string; username?: string }>();
    const normalized = expectedUsername?.trim().replace(/^@/, "").toLowerCase();
    const invalidResponse = () => ({ ok: false as const, error: "Meta에서 받은 계정 정보가 완전하지 않거나 서로 일치하지 않습니다. 잠시 후 다시 연결해 주세요.", reason: "invalid_account_response" as const });
    const incompleteIdentity = () => ({ ok: false as const, error: "Meta 계정 목록은 받았지만 일부 계정의 사용자명을 확인하지 못했습니다. 잠시 후 다시 연결하거나 Meta에서 연결할 계정만 선택해 다시 인증해 주세요.", reason: "account_identity_incomplete" as const });
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await igFetch("me/assigned_instagram_accounts", "GET", { fields: "id,username", limit: "100", ...(after ? { after } : {}) }, token, authMode, fetchImpl);
      if (!result.ok) return { ok: false as const, error: "Meta 계정 권한을 확인하지 못했습니다. 통합 로그인에서 이 인스타그램 계정을 선택하고 다시 연결하세요." + lookupFailureDiagnostic("assigned_accounts", result) };
      if (!Array.isArray(result.json.data)) return invalidResponse();
      const paging = result.json.paging;
      if (paging !== undefined && (!paging || typeof paging !== "object" || Array.isArray(paging))) return invalidResponse();
      if (paging?.next !== undefined && (typeof paging.next !== "string" || !paging.next)) return invalidResponse();
      if (paging?.cursors !== undefined && (!paging.cursors || typeof paging.cursors !== "object" || Array.isArray(paging.cursors))) return invalidResponse();
      if (paging?.cursors?.after !== undefined && (typeof paging.cursors.after !== "string" || !paging.cursors.after)) return invalidResponse();
      for (const entry of result.json.data) {
        const userId = instagramId(entry?.id);
        if (!userId) return invalidResponse();
        const username = typeof entry?.username === "string" && INSTAGRAM_USERNAME.test(entry.username) ? entry.username : undefined;
        const existing = accounts.get(userId);
        if (existing?.username && username && existing.username.toLowerCase() !== username.toLowerCase()) return invalidResponse();
        accounts.set(userId, { userId, username: existing?.username ?? username });
      }
      const next = result.json.paging?.cursors?.after;
      if (!result.json.paging?.next) break;
      if (typeof next !== "string" || !next || next === after || page === 9) return { ok: false as const, error: "Meta 계정 목록을 모두 확인하지 못했습니다. 연결할 계정만 선택해 다시 인증하세요.", reason: "account_list_incomplete" as const };
      after = next;
    }
    if (accounts.size === 0) {
      const targetId = normalized ? INSTAGRAM_TARGET_HINTS.get(normalized) : undefined;
      if (!targetId) return { ok: false as const, error: "이 토큰에서 연결 가능한 인스타그램 계정 목록이 비어 있습니다. 토큰을 발급한 Meta 앱과 로그인한 인스타그램 계정을 확인해 주세요.", reason: "no_assigned_accounts" as const };
      const profile = await igFetch(targetId, "GET", { fields: "id,username" }, token, authMode, fetchImpl);
      if (!profile.ok) return { ok: false as const, error: "Meta 계정 목록은 비어 있고, 이 토큰으로 대상 계정 정보를 직접 조회하지 못했습니다. 토큰을 발급한 Meta 앱과 해당 계정의 접근 권한을 확인해 주세요." + lookupFailureDiagnostic("direct_profile", profile), reason: "direct_account_access_failed" as const };
      const userId = instagramId(profile.json.id), username = profile.json.username;
      if (!userId || typeof username !== "string" || !INSTAGRAM_USERNAME.test(username)) return invalidResponse();
      if (userId !== targetId || username.toLowerCase() !== normalized) return { ok: false as const, error: "Meta에서 직접 확인한 계정이 이 채널의 게시 계정과 일치하지 않습니다. 인스타그램 연결 정보를 확인해 주세요.", reason: "account_mismatch" as const };
      // Enforce publishing access here, including identity-only worker callers.
      // Profile readability alone must never authorize this alternate path.
      const quota = await publishingLimit(userId, token, authMode, fetchImpl);
      if (!quota.ok) return { ok: false as const, error: "대상 계정 정보는 확인했지만 게시 API 접근을 확인하지 못했습니다. Meta에서 instagram_basic과 instagram_content_publish 권한을 확인해 주세요.", reason: "direct_publish_access_failed" as const };
      return { ok: true as const, userId, username };
    }

    const unresolved = [...accounts.values()].filter(account => !account.username);
    if (unresolved.length > MAX_IDENTITY_LOOKUPS) return incompleteIdentity();
    // A nonempty list only resolves IDs returned by the assigned-account edge,
    // on the same host and with the same token; target hints cannot replace it.
    const profiles = await Promise.all(unresolved.map(account => igFetch(account.userId, "GET", { fields: "id,username" }, token, authMode, fetchImpl)));
    for (let index = 0; index < unresolved.length; index++) {
      const account = unresolved[index], profile = profiles[index];
      if (!profile.ok) return incompleteIdentity();
      if (instagramId(profile.json.id) !== account.userId) return invalidResponse();
      const username = profile.json.username;
      if (typeof username !== "string" || !INSTAGRAM_USERNAME.test(username)) return incompleteIdentity();
      account.username = username;
    }
    const verified = [...accounts.values()].filter((account): account is { userId: string; username: string } => typeof account.username === "string");
    const matches = verified.filter(a => !normalized || a.username.toLowerCase() === normalized);
    if (matches.length > 1) return { ok: false as const, error: normalized ? "같은 사용자명으로 여러 계정 ID가 반환되어 게시 계정을 확정할 수 없습니다. Meta에서 연결할 계정을 확인해 주세요." : "여러 인스타그램 계정이 확인됐습니다. 연결할 계정을 지정해 주세요.", reason: "ambiguous_account" as const };
    if (matches.length === 0) {
      const handles = [...new Set(verified.map(account => account.username.toLowerCase()))];
      const shown = handles.slice(0, 5).map(username => `@${username}`).join(", ") + (handles.length > 5 ? ` 외 ${handles.length - 5}개` : "");
      const target = normalized && INSTAGRAM_USERNAME.test(normalized) ? `@${normalized}` : "선택한 계정";
      return { ok: false as const, error: `이 토큰에서 확인한 계정: ${shown}. 연결하려는 ${target}이 목록에 없습니다. Meta에서 로그인한 계정과 선택한 게시 계정을 확인해 주세요.`, reason: "account_mismatch" as const };
    }
    return { ok: true as const, ...matches[0] };
  }
  const result = await igFetch("me", "GET", { fields: "user_id,username" }, token, "instagram", fetchImpl);
  if (!result.ok) return { ok: false as const, error: result.err.kind === "token_expired" ? "토큰이 만료됐습니다. Instagram Login 토큰을 다시 발급해 주세요." : "인스타그램 계정 인증에 실패했습니다. 토큰과 권한을 확인하세요." };
  const userId = String(result.json.user_id ?? "");
  const username = String(result.json.username ?? "");
  if (!/^\d+$/.test(userId) || !/^[a-zA-Z0-9._]{1,30}$/.test(username)) return { ok: false as const, error: "계정 정보를 확인할 수 없습니다. Instagram Login 방식의 토큰이 필요합니다." };
  return { ok: true as const, userId, username };
}

export type IgError = { kind: "not_configured" | "auth" | "token_expired" | "rate_limit" | "limit_reached" | "terminal" | "transient" | "unknown"; error: string };
type IgFailureDiagnostic = { httpStatus?: number; graphCode?: number; graphSubcode?: number };

function safeGraphErrorNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Only local stage names, HTTP status, numeric provider codes and transport state reach the UI. */
function lookupFailureDiagnostic(stage: "assigned_accounts" | "direct_profile", failure: { lost: boolean; diagnostic?: IgFailureDiagnostic }) {
  const { httpStatus, graphCode, graphSubcode } = failure.diagnostic ?? {};
  return ` [진단: ${stage} / HTTP ${httpStatus ?? "-"} / Graph ${graphCode ?? "-"} / subcode ${graphSubcode ?? "-"} / lost=${failure.lost ? "true" : "false"}]`;
}

function providerFailureDiagnostic(status: number, body: { error?: unknown }): IgFailureDiagnostic {
  const e = body.error && typeof body.error === "object" && !Array.isArray(body.error) ? body.error as Record<string, unknown> : {};
  const graphCode = safeGraphErrorNumber(e.code), graphSubcode = safeGraphErrorNumber(e.error_subcode);
  // Never copy provider message/type/trace/URLs or arbitrary response fields.
  return {
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
    ...(graphCode !== undefined ? { graphCode } : {}),
    ...(graphSubcode !== undefined ? { graphSubcode } : {}),
  };
}

function classify(status: number, body: { error?: { code?: number; error_subcode?: number; message?: string; type?: string } }): IgError {
  const e = body.error || {};
  const msg = (e.message || `HTTP ${status}`).slice(0, 300);
  if (e.code === 190) return { kind: "token_expired", error: `액세스 토큰 만료·무효: ${msg}` };
  if (e.code === 10 || e.code === 200 || status === 403) return { kind: "auth", error: `권한 부족: ${msg}` };
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || status === 429) return { kind: "rate_limit", error: `호출 한도: ${msg}` };
  if (e.code === 9 && e.error_subcode === 2207042) return { kind: "limit_reached", error: `게시 한도 도달: ${msg}` };
  if (status >= 500 || e.code === 1 || e.code === 2) return { kind: "transient", error: msg };
  return { kind: "terminal", error: msg };
}

async function igFetch(path: string, method: "GET" | "POST", params: Record<string, string>, token: string, authMode: InstagramAuthMode = "instagram", fetchImpl: typeof fetch = fetch) {
  if (!env.instagramApiVersion) throw Object.assign(new Error("INSTAGRAM_API_VERSION 미설정"), { ig: { kind: "not_configured", error: "INSTAGRAM_API_VERSION 미설정" } as IgError });
  const url = new URL(`${HOSTS[authMode]}/${env.instagramApiVersion}/${path}`);
  let init: RequestInit = { method, signal: AbortSignal.timeout(30_000), redirect: "error", ...(authMode === "facebook" ? { headers: { authorization: `Bearer ${token}` } } : {}) };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (authMode === "instagram") url.searchParams.set("access_token", token);
  } else {
    const body = new URLSearchParams({ ...params, ...(authMode === "instagram" ? { access_token: token } : {}) });
    init = { ...init, body, headers: { ...init.headers, "content-type": "application/x-www-form-urlencoded" } };
  }
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch {
    return { ok: false as const, lost: true, err: { kind: "unknown", error: "응답을 받지 못함" } as IgError };
  }
  const parsed: unknown = await res.json().catch(() => null);
  const json = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  if (!res.ok || json.error) return { ok: false as const, lost: false, err: classify(res.status, json), diagnostic: providerFailureDiagnostic(res.status, json) };
  return { ok: true as const, json };
}

export async function createContainer(userId: string, token: string, imageUrl: string, caption: string, altText?: string, authMode: InstagramAuthMode = "instagram") {
  if(altText!==undefined&&!!altTextError(altText))return {ok:false as const,lost:false,err:{kind:"terminal",error:"대체텍스트는 1~2문장, 공백 포함 125자 이내로 작성해 주세요."} as IgError};
  const r = await igFetch(`${userId}/media`, "POST", { image_url: imageUrl, caption, ...(altText?.trim()?{alt_text:altText.trim()}: {}) }, token, authMode);
  if (!r.ok) return r;
  return { ok: true as const, containerId: String(r.json.id) };
}

export async function createCarouselContainer(userId: string, token: string, imageUrls: string[], caption: string, altTexts?: string[], authMode: InstagramAuthMode = "instagram") {
  if(altTexts&&(altTexts.length!==imageUrls.length||altTexts.some(v=>!!altTextError(v))))return {ok:false as const,lost:false,err:{kind:"terminal",error:"각 이미지의 대체텍스트를 1~2문장, 공백 포함 125자 이내로 작성해 주세요."} as IgError};
  if (imageUrls.length < 2 || imageUrls.length > 10) return { ok: false as const, lost: false, err: { kind: "terminal", error: "카드뉴스는 2~10장이어야 합니다." } as IgError };
  const children: string[] = [];
  for (const [index,image_url] of imageUrls.entries()) {
    const child = await igFetch(`${userId}/media`, "POST", { image_url, is_carousel_item: "true", ...(altTexts?.[index]?.trim()?{alt_text:altTexts[index].trim()}: {}) }, token, authMode);
    if (!child.ok) return child;
    if (!child.json.id) return { ok: false as const, lost: false, err: { kind: "transient", error: "하위 이미지 컨테이너 ID를 받지 못했습니다." } as IgError };
    children.push(String(child.json.id));
  }
  const parent = await igFetch(`${userId}/media`, "POST", { media_type: "CAROUSEL", children: children.join(","), caption }, token, authMode);
  if (!parent.ok) return parent;
  if (!parent.json.id) return { ok: false as const, lost: false, err: { kind: "transient", error: "카드뉴스 컨테이너 ID를 받지 못했습니다." } as IgError };
  return { ok: true as const, containerId: String(parent.json.id) };
}

export async function containerStatus(containerId: string, token: string, authMode: InstagramAuthMode = "instagram") {
  const r = await igFetch(containerId, "GET", { fields: "status_code,status" }, token, authMode);
  if (!r.ok) return r;
  return { ok: true as const, statusCode: String(r.json.status_code || ""), status: String(r.json.status || "") };
}

export async function publishContainer(userId: string, token: string, containerId: string, authMode: InstagramAuthMode = "instagram") {
  const r = await igFetch(`${userId}/media_publish`, "POST", { creation_id: containerId }, token, authMode);
  if (!r.ok) return r;
  return { ok: true as const, mediaId: String(r.json.id) };
}

export async function mediaPermalink(mediaId: string, token: string, authMode: InstagramAuthMode = "instagram"): Promise<string | null> {
  const r = await igFetch(mediaId, "GET", { fields: "permalink" }, token, authMode);
  return r.ok ? (r.json.permalink as string) ?? null : null;
}

export async function publishingLimit(userId: string, token: string, authMode: InstagramAuthMode = "instagram", fetchImpl: typeof fetch = fetch) {
  const r = await igFetch(`${userId}/content_publishing_limit`, "GET", { fields: "quota_usage,config" }, token, authMode, fetchImpl);
  if (!r.ok) return r;
  const d = (Array.isArray(r.json.data) ? r.json.data[0] : undefined) || {};
  if (!Number.isFinite(d.quota_usage) || !Number.isFinite(d.config?.quota_total) || d.quota_usage < 0 || d.config.quota_total <= 0) return { ok: false as const, lost: false, err: { kind: "auth", error: "게시 API 한도 응답을 확인할 수 없습니다." } as IgError };
  return { ok: true as const, used: Number(d.quota_usage ?? 0), total: Number(d.config?.quota_total ?? 0) };
}

/**
 * 컨테이너 상태를 제한 시간 동안만 폴링(점진 대기). 끝나지 않으면 "처리 중"으로 남겨 다음 실행에서 이어간다.
 * 컨테이너는 생성 후 24시간 유효.
 */
export async function waitForContainer(containerId: string, token: string, budgetMs = 90_000, authMode: InstagramAuthMode = "instagram"): Promise<{ state: "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | "UNKNOWN"; detail?: string; err?: IgError }> {
  const start = Date.now();
  let wait = 3000;
  for (;;) {
    const s = await containerStatus(containerId, token, authMode);
    if (!s.ok) return { state: "UNKNOWN", err: s.err };
    if (["FINISHED", "ERROR", "EXPIRED", "PUBLISHED"].includes(s.statusCode)) return { state: s.statusCode as never, detail: s.status };
    if (Date.now() - start + wait > budgetMs) return { state: "IN_PROGRESS" };
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 20_000);
  }
}
