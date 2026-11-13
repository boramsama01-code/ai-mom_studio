import type { FamilyPage } from "./familyDialogue";

/** Presentation-only projection. Never write this flattened text back to fields/claimRefs. */
export function editorialFamilyPageBody(page: FamilyPage): string {
  const hidden = new Set(["title", "headline", "mode", "resourceId", "logoAssetId", ...(page.id === "outro" ? ["brandName"] : [])]);
  const strings = (value: unknown): string[] => {
    if (typeof value === "string") return value.trim() ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => hidden.has(key) ? [] : strings(child));
    return [];
  };
  return strings(page.fields).join("\n\n");
}
