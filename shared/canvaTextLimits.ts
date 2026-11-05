import { CANVA_READING_MASTERS, CANVA_READING_TEMPLATE_VERSION } from "./canvaMasterCatalog";
import { canvaTextFields } from "./canvaEditorial";
import { FAMILY_PAGE_LABELS, familyFieldDescriptors, familyFieldValue, type CardCopyV2, type FamilyPageId } from "./familyDialogue";

export type CanvaTextTarget = {
  sourceId: string;
  templateVersion: string;
  purpose: "create" | "autofill" | "import" | "manual";
};
export type CanvaTextIssue = {
  pageId: FamilyPageId;
  pageNumber: number;
  fieldPath: string;
  canvaField: string;
  label: string;
  reasons: Array<"characters" | "lines">;
  maxCharacters: number;
  actualCharacters: number;
  maxLines: number;
  explicitLines: number;
  estimatedLines: number;
  message: string;
};
export type CanvaTextPreflight = { applicable: boolean; ok: boolean; issues: CanvaTextIssue[]; notice: string };

/** These are the fixed reading-v1.1 boxes, not limits on saved authoring text.
 * The matching Canva masters and build-canva-masters.mjs use these 1080×1350
 * box widths/type sizes. Heights were expanded for the guide's AI budgets.
 * Font shaping, line breaking, and Canva edits still require an 8-page review. */
type Box = { canvaField: string; width: number; fontSize: number; maxLines: number };
const box = (canvaField: string, width: number, fontSize: number, maxLines: number): Box => ({ canvaField, width, fontSize, maxLines });
const boxes: Record<string, Box> = {
  "cover.fields.headline": box("P01_HEADLINE", 920, 88, 3),
  "cover.fields.subtitle": box("P01_SUBTITLE", 870, 39, 2),
  "news_summary.fields.title": box("P02_TITLE", 900, 54, 2),
  "news_summary.fields.facts": box("P02_FACTS", 850, 46, 2), // Per fact; aggregate checked below.
  "news_summary.fields.caveat": box("P02_CAVEAT", 820, 32, 2),
  "implication.fields.title": box("P03_TITLE", 900, 54, 2),
  "implication.fields.takeaway": box("P03_TAKEAWAY", 880, 70, 5),
  "discussion.fields.title": box("P04_TITLE", 900, 54, 2),
  "discussion.fields.scenario": box("P04_SCENARIO", 840, 43, 3),
  "discussion.fields.question": box("P04_QUESTION", 880, 64, 4),
  "perspectives.fields.title": box("P05_TITLE", 900, 54, 2),
  "perspectives.fields.viewA.label": box("P05_A_LABEL", 820, 33, 1),
  "perspectives.fields.viewA.body": box("P05_A_BODY", 820, 45, 3),
  "perspectives.fields.viewB.label": box("P05_B_LABEL", 820, 33, 1),
  "perspectives.fields.viewB.body": box("P05_B_BODY", 820, 45, 3),
  "concept.fields.title": box("P06_TITLE", 900, 54, 2),
  "concept.fields.concept": box("P06_CONCEPT", 900, 50, 2),
  "concept.fields.definitionA": box("P06_DEFINITION_A", 840, 43, 2),
  "concept.fields.definitionB": box("P06_DEFINITION_B", 840, 43, 2),
  "concept.fields.boundaryCase": box("P06_BOUNDARY_CASE", 840, 37, 2),
  "concept.fields.acceptedDefinition": box("P06_ACCEPTED_DEFINITION", 840, 45, 3),
  "concept.fields.exampleOrNonExample": box("P06_EXAMPLE_OR_NON_EXAMPLE", 840, 40, 2),
  "concept.fields.fillIn": box("P06_FILL_IN", 840, 39, 2),
  "activity.fields.title": box("P07_TITLE", 900, 54, 2),
  "activity.fields.homeActivity.label": box("P07_HOME_LABEL", 820, 37, 1),
  "activity.fields.homeActivity.action": box("P07_HOME_ACTION", 860, 55, 4),
  "activity.fields.optionalActivity.label": box("P07_OPTIONAL_LABEL", 820, 32, 1),
  "activity.fields.optionalActivity.action": box("P07_OPTIONAL_ACTION", 840, 42, 4),
  "outro.fields.brandName": box("P08_BRAND_NAME", 900, 94, 1),
  "outro.fields.parentBrand": box("P08_PARENT_BRAND", 720, 33, 1),
  "outro.fields.brandLine": box("P08_BRAND_LINE", 880, 43, 1),
  "outro.fields.cta": box("P08_CTA", 880, 31, 2),
  "outro.fields.handle": box("P08_HANDLE", 780, 27, 1),
};

