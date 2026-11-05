import { describe, expect, it } from "vitest";
import { defaultPageDesigns, pageDesignsSchema } from "../shared/familyDialogue";
import { readingProfileDesigns, readingProfileForTemplateKey } from "../shared/readingCardProfiles";
import { resolvedReadingPageDesigns } from "../shared/readingPageImages";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";

function fixture(templateKey = "cardnews14-cinematic-v1") {
  const copy = familyDialogueCardFixture(); copy.templateKey = templateKey;
  const profile = readingProfileForTemplateKey(templateKey)!;
  const designs = readingProfileDesigns(profile, defaultPageDesigns());
  designs.cover.background = { ...designs.cover.background, kind: "image", assetId: 101, focalX: 10, brightness: 150 };
  return { copy, designs };
}

describe("explicit cover-photo inheritance", () => {
  it("uses the current cover in opted-in inner slots while preserving target crop/brightness and the stored draft", () => {
    const { copy, designs } = fixture();
    designs.news_summary.background = { ...designs.news_summary.background, inheritCover: true, fit: "contain", focalX: 0, focalY: 85, brightness: 0, overlay: 20 };
    const before = structuredClone(designs), resolved = resolvedReadingPageDesigns(copy, designs);
    expect(resolved.news_summary.background).toMatchObject({ kind: "image", assetId: 101, fit: "contain", focalX: 0, focalY: 85, brightness: 0, overlay: 20 });
    expect(designs).toEqual(before); expect(designs.news_summary.background.assetId).toBeUndefined();
    expect(pageDesignsSchema.safeParse(designs).success).toBe(true);
    designs.cover.background.assetId = 202;
    expect(resolvedReadingPageDesigns(copy, designs).news_summary.background.assetId).toBe(202);
    expect(resolved.news_summary.background.assetId).toBe(101); // Already produced snapshots stay stable.
  });
  it("never overwrites an explicit inner photograph or explicit opt-out", () => {
    const { copy, designs } = fixture();
    designs.news_summary.background = { ...designs.news_summary.background, kind: "image", assetId: 303, inheritCover: true };
    designs.activity.background.inheritCover = false;
    designs.discussion.background.inheritCover = undefined;
    const resolved = resolvedReadingPageDesigns(copy, designs);
    expect(resolved.news_summary.background.assetId).toBe(303);
    expect(resolved.activity).toEqual(designs.activity); expect(resolved.activity.background.assetId).toBeUndefined();
    expect(resolved.discussion.background.assetId).toBeUndefined();
  });
  it("does not introduce a photo when the cover has none, and never borrows a packaged sample", () => {
    const { copy, designs } = fixture();
    designs.cover.background = { ...designs.cover.background, kind: "brand", assetId: undefined };
    designs.discussion.background.inheritCover = true;
    expect(resolvedReadingPageDesigns(copy, designs)).toBe(designs);
    expect(Object.values(resolvedReadingPageDesigns(copy, designs)).every(design => design.background.assetId === undefined)).toBe(true);
  });
  it("excludes the logo and pages without an artwork slot even when a forged flag opts them in", () => {
    const { copy, designs } = fixture("cardnews14-swiss-modernism-v1");
    designs.outro.background.inheritCover = true; designs.news_summary.background.inheritCover = true; designs.implication.background.inheritCover = true;
    const resolved = resolvedReadingPageDesigns(copy, designs);
    expect(resolved.outro.background.assetId).toBeUndefined(); expect(resolved.news_summary.background.assetId).toBeUndefined();
    expect(resolved.implication.background.assetId).toBe(101);
  });
  it.each(["reading-ink-lime-v1", "reading-cobalt-paper-v1"])("keeps %s and its saved snapshots unchanged", id => {
    const { copy, designs } = fixture(id);
    expect(resolvedReadingPageDesigns(copy, designs)).toBe(designs);
    designs.discussion.background.inheritCover = true;
    expect(resolvedReadingPageDesigns(copy, designs)).toBe(designs);
    expect(designs.discussion.background.assetId).toBeUndefined();
  });
  it.each(["cardnews14-cobalt-paper-v1", "reading-ink-lime-v1", "reading-cobalt-paper-v1"])("preserves opt-in and opt-out when switching through %s and back", templateKey => {
    const { copy, designs } = fixture();
    designs.news_summary.background.inheritCover = true;
    designs.implication.background.inheritCover = false;
    const before = structuredClone(designs);
    const intermediate = readingProfileDesigns(readingProfileForTemplateKey(templateKey)!, designs);
    expect(intermediate.news_summary.background.inheritCover).toBe(true);
    expect(intermediate.implication.background.inheritCover).toBe(false);
    expect(resolvedReadingPageDesigns({ ...copy, templateKey }, intermediate).news_summary.background.assetId).toBeUndefined();
    const restored = readingProfileDesigns(readingProfileForTemplateKey(copy.templateKey)!, intermediate);
    const resolved = resolvedReadingPageDesigns(copy, restored);
    expect(resolved.news_summary.background.assetId).toBe(101);
    expect(resolved.implication.background.assetId).toBeUndefined();
    expect(restored.implication.background.inheritCover).toBe(false);
    expect(designs).toEqual(before);
  });
  it("does not turn an absent preference into an opt-out in styles without the photo window", () => {
    const empty = defaultPageDesigns();
    const sparse = readingProfileDesigns(readingProfileForTemplateKey("cardnews14-cobalt-paper-v1")!, empty);
    const legacy = readingProfileDesigns(readingProfileForTemplateKey("reading-ink-lime-v1")!, sparse);
    expect(sparse.news_summary.background.inheritCover).toBeUndefined();
    expect(legacy.news_summary.background.inheritCover).toBeUndefined();
    const full = readingProfileDesigns(readingProfileForTemplateKey("cardnews14-cinematic-v1")!, legacy);
    expect(full.news_summary.background.inheritCover).toBe(true);
  });
  it("keeps a manually selected image ahead of the shared cover across supported styles", () => {
    const { copy, designs } = fixture();
    designs.discussion.background = { ...designs.discussion.background, kind: "image", assetId: 303, inheritCover: true, focalX: 0, brightness: 0 };
    const sparse = readingProfileDesigns(readingProfileForTemplateKey("cardnews14-cobalt-paper-v1")!, designs);
    const restored = readingProfileDesigns(readingProfileForTemplateKey(copy.templateKey)!, sparse);
    expect(resolvedReadingPageDesigns(copy, restored).discussion.background).toMatchObject({ kind: "image", assetId: 303, focalX: 0, brightness: 0 });
    expect(restored.discussion.previousAssetIds).toContain(303);
  });
});
