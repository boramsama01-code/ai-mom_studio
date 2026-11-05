import { describe, expect, it } from "vitest";
import { DEFAULT_INSTAGRAM_ARTWORK_COMPOSITION, INSTAGRAM_COVER_SAFE, instagramCropWindow, intersectBounds } from "../shared/instagramCrop";
import { studioImagePrompt } from "../shared/studioImagePrompt";
import { readingArtworkComposition, readingArtworkPrompt } from "../shared/readingImagePrompts";
import { READING_CARD_PROFILES, readingProfileDesigns } from "../shared/readingCardProfiles";
import { defaultPageDesigns } from "../shared/familyDialogue";

describe("Instagram final-card and source-image crop protection", () => {
  it("keeps the composition inside both square and portrait previews without assuming square alone protects the sides", () => {
    expect(instagramCropWindow("square")).toEqual({ x: 0, y: 135, width: 1080, height: 1080 });
    expect(instagramCropWindow("profile")).toEqual({ x: 33.75, y: 0, width: 1012.5, height: 1350 });
    for (const mode of ["square", "profile"] as const) expect(intersectBounds(INSTAGRAM_COVER_SAFE, instagramCropWindow(mode))).toEqual(INSTAGRAM_COVER_SAFE);
    expect(instagramCropWindow("square", 1080, 1440).y).toBe(180);
    expect(instagramCropWindow("square", 1080, 1920).y).toBe(420);
    expect(() => instagramCropWindow("square", 0, 1350)).toThrow();
  });

  it("protects edited prompts as well as defaults, while retaining exact operator text and excluding comic panels", () => {
    const operator = "우주펭귄 네 가족과 파란 하늘", compositionPrompt = "원본 x=34~67%, y=20~75% 안의 사진창";
    const submitted = studioImagePrompt({ purpose: "cover", prompt: operator, instruction: "엄마의 숄만 파란색", compositionPrompt });
    expect(submitted).toContain("Instagram crop-safe composition");
    expect(submitted).toContain(compositionPrompt);
    expect(submitted).not.toContain(DEFAULT_INSTAGRAM_ARTWORK_COMPOSITION);
    expect(submitted).toContain(`<topic>${operator}</topic>`);
    expect(submitted).toContain("엄마의 숄만 파란색");
    expect(studioImagePrompt({ purpose: "cover", prompt: operator })).toContain(DEFAULT_INSTAGRAM_ARTWORK_COMPOSITION);
    expect(studioImagePrompt({ prompt: operator })).not.toContain("Instagram crop-safe");
  });

  it("projects a square generated image through every real photo slot and preserves a saved off-center focal point", () => {
    for (const profile of READING_CARD_PROFILES) {
      const designs = readingProfileDesigns(profile, defaultPageDesigns());
      for (const slot of profile.images.filter(value => value.kind === "artwork")) {
        const design = { ...designs[slot.pageId], background: { ...designs[slot.pageId].background, fit: "cover" as const, focalX: 23, focalY: 71 } };
        const composition = readingArtworkComposition(profile, slot.pageId, design)!;
        expect(composition).toMatchObject({ focalX: 23, focalY: 71, slot: { fit: "cover" } });
        const percent = composition.sourceSubjectSafePercent!, safe = composition.subjectSafeArea!;
        expect(percent).not.toBeNull();
        expect(percent.x).toBeGreaterThanOrEqual(0); expect(percent.y).toBeGreaterThanOrEqual(0);
        expect(percent.x + percent.width).toBeLessThanOrEqual(100.002); expect(percent.y + percent.height).toBeLessThanOrEqual(100.002);
        const side = Math.max(slot.width, slot.height), offsetX = (slot.width - side) * .23, offsetY = (slot.height - side) * .71;
        expect(percent.x / 100 * side + offsetX).toBeCloseTo(safe.x, 1);
        expect(percent.y / 100 * side + offsetY).toBeCloseTo(safe.y, 1);
        expect(readingArtworkPrompt(composition)).toContain("얼굴·눈·머리·헬멧·손·주요 소품");
      }
    }
  });
});
