import { z } from "zod";

/** Only for optional research inputs; never apply to global channel categories or source bodies. */
export function normalizeOptionalResourceInput(value: unknown): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    return !text || /^(없음|미지정|미정|해당\s*없음|none|null|undefined)$/i.test(text) ? undefined : text;
  }
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeOptionalResourceInput).filter(item => item !== undefined);
    return normalized.length ? normalized : undefined;
  }
  if (typeof value === "object") {
    const normalized = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeOptionalResourceInput(child)]).filter(([, child]) => child !== undefined));
    return Object.keys(normalized).length ? normalized : undefined;
  }
  return value; // false and zero are explicit choices.
}
export const familyDialogueSettingsSchema = z.object({
  additionalResourcesAutoSearch: z.boolean().default(true),
  visitScope: z.enum(["off", "region", "national"]).default("off"),
  activityRegion: z.preprocess(normalizeOptionalResourceInput, z.string().max(120).optional()),
}).strict().refine(value => value.visitScope !== "region" || !!value.activityRegion, { path: ["activityRegion"], message: "지역 방문 활동을 켜려면 활동 지역을 직접 입력해 주세요." });
export type FamilyDialogueSettings = z.infer<typeof familyDialogueSettingsSchema>;
export function defaultFamilyDialogueSettings(): FamilyDialogueSettings {
  return { additionalResourcesAutoSearch: true, visitScope: "off" };
}
export function resolveFamilyDialogueSettings(saved?: Partial<FamilyDialogueSettings> | null): FamilyDialogueSettings {
  return familyDialogueSettingsSchema.parse({ ...defaultFamilyDialogueSettings(), ...(saved ?? {}) });
}
