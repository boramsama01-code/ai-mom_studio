import { z } from "zod";
import { aiProviders } from "./aiProviders";
import { aiModelIdSchema, channelAiTaskRoles } from "./channelAi";
import { familyDialogueSettingsSchema } from "./familyDialogueSettings";

const nullableId = z.string().max(200).nullable();
export const providerExecutionSchema = z.object({
  provider: z.enum(aiProviders), requestedModel: aiModelIdSchema,
  actualModel: aiModelIdSchema.nullable(), requestId: nullableId,
  usageStatus: z.enum(["known", "usage_unknown"]),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  status: z.enum(["completed", "truncated", "refused", "invalid_output", "failed", "cancelled", "not_started"]),
}).strict();
export type ProviderExecution = z.infer<typeof providerExecutionSchema>;
export const aiExecutionPlanSchema = z.object({
  version: z.literal(1), settingsVersion: z.number().int().nonnegative(), settingsSchemaVersion: z.union([z.literal(1), z.literal(2)]),
  sourceSnapshotId: nullableId, contentRevision: z.number().int().nonnegative().nullable(), schemaVersion: z.string().min(1).max(120),
  editorial: familyDialogueSettingsSchema.optional(),
  roles: z.record(z.enum(channelAiTaskRoles), z.object({
    provider: z.enum(aiProviders), model: aiModelIdSchema, requestedModel: aiModelIdSchema,
    inheritedFrom: z.array(z.enum(channelAiTaskRoles)).max(7), promptVersion: z.string().min(1).max(120),
  }).strict()),
}).strict();
export type AiExecutionPlan = z.infer<typeof aiExecutionPlanSchema>;
export const aiStageProvenanceSchema = providerExecutionSchema.extend({
  role: z.enum(channelAiTaskRoles), settingsVersion: z.number().int().nonnegative(),
  settingsSchemaVersion: z.union([z.literal(1), z.literal(2)]), promptVersion: z.string().min(1).max(120),
  schemaVersion: z.string().min(1).max(120), sourceSnapshotId: nullableId,
  contentRevision: z.number().int().nonnegative().nullable(), inheritedFrom: z.array(z.enum(channelAiTaskRoles)).max(7),
}).strict();
export type AiStageProvenance = z.infer<typeof aiStageProvenanceSchema>;

/** Caller persists this next to the stage result, including failed/unknown usage responses. */
export function stageProvenance(plan: AiExecutionPlan, role: typeof channelAiTaskRoles[number], execution?: ProviderExecution): AiStageProvenance {
  const selected = plan.roles[role];
  return aiStageProvenanceSchema.parse({
    ...(execution ?? { provider: selected.provider, requestedModel: selected.requestedModel, actualModel: null, requestId: null,
      usageStatus: "usage_unknown", inputTokens: null, outputTokens: null, status: "not_started" }),
    role, settingsVersion: plan.settingsVersion, settingsSchemaVersion: plan.settingsSchemaVersion,
    promptVersion: selected.promptVersion, schemaVersion: plan.schemaVersion,
    sourceSnapshotId: plan.sourceSnapshotId, contentRevision: plan.contentRevision, inheritedFrom: selected.inheritedFrom,
  });
}
