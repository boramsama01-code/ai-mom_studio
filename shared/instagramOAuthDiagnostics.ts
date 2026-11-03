/** Only these local labels and bounded numbers may cross an OAuth redirect. */
export const INSTAGRAM_OAUTH_REASONS = [
  "state", "expired", "configuration", "denied", "invalid_request", "exchange_failed",
  "account_mismatch", "publishing_permission", "connect_failed", "instagram_identity_failed",
  "invalid_account_response", "account_identity_incomplete", "account_list_incomplete",
  "no_assigned_accounts", "direct_account_access_failed", "direct_publish_access_failed",
  "ambiguous_account", "persistence_failed",
  // Preserve notices from older callers without accepting arbitrary reason text.
  "cancelled", "invalid_state", "expired_state", "not_configured",
] as const;
export type InstagramOAuthReason = typeof INSTAGRAM_OAUTH_REASONS[number];

export const INSTAGRAM_DIAGNOSTIC_STAGES = [
  "callback", "configuration", "token_exchange", "assigned_accounts", "account_profile",
  "direct_profile", "business_asset", "mapped_profile", "quota", "connection_validation", "persistence",
] as const;
export type InstagramDiagnosticStage = typeof INSTAGRAM_DIAGNOSTIC_STAGES[number];
export type InstagramDiagnostic = {
  stage: InstagramDiagnosticStage;
  httpStatus?: number;
  graphCode?: number;
  graphSubcode?: number;
  lost?: boolean;
};
export type InstagramOAuthFailure = { reason: InstagramOAuthReason; diagnostic?: InstagramDiagnostic };

const MAX_GRAPH_CODE = 2_147_483_647;
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const integer = (value: unknown, min: number, max: number): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;

export function instagramOAuthReason(value: unknown): InstagramOAuthReason {
  return typeof value === "string" && (INSTAGRAM_OAUTH_REASONS as readonly string[]).includes(value) ? value as InstagramOAuthReason : "connect_failed";
}

/** Never spread provider/error/query objects into a client-facing diagnostic. */
export function sanitizeInstagramDiagnostic(value: unknown): InstagramDiagnostic | undefined {
  const input = record(value);
  if (!input || typeof input.stage !== "string" || !(INSTAGRAM_DIAGNOSTIC_STAGES as readonly string[]).includes(input.stage)) return undefined;
  const httpStatus = integer(input.httpStatus, 100, 599);
  const graphCode = integer(input.graphCode, 0, MAX_GRAPH_CODE);
  const graphSubcode = integer(input.graphSubcode, 0, MAX_GRAPH_CODE);
  return {
    stage: input.stage as InstagramDiagnosticStage,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(graphCode !== undefined ? { graphCode } : {}),
    ...(graphSubcode !== undefined ? { graphSubcode } : {}),
    ...(typeof input.lost === "boolean" ? { lost: input.lost } : {}),
  };
}

export function instagramDiagnostic(stage: InstagramDiagnosticStage, details?: unknown, lost?: boolean): InstagramDiagnostic {
  const input = record(details);
  return sanitizeInstagramDiagnostic({ stage, httpStatus: input?.httpStatus, graphCode: input?.graphCode, graphSubcode: input?.graphSubcode, lost })!;
}

/** Read just the provider's numeric error fields; message/type/URL/cause stay private. */
export function instagramProviderDiagnostic(stage: InstagramDiagnosticStage, httpStatus: unknown, body: unknown): InstagramDiagnostic {
  const error = record(record(body)?.error);
  return sanitizeInstagramDiagnostic({ stage, httpStatus, graphCode: error?.code, graphSubcode: error?.error_subcode, lost: false })!;
}

export function instagramOAuthFailureUrl(reason: unknown, diagnostic?: unknown): string {
  const query = new URLSearchParams({ instagram: "error", reason: instagramOAuthReason(reason) });
  const safe = sanitizeInstagramDiagnostic(diagnostic);
  if (safe) {
    query.set("stage", safe.stage);
    if (safe.httpStatus !== undefined) query.set("http_status", String(safe.httpStatus));
    if (safe.graphCode !== undefined) query.set("graph_code", String(safe.graphCode));
    if (safe.graphSubcode !== undefined) query.set("graph_subcode", String(safe.graphSubcode));
    if (safe.lost !== undefined) query.set("lost", String(safe.lost));
  }
  return `/instagram?${query}`;
}

/** Query strings are untrusted too. Reject duplicates and non-canonical numbers. */
export function readInstagramOAuthFailure(query: URLSearchParams): InstagramOAuthFailure {
  const one = (key: string) => query.getAll(key).length === 1 ? query.get(key) : null;
  const number = (key: string) => {
    const value = one(key);
    return value !== null && /^(0|[1-9]\d{0,9})$/.test(value) ? Number(value) : undefined;
  };
  const lost = one("lost");
  const diagnostic = sanitizeInstagramDiagnostic({ stage: one("stage"), httpStatus: number("http_status"), graphCode: number("graph_code"), graphSubcode: number("graph_subcode"), lost: lost === "true" ? true : lost === "false" ? false : undefined });
  return { reason: instagramOAuthReason(one("reason")), ...(diagnostic ? { diagnostic } : {}) };
}
