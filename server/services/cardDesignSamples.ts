import fs from "node:fs";
import path from "node:path";
import { cardDesign } from "../../shared/cardDesigns";
import { planCarousel, renderCarouselCover } from "./cardCarousel";
import { renderCollectionBody } from "./cardCollection";
import type { CardStyle } from "./card";

/** Fictional, explicitly labelled content. Never used as actual generated content. */
export function collectionSample(id: string) {
  const d = cardDesign(id);
  if (!d) throw new Error("알 수 없는 카드 세트");
  const notice = d.family === "recruitment";
  const input = {
    kind: notice ? "notice" : "current_dialogue",
    payload: notice ? {
      title: "청소년 우주탐구 캠프\n참가자 모집", category: "모집 디자인 예시",
      one_line_summary: "질문에서 시작해 나만의 탐구를 완성하는 겨울 과학 캠프입니다.",
      organization: "미래탐구연구소 (가상 기관)", academic_year: "2027 겨울 프로그램",
      audience: "우주와 과학이 궁금한 중학교 1–3학년 학생",
      eligibility: "처음 참여해도 괜찮아요. 함께 배우려는 호기심을 준비해 주세요.",
      schedules: [{ kind: "apply", label: "예시 접수 기간", start: { date: "2026-12-02" }, end: { date: "2026-12-12" } }, { kind: "event", label: "예시 캠프 일정", start: { date: "2027-01-16" }, end: { date: "2027-01-17" } }],
      deadline_type: "fixed", key_details: "관심 있는 탐구 주제와 참여 이유를 작성해 신청합니다.",
      uncertainties: "실제 모집 공고가 아닙니다. 기간·대상·기관은 디자인 비교용 예시입니다.",
    } : {
      title: "학교의 AI 활용 지침\n무엇이 달라질까", category: "뉴스 디자인 예시",
      summary: "학교에서 AI 활용 지침을 만든다면 무엇을 담아야 할까요? 가상 상황으로 살펴봅니다.",
      why_it_matters: "학습에 도움을 받는 방법과 스스로 생각해야 할 범위를 함께 정해야 합니다.",
      verified_facts: ["이 카드는 실제 사건을 보도하지 않는 디자인 예시입니다."],
      under_verification: ["구체적인 적용 시기와 대상은 실제 원문 확인이 필요한 항목입니다."],
      perspectives: [{ stakeholder: "학생의 질문", view: "어디까지 도움을 받아도 될까요?" }, { stakeholder: "교사의 질문", view: "생각의 과정을 어떻게 확인할까요?" }],
      glossary: [{ term: "활용 지침", meaning: "사용 범위와 책임을 정한 안내" }],
      discussion_questions: ["AI의 도움과 나의 생각을 어떻게 구분해 표시하면 좋을까요?"],
      parent_hints: "정답을 정하기보다 도움받은 과정부터 함께 이야기해 보세요.",
    },
    channelName: notice ? "새로운 배움" : "오늘의 맥락", accent: d.accent,
    sourceOrg: "디자인 예시", checkedDate: "2026-10-31",
  };
  const style: CardStyle = { layout: "minimal", collection: id };
  const plan = planCarousel(input, style);
  plan.base.brandLine = "우주펭귄상회 / " + (notice ? "모집정보" : "뉴스 브리핑");
  plan.base.badge = notice ? "모집 디자인 예시" : "뉴스 디자인 예시";
  plan.base.footer = "디자인 예시 · 실제 모집/보도 아님 · 우주펭귄상회";
  plan.pages.forEach(p => { p.brandLine = plan.base.brandLine; p.footer = plan.base.footer; });
  return { d, style, plan };
}
export function collectionSampleArt(id: string) {
  const d = cardDesign(id);
  if (!d) throw new Error("알 수 없는 카드 세트");
  return fs.readFileSync(path.resolve(process.cwd(), `assets/card-art/${d.art}.jpg`));
}
export async function renderCollectionPreview(id: string, page = 0) {
  const { plan, style } = collectionSample(id);
  if (page === 0) return renderCarouselCover(plan.base, plan.count, collectionSampleArt(id), "이미지: AI 생성 · 연출 이미지", style);
  const model = plan.pages[page - 1];
  if (!model) throw new Error("미리보기 페이지를 찾을 수 없습니다.");
  return renderCollectionBody(model, id);
}
