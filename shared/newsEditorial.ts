/** Stable editorial roles: the first page is the cover, followed by these seven pages. */
export const NEWS_EDITORIAL_ROLES = ["summary", "implication", "discussion", "perspectives", "concept", "activity", "closing"] as const;
export type NewsEditorialRole = typeof NEWS_EDITORIAL_ROLES[number];
export const NEWS_EDITORIAL_LABELS: Record<NewsEditorialRole, string> = {
  summary: "뉴스 요약", implication: "뉴스의 의미", discussion: "함께 생각할 질문", perspectives: "두 가지 시선",
  concept: "나만의 개념 정의", activity: "생각을 넓히는 활동", closing: "닫는 표지",
};
export const NEWS_EDITORIAL_AI_LIMITS = { coverTitle: 56, title: 36, subtitle: 52, body: 140, columnTitle: 24, columnBody: 100 } as const;
export const NEWS_EDITORIAL_BODY_LIMITS: Partial<Record<NewsEditorialRole, number>> = { implication: 90, perspectives: 70, concept: 70, closing: 80 };

/** A page has a job in the story, rather than being another repeated article summary. */
export function discussionCardCopyInstruction(templateKey: string): string {
  return `카드뉴스는 정확히 8장입니다. version=1, storyFormat="discussion8", templateKey=${JSON.stringify(templateKey)}.
cover 1장과 pages 7장을 반환합니다. pages의 id는 body-1부터 body-7까지, role은 summary, implication, discussion, perspectives, concept, activity, closing 순서입니다.
표지: 확인된 사실을 해치지 않는 짧은 질문이나 구체적인 긴장으로 호기심을 엽니다. title 56자, subtitle 52자 이내. 전망·주장·인터뷰를 확정 사실로 바꾸지 말고 발언 주체와 조건을 유지합니다. 공포·과장·낚시성 단정은 금지합니다.
2장 summary: 누가 무엇을 했거나 말했는지, 핵심 조건과 한계를 설명합니다. 원문의 사실·연구 결과·발언·미확인을 구분합니다. body 140자 이내.
3장 implication: 이 뉴스가 우리 판단이나 생활에 던지는 의미를 한 문장으로 강조합니다. 기사에서 확인된 사실과 구분되는 해석입니다. body 90자 이내. 원문보다 더 센 결론을 내리지 않습니다.
4장 discussion: 중학생과 부모가 서로 다른 이유를 말할 수 있는 구체적 상황과 열린 질문 하나를 씁니다. 단순 찬반이나 정답 맞히기는 피하고, 답에 근거를 붙일 수 있게 합니다. body 140자 이내.
5장 perspectives: 같은 확인된 사실을 바라보는 두 판단 기준을 columns 두 칸으로 제시합니다. 각 칸은 title 24자, body 100자 이내. 기대와 한계·권리와 책임처럼 의미 있는 기준을 대비합니다. 사실과 거짓을 반반으로 배치하거나 당사자의 실제 발언처럼 꾸미지 않습니다. 페이지 body는 두 기준을 연결하는 질문으로 70자 이내.
6장 concept: 기사의 주요 개념 하나를 고르고, columns 두 칸에 서로 다른 정의의 예시를 제시합니다(title 24자, body 100자 이내). 누가 실제로 내린 정의인 것처럼 꾸미지 않습니다. 페이지 body는 독자가 자신의 정의와 이유를 완성하도록 돕는 문장으로 70자 이내.
7장 activity: 관련 내용을 더 살펴볼 구체적인 활동 한 개를 제안합니다. 무엇을 하고 어떤 결과물을 남길지 적습니다. 논문·기관·과학관·일정·URL은 제공된 검증 자료에 있을 때만 사용합니다. 제공된 추가 참고자료가 직접 관련될 때만 resourceSourceId로 그 source_id를 선택합니다. 제목이나 URL을 직접 생성하지 않습니다. 없으면 집에서 하는 비교·관찰·기록, 원문 근거 표시, 공식 사이트에서 검색할 주제처럼 실행 가능한 활동으로 제안합니다. 인터넷을 확인했다고 주장하지 않습니다. body 140자 이내.
8장 closing: 채널 브랜드를 기억하게 하고 저장·좋아요·다음 대화를 간결하게 권합니다. 새로운 사실이나 원문 요약을 추가하지 않습니다. body 80자 이내.
모든 본문 title은 36자, subtitle은 52자 이내입니다. subtitle이 불필요하면 빈 문자열로 둡니다. title과 body는 비우지 않습니다. columns는 perspectives와 concept에만 정확히 두 개씩 사용합니다.
한 페이지에 한 가지 역할을 담고, 같은 문장을 제목·부제·본문에서 반복하지 않습니다. 중앙 정렬에 맞게 짧고 자연스러운 완결 문장으로 씁니다. 의미를 잃는 명사 나열이나 교훈적인 상투어로 채우지 않습니다.
sourceIds를 넣을 경우 실제 제공된 source_id만 사용합니다. 원문 인용은 그대로인지 검증 가능한 짧은 구절만 사용합니다. URL·이미지 ID·background 필드는 생성하지 않습니다. 게시 캡션과 이미지 설명을 카드 본문에 섞지 않습니다.`;
}
