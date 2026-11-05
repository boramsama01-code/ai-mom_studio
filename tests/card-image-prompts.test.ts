import { describe, expect, it } from "vitest";
import { defaultCardPageImagePrompt } from "../server/services/cardPageArtwork";
import { studioImagePrompt } from "../shared/studioImagePrompt";
import { READING_CARD_PROFILES, readingProfileDesigns } from "../shared/readingCardProfiles";
import { cardCopyFixture } from "./fixtures/cardCopy";
import { familyDialogueCardFixture, familyDialogueMetadataFixture } from "./fixtures/familyDialogueCard";

describe("the image prompt shown before generation", () => {
  it("uses only the chosen V1 page and retains its actual page identity instead of treating every page as a cover", () => {
    const copy = cardCopyFixture("set:r01");
    copy.pages[0].body = "다른 페이지에만 있는 설명";
    copy.pages[1].body = "두 번째 장에 직접 수정한 설명\n따옴표와 숫자도 그대로: \"42\"";
    const before = structuredClone(copy);
    const result = JSON.parse(defaultCardPageImagePrompt({ articleTitle: "현재 원고의 제목", copy, pageId: "body-2" }));
    expect(result).toMatchObject({ articleTitle: "현재 원고의 제목", role: "body-2", pageTitle: copy.pages[1].title, body: copy.pages[1].body });
    expect(JSON.stringify(result)).not.toContain(copy.pages[0].body);
    expect(copy).toEqual(before);
  });

  it("keeps the selected reading style's image geometry, current manuscript and page-specific visual brief together", () => {
    const copy = familyDialogueCardFixture(), metadata = familyDialogueMetadataFixture();
    const profile = READING_CARD_PROFILES.find(value => value.sourceStyleId === "cinematic")!;
    copy.templateKey = profile.templateKey;
    const pageDesigns = readingProfileDesigns(profile, metadata.pageDesigns);
    const visualBriefs = { news_summary: { scene: "관찰 결과를 비교하는 돋보기", avoid: "실제 취재 사진처럼 꾸미지 않기" }, activity: { scene: "다른 장의 장면" } };
    const before = structuredClone({ copy, pageDesigns, visualBriefs });
    const result = JSON.parse(defaultCardPageImagePrompt({ articleTitle: "기사에서 확인한 제목", copy, pageId: "news_summary", pageDesigns, visualBriefs }));
    expect(result).toMatchObject({ role: "news_summary", visualBrief: visualBriefs.news_summary,
      photoComposition: { profileId: profile.id, pageId: "news_summary", textPlacement: "over_image" } });
    expect(result.photoComposition.textSafeAreas.length).toBeGreaterThan(0);
    expect(result.body).toContain("게이츠는 AI가 전문 업무에서 앞설 것으로 전망했어요.");
    expect(result.body).toContain("모든 지능에서 우월하다는 연구 결과는 아니에요.");
    expect(result.use).toContain("실제 글자는 이미지에 그리지 않는다");
    expect(JSON.stringify(result)).not.toContain(visualBriefs.activity.scene);
    expect({ copy, pageDesigns, visualBriefs }).toEqual(before);
  });

  it("does not invent an image prompt for a text-only page or an eight-page profile logo", () => {
    const copy = familyDialogueCardFixture(); copy.templateKey = READING_CARD_PROFILES[0].templateKey;
    for (const pageId of ["news_summary", "outro"] as const) {
      expect(() => defaultCardPageImagePrompt({ articleTitle: "확인한 제목", copy, pageId })).toThrow("사진은");
    }
  });

  it("shows the fixed provider instructions and exact operator edits without changing source text", () => {
    const prompt = "아이의 관찰 노트를 묘사하되, 원문 인용은 이미지에 쓰지 않는다.\n수치는 42다.";
    const instruction = "  물체를 오른쪽에 놓고 왼쪽에는 넓은 여백.  ";
    const result = studioImagePrompt({ purpose: "cover", prompt, instruction });
    expect(result).toContain("no text, logos, captions or watermarks");
    expect(result).toContain(`<operator_revision>${instruction.trim()}</operator_revision>`);
    expect(result).toContain(`<topic>${prompt}</topic>`);
    expect(result.indexOf("</operator_revision>")).toBeLessThan(result.indexOf("<topic>"));
    expect(studioImagePrompt({ purpose: "cover", prompt, instruction: "  " })).not.toContain("<operator_revision>");
  });
});
