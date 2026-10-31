import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { loadFonts, wrapText, layoutCard, renderCardJpeg, type CardModel } from "../server/services/card";
const title = "AI가 코딩을 더 잘한다면, 그것만으로 인간보다 모든 면에서 똑똑하다고 판단해도 될까?";
const sentence = "제공된 자료에서 확인한 사실과 아직 검증하지 않은 주장을 구분해야 합니다. ";
function background(lines: number) {
  let text = "";
  while (wrapText(loadFonts().regular, text, 34, 912).length < lines) text += sentence;
  return text.trim();
}
function model(lines = 7): CardModel {
  return { accent: "#285f6a", brandLine: "우주펭귄상회 스튜디오", badge: "오늘의 과학 질문", title,
    blocks: [
      { field: "background", label: "알아두면 좋은 배경", text: background(lines), maxLines: 6 },
      { field: "discussion_questions", label: "함께 생각해 볼 질문", text: "유명 전문가의 이름, 정확한 주장과 증명 원문, 공개된 형식화 자료, 외부 검증자의 검토 결과 중 무엇을 먼저 확인할까? 각 자료가 어떤 의문을 풀어 줄지 설명해 보자.", maxLines: 3, emphasis: true },
    ], footer: "출처: 확인한 원문 · 확인 2026-10-31" };
}
describe("whole-card title and body fitting", () => {
  it.each(["classic", "header", "magazine", "minimal"] as const)("%s fits a long question title without altering source text", async layout => {
    const input = model(), before = JSON.stringify(input);
    expect(wrapText(loadFonts().bold, input.title, 74, 912).length).toBeGreaterThan(3);
    const output = await renderCardJpeg(input, { layout });
    expect((await sharp(output.jpeg).metadata()).width).toBe(1080);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(["classic", "header", "magazine", "minimal"] as const)("%s shares available space with a ten-line background", () => {
    const input = model(10), before = JSON.stringify(input);
    expect(wrapText(loadFonts().regular, input.blocks[0].text, 34, 912)).toHaveLength(10);
    expect(layoutCard(input, { layout })).toContain('<svg');
    expect(JSON.stringify(input)).toBe(before);
  });
});
