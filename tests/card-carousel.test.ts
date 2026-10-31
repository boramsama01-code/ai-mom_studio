import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { carouselSections, planCarousel, renderCarouselPages, cardApprovalHash } from "../server/services/cardCarousel";
import { CardOverflowError } from "../server/services/card";

export const science = { topic: "빛", age_band: "중학생", key_question: "하늘은 왜 파랗게 보일까요?", background: ["태양빛에는 여러 색이 섞여 있습니다.", "빛은 공기를 지나며 흩어집니다.", "색마다 흩어지는 정도가 다릅니다."], scientific_basis: "짧은 파장의 빛이 더 많이 산란합니다.", misconceptions: ["공기가 파란 물감으로 칠해진 것은 아닙니다."], discussion_questions: ["해질 무렵에는 왜 다를까요?", "달에서도 같을까요?", "무엇을 관찰하면 좋을까요?"], parent_hints: ["관찰한 색부터 이야기해 보세요."], safe_activity: "낮과 저녁의 하늘색을 비교해 보세요.", sources: [], evidence: [] };
const input = { kind: "science_dialogue", payload: science, channelName: "과학 대화", accent: "#285f6a", sourceOrg: "원문", checkedDate: "2026-11-01" };
describe("readable multi-page card news", () => {
  it("makes a cover and four sections, preserving every science question and hint", async () => {
    const plan = planCarousel(input, { layout: "classic" });
    expect(plan.count).toBe(5);
    const text = plan.pages.flatMap(p => p.blocks.map(b => b.text)).join("\n");
    [...science.background, science.scientific_basis, ...science.discussion_questions, ...science.parent_hints, science.safe_activity].forEach(t => expect(text).toContain(t));
    const pages = await renderCarouselPages(plan, { layout: "classic" }, null, "우주펭귄상회 스튜디오");
    expect(pages).toHaveLength(5);
    for (const p of pages) expect(await sharp(p.bytes).metadata()).toMatchObject({ width: 1080, height: 1350, format: "jpeg" });
  });
  it("continues long paragraphs on later pages without losing text", () => {
    const long = "실험 결과를 다시 살펴보고 관찰한 내용과 추론한 내용을 구분합니다. ".repeat(25).trim();
    const plan = planCarousel({ ...input, payload: { ...science, scientific_basis: long } }, { layout: "classic" });
    expect(plan.count).toBeGreaterThan(5); expect(plan.count).toBeLessThanOrEqual(10);
    const preserved = plan.pages.flatMap(p => p.blocks).filter(b => b.field === "scientific_basis").map(b => b.text).join("").replace(/\s/g, "");
    expect(preserved).toBe(long.replace(/\s/g, ""));
  });
  it("keeps verification caveats and every schedule in the page plan", () => {
    const current = carouselSections("current_dialogue", { under_verification: ["발표는 아직 확인 중"], perspectives: [{ stakeholder: "학교", view: "추가 논의" }], glossary: [{ term: "확인", meaning: "근거를 대조" }] });
    expect(JSON.stringify(current)).toContain("발표는 아직 확인 중"); expect(JSON.stringify(current)).toContain("학교: 추가 논의");
    const schedules = Array.from({ length: 6 }, (_, i) => ({ kind: "apply", label: `접수 ${i}`, raw: `원문 일정 ${i}` }));
    const notice = JSON.stringify(carouselSections("notice", { schedules, deadline_type: "unknown" }));
    schedules.forEach(s => expect(notice).toContain(s.label));
  });
  it("rejects more than ten pages rather than omitting the tail", () => {
    expect(() => planCarousel({ ...input, payload: { ...science, scientific_basis: "아주 긴 근거입니다. ".repeat(1500) } }, { layout: "classic" })).toThrow(CardOverflowError);
  });
  it("binds both the cover identity and approval to every ordered page", async () => {
    const a = await renderCarouselPages(planCarousel(input, { layout: "classic" }), { layout: "classic" }, null, "스튜디오");
    const b = await renderCarouselPages(planCarousel(input, { layout: "minimal" }), { layout: "minimal" }, null, "스튜디오");
    expect(a[0].bytes.equals(b[0].bytes)).toBe(false);
    expect(cardApprovalHash(a)).not.toBe(cardApprovalHash([...a].reverse()));
    expect(cardApprovalHash(a)).not.toBe(cardApprovalHash([a[0], { bytes: Buffer.from("changed") }, ...a.slice(2)]));
  });
});
