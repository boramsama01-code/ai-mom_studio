import { describe, expect, it } from "vitest";
import type { FamilyPageId } from "../shared/familyDialogue";
import { READING_CARD_PROFILES, readingProfileForTemplateKey, type ReadingCardProfile, type ReadingImageBox, type ReadingTextBox } from "../shared/readingCardProfiles";
import { readingArtworkComposition, readingArtworkPagesLabel, readingArtworkPrompt } from "../shared/readingImagePrompts";

const image = (pageId: FamilyPageId, bounds: Partial<ReadingImageBox> = {}): ReadingImageBox => ({ field: "PHOTO", pageId, x: 0, y: 0, width: 1080, height: 1350, kind: "artwork", ...bounds });
const text = (bounds: Partial<ReadingTextBox>): ReadingTextBox => ({ field: "HEADLINE", x: 72, y: 200, width: 936, height: 240, fontSize: 80, fontWeight: 700, lineHeight: 1.1, maxLines: 3, align: "left", color: "#ffffff", ...bounds });
function profile(images: ReadingImageBox[], textBoxes: ReadingTextBox[] = []): ReadingCardProfile {
  return { id: "reading-ink-lime-v1", templateKey: "reading-ink-lime-v1", templateVersion: "test-only", mappingVersion: "test-only", label: "격리된 사진 스타일", images,
    pages: [{ page: 1, background: "#000000", shapes: [], textBoxes, imageBoxes: images.filter(slot => slot.pageId === "cover") }],
    profileImagePath: "unused", profileImageSha256: "0".repeat(64), profileImageAssetId: "unused" };
}

