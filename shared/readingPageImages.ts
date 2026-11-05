import type { CardCopyV2, PageDesigns } from "./familyDialogue";
import { readingProfileForTemplateKey } from "./readingCardProfiles";

/** Resolve display-time image references without writing them into the saved draft.
 * An explicit page asset always wins; cover changes therefore affect only pages
 * that still opt into inheritance. No bundled example image is an implicit source. */
export function resolvedReadingPageDesigns(copy: CardCopyV2, designs: PageDesigns): PageDesigns {
  const profile = readingProfileForTemplateKey(copy.templateKey);
  if (!profile?.sourceStyleId) return designs; // Preserve the two legacy profiles and other formats exactly.
  const cover = designs.cover.background;
  if (cover.kind !== "image" || !cover.assetId) return designs;
  let resolved = designs;
  for (const slot of profile.images) {
    if (slot.kind !== "artwork" || slot.pageId === "cover" || slot.pageId === "outro") continue;
    const design = designs[slot.pageId], background = design.background;
    if (background.inheritCover !== true || background.assetId !== undefined) continue;
    if (resolved === designs) resolved = { ...designs };
    // Crop, focal point, tone and overlay belong to the target page, not its source.
    resolved[slot.pageId] = { ...design, background: { ...background, kind: "image", assetId: cover.assetId } };
  }
  return resolved;
}
