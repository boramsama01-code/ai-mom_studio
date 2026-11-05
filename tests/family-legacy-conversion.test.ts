import { describe, expect, it } from "vitest";
import { legacyFamilyCopy, legacyFamilyPageDesigns } from "../shared/familyLegacyConversion";
import { discussionCardCopyFixture } from "./fixtures/discussionCardCopy";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { readingProfileDesigns, readingProfileForTemplateKey } from "../shared/readingCardProfiles";

describe("existing manuscript and artwork during v1 to v2 conversion", () => {
  it("keeps every manually edited field as proposal input and maps semantic photo roles without mutating the source", () => {
    const copy = discussionCardCopyFixture("set:n04");
    copy.cover.title = "운영자가 직접 고친 제목"; copy.cover.background = { assetId: 10, opacity: 70 };
    copy.pages[0].body = "수정한 사실과 중요한 조건을 빠뜨리지 않는다."; copy.pages[0].background = { assetId: 11 };
    copy.pages[3].columns![1].body = "내가 고친 다른 관점"; copy.pages[6].background = { assetId: 17 };
    const before = structuredClone(copy), retained = legacyFamilyCopy({ cardCopy: copy });
    expect(retained).toEqual(copy);
    const designs = legacyFamilyPageDesigns(retained!);
    expect(designs.cover.background).toMatchObject({ kind: "image", assetId: 10, overlay: 30 });
    expect(designs.news_summary.background).toMatchObject({ kind: "image", assetId: 11 });
    expect(designs.outro.background.assetId).toBe(17);
    const applied = readingProfileDesigns(readingProfileForTemplateKey("cardnews14-swiss-modernism-v1")!, designs);
    expect(applied.news_summary.previousAssetIds).toContain(11); expect(applied.outro.previousAssetIds).toContain(17);
    expect(copy).toEqual(before);
  });
  it("reuses a real legacy cover asset without changing the saved v1 key or inventing body photographs", () => {
    const copy = cardCopyFixture("set:r01"), designs = legacyFamilyPageDesigns(copy, 701);
    expect(designs.cover.background).toMatchObject({ kind: "image", assetId: 701 });
    expect(Object.values(designs).filter(design => design.background.kind === "image")).toHaveLength(1);
    expect(copy.templateKey).toBe("set:r01"); expect(legacyFamilyCopy({ cardCopy: { version: 2 } })).toBeNull();
  });
});