// Deliberately conservative width estimates. Hangul and other non-ASCII glyphs
// consume a full em. Latin's separate estimate permits the approved ALLligodang
// wordmark without pretending that a code-point count is a font measurement.
function estimatedEm(character: string): number {
  if (character === "\t") return 4;
  if (character === " ") return 0.6;
  if (/^[WM@]$/.test(character)) return 1;
  if (/^[A-Z]$/.test(character)) return 0.85;
  if (/^[a-z0-9]$/.test(character)) return 0.75;
  if (/^[\x21-\x7e]$/.test(character)) return 0.7;
  return 1;
}
function measured(value: string, target: Box) {
  // Normalization is only for measurement. The caller's text is never returned
  // rewritten, trimmed, shortened, resized, or otherwise mutated.
  const paragraphs = value.replace(/\r\n|\r|\u2028|\u2029/g, "\n").split("\n");
  const widthEm = target.width / target.fontSize;
  const estimatedLines = value === "" ? 0 : paragraphs.reduce((sum, line) => {
    const em = [...line].reduce((width, character) => width + estimatedEm(character), 0);
    return sum + Math.max(1, Math.ceil(em / widthEm - 1e-9));
  }, 0);
  return { actualCharacters: [...value].length, explicitLines: value === "" ? 0 : paragraphs.length, estimatedLines };
}

/** Conservative preflight for only the four prepared autofill masters.
 * A successful result is not proof that text fits Canva: inspect all 8 actual
 * exported pages. Manual/imported designs and other templates are out of scope.
 * The input copy stays intact even when autofill must stop. */
export function checkCanvaTextLimits(copy: CardCopyV2, target: CanvaTextTarget): CanvaTextPreflight {
  const applicable = ["create", "autofill"].includes(target.purpose)
    && target.templateVersion === CANVA_READING_TEMPLATE_VERSION
    && CANVA_READING_MASTERS.some(master => master.sourceId === target.sourceId);
  const notice = "고정 Canva 마스터의 글자·줄 수를 보수적으로 사전 점검합니다. 실제 글꼴과 줄바꿈을 보장하지 않으므로 완성된 8장을 모두 확인해 주세요.";
  if (!applicable) return { applicable: false, ok: true, issues: [], notice };

  const issues: CanvaTextIssue[] = [];
  const hasExternalActivity = copy.pages.some(page => page.id === "activity" && page.fields.optionalActivity !== null);
  function check(pageId: FamilyPageId, pageNumber: number, fieldPath: string, label: string, value: string, maxCharacters: number, targetBox: Box) {
    const metrics = measured(value, targetBox);
    const reasons: CanvaTextIssue["reasons"] = [];
    if (metrics.actualCharacters > maxCharacters) reasons.push("characters");
    if (metrics.estimatedLines > targetBox.maxLines) reasons.push("lines");
    if (!reasons.length) return;
    const limits = [reasons.includes("characters") ? `글자 ${metrics.actualCharacters}자 / ${maxCharacters}자` : "", reasons.includes("lines") ? `예상 ${metrics.estimatedLines}줄 / 최대 ${targetBox.maxLines}줄(직접 입력한 줄 ${metrics.explicitLines}개)` : ""].filter(Boolean).join(" · ");
    issues.push({ pageId, pageNumber, fieldPath, canvaField: targetBox.canvaField, label, reasons, maxCharacters, ...metrics, maxLines: targetBox.maxLines,
      message: `${pageNumber}페이지 ${FAMILY_PAGE_LABELS[pageId]} · ${label}: ${limits}. 원고를 자르지 않고 자동 채우기를 멈춥니다. 문구·줄바꿈을 직접 조정하거나 Canva에서 수동 배치한 뒤 가져와 주세요.` });
  }

  for (const page of copy.pages) for (const descriptor of familyFieldDescriptors(page)) {
    const key = `${page.id}.${descriptor.path}`;
    const configured = boxes[key];
    if (!configured) throw new Error(`${page.page}페이지 ${descriptor.label}의 Canva 사전 점검 기준이 없습니다. 원고를 보존하고 마스터 설정을 확인해 주세요.`);
    const targetBox = hasExternalActivity && key === "activity.fields.homeActivity.action" ? box("P07_HOME_ACTION", 840, 42, 4)
      : hasExternalActivity && key === "activity.fields.homeActivity.label" ? box("P07_HOME_LABEL", 820, 33, 1) : configured;
    const value = familyFieldValue(copy, descriptor.fieldPath);
    if (Array.isArray(value)) value.forEach((entry, index) => check(page.id, page.page, `${descriptor.fieldPath}.${index}`, `${descriptor.label} ${index + 1}`, entry, descriptor.initialBudget, targetBox));
    else if (typeof value === "string") check(page.id, page.page, descriptor.fieldPath, descriptor.label, value, descriptor.initialBudget, targetBox);
  }
  // The real mapper inserts a blank line between facts. Check its aggregate
  // string as well as each semantic fact so separator height cannot disappear.
  const mappedFacts = canvaTextFields(copy).P02_FACTS.text;
  check("news_summary", 2, "pages.news_summary.fields.facts", "뉴스 요약 전체(사실 사이 빈줄 포함)", mappedFacts, 35 * 3 + 4, box("P02_FACTS", 850, 46, 8));
  return { applicable: true, ok: issues.length === 0, issues, notice };
}
