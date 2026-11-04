import { z } from "zod";
import type { CardCopyV2, CaptionPackage, FamilyPage, FamilyPageId } from "./familyDialogue";

/** Display-only copy. Article text stays in fields, so an old override can never
 * conceal a later semantic edit. Empty strings intentionally hide a label. */
const displayText = (max: number) => z.string().refine(value => [...value].length <= max, max + "자 이내로 입력해 주세요.").optional();
export const familyDisplayOverridesSchema = z.object({
  brandName: displayText(120), kicker: displayText(120), pageNumber: displayText(80),
  sourceCredit: displayText(1000), imageCredit: displayText(300),
  factIndex1: displayText(40), factIndex2: displayText(40), factIndex3: displayText(40),
  definitionIndexA: displayText(40), definitionIndexB: displayText(40),
  duration: displayText(80), activityHelp: displayText(1000),
}).strict();
export type FamilyDisplayOverrides = z.infer<typeof familyDisplayOverridesSchema>;
export type FamilyDisplayKey = keyof FamilyDisplayOverrides;
export type FamilyDisplayValues = Record<FamilyDisplayKey, string>;
export type FamilyDisplayContext = { brandName?: string; sourceCredit?: string; imageCredit?: string };
export type FamilyDisplayDescriptor = { key: FamilyDisplayKey; label: string; max: number; canvaField: string };

const kickers: Record<FamilyPageId, string> = {
  cover: "오늘의 뉴스, 우리 집의 대화", news_summary: "뉴스 읽기", implication: "뉴스 읽기",
  discussion: "STEP 1", perspectives: "STEP 2", concept: "STEP 3", activity: "STEP 4", outro: "",
};
/** Source metadata is retained separately; this is only its editable card label. */
export function familyDisplayContext(copy: CardCopyV2, caption?: Pick<CaptionPackage, "sourceCredit"> | null): FamilyDisplayContext {
  const outro = copy.pages.find(page => page.id === "outro");
  const source = caption?.sourceCredit[0];
  return { brandName: outro?.id === "outro" ? outro.fields.brandName : "",
    sourceCredit: "출처: " + (source?.publisher?.trim() || source?.title?.trim() || "원문 확인 필요") };
}
export function resolveFamilyDisplay(page: FamilyPage, context: FamilyDisplayContext = {}): FamilyDisplayValues {
  const defaults: FamilyDisplayValues = {
    // The closing logo owns the ALL mark. Do not repeat a watermark on pages 1–7.
    brandName: "", kicker: kickers[page.id], pageNumber: String(page.page).padStart(2, "0") + " / 08",
    sourceCredit: page.id === "outro" ? "" : context.sourceCredit ?? "",
    imageCredit: page.id === "outro" ? "" : context.imageCredit ?? "",
    factIndex1: "01", factIndex2: "02", factIndex3: "03",
    definitionIndexA: "1", definitionIndexB: "2", duration: "10분", activityHelp: "",
  };
  for (const [key, value] of Object.entries(page.displayOverrides ?? {})) {
    if (typeof value === "string" && Object.hasOwn(defaults, key)) defaults[key as FamilyDisplayKey] = value;
  }
  return defaults;
}
export function familyDisplayDescriptors(page: FamilyPage): FamilyDisplayDescriptor[] {
  const prefix = "P" + String(page.page).padStart(2, "0");
  const descriptor = (key: FamilyDisplayKey, label: string, max: number, suffix: string): FamilyDisplayDescriptor => ({ key, label, max, canvaField: prefix + "_" + suffix });
  const fields = [descriptor("brandName", "상단 브랜드 표기", 120, "HEADER_BRAND"), descriptor("pageNumber", "페이지 번호", 80, "PAGE_NUMBER")];
  if (page.id !== "outro") fields.push(
    descriptor("kicker", page.id === "cover" ? "표지 주제 안내" : "뉴스 읽기·STEP 안내", 120, page.id === "cover" ? "TOPIC_TAG" : "KICKER"),
    descriptor("sourceCredit", "출처·하단 안내", 1000, "SOURCE"),
    descriptor("imageCredit", "이미지 출처·성격", 300, "IMAGE_CREDIT"),
  );
  if (page.id === "news_summary") page.fields.facts.forEach((_value, i) => fields.push(descriptor(("factIndex" + (i + 1)) as FamilyDisplayKey, "사실 앞 번호 " + (i + 1), 40, "FACT_INDEX_" + (i + 1))));
  if (page.id === "concept" && page.fields.mode === "value_definition") fields.push(descriptor("definitionIndexA", "첫 정의 앞 번호", 40, "DEFINITION_INDEX_A"), descriptor("definitionIndexB", "둘째 정의 앞 번호", 40, "DEFINITION_INDEX_B"));
  if (page.id === "activity") fields.push(descriptor("duration", "활동 시간 안내", 80, "DURATION"), descriptor("activityHelp", "활동 도움말", 1000, "ACTIVITY_HELP"));
  return fields;
}
/** Regeneration owns semantic fields only. Never accept model-created display
 * overrides; keep the operator's page-ID-bound values, including explicit ''. */
