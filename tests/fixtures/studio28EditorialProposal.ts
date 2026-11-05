import type { CardCopy } from "../../shared/cardCopy";

/** Manual editorial proposal grounded in source 2600's Gates interview/forecast.
 * This is review material, not an AI response or a change to production item 28.
 * Interpretive questions, definition examples and the hypothetical discussion
 * scenario are editorial additions; only the summary attributes article facts.
 */
export function studio28EditorialProposal(templateKey = "set:n03"): CardCopy {
  return {
    version: 1, storyFormat: "discussion8", templateKey,
    cover: { title: "코딩을 더 잘하면,\n더 똑똑한 걸까?", subtitle: "빌 게이츠의 전망에서 시작하는 지능 이야기" },
    pages: [
      { id: "body-1", role: "summary", title: "게이츠가 내다본\nAI의 미래", subtitle: "인터뷰 발언과 연구 결과를 구분해요", body: "빌 게이츠는 AI가 코딩 등 전문 업무에서 사람을 앞설 것이라고 전망했어요. 기사는 그의 인터뷰 발언을 전합니다. 모든 지능에서 AI가 우월하다는 연구 결과는 아니에요.", sourceIds: [2600] },
      { id: "body-2", role: "implication", title: "평가 기준이\n달라질 때", subtitle: "기사의 의미를 생각해 보는 질문", body: "일을 잘 해내는 능력과, 무엇을 위해 할지 판단하는 능력은 같은 기준으로 볼 수 있을까요?" },
      { id: "body-3", role: "discussion", title: "좋은 답의 기준은?", subtitle: "이 상황을 가정하고 이유를 나눠 보세요", body: "AI가 숙제를 더 빠르고 정확하게 풀었어요. 친구는 답이 왜 옳은지 설명하고 잘못된 조건도 찾아냈죠. 누가 더 똑똑하다고 느끼나요? 그 기준은 무엇인가요?" },
      { id: "body-4", role: "perspectives", title: "지능을 보는\n두 가지 시선", subtitle: "", body: "내가 더 중요하게 여기는 기준은 무엇인가요?", columns: [{ title: "성과를 보는 시선", body: "빠르고 정확하게 문제를 해결한다면 높은 지능이라고 볼 수 있어요." }, { title: "판단을 보는 시선", body: "목표를 의심하고 맥락·책임까지 살필 수 있어야 한다고 볼 수도 있어요." }] },
      { id: "body-5", role: "concept", title: "나에게 똑똑함이란", subtitle: "정의의 예시를 비교하고 내 말로 완성해요", body: "나는 똑똑함을 ___라고 정의한다. 왜냐하면 ___.", columns: [{ title: "정의 A · 해결하는 힘", body: "똑똑함은 주어진 목표를 효율적으로 달성하는 능력이다." }, { title: "정의 B · 판단하는 힘", body: "똑똑함은 어떤 목표가 좋은지 묻고 이유를 설명하는 능력이다." }] },
      { id: "body-6", role: "activity", title: "전망과 사실,\n색을 나눠 보기", subtitle: "형광펜 두 색과 종이 한 장", body: "원문에서 이미 확인된 일은 파랑, 앞으로의 전망은 노랑으로 표시해 보세요. 가장 궁금한 주장 하나를 골라, 확인에 필요한 근거를 적어 보세요." },
      { id: "body-7", role: "closing", title: "한 가지 뉴스,\n우리만의 질문", subtitle: "", body: "오늘의 생각을 댓글로 나눠 주세요. 다음 대화도 함께하려면 저장·좋아요." },
    ],
  };
}
