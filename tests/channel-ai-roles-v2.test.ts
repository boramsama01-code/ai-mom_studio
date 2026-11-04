import { afterEach, describe, expect, it, vi } from "vitest";
import { channelAiSettingsSchema, defaultChannelAiSettings, defaultChannelRoleSettings, normalizeChannelRoleSettings, resolveAiSelection, resolveChannelRoleModels } from "../shared/channelAi";
import { stageProvenance } from "../shared/aiProvenance";
import { channelAiExecutionPlan } from "../server/services/channelAi";
const models = { gemini: "gemini-saved-global", openai: "gpt-saved-global", anthropic: "claude-saved-global", image: "gpt-image-saved-global" };
afterEach(() => vi.unstubAllEnvs());

describe("seven-role settings and immutable execution choices", () => {
  it("uses the exact editorial defaults and resolves all three inherited writer roles", () => {
    const defaults = defaultChannelRoleSettings();
    expect(defaults.roleModels.caption).toEqual({ inherit: "card_copy" });
    const resolved = resolveChannelRoleModels(defaults, models);
    expect(resolved.article_analysis).toEqual({ provider: "gemini", model: "gemini-4-argon" });
    expect(resolved.resource_research).toEqual(resolved.article_analysis);
    expect(resolved.card_copy).toEqual({ provider: "openai", model: "gpt-6-astra" });
    for (const role of ["caption", "image_brief", "editorial_review"] as const) expect(resolved[role]).toEqual(resolved.card_copy);
    expect(resolved.image_generation).toEqual({ provider: "openai", model: "gpt-image-2.5-sunburst" });
    expect(resolveAiSelection(defaults, "summary", models)).toEqual(resolved.article_analysis);
  });
  it("preserves saved legacy models and blank-model environment behavior without mutating storage", () => {
    const old = defaultChannelAiSettings(); old.summary = { provider: "anthropic", model: "claude-existing" };
    const before = structuredClone(old), upgraded = normalizeChannelRoleSettings(old);
    expect(upgraded.version).toBe(2);
    expect(resolveAiSelection(upgraded, "article_analysis", models)).toEqual(old.summary);
    expect(resolveAiSelection(upgraded, "card_copy", models)).toEqual({ provider: "openai", model: "gpt-saved-global" });
    expect(resolveAiSelection(upgraded, "caption", models)).toEqual({ provider: "openai", model: "gpt-saved-global" });
    expect(resolveAiSelection(upgraded, "image_generation", models)).toEqual({ provider: "openai", model: "gpt-image-saved-global" });
    expect(old).toEqual(before);
    upgraded.roleModels.card_copy = { provider: "gemini", model: "gemini-new" };
    expect(old.copy).toEqual(before.copy);
  });
  it("propagates a run writer override to inheriting roles while a caption override remains independent", () => {
    const settings = defaultChannelRoleSettings();
    const roles = resolveChannelRoleModels(settings, models, { card_copy: { provider: "anthropic", model: "claude-opus-5-5" }, caption: { provider: "gemini" } });
    expect(roles.card_copy).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(roles.editorial_review).toEqual(roles.card_copy); expect(roles.image_brief).toEqual(roles.card_copy);
    expect(roles.caption).toEqual({ provider: "gemini", model: "gemini-saved-global" });
    expect(defaultChannelRoleSettings()).toEqual(settings);
  });
  it.each(["self", "cycle", "image", "secret", "wrong-model"] as const)("rejects %s settings before execution", test => {
    const settings: any = defaultChannelRoleSettings();
    if (test === "self") settings.roleModels.caption = { inherit: "caption" };
    if (test === "cycle") { settings.roleModels.caption = { inherit: "editorial_review" }; settings.roleModels.editorial_review = { inherit: "caption" }; }
    if (test === "image") settings.roleModels.caption = { inherit: "image_generation" };
    if (test === "secret") settings.roleModels.card_copy.apiKey = "secret-never-persists";
    if (test === "wrong-model") settings.roleModels.resource_research = { provider: "gemini", model: "gpt-6-astra" };
    expect(channelAiSettingsSchema.safeParse(settings).success).toBe(false);
  });
  it("pins settings/revision/evidence IDs and keeps actual-model/unknown-usage provenance honest", () => {
    const channel = { version: 12, aiSettings: defaultChannelRoleSettings() };
    const plan = channelAiExecutionPlan(channel, { sourceSnapshotId: "source-4", contentRevision: 18, schemaVersion: "card-copy-v2", promptVersions: { card_copy: "editorial-20261104-v1.1" } });
    channel.version = 13; channel.aiSettings.roleModels.card_copy = { provider: "anthropic", model: "claude-opus-5-5" };
    vi.stubEnv("OPENAI_MODEL", "gpt-changed-after-admission");
    expect(plan.roles.card_copy).toMatchObject({ provider: "openai", model: "gpt-6-astra", requestedModel: "gpt-6-astra", promptVersion: "editorial-20261104-v1.1" });
    expect(plan.roles.caption.inheritedFrom).toEqual(["card_copy"]);
    expect(plan.editorial).toEqual({ additionalResourcesAutoSearch: true, visitScope: "off" });
    const row = stageProvenance(plan, "card_copy", { provider: "openai", requestedModel: "gpt-6-astra", actualModel: "gpt-6-astra-2026-10-01", requestId: "resp_test", usageStatus: "usage_unknown", inputTokens: null, outputTokens: null, status: "completed" });
    expect(row).toMatchObject({ settingsVersion: 12, contentRevision: 18, sourceSnapshotId: "source-4", actualModel: "gpt-6-astra-2026-10-01", usageStatus: "usage_unknown", inputTokens: null });
    expect(JSON.stringify(plan)).not.toContain("secret");
  });
  it("pins a saved research opt-out and rejects a region scope without an explicit region", () => {
    const settings = { ...defaultChannelRoleSettings(), editorial: { additionalResourcesAutoSearch: false, visitScope: "region" as const, activityRegion: "서울 종로구" } };
    const plan = channelAiExecutionPlan({ version: 2, aiSettings: settings }, { sourceSnapshotId: "source-4", contentRevision: 8, schemaVersion: "card-copy-v2", promptVersions: {} });
    settings.editorial.additionalResourcesAutoSearch = true; settings.editorial.activityRegion = "부산";
    expect(plan.editorial).toEqual({ additionalResourcesAutoSearch: false, visitScope: "region", activityRegion: "서울 종로구" });
    expect(channelAiSettingsSchema.safeParse({ ...settings, editorial: { additionalResourcesAutoSearch: false, visitScope: "region", activityRegion: "미지정" } }).success).toBe(false);
  });
});
