import { env } from "../env";
import { instagramDiagnosticTargetHints } from "./instagram";
import type { InstagramDiagnosticStage } from "../../shared/instagramOAuthDiagnostics";

/** Observed permission names only; this list never requests or grants permissions. */
const OBSERVED_SCOPES = [
  "instagram_basic", "instagram_content_publish", "instagram_manage_messages",
  "instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_messages",
  "pages_show_list", "pages_read_engagement", "business_management",
] as const;
type ObservedScope = typeof OBSERVED_SCOPES[number];
const TOKEN_TYPES = ["USER", "PAGE", "APP", "SYSTEM_USER"] as const;
const MAX_SCOPES = 64;
const MAX_TARGETS = 100;
type ListState = "missing" | "empty" | "present" | "invalid" | "truncated";
type CheckedBoolean = boolean | "missing" | "invalid";
type TargetHints = ReturnType<typeof instagramDiagnosticTargetHints>;
type TargetSummary = {
  state: ListState; count: number; invalidCount: number;
  primaryMatch?: boolean; businessAssetMatch?: boolean; linkedPageMatch?: boolean; businessMatch?: boolean; otherTargetPresent?: boolean;
};
type ScopeSummary = { state: ListState; names: ObservedScope[]; unknownCount: number; invalidCount: number };
type GranularSummary = { state: ListState; grants: Array<{ scope: ObservedScope; targets: TargetSummary }>; unknownScopeCount: number; invalidCount: number; duplicateCount: number };
export type InstagramTokenGrantDiagnostic = {
  outcome: "inspected" | "configuration_changed" | "provider_error" | "invalid_response" | "unavailable";
  httpStatus?: number; graphCode?: number; graphSubcode?: number; lost?: boolean;
  valid?: CheckedBoolean; appMatches?: CheckedBoolean;
  type?: typeof TOKEN_TYPES[number] | "other" | "missing";
  scopes?: ScopeSummary; granular?: GranularSummary;
};

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const own = (value: Record<string, unknown> | undefined, key: string): unknown => value && Object.hasOwn(value, key) ? value[key] : undefined;
const integer = (value: unknown, min: number, max: number): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
const scopeName = (value: unknown): ObservedScope | undefined => typeof value === "string" && (OBSERVED_SCOPES as readonly string[]).includes(value) ? value as ObservedScope : undefined;

