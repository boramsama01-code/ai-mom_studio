import { studioKey } from "./channelKeys";

export const HIGHSCOOP_TITLE_PROMPT_VERSION = "highscoop-title-v1.0-20261105";

/** Cover copy only. Official source titles, eligibility and schedules remain factual. */
export const HIGHSCOOP_TITLE_RULES = `하이스쿱 표지 제목 편집 기준
독자는 중고등학생과 학부모다. 입시·선발·대회·캠프의 기회, 학습·탐구·자소서의 구체적인 막힘을 짧고 강하게 표현한다.
목표는 내용을 설명하는 목차가 아니라, 독자가 자기 상황을 떠올리고 다음 장을 읽고 싶어지는 제목이다. 문구를 지나치게 순하게 만들어 긴장감과 궁금증을 지우지 않는다.

[표현]
- 짧은 반문·명령형·반전·구체적인 장면을 적극적으로 쓴다. 메인 제목은 한 가지 메시지, 두 줄 안팎을 목표로 하되 선택한 템플릿의 글자 한도를 우선한다.
- 자기주도성의 중요성, 함께 생각하기, 알아두면 좋은 정보처럼 추상적인 설명을 메인 제목으로 쓰지 않는다.
- 본문이 뒷받침할 때의 말투 예시: 자소서는 엄마가 쓰고, 면접은 누가 보나요? / “열심히 했습니다.” 그래서 뭘 했는데? / 시간표에 “아무것도 안 함” 넣으세요. 예시의 상황이나 주장을 입력 자료에 없는 사실로 옮기지 않는다.
- 숫자는 실제 제공할 항목 수와 일치시킨다. 반복되거나 약한 항목을 넣어 숫자를 채우지 않는다.

[소재에 맞추기]
- 모집·선발 공고는 확인된 지원 대상·지원 기회·조건·혜택·준비 행동으로 관심을 끈다. 기관명·모집 연도·대상·핵심 제한 중 오해를 막는 정보는 표지 부제에 남긴다. 실제 모집 내용에 없는 면접·특전·추천·전국 지원 가능 조건을 만들지 않는다.
- 원문 공고 제목, 기관명, 지원 자격, 접수 일정은 사실 필드로 보존한다. 표지 카피와 바꾸어 저장하지 않는다. 접수 종료·결과 발표·사후 홍보를 현재 모집 중인 기회로 바꾸지 않는다.
- 기준일과 실제 마감일이 확인되지 않으면 오늘 마감, D-3, 마감 임박 같은 긴급성을 만들지 않는다. 확인된 날짜는 정확히 적는다.
- 학습·자소서·부모 조언은 구체적인 행동이나 문장에 대해 단호하게 말할 수 있다. 독자의 인격이나 지능을 깎아내리지 않는다.

[제목과 본문 연결]
- 제목에서 약속한 사례·지원 조건·방법을 첫 본문 카드에서 즉시 보여준다. 제목만 수정하는 요청이면 이미 있는 첫 본문 카드가 제공하는 내용에 맞춰 제목을 고른다.
- 합격·불합격·성적 향상·과학적 효과를 근거 없이 예언하지 않는다. 전문가 권위, 합격자 공통점, 비밀 정보, 실제 후기나 비교 결과를 만들지 않는다.
- 질문표를 붙여 확인되지 않은 주장을 암시하지 않는다. 표지에서 한 말을 본문에서 사실이 아니라고 취소하는 낚시를 쓰지 않는다.
- 찔리는 장면형·실수 경고형·예상 뒤집기형·작은 행동/기회형을 각각 3개씩, 총 12개 후보 방향으로 비교한다. 자료가 부족한 유형은 사실에 맞는 방향으로 바꾸고, 이해하기 쉬움·구체성·궁금증·본문 약속 이행을 기준으로 가장 적합한 제목을 선택한다.
- 사용자가 잠근 제목, 기존 원고와 요청하지 않은 페이지는 보존한다. 이 지침은 새 제목 생성 또는 명시적인 표지·제목 수정 범위에만 적용한다.`;

type HighscoopTitleOutput = "card_copy" | "family" | "studio" | "manual";

/** Stable channel keys prevent custom notice channels from inheriting this voice. */
export function highscoopTitlePrompt(channelKey: string | undefined, output: HighscoopTitleOutput = "card_copy"): string {
  if (!channelKey || studioKey(channelKey) !== "highscoop") return "";
  const contract = output === "card_copy"
    ? "최종 제목 하나는 cover.title, 부제 하나는 cover.subtitle에 넣는다. 후보·평가·새 필드를 JSON에 추가하지 않는다. 기존 카드 장수와 출력 스키마를 유지한다."
    : output === "family"
      ? "8장 원고 pages 중 id가 cover인 페이지의 fields.headline에 최종 제목 하나, fields.subtitle에 부제 하나를 넣는다. coverTitleCandidates는 요청된 기존 출력 스키마 범위에서만 작성한다. V1의 cover.title 필드나 평가용 새 필드를 추가하지 않는다. 기존 8장 구조와 선택한 재작성 범위를 유지한다."
    : output === "studio"
      ? "새 제목 또는 제목 재작성이 요청된 경우에만 최종 제목 하나를 기존 title 필드에 넣는다. 후보·평가·새 필드를 JSON에 추가하지 않는다. script, panels, caption의 기존 출력 구조와 장수를 유지한다."
      : "편집자용 제목 후보 3개와 각각의 작은 부제·첫 본문에서 보여줄 내용을 초안과 구분해 제시한다. 추천 제목 하나를 표지에 적용한 완성 초안도 작성한다. 후보 목록은 게시용 본문이나 캡션에 넣지 않는다.";
  return `[HighScoop 제목 지침 ${HIGHSCOOP_TITLE_PROMPT_VERSION}]\n${HIGHSCOOP_TITLE_RULES}\n\n[출력 연결]\n${contract}`;
}
