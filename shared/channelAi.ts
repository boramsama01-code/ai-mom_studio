import { z } from "zod";
import { aiProviders, type AiProvider } from "./aiProviders";

export const channelAiRoles = ["summary", "copy", "image"] as const;
export type ChannelAiRole = typeof channelAiRoles[number];
export const channelAiRoleLabels: Record<ChannelAiRole, string> = {
  summary: "기사 요약", copy: "카드뉴스 문구", image: "이미지 제작",
};

/** A model ID is a name, never a URL, API key, endpoint or free-form prompt. */
export const aiModelIdSchema = z.string().trim().max(120)
  .refine(value => value === "" || /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,119}$/.test(value), "모델 ID에는 영문·숫자·점·하이픈·밑줄만 사용할 수 있습니다.");

export function aiModelMatches(provider: AiProvider, model: string, role: ChannelAiRole): boolean {
  if (!model) return true;
  if (role === "image") return provider === "openai" && /^gpt-image-[a-zA-Z0-9._-]+$/.test(model);
  if (provider === "gemini") return /^gemini-[a-zA-Z0-9._-]+$/.test(model) && !/(?:^|-)image(?:-|$)/.test(model);
  if (provider === "anthropic") return /^claude-[a-zA-Z0-9._-]+$/.test(model);
  return /^(?:gpt-(?!image-)[a-zA-Z0-9._-]+|chatgpt-[a-zA-Z0-9._-]+|o[1-9][a-zA-Z0-9._-]*)$/.test(model);
}

export const textAiSelectionSchema = z.object({ provider: z.enum(aiProviders), model: aiModelIdSchema.default("") }).strict()
  .refine(value => aiModelMatches(value.provider, value.model, "copy"), { path: ["model"], message: "선택한 AI의 텍스트 모델 ID를 입력해 주세요." });
export const imageAiSelectionSchema = z.object({ provider: z.literal("openai"), model: aiModelIdSchema.default("") }).strict()
  .refine(value => aiModelMatches(value.provider, value.model, "image"), { path: ["model"], message: "이미지 제작에는 gpt-image 계열 모델 ID를 입력해 주세요." });

export const channelAiSettingsSchema = z.object({
  summary: textAiSelectionSchema,
  copy: textAiSelectionSchema,
  image: imageAiSelectionSchema,
}).strict();
export type ChannelAiSettings = z.infer<typeof channelAiSettingsSchema>;
export type AiSelection = z.infer<typeof textAiSelectionSchema>;
export type ChannelAiModels = Record<AiProvider, string> & { image: string };
export type ChannelAiRuntime = {
  effectiveAiSettings: ChannelAiSettings;
  aiDefaultModels: ChannelAiModels;
  aiAvailability: Record<AiProvider, boolean>;
};

/** Defaults are role-specific even when the global preferred writer changes. */
export function defaultChannelAiSettings(): ChannelAiSettings {
  return { summary: { provider: "gemini", model: "" }, copy: { provider: "openai", model: "" }, image: { provider: "openai", model: "" } };
}

/** A temporary provider override cannot inherit a different provider's model ID. */
export function resolveAiSelection(
  settings: ChannelAiSettings | null | undefined,
  role: ChannelAiRole,
  models: ChannelAiModels,
  override: { provider?: AiProvider; model?: string } = {},
): AiSelection {
  const saved = channelAiSettingsSchema.parse(settings ?? defaultChannelAiSettings())[role];
  const provider = override.provider ?? saved.provider;
  const model = override.model?.trim() || (saved.provider === provider ? saved.model : "") || (role === "image" ? models.image : models[provider]);
  const selected = { provider, model };
  return role === "image" ? imageAiSelectionSchema.parse(selected) : textAiSelectionSchema.parse(selected);
}

/** Jobs persist this resolved selection so a settings change cannot redirect queued work. */
export const aiExecutionSchema = z.object({ provider: z.enum(aiProviders), model: aiModelIdSchema.refine(value => !!value, "실행 모델을 지정해 주세요.") }).strict();
export type AiExecution = z.infer<typeof aiExecutionSchema>;