function identifier(value: unknown): string | undefined {
  if (typeof value === "string" && /^[1-9]\d{0,39}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

function listState(value: unknown, limit: number, invalidCount: number): ListState {
  if (value === undefined) return "missing";
  if (!Array.isArray(value)) return "invalid";
  if (value.length > limit) return "truncated";
  if (invalidCount) return "invalid";
  return value.length ? "present" : "empty";
}

function summarizeScopes(value: unknown): ScopeSummary {
  const names = new Set<ObservedScope>();
  let unknownCount = 0, invalidCount = 0;
  if (Array.isArray(value)) for (const entry of value.slice(0, MAX_SCOPES)) {
    const scope = scopeName(entry);
    if (scope) names.add(scope);
    else if (typeof entry === "string") unknownCount++;
    else invalidCount++;
  }
  return { state: listState(value, MAX_SCOPES, invalidCount), names: [...names], unknownCount, invalidCount };
}

function summarizeTargets(value: unknown, hints: TargetHints): TargetSummary {
  const ids = new Set<string>();
  let invalidCount = 0;
  if (Array.isArray(value)) for (const entry of value.slice(0, MAX_TARGETS)) {
    const id = identifier(entry);
    if (id) ids.add(id); else invalidCount++;
  }
  const state = listState(value, MAX_TARGETS, invalidCount);
  const complete = state === "present" || state === "empty";
  // Partial/malformed lists may prove a positive match, never a negative one.
  const match = (id: string | undefined) => id ? ids.has(id) ? true : complete ? false : undefined : undefined;
  const primaryMatch = match(hints.primaryId), businessAssetMatch = match(hints.businessAssetId);
  const linkedPageMatch = match(hints.linkedPageId), businessMatch = match(hints.businessId);
  const known = new Set([hints.primaryId, hints.businessAssetId, hints.linkedPageId, hints.businessId].filter((id): id is string => !!id));
  const other = [...ids].some(id => !known.has(id));
  return {
    state, count: ids.size, invalidCount,
    ...(primaryMatch !== undefined ? { primaryMatch } : {}),
    ...(businessAssetMatch !== undefined ? { businessAssetMatch } : {}),
    ...(linkedPageMatch !== undefined ? { linkedPageMatch } : {}),
    ...(businessMatch !== undefined ? { businessMatch } : {}),
    ...(other || complete ? { otherTargetPresent: other } : {}),
  };
}

function summarizeGranular(value: unknown, hints: TargetHints): GranularSummary {
  const grants: GranularSummary["grants"] = [], seen = new Set<ObservedScope>();
  let unknownScopeCount = 0, invalidCount = 0, duplicateCount = 0;
  if (Array.isArray(value)) for (const entry of value.slice(0, MAX_SCOPES)) {
    const item = record(entry), name = own(item, "scope"), scope = scopeName(name);
    if (!item || typeof name !== "string") { invalidCount++; continue; }
    if (!scope) { unknownScopeCount++; continue; }
    if (seen.has(scope)) { duplicateCount++; continue; }
    seen.add(scope);
    grants.push({ scope, targets: summarizeTargets(own(item, "target_ids"), hints) });
  }
  const state = listState(value, MAX_SCOPES, invalidCount + duplicateCount);
  if (state === "invalid" || state === "truncated") for (const grant of grants) {
    if (grant.targets.state === "present" || grant.targets.state === "empty") grant.targets.state = state;
    // Another entry for this permission may be missing or duplicated. Keep only observed positives.
    for (const key of ["primaryMatch", "businessAssetMatch", "linkedPageMatch", "businessMatch", "otherTargetPresent"] as const) if (grant.targets[key] === false) delete grant.targets[key];
  }
  return { state, grants, unknownScopeCount, invalidCount, duplicateCount };
}

/** Constructs the entire log payload; no provider strings, identifiers or objects escape. */
export function summarizeInstagramTokenGrants(body: unknown, appId: string, username: string): InstagramTokenGrantDiagnostic {
  const data = record(own(record(body), "data"));
  if (!data) return { outcome: "invalid_response" };
  const valid = own(data, "is_valid"), rawAppId = own(data, "app_id"), returnedAppId = identifier(rawAppId), type = own(data, "type");
  return {
    outcome: "inspected",
    valid: valid === undefined ? "missing" : typeof valid === "boolean" ? valid : "invalid",
    appMatches: rawAppId === undefined ? "missing" : returnedAppId ? returnedAppId === appId : "invalid",
    type: type === undefined ? "missing" : typeof type === "string" && (TOKEN_TYPES as readonly string[]).includes(type) ? type as typeof TOKEN_TYPES[number] : "other",
    scopes: summarizeScopes(own(data, "scopes")),
    granular: summarizeGranular(own(data, "granular_scopes"), instagramDiagnosticTargetHints(username)),
  };
}

export function shouldInspectInstagramToken(stage: InstagramDiagnosticStage): boolean {
  return ["assigned_accounts", "account_profile", "direct_profile", "business_asset", "mapped_profile", "quota"].includes(stage);
}

/**
 * One read-only request while the failed credential is still in callback memory.
 * Meta's reference uses a distinct app credential with input_token:
 * https://github.com/meta/agentic-tools/blob/865dfb2e236dc3ea27cb8bd19ae64af752fdfd27/plugins/devtools/skills/debug-access-token/scripts/debug_token_probe.py
 * Never log this request URL, response body or caught exception, or persist the token.
 */
export async function inspectInstagramTokenGrants(token: string, appId: string, username: string, fetchImpl: typeof fetch = fetch): Promise<InstagramTokenGrantDiagnostic> {
  const currentAppId = process.env.META_APP_ID?.trim(), secret = process.env.META_APP_SECRET?.trim();
  if (identifier(appId) !== appId || currentAppId !== appId || !secret || !/^v\d+\.\d+$/.test(env.instagramApiVersion)) return { outcome: "configuration_changed" };
  const url = new URL(`https://graph.facebook.com/${env.instagramApiVersion}/debug_token`);
  url.search = new URLSearchParams({ input_token: token, access_token: `${appId}|${secret}` }).toString();
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch { return { outcome: "unavailable", lost: true }; }
  const httpStatus = integer(response.status, 100, 599);
  const body: unknown = await response.json().catch(() => undefined);
  const error = own(record(body), "error");
  if (!response.ok || error !== undefined) {
    const graphCode = integer(own(record(error), "code"), 0, 2_147_483_647), graphSubcode = integer(own(record(error), "error_subcode"), 0, 2_147_483_647);
    return { outcome: "provider_error", ...(httpStatus !== undefined ? { httpStatus } : {}), ...(graphCode !== undefined ? { graphCode } : {}), ...(graphSubcode !== undefined ? { graphSubcode } : {}) };
  }
  return { ...summarizeInstagramTokenGrants(body, appId, username), ...(httpStatus !== undefined ? { httpStatus } : {}) };
}