export function preserveFamilyDisplayOverrides(next: CardCopyV2, previous: CardCopyV2 | null): CardCopyV2 {
  return { ...next, pages: next.pages.map(page => {
    const { displayOverrides: _generated, ...rest } = page;
    const saved = previous?.pages.find(candidate => candidate.id === page.id)?.displayOverrides;
    return saved === undefined ? rest as FamilyPage : { ...rest, displayOverrides: { ...saved } } as FamilyPage;
  }) };
}

/** Prepared boundary for the two reading layouts. This does not register a Canva
 * master or claim its dataset exists. Existing V2 content stays lossless. */
export function familyReadingTextValues(copy: CardCopyV2, context: FamilyDisplayContext = {}, pageContexts: Partial<Record<FamilyPageId, FamilyDisplayContext>> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const page of copy.pages) {
    const d = resolveFamilyDisplay(page, { ...context, ...pageContexts[page.id] });
    const prefix = "P" + String(page.page).padStart(2, "0");
    out[prefix + "_PAGE_NUMBER"] = d.pageNumber;
    switch (page.id) {
      case "cover": Object.assign(out, { P01_TOPIC_TAG: d.kicker, P01_HEADLINE: page.fields.headline, P01_SUBTITLE: page.fields.subtitle, P01_IMAGE_CREDIT: d.imageCredit }); break;
      case "news_summary": Object.assign(out, { P02_KICKER: d.kicker, P02_TITLE: page.fields.title, P02_READING_BODY: [...page.fields.facts, ...(page.fields.caveat ? [page.fields.caveat] : [])].join("\n\n"), P02_SOURCE: d.sourceCredit }); break;
      case "implication": Object.assign(out, { P03_KICKER: d.kicker, P03_READING_BODY: page.fields.takeaway, P03_SOURCE: d.sourceCredit }); break;
      case "discussion": Object.assign(out, { P04_KICKER: d.kicker, P04_SCENARIO: page.fields.scenario ?? "", P04_QUESTION: page.fields.question, P04_IMAGE_CREDIT: d.imageCredit }); break;
      case "perspectives": Object.assign(out, { P05_KICKER: d.kicker, P05_VIEW_A_LABEL: page.fields.viewA.label, P05_VIEW_A_BODY: page.fields.viewA.body, P05_VIEW_B_LABEL: page.fields.viewB.label, P05_VIEW_B_BODY: page.fields.viewB.body }); break;
      case "concept": {
        const f = page.fields;
        Object.assign(out, { P06_KICKER: d.kicker, P06_CONCEPT: f.concept, P06_DEFINITION_INDEX_A: d.definitionIndexA, P06_DEFINITION_INDEX_B: d.definitionIndexB,
          P06_DEFINITION_A: f.mode === "value_definition" ? f.definitionA : f.acceptedDefinition,
          P06_DEFINITION_B: f.mode === "value_definition" ? f.definitionB : f.exampleOrNonExample,
          P06_BOUNDARY_CASE: f.mode === "value_definition" ? f.boundaryCase : "", P06_FILL_IN: f.fillIn });
        break;
      }
      case "activity": {
        const f = page.fields;
        Object.assign(out, { P07_KICKER: d.kicker, P07_DURATION: d.duration, P07_ACTIVITY_LABEL: f.homeActivity.label,
          P07_ACTIVITY_ACTIONS: [f.homeActivity.action, ...(f.optionalActivity ? [f.optionalActivity.label, f.optionalActivity.action] : [])].join("\n\n"),
          P07_ACTIVITY_HELP: d.activityHelp, P07_IMAGE_CREDIT: d.imageCredit });
        break;
      }
      case "outro": Object.assign(out, { P08_PARENT_BRAND: page.fields.parentBrand, P08_BRAND_LINE: page.fields.brandLine, P08_CTA: page.fields.cta, P08_HANDLE: page.fields.handle }); break;
    }
  }
  return out;
}
