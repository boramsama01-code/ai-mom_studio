import { z } from "zod";
import type { CanvaJobDto, CanvaMasterDto } from "../../shared/canvaEditorial";
import { ApiError } from "./api";
import { canvaReconcileRequestSchema, canvaReconciliationSchema, type CanvaReconcileRequest } from '../../shared/canvaReconciliation';
import { canvaConnectionStatusSchema } from '../../shared/canvaCapabilities';
const id = z.number().int().positive();
const canvaUrl = z.string().max(8192).refine(value => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")); } catch { return false; } });
const page = z.object({ id, sha256: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().max(1000), altText: z.string().max(1000).optional() });
const original = z.object({ id, sha256: z.string().regex(/^[a-f0-9]{64}$/), page: z.number().int().min(1).max(8) });
const jobSchema = z.object({
  id, requestId: z.string().uuid(), purpose: z.enum(["create", "import", "caption_rebind"]), status: z.enum(["queued", "running", "ready", "needs_review", "superseded", "result_unknown", "failed", "cancelled"]), phase: z.string().min(1).max(80),
  sourceRevisionId: id, sourceVersion: id, designId: z.string().max(200).nullable(), editUrl: canvaUrl.nullable(), exportJobId: z.string().max(200).nullable(), outputAssetId: id.nullable(), outputRevisionId: id.nullable(),
  errorCode: z.string().max(200).nullable(), errorMessage: z.string().max(3000).nullable(), createdAt: z.string().datetime(), recoveryToken: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  result: z.object({ pages: z.array(page).max(8).optional(), originals: z.array(original).max(8).optional(), reconciled: z.boolean().optional(), reconciliation: canvaReconciliationSchema.optional(), reconciliationHistory: z.array(canvaReconciliationSchema).max(20).optional(), reusedFromJobId: id.optional(), reuseReason: z.literal('caption_only').optional(), reusedAt: z.string().datetime().optional() }).passthrough().nullable(),
}).superRefine((job, context) => {
  if (!["ready", "needs_review", "superseded"].includes(job.status)) return;
  const pages = job.result?.pages, originals = job.result?.originals;
  if (!job.outputAssetId || !job.outputRevisionId || job.phase !== "complete" || pages?.length !== 8 || originals?.length !== 8 || pages[0]?.id !== job.outputAssetId || new Set(pages.map(value => value.id)).size !== 8 || new Set(originals.map(value => value.id)).size !== 8 || originals.some((value, index) => value.page !== index + 1)) context.addIssue({ code: "custom", message: "완료된 Canva 출력 8장과 원본 목록이 필요합니다." });
});
const masterSchema = z.object({ id, conceptMode: z.enum(["value_definition", "scientific_explanation"]), hasExternalActivity: z.boolean(), templateVersion: z.string().min(1).max(80), sourceType: z.enum(["design", "brand_template"]), sourceId: z.string().min(1).max(200), status: z.string().min(1).max(80), editUrl: canvaUrl.nullable(), validatedAt: z.string().datetime() });
export const canvaRequestBodySchema = z.object({ version: id, requestId: z.string().uuid(), masterId: id.optional(), importFromJobId: id.optional() }).strict();
export type CanvaRequestBody = z.infer<typeof canvaRequestBodySchema>;
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(502, "Canva 응답을 확인할 수 없습니다. 새 요청을 만들지 말고 저장된 요청 결과를 다시 확인해 주세요.");
  return result.data;
}
export const parseCanvaJob = (value: unknown): CanvaJobDto => parsed(jobSchema, value);
export const parseCanvaJobs = (value: unknown): { items: CanvaJobDto[] } => parsed(z.object({ items: z.array(jobSchema).max(100) }), value);
export const parseCanvaMaster = (value: unknown): CanvaMasterDto => parsed(masterSchema, value);
export const parseCanvaMasters = (value: unknown): { items: CanvaMasterDto[] } => parsed(z.object({ items: z.array(masterSchema).max(500) }), value);
export const parseCanvaConnection = (value: unknown) => parsed(canvaConnectionStatusSchema, value);
export const parseCanvaAcceptance = (value: unknown) => parsed(z.object({ ok: z.literal(true) }), value);
export function readCanvaRequest(key: string): CanvaRequestBody | null {
  try { const result = canvaRequestBodySchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null")); return result.success ? result.data : null; }
  catch { return null; }
}
export function clearCanvaRequest(key: string) { try { sessionStorage.removeItem(key); } catch { /* UI state remains usable when browser storage is unavailable. */ } }
export function readCanvaReconcileRequest(key: string): CanvaReconcileRequest | null {
  try { const result = canvaReconcileRequestSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null")); return result.success ? result.data : null; }
  catch { return null; }
}