describe("reading image prompts from actual slot geometry", () => {
  it("reserves only intersecting text areas on a full-page photograph", () => {
    const p = profile([image("cover")], [text({}), text({ field: "OUTSIDE", y: 1400 }), text({ field: "EDGE", x: 1000, y: 1300, width: 200, height: 100 })]);
    const composition = readingArtworkComposition(p, "cover")!;
    expect(composition).toMatchObject({ textPlacement: "over_image", slot: { width: 1080, height: 1350, fit: "cover", aspectRatio: 0.8 } });
    expect(composition.textSafeAreas).toEqual([{ field: "HEADLINE", x: 72, y: 200, width: 936, height: 240 }, { field: "EDGE", x: 1000, y: 1300, width: 80, height: 50 }]);
    const prompt = readingArtworkPrompt(composition);
    expect(prompt).toContain("글자 안전 영역"); expect(prompt).toContain("복잡한 무늬"); expect(prompt).not.toContain("글자가 겹치지 않는다");
  });
  it("keeps a wide separate photograph window distinct from a text-overlay background", () => {
    const p = profile([image("cover", { x: 96, y: 678, width: 888, height: 444 })], [text({ y: 100, height: 300 }), text({ field: "TOUCHES_EDGE", y: 600, height: 78 })]);
    const composition = readingArtworkComposition(p, "cover")!;
    expect(composition).toMatchObject({ textPlacement: "outside_image", textSafeAreas: [], slot: { x: 96, y: 678, width: 888, height: 444, aspectRatio: 2 } });
    expect(readingArtworkPrompt(composition)).toContain("글자가 겹치지 않는다"); expect(readingArtworkPrompt(composition)).not.toContain("글자 안전 영역");
    expect(readingArtworkPrompt(composition)).toContain("잘린 중앙 영역");
  });
  it("uses window-relative coordinates and respects contain without inventing a cover crop", () => {
    const photo = { ...image("cover", { x: 100, y: 600, width: 600, height: 300 }), fit: "contain" as const };
    const composition = readingArtworkComposition(profile([photo], [text({ x: 50, y: 550, width: 200, height: 150 })]), "cover")!;
    expect(composition.textSafeAreas).toEqual([{ field: "HEADLINE", x: 0, y: 0, width: 150, height: 100 }]);
    expect(composition.slot.fit).toBe("contain"); expect(readingArtworkPrompt(composition)).toContain("contain"); expect(readingArtworkPrompt(composition)).not.toContain("cover 크롭");
  });
  it("derives 4/5/6/8-slot artwork pages while keeping the closing profile out of AI targets", () => {
    const all: FamilyPageId[] = ["cover", "news_summary", "implication", "discussion", "perspectives", "concept", "activity"];
    const p = profile([...all.map(id => image(id)), image("outro", { kind: "profile" })]);
    expect(readingArtworkPagesLabel(p)).toBe("1·2·3·4·5·6·7장");
    expect(readingArtworkComposition(p, "outro")).toBeUndefined();
    expect(readingArtworkPagesLabel(profile([image("activity"), image("cover"), image("implication"), image("discussion"), image("outro", { kind: "profile" })]))).toBe("1·3·4·7장");
    expect(readingArtworkComposition(profile([image("cover")]), "news_summary")).toBeUndefined();
  });
  it("supports every supplied 14-style slot contract without inserting example photos or generating the profile logo", () => {
    const counts = { cinematic: 8, "monochrome-coral": 8, "amber-cream": 8, "cobalt-paper": 4, "ink-lime": 4, "swiss-modernism": 5, "studio-2am": 6, ichestyime: 5, "sharp-serif": 8, "bang-bang": 4, hello: 5, "ekiden-pack": 8, "you-and-me": 8, "ott-recommendation": 8 };
    const supplied = READING_CARD_PROFILES.filter(value => value.sourceStyleId);
    expect(supplied).toHaveLength(14); expect(supplied.reduce((count, value) => count + value.images.length, 0)).toBe(89);
    for (const p of supplied) {
      const before = JSON.stringify(p);
      expect(p.images).toHaveLength(counts[p.sourceStyleId!]);
      for (const slot of p.images) {
        const composition = readingArtworkComposition(p, slot.pageId);
        if (slot.kind === "profile") expect(composition).toBeUndefined();
        else {
          expect(composition).toMatchObject({ field: slot.field, slot: { x: slot.x, y: slot.y, width: slot.width, height: slot.height, fit: slot.fit ?? "cover" } });
          expect(JSON.stringify(composition)).not.toMatch(/sampleAsset|assetId|MAHZ/);
        }
      }
      expect(JSON.stringify(p)).toBe(before);
    }
  });
  it("uses full-page text overlap for cinematic and exact separate/strip/portrait bounds for Swiss Modernism", () => {
    const cinematic = readingProfileForTemplateKey("cardnews14-cinematic-v1")!, swiss = readingProfileForTemplateKey("cardnews14-swiss-modernism-v1")!;
    expect(readingArtworkComposition(cinematic, "cover")).toMatchObject({ textPlacement: "over_image", slot: { width: 1080, height: 1350 } });
    expect(readingArtworkComposition(cinematic, "news_summary")?.textSafeAreas).toContainEqual({ field: "P02_READING_BODY", x: 72, y: 438, width: 910, height: 700 });
    expect(readingArtworkComposition(swiss, "cover")).toMatchObject({ textPlacement: "outside_image", slot: { width: 888, height: 444, aspectRatio: 2 } });
    expect(readingArtworkComposition(swiss, "implication")).toMatchObject({ textPlacement: "over_image", slot: { width: 1080, height: 236 }, textSafeAreas: [{ field: "P03_KICKER", x: 72, y: 84, width: 800, height: 42 }] });
    expect(readingArtworkComposition(swiss, "discussion")).toMatchObject({ textPlacement: "outside_image", slot: { width: 384, height: 904 } });
    expect(readingArtworkComposition(swiss, "activity")).toMatchObject({ textPlacement: "outside_image", slot: { width: 936, height: 290 } });
    expect(readingArtworkPagesLabel(swiss)).toBe("1·3·4·7장");
  });
});
