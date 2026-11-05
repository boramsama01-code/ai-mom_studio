import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { env } from "../env";
import { channels, type Channel } from "../../shared/schema";
import { channelAiTaskRoles, inheritedAiRole, normalizeChannelRoleSettings, resolveAiSelection, resolveChannelRoleModels, type AiSelection, type AiRoleOverrides, type ChannelAiModels, type ChannelAiRole, type ChannelAiRuntime, type ChannelAiSettings, type ChannelAiTaskRole, type SavedChannelAiSettings } from "../../shared/channelAi";
import { aiExecutionPlanSchema, type AiExecutionPlan } from "../../shared/aiProvenance";
import { resolveFamilyDialogueSettings } from "../../shared/familyDialogueSettings";
import type { AiProvider } from "../../shared/aiProviders";
import { HttpError } from "../routes/util";

export function channelAiDefaultModels(): ChannelAiModels {
  return { gemini: env.geminiModel, openai: env.openaiModel, anthropic: env.anthropicModel, image: env.openaiImageModel };
}
export function channelAiAvailability(): Record<AiProvider, boolean> {
  return { gemini: !!env.geminiKey, openai: !!env.openaiKey, anthropic: !!env.anthropicKey };
}
export function channelAiSelection(
  channel: { aiSettings?: SavedChannelAiSettings | null },
  role: ChannelAiRole,
  override: { provider?: AiProvider; model?: string } = {},
): AiSelection {
  try { return resolveAiSelection(channel.aiSettings, role, channelAiDefaultModels(), override); }
  catch { throw new HttpError(400, "채널 설정의 AI와 모델 ID를 확인해 주세요."); }
}
export async function resolveChannelAiSettings(db: DB, channelId: number, role: ChannelAiRole, override: { provider?: AiProvider; model?: string } = {}) {
  const [channel] = await db.select({ aiSettings: channels.aiSettings }).from(channels).where(eq(channels.id, channelId));
  if (!channel) throw new HttpError(404, "채널을 찾을 수 없습니다.");
  return channelAiSelection(channel, role, override);
}

export type AiExecutionPlanOptions = {
  sourceSnapshotId: string | null;
  contentRevision: number | null;
  schemaVersion: string;
  promptVersions: Partial<Record<ChannelAiTaskRole, string>>;
  overrides?: AiRoleOverrides;
};
/** Resolve under the caller's admission transaction and persist the returned plain object in the job. */
export function channelAiExecutionPlan(channel: { version: number; aiSettings?: SavedChannelAiSettings | null }, options: AiExecutionPlanOptions): AiExecutionPlan {
  const effective = resolveChannelRoleModels(channel.aiSettings, channelAiDefaultModels(), options.overrides);
  return aiExecutionPlanSchema.parse({ version: 1, settingsVersion: channel.version,
    settingsSchemaVersion: channel.aiSettings && !("version" in channel.aiSettings) ? 1 : 2,
    sourceSnapshotId: options.sourceSnapshotId, contentRevision: options.contentRevision, schemaVersion: options.schemaVersion,
    editorial: resolveFamilyDialogueSettings(normalizeChannelRoleSettings(channel.aiSettings).editorial),
    roles: Object.fromEntries(channelAiTaskRoles.map(role => [role, { ...effective[role], requestedModel: effective[role].model,
      inheritedFrom: inheritedAiRole(channel.aiSettings, role).inheritedFrom,
      promptVersion: options.promptVersions[role] ?? "not-requested",
    }])),
  });
}
export async function resolveChannelAiExecutionPlan(db: DB, channelId: number, options: AiExecutionPlanOptions): Promise<AiExecutionPlan> {
  const [channel] = await db.select({ aiSettings: channels.aiSettings, version: channels.version }).from(channels).where(eq(channels.id, channelId));
  if (!channel) throw new HttpError(404, "채널을 찾을 수 없습니다.");
  return channelAiExecutionPlan(channel, options);
}

/** Only public configuration and booleans leave the server; no credentials are returned. */
export function withChannelAiSettings<T extends Channel>(channel: T): T & ChannelAiRuntime {
  const aiDefaultModels = channelAiDefaultModels();
  const saved = channel.aiSettings;
  return { ...channel,
    roleModels: normalizeChannelRoleSettings(saved).roleModels,
    effectiveRoleModels: resolveChannelRoleModels(saved, aiDefaultModels),
    effectiveAiSettings: {
      summary: resolveAiSelection(saved, "summary", aiDefaultModels),
      copy: resolveAiSelection(saved, "copy", aiDefaultModels),
      image: resolveAiSelection(saved, "image", aiDefaultModels) as ChannelAiSettings["image"],
    },
    aiDefaultModels, aiAvailability: channelAiAvailability(),
  };
}
