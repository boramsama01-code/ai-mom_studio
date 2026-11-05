import { z } from "zod";
import { aiProviders, type AiProvider } from "./aiProviders";
import { familyDialogueSettingsSchema } from "./familyDialogueSettings";

export const channelAiRoles = ["summary", "copy", "image"] as const;
export type LegacyChannelAiRole = typeof channelAiRoles[number];
export const channelAiTaskRoles = ["article_analysis", "resource_research", "card_copy", "caption", "image_brief", "image_generation", "editorial_review"] as const;
export type ChannelAiTaskRole = typeof channelAiTaskRoles[number];
export type ChannelAiRole = LegacyChannelAiRole | ChannelAiTaskRole;
export const channelAiRoleLabels: Record<ChannelAiRole, string> = {
  summary: "기사 요약", copy: "카드뉴스 문구", image: "이미지 제작",
  article_analysis: "원문·근거 분석", resource_research: "추가자료 조사", card_copy: "카드뉴스 문구",
  caption: "게시물 캡션", image_brief: "이미지 제작 지시", image_generation: "이미지 제작", editorial_review: "근거·편집 검수",
};
export const canonicalAiRole = (role: ChannelAiRole): ChannelAiTaskRole => role === "summary" ? "article_analysis" : role === "copy" ? "card_copy" : role === "image" ? "image_generation" : role;

/** A model ID is a name, never a URL, API key, endpoint or free-form prompt. */
export const aiModelIdSchema = z.string().trim().max(120)
  .refine(value => value === "" || /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,119}$/.test(value), "모델 ID에는 영문·숫자·점·하이픈·밑줄만 사용할 수 있습니다.");

export function aiModelMatches(provider: AiProvider, model: string, role: ChannelAiRole): boolean {
  if (!model) return true;
  if (canonicalAiRole(role) === "image_generation") return provider === "openai" && /^gpt-image-[a-zA-Z0-9._-]+$/.test(model);
  if (provider === "gemini") return /^gemini-[a-zA-Z0-9._-]+$/.test(model) && !/(?:^|-)image(?:-|$)/.test(model);
  if (provider === "anthropic") return /^claude-[a-zA-Z0-9._-]+$/.test(model);
  return /^(?:gpt-(?!image-)[a-zA-Z0-9._-]+|chatgpt-[a-zA-Z0-9._-]+|o[1-9][a-zA-Z0-9._-]*)$/.test(model);
}

export const textAiSelectionSchema = z.object({ provider: z.enum(aiProviders), model: aiModelIdSchema.default("") }).strict()
  .refine(value => aiModelMatches(value.provider, value.model, "copy"), { path: ["model"], message: "선택한 AI의 텍스트 모델 ID를 입력해 주세요." });
export const imageAiSelectionSchema = z.object({ provider: z.literal("openai"), model: aiModelIdSchema.default("") }).strict()
  .refine(value => aiModelMatches(value.provider, value.model, "image"), { path: ["model"], message: "이미지 제작에는 gpt-image 계열 모델 ID를 입력해 주세요." });

export const legacyChannelAiSettingsSchema = z.object({
  summary: textAiSelectionSchema,
  copy: textAiSelectionSchema,
  image: imageAiSelectionSchema,
}).strict();
/** Kept for already admitted jobs and old clients; never rewrite their model selection. */
export type ChannelAiSettings = z.infer<typeof legacyChannelAiSettingsSchema>;
export type AiSelection = z.infer<typeof textAiSelectionSchema>;
const inheritedAiSelectionSchema = z.object({ inherit: z.enum(channelAiTaskRoles) }).strict();
const textRoleSelectionSchema = z.union([textAiSelectionSchema, inheritedAiSelectionSchema]);
export const channelRoleModelsSchema = z.object({
  article_analysis: textRoleSelectionSchema, resource_research: textRoleSelectionSchema,
  card_copy: textRoleSelectionSchema, caption: textRoleSelectionSchema, image_brief: textRoleSelectionSchema,
  image_generation: imageAiSelectionSchema, editorial_review: textRoleSelectionSchema,
}).strict().superRefine((roles, context) => {
  for (const role of channelAiTaskRoles) {
    let next: ChannelAiTaskRole = role;
    const visited = new Set<ChannelAiTaskRole>();
    while (true) {
      if (visited.has(next)) {
        context.addIssue({ code: "custom", path: [role], message: "AI 역할 상속이 순환합니다. 직접 사용할 AI를 선택해 주세요." });
        break;
      }
      visited.add(next);
      const value = roles[next];
      if (!("inherit" in value)) break;
      if (value.inherit === "image_generation") {
        context.addIssue({ code: "custom", path: [role], message: "텍스트 역할은 이미지 제작 모델을 상속할 수 없습니다." });
        break;
      }
      next = value.inherit;
    }
  }
});
export const channelAiSettingsV2Schema = z.object({ version: z.literal(2), roleModels: channelRoleModelsSchema, editorial: familyDialogueSettingsSchema.optional() }).strict();
export type ChannelAiSettingsV2 = z.infer<typeof channelAiSettingsV2Schema>;
export type ChannelRoleModels = ChannelAiSettingsV2["roleModels"];
export const channelAiSettingsSchema = z.union([legacyChannelAiSettingsSchema, channelAiSettingsV2Schema]);
export type SavedChannelAiSettings = z.infer<typeof channelAiSettingsSchema>;
export type EffectiveRoleModels = Record<ChannelAiTaskRole, AiSelection>;
export type AiRoleOverrides = Partial<Record<ChannelAiTaskRole, { provider?: AiProvider; model?: string }>>;
export type ChannelAiModels = Record<AiProvider, string> & { image: string };
export type ChannelAiRuntime = {
  effectiveAiSettings: ChannelAiSettings;
  roleModels: ChannelRoleModels;
  effectiveRoleModels: EffectiveRoleModels;
  aiDefaultModels: ChannelAiModels;
  aiAvailability: Record<AiProvider, boolean>;
};

