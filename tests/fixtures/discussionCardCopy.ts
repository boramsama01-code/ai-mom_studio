import type { CardCopy } from "../../shared/cardCopy";

/** Synthetic editorial text for isolated renderer tests, not a published article summary. */
export function discussionCardCopyFixture(templateKey = "set:n03"): CardCopy {
  return {
    version: 1, storyFormat: "discussion8", templateKey,
    cover: { title: "정답을 잘 맞히면,\n똑똑한 걸까?", subtitle: "AI의 시험 점수와 실제 판단 사이" },
    pages: [
      { id: "body-1", role: "summary", title: "높은 점수,\n그 다음은?", subtitle: "무엇을 평가했는지부터 살펴봐요", body: "한 평가에서는 AI가 어려운 문제의 답을 빠르게 찾아냈습니다. 다만 정해진 문제에서 얻은 점수가 새로운 상황의 판단력까지 보여 주는지는 따로 살펴봐야 합니다.", sourceIds: [1] },
      { id: "body-2", role: "implication", title: "점수와 판단은\n다를 수 있습니다", subtitle: "결과를 읽는 또 하나의 기준", body: "능력을 평가하려면 무엇을 잘했는지뿐 아니라, 어떤 상황에서 잘했는지도 물어야 합니다." },
      { id: "body-3", role: "discussion", title: "우리 집 숙제에\nAI를 쓴다면?", subtitle: "선택한 이유도 함께 이야기해요", body: "답은 늘 맞지만 이유를 설명하지 못하는 친구와, 가끔 틀려도 스스로 고치는 친구. 누구에게 조언을 구하고 싶은가요?" },
      { id: "body-4", role: "perspectives", title: "‘똑똑함’을 보는\n두 가지 기준", subtitle: "같은 결과에도 서로 다른 질문을 던질 수 있어요", body: "어느 쪽을 더 중요하게 생각하나요?", columns: [{ title: "정답을 찾는 능력", body: "정확한 답을 빠르게 찾으면 복잡한 일을 해결하는 데 도움이 됩니다. 무엇을 얼마나 잘했는지 측정할 수 있죠." }, { title: "판단을 고치는 능력", body: "상황이 바뀌었을 때 잘못을 알아차리고 이유를 다시 살피는 일도 중요합니다. 점수만으로는 보기 어려운 능력이죠." }] },
      { id: "body-5", role: "concept", title: "나에게 ‘똑똑하다’는?", subtitle: "정의의 예시를 비교해 보세요", body: "나는 ___할 때 똑똑하다고 생각해요. 그 이유는 ___예요.", columns: [{ title: "많이 아는 사람", body: "필요한 정보를 기억하고, 문제에 맞는 답을 빠르게 찾아내는 사람." }, { title: "다시 생각하는 사람", body: "모르는 것을 인정하고, 새로운 근거를 만나면 자신의 판단을 바꾸는 사람." }] },
      { id: "body-6", role: "activity", title: "같은 질문,\n답은 어떻게 다를까?", subtitle: "종이 한 장으로 시작해요", body: "일상 질문 하나를 정해 각자 답과 이유를 적어 보세요. 답을 서로 바꿔 읽고, 생각을 바꿀 만한 근거를 한 가지씩 찾아 기록해 보세요." },
      { id: "body-7", role: "closing", title: "하루 한 번,\n생각을 나누는 시간", subtitle: "좋아요 · 저장 · 구독", body: "오늘의 질문을 저장하고,\n우리의 다음 대화도 함께해요." },
    ],
  };
}
