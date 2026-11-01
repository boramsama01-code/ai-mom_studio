/**
 * Instagram 게시 — "Instagram API with Instagram Login" 한 방식만 사용 (graph.instagram.com)
 * Facebook Login의 Page 토큰과 혼용하지 않는다.
 * 흐름: 컨테이너 생성 → creation_id 즉시 보관 → 상태 폴링 → FINISHED 확인 → publish → media_id 저장
 * API 버전은 INSTAGRAM_API_VERSION으로 지정(코드에 최신 버전을 가정하지 않음).
 * 문서: https://developers.facebook.com/docs/instagram-platform/content-publishing/
 */
import { env } from "../env";

const HOST = "https://graph.instagram.com";

/** Read the account identity from the token, never accept a user-entered account ID. */
export async function accountIdentity(token: string) {
  const result = await igFetch("me", "GET", { fields: "user_id,username" }, token);
  if (!result.ok) return { ok: false as const, error: result.err.kind === "token_expired" ? "토큰이 만료됐습니다. Instagram Login 토큰을 다시 발급해 주세요." : "인스타그램 계정 인증에 실패했습니다. 토큰과 권한을 확인하세요." };
  const userId = String(result.json.user_id ?? "");
  const username = String(result.json.username ?? "");
  if (!/^\d+$/.test(userId) || !/^[a-zA-Z0-9._]{1,30}$/.test(username)) return { ok: false as const, error: "계정 정보를 확인할 수 없습니다. Instagram Login 방식의 토큰이 필요합니다." };
  return { ok: true as const, userId, username };
}

export type IgError = { kind: "not_configured" | "auth" | "token_expired" | "rate_limit" | "limit_reached" | "terminal" | "transient" | "unknown"; error: string };

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

async function igFetch(path: string, method: "GET" | "POST", params: Record<string, string>, token: string) {
  if (!env.instagramApiVersion) throw Object.assign(new Error("INSTAGRAM_API_VERSION 미설정"), { ig: { kind: "not_configured", error: "INSTAGRAM_API_VERSION 미설정" } as IgError });
  const url = new URL(`${HOST}/${env.instagramApiVersion}/${path}`);
  let init: RequestInit = { method, signal: AbortSignal.timeout(30_000) };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
  } else {
    const body = new URLSearchParams({ ...params, access_token: token });
    init = { ...init, body, headers: { "content-type": "application/x-www-form-urlencoded" } };
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false as const, lost: true, err: { kind: "unknown", error: "응답을 받지 못함" } as IgError };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || json.error) return { ok: false as const, lost: false, err: classify(res.status, json) };
  return { ok: true as const, json };
}

export async function createContainer(userId: string, token: string, imageUrl: string, caption: string, altText?: string) {
  if(altText!==undefined&&(!altText.trim()||altText.length>1000))return {ok:false as const,lost:false,err:{kind:"terminal",error:"대체텍스트는 1~1000자로 작성해 주세요."} as IgError};
  const r = await igFetch(`${userId}/media`, "POST", { image_url: imageUrl, caption, ...(altText?.trim()?{alt_text:altText.trim()}: {}) }, token);
  if (!r.ok) return r;
  return { ok: true as const, containerId: String(r.json.id) };
}

export async function createCarouselContainer(userId: string, token: string, imageUrls: string[], caption: string, altTexts?: string[]) {
  if(altTexts&&(altTexts.length!==imageUrls.length||altTexts.some(v=>!v.trim()||v.length>1000)))return {ok:false as const,lost:false,err:{kind:"terminal",error:"각 이미지의 대체텍스트를 1~1000자로 작성해 주세요."} as IgError};
  if (imageUrls.length < 2 || imageUrls.length > 10) return { ok: false as const, lost: false, err: { kind: "terminal", error: "카드뉴스는 2~10장이어야 합니다." } as IgError };
  const children: string[] = [];
  for (const [index,image_url] of imageUrls.entries()) {
    const child = await igFetch(`${userId}/media`, "POST", { image_url, is_carousel_item: "true", ...(altTexts?.[index]?.trim()?{alt_text:altTexts[index].trim()}: {}) }, token);
    if (!child.ok) return child;
    if (!child.json.id) return { ok: false as const, lost: false, err: { kind: "transient", error: "하위 이미지 컨테이너 ID를 받지 못했습니다." } as IgError };
    children.push(String(child.json.id));
  }
  const parent = await igFetch(`${userId}/media`, "POST", { media_type: "CAROUSEL", children: children.join(","), caption }, token);
  if (!parent.ok) return parent;
  if (!parent.json.id) return { ok: false as const, lost: false, err: { kind: "transient", error: "카드뉴스 컨테이너 ID를 받지 못했습니다." } as IgError };
  return { ok: true as const, containerId: String(parent.json.id) };
}

export async function containerStatus(containerId: string, token: string) {
  const r = await igFetch(containerId, "GET", { fields: "status_code,status" }, token);
  if (!r.ok) return r;
  return { ok: true as const, statusCode: String(r.json.status_code || ""), status: String(r.json.status || "") };
}

export async function publishContainer(userId: string, token: string, containerId: string) {
  const r = await igFetch(`${userId}/media_publish`, "POST", { creation_id: containerId }, token);
  if (!r.ok) return r;
  return { ok: true as const, mediaId: String(r.json.id) };
}

export async function mediaPermalink(mediaId: string, token: string): Promise<string | null> {
  const r = await igFetch(mediaId, "GET", { fields: "permalink" }, token);
  return r.ok ? (r.json.permalink as string) ?? null : null;
}

export async function publishingLimit(userId: string, token: string) {
  const r = await igFetch(`${userId}/content_publishing_limit`, "GET", { fields: "quota_usage,config" }, token);
  if (!r.ok) return r;
  const d = (r.json.data || [])[0] || {};
  return { ok: true as const, used: Number(d.quota_usage ?? 0), total: Number(d.config?.quota_total ?? 0) };
}

/**
 * 컨테이너 상태를 제한 시간 동안만 폴링(점진 대기). 끝나지 않으면 "처리 중"으로 남겨 다음 실행에서 이어간다.
 * 컨테이너는 생성 후 24시간 유효.
 */
export async function waitForContainer(containerId: string, token: string, budgetMs = 90_000): Promise<{ state: "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | "UNKNOWN"; detail?: string; err?: IgError }> {
  const start = Date.now();
  let wait = 3000;
  for (;;) {
    const s = await containerStatus(containerId, token);
    if (!s.ok) return { state: "UNKNOWN", err: s.err };
    if (["FINISHED", "ERROR", "EXPIRED", "PUBLISHED"].includes(s.statusCode)) return { state: s.statusCode as never, detail: s.status };
    if (Date.now() - start + wait > budgetMs) return { state: "IN_PROGRESS" };
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 20_000);
  }
}
