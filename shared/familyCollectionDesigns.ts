import { cardDesign } from "./cardDesigns";
import { FAMILY_PAGE_IDS, type PageDesigns } from "./familyDialogue";
import { FAMILY_PAGE_COLORS } from "./familyDialogueTheme";
import { readingProfileForTemplateKey } from "./readingCardProfiles";

export const familyCollectionDesign = (key: unknown) => typeof key === "string" && key.startsWith("set:") ? cardDesign(key.slice(4)) : undefined;

/** A five-page sample has a different copy schema. On an eight-page manuscript
 * its palette belongs to the eight-page layout; the copy is never reinterpreted
 * as five pages. Preserve intentional page colours, crops and image history. */
export function familyCollectionPageDesigns(key: string, previousKey: string, current: PageDesigns): PageDesigns {
  const next = familyCollectionDesign(key);
  if (!next) return current;
  const previous = familyCollectionDesign(previousKey), reading = readingProfileForTemplateKey(previousKey);
  return Object.fromEntries(FAMILY_PAGE_IDS.map((id, index) => {
    const design = current[id], priorDefault = reading?.pages[index].background ?? previous?.bg ?? FAMILY_PAGE_COLORS[id];
    const followsPalette = !design.background.color || design.background.color.toUpperCase() === priorDefault.toUpperCase();
    return [id, { ...design, background: { ...design.background, ...(followsPalette ? { color: next.bg } : {}) } }];
  })) as PageDesigns;
}
