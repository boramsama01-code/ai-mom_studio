import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_COLOR_VARIANTS, PERSISTED_CARD_DESIGNS, cardDesignOptions } from "../shared/cardDesigns";
import { READING_CARD_PROFILES } from "../shared/readingCardProfiles";
import { templateCatalogItem, templateCatalogOptions } from "../shared/templateCatalog";

describe("complete template selection catalog", () => {
  it("exposes every original set exactly once and retains the original 33 palettes", () => {
    const items = templateCatalogOptions();
    expect(items).toHaveLength(37);
    expect(new Set(items.map(item => item.key)).size).toBe(37);
    expect(CARD_COLOR_VARIANTS).toHaveLength(33);
    expect(cardDesignOptions()).toHaveLength(21);
    for (const original of PERSISTED_CARD_DESIGNS) {
      expect(templateCatalogItem(`set:${original.id}`)).toMatchObject({ key: `set:${original.id}`, templateKey: `set:${original.id}`, cardCopyVersion: 1, format: "standard", pageCountMode: "variable", previewPageCount: 5 });
    }
    for (const item of cardDesignOptions()) expect(item.colors.every(color => color.name.length > 0)).toBe(true);
    expect(templateCatalogItem("set:r01-blue")).toMatchObject({ key: "set:r01-blue", templateKey: "set:r01-blue", setId: "r01", cardCopyVersion: 1 });
    expect(templateCatalogItem("set:r02-blue")).toBeUndefined();
  });

  it("separates the sixteen fixed eight-page formats from variable-length V1 copies", () => {
    const items = templateCatalogOptions();
    expect(items.filter(item => item.cardCopyVersion === 2)).toHaveLength(16);
    for (const profile of READING_CARD_PROFILES) {
      const item = templateCatalogItem(profile.id)!;
      expect(item).toMatchObject({ templateKey: profile.id, cardCopyVersion: 2, format: "family_dialogue_8", pageCount: 8, previewPageCount: 8, pageCountMode: "fixed", templateVersion: profile.templateVersion });
      expect(item.pageLabels).toHaveLength(8);
      if (profile.sourceStyleId) {
        expect(item.thumbnailUrl).toBe(`/cardnews14/${profile.sourceStyleId}-cover.webp`);
        expect(item.overviewUrl).toBe(`/cardnews14/${profile.sourceStyleId}.webp`);
        expect(fs.existsSync(`client/public${item.thumbnailUrl}`)).toBe(true);
        expect(fs.existsSync(`client/public${item.overviewUrl}`)).toBe(true);
      }
    }
    expect(templateCatalogItem("reading-ink-lime-v1")?.key).not.toBe(templateCatalogItem("cardnews14-ink-lime-v1")?.key);
    expect(items.slice(0, 14).every(item => item.generation === "cardnews14")).toBe(true);
  });
});
