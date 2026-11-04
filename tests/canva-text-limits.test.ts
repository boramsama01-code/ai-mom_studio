import { describe, expect, it } from "vitest";
import { checkCanvaTextLimits, type CanvaTextTarget } from "../shared/canvaTextLimits";
import { CANVA_READING_MASTERS, CANVA_READING_TEMPLATE_VERSION } from "../shared/canvaMasterCatalog";
import { familyCardCopySchema, familyFieldDescriptors, type CardCopyV2 } from "../shared/familyDialogue";
import { familyDialogueCardFixture, scientificFamilyCardFixture } from "./fixtures/familyDialogueCard";

const target = (index = 0): CanvaTextTarget => ({ sourceId: CANVA_READING_MASTERS[index].sourceId, templateVersion: CANVA_READING_TEMPLATE_VERSION, purpose: "autofill" });
function setField(copy: CardCopyV2, path: string, value: unknown) {
  const [, pageId, ...segments] = path.split(".");
  let current: any = copy.pages.find(page => page.id === pageId)!;
  for (const segment of segments.slice(0, -1)) current = current[segment];
  current[segments.at(-1)!] = value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

describe("prepared Canva reading masters text preflight", () => {
  it("accepts the manual sample without claiming the actual Canva line breaks are verified", () => {
    const result = checkCanvaTextLimits(familyDialogueCardFixture(), target());
    expect(result).toMatchObject({ applicable: true, ok: true, issues: [] });
    expect(result.notice).toContain("실제 글꼴과 줄바꿈을 보장하지 않으므로");
    expect(result.notice).toContain("완성된 8장을 모두 확인");
  });

  it.each(CANVA_READING_MASTERS.map((master, index) => ({ ...master, index })))("accepts guide-length Korean copy for $label in the corresponding expanded boxes", master => {
    const copy = master.conceptMode === "scientific_explanation" ? scientificFamilyCardFixture() : familyDialogueCardFixture();
    const activity = copy.pages.find(page => page.id === "activity")!;
    if (master.hasExternalActivity) activity.fields.optionalActivity = { label: "읽을 자료", action: "확인한 초록을 읽어요.", resourceId: "R1" };
    const summary = copy.pages.find(page => page.id === "news_summary")!;
    summary.fields.facts = ["가".repeat(35), "가".repeat(35), "가".repeat(35)];
    for (const page of copy.pages) for (const field of familyFieldDescriptors(page)) {
      if (field.systemOwned || field.kind === "array") continue;
      setField(copy, field.fieldPath, "가".repeat(field.initialBudget));
    }
    expect(familyCardCopySchema.safeParse(copy).success).toBe(true);
    expect(checkCanvaTextLimits(copy, target(master.index))).toMatchObject({ applicable: true, ok: true, issues: [] });
  });

  it("allows a 1000-character manual draft to remain valid and unchanged while blocking only fixed-master autofill", () => {
    const copy = familyDialogueCardFixture(); setField(copy, "pages.cover.fields.headline", "긴".repeat(1000));
    expect(familyCardCopySchema.safeParse(copy).success).toBe(true);
    const before = structuredClone(copy); freeze(copy);
    const result = checkCanvaTextLimits(copy, target());
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ pageId: "cover", pageNumber: 1, fieldPath: "pages.cover.fields.headline", canvaField: "P01_HEADLINE", label: "표지 제목", actualCharacters: 1000, maxCharacters: 24, maxLines: 3, reasons: ["characters", "lines"] });
    expect(result.issues[0].message).toContain("1페이지 표지 · 표지 제목");
    expect(result.issues[0].message).toContain("원고를 자르지 않고 자동 채우기를 멈춥니다");
    expect(copy).toEqual(before);
  });

  it.each(["가\n나\n다\n라", "가\r\n나\r\n다\r\n라", "가\u2028나\u2029다\r라"])("blocks too many explicit lines even when the field is within its character budget: %j", headline => {
    const copy = familyDialogueCardFixture(); setField(copy, "pages.cover.fields.headline", headline);
    const issue = checkCanvaTextLimits(copy, target()).issues.find(value => value.fieldPath === "pages.cover.fields.headline")!;
    expect(issue).toMatchObject({ reasons: ["lines"], explicitLines: 4, estimatedLines: 4, maxLines: 3 });
    expect(copy.pages[0].fields).toMatchObject({ headline });
  });

  it("counts code points at the guide boundary without truncating surrogate pairs", () => {
    const copy = familyDialogueCardFixture();
    setField(copy, "pages.cover.fields.headline", "🐧".repeat(24));
    expect(checkCanvaTextLimits(copy, target()).ok).toBe(true);
    setField(copy, "pages.cover.fields.headline", "🐧".repeat(25));
    expect(checkCanvaTextLimits(copy, target()).issues[0]).toMatchObject({ actualCharacters: 25, maxCharacters: 24, reasons: ["characters"] });
    expect(copy.pages[0].fields).toMatchObject({ headline: "🐧".repeat(25) });
  });

  it("accounts for blank separators in the exact mapped summary instead of inspecting facts independently only", () => {
    const copy = familyDialogueCardFixture();
    setField(copy, "pages.news_summary.fields.facts", ["첫\n번째\n사실", "두\n번째\n사실", "세\n번째\n사실"]);
    const issues = checkCanvaTextLimits(copy, target()).issues;
    expect(issues.some(issue => issue.fieldPath === "pages.news_summary.fields.facts.0" && issue.maxLines === 2)).toBe(true);
    expect(issues.find(issue => issue.fieldPath === "pages.news_summary.fields.facts")).toMatchObject({ canvaField: "P02_FACTS", maxLines: 8, explicitLines: 11, estimatedLines: 11 });
    expect(issues.find(issue => issue.fieldPath === "pages.news_summary.fields.facts")?.label).toContain("빈줄 포함");
  });

  it("keeps approved branding intact and reports a one-line wordmark or brand phrase that is too wide", () => {
    const copy = familyDialogueCardFixture();
    setField(copy, "pages.outro.fields.brandName", "가".repeat(10));
    setField(copy, "pages.outro.fields.brandLine", "승인된 브랜드 문구를 그대로 유지합니다. ".repeat(2));
    const before = structuredClone(copy);
    const issues = checkCanvaTextLimits(copy, target()).issues;
    expect(issues.find(issue => issue.fieldPath === "pages.outro.fields.brandName")).toMatchObject({ maxLines: 1, reasons: ["lines"] });
    expect(issues.find(issue => issue.fieldPath === "pages.outro.fields.brandLine")).toMatchObject({ maxLines: 1, reasons: ["lines"] });
    expect(copy).toEqual(before);
  });

  it.each<Partial<CanvaTextTarget>>([{ purpose: "import" }, { purpose: "manual" }, { sourceId: "operator-imported-design" }, { templateVersion: "another-template-v2" }])("does not apply prepared-master restrictions to an imported/manual or unrelated design: %j", override => {
    const copy = familyDialogueCardFixture(); setField(copy, "pages.cover.fields.headline", "직접 배치한 긴 문구\n".repeat(50));
    const before = structuredClone(copy);
    expect(checkCanvaTextLimits(copy, { ...target(), ...override })).toMatchObject({ applicable: false, ok: true, issues: [] });
    expect(copy).toEqual(before);
  });
});
