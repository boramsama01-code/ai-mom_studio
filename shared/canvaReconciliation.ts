import { z } from "zod";

const positiveId = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const canvaDesignIdSchema = z.string().regex(/^D[A-Za-z0-9_-]{3,199}$/);
export const canvaReconcileRequestSchema = z.object({
  version: positiveId,
  designId: canvaDesignIdSchema,
  confirmed: z.literal(true),
  expectedRecoveryToken: hash,
}).strict();
export type CanvaReconcileRequest = z.infer<typeof canvaReconcileRequestSchema>;

/** Public recovery evidence contains identities and hashes, never tokens or provider errors. */
export const canvaReconciliationSchema = z.object({
  version: z.literal(1),
  recoveryToken: hash,
  designId: canvaDesignIdSchema,
  sourceRevisionId: positiveId,
  sourceVersion: positiveId,
  sourceInputHash: hash,
  requestTitleMatched: z.boolean(),
  datasetCheck: z.enum(["matches", "different", "unavailable"]),
  original: z.object({
    sourceRevisionId: positiveId,
    sourceVersion: positiveId,
    purpose: z.enum(["create", "import"]),
    requestId: z.string().uuid(),
    requestHash: hash,
    inputHash: hash,
  }),
  reconciledAt: z.string().datetime(),
});
export type CanvaReconciliation = z.infer<typeof canvaReconciliationSchema>;

export function canvaReconciliations(result: Record<string, unknown> | null | undefined): CanvaReconciliation[] {
  if (!result) return [];
  const entries = [result.reconciliation, ...(Array.isArray(result.reconciliationHistory) ? result.reconciliationHistory : [])];
  return entries.flatMap(entry => { const parsed = canvaReconciliationSchema.safeParse(entry); return parsed.success ? [parsed.data] : []; });
}

/** Accept the design ID or the ordinary Canva editor/view URL; never forward a pasted URL. */
export function canvaDesignIdFromInput(value: string): string | null {
  const trimmed = value.trim(), direct = canvaDesignIdSchema.safeParse(trimmed);
  if (direct.success) return direct.data;
  if (trimmed.length > 8192) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["canva.com", "www.canva.com"].includes(url.hostname)) return null;
    const parsed = canvaDesignIdSchema.safeParse(url.pathname.match(/^\/design\/([^/]+)(?:\/|$)/)?.[1]);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
