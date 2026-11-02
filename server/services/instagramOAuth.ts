import crypto from "node:crypto";
import { env } from "../env";

/** Meta Unified Login uses the configured system-user flow, not Instagram's legacy OAuth scopes. */
export const INSTAGRAM_OAUTH_TTL_MS = 10 * 60_000;
export type PendingInstagramOAuth = {
  state: string; createdAt: number; channelId: number; username: string; dailyLimit: number;
  redirectUri: string; appId: string; configId: string;
};

export function instagramOAuthConfig() {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const configId = (process.env.META_INSTAGRAM_CONFIG_ID ?? "").trim();
  const missing: string[] = [];
  if (!/^\d+$/.test(appId)) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET?.trim()) missing.push("META_APP_SECRET");
  if (!/^\d+$/.test(configId)) missing.push("META_INSTAGRAM_CONFIG_ID");
  if (!/^v\d+\.\d+$/.test(env.instagramApiVersion)) missing.push("INSTAGRAM_API_VERSION");
  let redirectUri = "";
  try {
    const base = new URL(env.baseUrl);
    if (base.username || base.password || (base.protocol !== "https:" && (env.isProduction || base.protocol !== "http:"))) throw new Error("invalid origin");
    redirectUri = new URL("/api/studio/instagram/oauth/callback", base.origin).toString();
  } catch { missing.push("APP_BASE_URL"); }
  return { configured: missing.length === 0, missing, appId: /^\d+$/.test(appId) ? appId : null, redirectUri, authMode: "facebook" as const };
}

export function newInstagramOAuth(input: { channelId: number; username: string; dailyLimit: number }, now = Date.now()): PendingInstagramOAuth {
  const config = instagramOAuthConfig();
  if (!config.configured || !config.appId) throw new Error("instagram_oauth_not_configured");
  return { ...input, state: crypto.randomBytes(32).toString("base64url"), createdAt: now, redirectUri: config.redirectUri, appId: config.appId, configId: process.env.META_INSTAGRAM_CONFIG_ID!.trim() };
}

export function instagramAuthorizationUrl(pending: PendingInstagramOAuth) {
  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.search = new URLSearchParams({ client_id: pending.appId, config_id: pending.configId, redirect_uri: pending.redirectUri, response_type: "code", override_default_response_type: "true", prompt: "login", state: pending.state }).toString();
  return url.toString();
}

export function validateInstagramOAuthState(pending: PendingInstagramOAuth | undefined, state: unknown, now = Date.now()): "valid" | "state" | "expired" {
  if (!pending || typeof state !== "string" || state.length > 128) return "state";
  const sent = Buffer.from(state), saved = Buffer.from(pending.state);
  if (sent.length !== saved.length || !crypto.timingSafeEqual(sent, saved)) return "state";
  const age = now - pending.createdAt;
  return Number.isFinite(age) && age >= 0 && age < INSTAGRAM_OAUTH_TTL_MS ? "valid" : "expired";
}

/** Tokens are returned to server callers only. No raw provider response is included in errors. */
export async function exchangeUnifiedInstagramCode(code: string, pending: PendingInstagramOAuth, fetchImpl: typeof fetch = fetch) {
  const current = instagramOAuthConfig();
  if (!current.configured || current.appId !== pending.appId || process.env.META_INSTAGRAM_CONFIG_ID?.trim() !== pending.configId || current.redirectUri !== pending.redirectUri) throw new Error("configuration");
  const url = new URL(`https://graph.facebook.com/${env.instagramApiVersion}/oauth/access_token`);
  url.search = new URLSearchParams({ client_id: pending.appId, client_secret: process.env.META_APP_SECRET!, redirect_uri: pending.redirectUri, code }).toString();
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error || typeof body.access_token !== "string" || !/^[^\s]{20,4000}$/.test(body.access_token)) throw new Error("exchange_failed");
    const seconds = body.expires_in;
    // A missing or zero lifetime is unknown here; do not invent a 60-day expiry.
    const expiresAt = Number.isSafeInteger(seconds) && seconds > 0 && seconds < 10 * 365 * 86400 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
    return { token: body.access_token as string, expiresAt };
  } catch { throw new Error("exchange_failed"); }
}
