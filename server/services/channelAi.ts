import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { env } from "../env";
import { channels, type Channel } from "../../shared/schema";
import { defaultChannelAiSettings, resolveAiSelection, type AiSelection, type ChannelAiModels, type ChannelAiRole, type ChannelAiRuntime, type ChannelAiSettings } from "../../shared/channelAi";
import type { AiProvider } from "../../shared/aiProviders";
import { HttpError } from "../routes/util";

export function channelAiDefaultModels(): ChannelAiModels {
  return { gemini: env.geminiModel, openai: env.openaiModel, anthropic: env.anthropicModel, image: env.openaiImageModel };
}
export function channelAiAvailability(): Record<AiProvider, boolean> {
  return { gemini: !!env.geminiKey, openai: !!env.openaiKey, anthropic: !!env.anthropicKey };
}
export function channelAiSelection(
  channel: { aiSettings?: ChannelAiSettings | null },
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

/** Only public configuration and booleans leave the server; no credentials are returned. */
export function withChannelAiSettings<T extends Channel>(channel: T): T & ChannelAiRuntime {
  const aiDefaultModels = channelAiDefaultModels();
  const saved = channel.aiSettings ?? defaultChannelAiSettings();
  return { ...channel,
    effectiveAiSettings: {
      summary: resolveAiSelection(saved, "summary", aiDefaultModels),
      copy: resolveAiSelection(saved, "copy", aiDefaultModels),
      image: resolveAiSelection(saved, "image", aiDefaultModels) as ChannelAiSettings["image"],
    },
    aiDefaultModels, aiAvailability: channelAiAvailability(),
  };
}
