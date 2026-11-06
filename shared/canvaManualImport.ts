import { z } from 'zod';
import { canvaDesignIdSchema } from './canvaReconciliation';
export { canvaDesignIdFromInput } from './canvaReconciliation';

/** An existing user-edited copy, never an Autofill request or master validation. */
export const CANVA_MANUAL_MAPPING_VERSION = 'canva-manual-copy/1';
export const canvaManualImportRequestSchema = z.object({
  version: z.number().int().positive(), requestId: z.string().uuid(),
  designId: canvaDesignIdSchema, confirmed: z.literal(true),
}).strict();
export type CanvaManualImportRequest = z.infer<typeof canvaManualImportRequestSchema>;
export const canvaManualSnapshotSchema = z.object({
  version: z.literal(1), kind: z.literal('manual_copy'), designId: canvaDesignIdSchema,
  principal: z.string().min(3).max(401), designUpdatedAt: z.number().int().nonnegative(),
  // Hash the ordered geometry and any page IDs Canva actually provides. Some
  // accounts omit IDs; the mandatory design updatedAt still pins that version.
  pagesHash: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: z.string().datetime(),
}).strict();
export type CanvaManualSnapshot = z.infer<typeof canvaManualSnapshotSchema>;
