import { z } from "zod";

/** Stable, safe categories. Provider messages and arbitrary provider codes are never public data. */
export const CANVA_FAILURE_REASONS = [
  "not_connected", "auth_required", "permission_denied", "missing_scope", "capability_missing",
  "not_found", "export_expired", "rate_limited", "quota_exceeded", "invalid_request",
  "provider_unavailable", "result_unknown", "invalid_response", "cancelled", "job_failed",
] as const;
export type CanvaFailureReason = typeof CANVA_FAILURE_REASONS[number];
export const CANVA_PROVIDER_ERROR_CODES = [
  "invalid_access_token", "revoked_access_token", "missing_scope", "invalid_scope", "invalid_grant",
  "permission_denied", "user_role_required", "unauthorized_user", "not_found", "design_not_found",
  "asset_not_found", "too_many_requests", "quota_exceeded", "credit_quota_exceeded",
  "credit_quota_cooldown", "app_credit_quota_exceeded", "bad_request_body", "bad_request_params",
  "invalid_field", "missing_field", "design_not_fillable", "autofill_data_invalid",
  "feature_not_available", "license_required", "internal_error",
] as const;
export type CanvaProviderErrorCode = typeof CANVA_PROVIDER_ERROR_CODES[number];
export const canvaProviderErrorCodeSchema = z.enum(CANVA_PROVIDER_ERROR_CODES);

/** New fields are optional so old saved UI fixtures/clients retain their existing contract. */
export const canvaConnectionStatusSchema = z.object({
  configured: z.boolean(), connected: z.boolean(), autofill: z.boolean(),
  capabilities: z.array(z.string().max(100)).max(100),
  capabilityStatus: z.enum(["available", "unavailable", "unknown"]).optional(),
  reason: z.enum(CANVA_FAILURE_REASONS).nullable().optional(),
  message: z.string().max(1000).nullable().optional(),
  providerCode: canvaProviderErrorCodeSchema.nullable().optional(),
  checkedAt: z.string().datetime().nullable().optional(),
});
export type CanvaConnectionStatus = z.infer<typeof canvaConnectionStatusSchema>;