/** Defaults are role-specific even when the global preferred writer changes. */
export function defaultChannelAiSettings(): ChannelAiSettings {
  return { summary: { provider: "gemini", model: "" }, copy: { provider: "openai", model: "" }, image: { provider: "openai", model: "" } };
}

/** New editorial defaults are explicit IDs, independent of global auxiliary-tool preferences. */
export function defaultChannelRoleSettings(): ChannelAiSettingsV2 {
  return { version: 2, roleModels: {
    article_analysis: { provider: "gemini", model: "gemini-4-argon" },
    resource_research: { provider: "gemini", model: "gemini-4-argon" },
    card_copy: { provider: "openai", model: "gpt-6-astra" },
    caption: { inherit: "card_copy" }, image_brief: { inherit: "card_copy" },
    image_generation: { provider: "openai", model: "gpt-image-2.5-sunburst" },
    editorial_review: { inherit: "card_copy" },
  } };
}

/** Read compatibility only. Saving an upgrade creates a new channel settings version through CAS. */
export function normalizeChannelRoleSettings(settings: SavedChannelAiSettings | null | undefined): ChannelAiSettingsV2 {
  if (settings == null) return defaultChannelRoleSettings();
  const parsed = channelAiSettingsSchema.parse(settings);
  if ("version" in parsed) return parsed;
  const result = defaultChannelRoleSettings();
  result.roleModels.article_analysis = { ...parsed.summary };
  result.roleModels.card_copy = { ...parsed.copy };
  result.roleModels.image_generation = { ...parsed.image };
  return result;
}

export function inheritedAiRole(settings: SavedChannelAiSettings | null | undefined, role: ChannelAiRole): { selection: AiSelection; inheritedFrom: ChannelAiTaskRole[] } {
  const roles = normalizeChannelRoleSettings(settings).roleModels;
  let current = canonicalAiRole(role);
  const inheritedFrom: ChannelAiTaskRole[] = [];
  // Schema validation above rejects cycles before any settings can be saved or executed.
  while (true) {
    const value = roles[current];
    if (!("inherit" in value)) return { selection: { ...value }, inheritedFrom };
    current = value.inherit;
    inheritedFrom.push(current);
  }
}

/** A temporary provider override cannot inherit a different provider's model ID. */
export function resolveAiSelection(
  settings: SavedChannelAiSettings | null | undefined,
  role: ChannelAiRole,
  models: ChannelAiModels,
  override: { provider?: AiProvider; model?: string } = {},
): AiSelection {
  const saved = inheritedAiRole(settings, role).selection;
  const provider = override.provider ?? saved.provider;
  const isImage = canonicalAiRole(role) === "image_generation";
  const model = override.model?.trim() || (saved.provider === provider ? saved.model : "") || (isImage ? models.image : models[provider]);
  const selected = { provider, model };
  return isImage ? imageAiSelectionSchema.parse(selected) : textAiSelectionSchema.parse(selected);
}

/** Compatibility projection for screens that still display the three broad production steps. */
export function legacyChannelAiSettings(settings: SavedChannelAiSettings | null | undefined): ChannelAiSettings {
  return { summary: inheritedAiRole(settings, "summary").selection,
    copy: inheritedAiRole(settings, "copy").selection,
    image: imageAiSelectionSchema.parse(inheritedAiRole(settings, "image").selection) };
}

/** A run override of the writer also reaches roles that explicitly inherit that writer. */
export function resolveChannelRoleModels(settings: SavedChannelAiSettings | null | undefined, models: ChannelAiModels, overrides: AiRoleOverrides = {}): EffectiveRoleModels {
  const roles = normalizeChannelRoleSettings(settings).roleModels;
  const resolved: Partial<EffectiveRoleModels> = {};
  const resolve = (role: ChannelAiTaskRole): AiSelection => {
    if (resolved[role]) return resolved[role]!;
    const configured = roles[role];
    const base = "inherit" in configured ? resolve(configured.inherit) : configured;
    const override = overrides[role];
    const provider = override?.provider ?? base.provider;
    const model = override?.model?.trim() || (base.provider === provider ? base.model : "") || (role === "image_generation" ? models.image : models[provider]);
    const selection = role === "image_generation" ? imageAiSelectionSchema.parse({ provider, model }) : textAiSelectionSchema.parse({ provider, model });
    resolved[role] = selection;
    return selection;
  };
  for (const role of channelAiTaskRoles) resolve(role);
  return resolved as EffectiveRoleModels;
}

/** Jobs persist this resolved selection so a settings change cannot redirect queued work. */
export const aiExecutionSchema = z.object({ provider: z.enum(aiProviders), model: aiModelIdSchema.refine(value => !!value, "실행 모델을 지정해 주세요.") }).strict();
export type AiExecution = z.infer<typeof aiExecutionSchema>;
