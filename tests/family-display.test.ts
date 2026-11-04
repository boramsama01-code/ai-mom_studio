import { describe, expect, it } from "vitest";
import { familyCardCopyAiSchema, familyCardCopySchema, defaultPageDesigns } from "../shared/familyDialogue";
import { familyDisplayContext, familyReadingTextValues, preserveFamilyDisplayOverrides, resolveFamilyDisplay } from "../shared/familyDisplay";
import { canvaDisplaySupportErrors, canvaDisplayTextFields, canvaReadingTextFields, canvaTextFields, canvaVariant, expectedCanvaDataset } from "../shared/canvaEditorial";
import { familyPageText, layoutFamilyDialogueCard } from "../server/services/familyDialogueCard";
import { applyFamilyFieldPatches } from "../server/services/familyEditorial";
import { familyDialogueCardFixture, familyDialogueMetadataFixture, scientificFamilyCardFixture } from "./fixtures/familyDialogueCard";

describe("editable family display copy", () => {
  it("accepts optional manual labels without changing V2 or allowing body/unknown-key overrides", () => {
    const copy = familyDialogueCardFixture(), before = structuredClone(copy);
    expect(familyCardCopySchema.parse(copy)).toEqual(before);
    copy.pages[0].displayOverrides = { kicker: "", pageNumber: "첫 장", imageCredit: "예시 이미지" };
    expect(familyCardCopySchema.parse(copy).pages[0].displayOverrides).toEqual(copy.pages[0].displayOverrides);
    expect(familyCardCopyAiSchema.safeParse(copy).success).toBe(false);
    const invalid = structuredClone(copy) as any;
    invalid.pages[0].displayOverrides.headline = "본문 위에 덮어쓸 수 없음";
    expect(familyCardCopySchema.safeParse(invalid).success).toBe(false);
    invalid.pages[0].displayOverrides = { pageNumber: "가".repeat(81) };
    expect(familyCardCopySchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps operator labels and explicit blanks during full and partial AI rewriting without hiding new article copy", () => {
    const previous = familyDialogueCardFixture(), generated = familyDialogueCardFixture();
    previous.pages[0].displayOverrides = { kicker: "", pageNumber: "표지" };
    generated.pages[0].displayOverrides = { kicker: "모델이 바꾼 표시" };
    if (generated.pages[0].id === "cover") generated.pages[0].fields.headline = "새롭게 다듬은 본문";
    const next = preserveFamilyDisplayOverrides(generated, previous);
    expect(next.pages[0]).toMatchObject({ displayOverrides: { kicker: "", pageNumber: "표지" }, fields: { headline: "새롭게 다듬은 본문" } });
    const path = "pages.cover.fields.headline";
    const partial = applyFamilyFieldPatches(next, [{ path, value: "직접 지정한 한 칸", claimRefs: [] }], [path], {});
    expect(partial.pages[0].displayOverrides).toEqual(previous.pages[0].displayOverrides);
    expect(canvaTextFields(partial).P01_HEADLINE.text).toBe("직접 지정한 한 칸");
    expect(preserveFamilyDisplayOverrides(generated, null).pages[0]).not.toHaveProperty("displayOverrides");
  });

  it("uses identical operator labels in draft pixels, accessible text and supported Canva fields", () => {
    const copy = familyDialogueCardFixture(), page = copy.pages[3];
    page.displayOverrides = { kicker: "STEP 하나", pageNumber: "4", sourceCredit: "출처: 확인한 원문", imageCredit: "AI 예시 그림", brandName: "" };
    const context = familyDisplayContext(copy, familyDialogueMetadataFixture().captionPackage);
    const dataset = { ...expectedCanvaDataset(canvaVariant(copy)), ...Object.fromEntries(Object.keys(canvaDisplayTextFields(copy)).map(name => [name, { type: "text" }])) };
    const mapped = canvaTextFields(copy, { context, dataset });
    const runs = layoutFamilyDialogueCard(page, defaultPageDesigns().discussion, { ...context, brandName: "ALLligodang", accent: "#102D49" }, { layout: "minimal", collection: "n03" }).textRuns;
    const accessible = familyPageText(page, context);
    for (const key of ["P04_KICKER", "P04_PAGE_NUMBER", "P04_SOURCE", "P04_IMAGE_CREDIT"]) {
      expect(runs.map(run => run.text)).toContain(mapped[key].text);
      expect(accessible).toContain(mapped[key].text);
    }
    expect(runs.map(run => run.text)).not.toContain("ALLligodang");
    expect(resolveFamilyDisplay(page, context).brandName).toBe("");
  });

  it("stops legacy masters from silently dropping edited static labels and preserves the legacy field contract", () => {
    const copy = familyDialogueCardFixture(), legacy = expectedCanvaDataset(canvaVariant(copy));
    const before = canvaTextFields(copy);
    expect(Object.keys(before).sort()).toEqual(Object.entries(legacy).filter(([, field]) => field.type === "text").map(([name]) => name).sort());
    copy.pages[1].displayOverrides = { kicker: "함께 읽기", sourceCredit: "", pageNumber: "둘째 장" };
    expect(canvaDisplaySupportErrors(copy, legacy)).toHaveLength(3);
    expect(() => canvaTextFields(copy, { dataset: legacy })).toThrow("표시 문구");
    expect(copy.pages[1].displayOverrides?.sourceCredit).toBe("");
    expect(canvaDisplaySupportErrors(copy, {})).toHaveLength(3);
  });

  it("prepares exactly 46 reading labels from current V2 text while retaining science and optional activities", () => {
    for (const copy of [familyDialogueCardFixture(), scientificFamilyCardFixture()]) {
      const activity = copy.pages[6];
      if (activity.id !== "activity") throw new Error("activity");
      activity.fields.optionalActivity = { label: "추가 자료", action: "확인한 자료에서 조건을 찾아요.", resourceId: "R1" };
      activity.displayOverrides = { duration: "5분", activityHelp: "아이의 이유를 들어 주세요." };
      const values = familyReadingTextValues(copy);
      expect(Object.keys(values)).toHaveLength(46);
      expect(Object.keys(canvaReadingTextFields(copy))).toHaveLength(46);
      expect(values.P07_ACTIVITY_ACTIONS).toContain(activity.fields.optionalActivity.action);
      expect(values.P07_DURATION).toBe("5분");
      const concept = copy.pages[5];
      if (concept.id !== "concept") throw new Error("concept");
      if (concept.fields.mode === "scientific_explanation") expect(values.P06_DEFINITION_A).toBe(concept.fields.acceptedDefinition);
      if (copy.pages[0].id === "cover") copy.pages[0].fields.headline = "본문을 다시 고친 제목";
      expect(familyReadingTextValues(copy).P01_HEADLINE).toBe("본문을 다시 고친 제목");
      expect(familyReadingTextValues(copy).P07_ACTIVITY_HELP).toBe("아이의 이유를 들어 주세요.");
    }
  });
});
