/** Free, conservative triage. A recruitment clue is NOT proof that applications are open. */
export const NOTICE_INTENTS = ["candidate", "uncertain", "retrospective", "closed", "off_topic"] as const;
export type NoticeIntent = typeof NOTICE_INTENTS[number];
export const NOTICE_INTENT_LABEL: Record<NoticeIntent, string> = {
  candidate: "모집·접수 후보", uncertain: "확인 필요", retrospective: "사후·홍보", closed: "마감 확인", off_topic: "대상 외 모집",
};
// These patterns are also used in PostgreSQL so filtering happens BEFORE pagination.
export const NOTICE_PATTERNS = {
  recruitment: "모집|접수|신청|공모전|교육\\s*안내|예약|모집\\s*요강|입학\\s*전형|전형\\s*(요강|일정|안내|계획)|입학\\s*설명회|선발\\s*(공고|안내|계획)|참가\\s*(안내|신청)|교육대상자\\s*(선발|모집)",
  retrospective: "성료|성황|성공적.{0,8}(마무리|개최)|개최했다|개최하였다|진행했다|진행하였다|마무리했다|수료식|졸업식|시상식|수상|수상자|입상|금메달|은메달|동메달|대상\\s*수상|합격자\\s*(발표|배출)|선발\\s*결과|선정\\s*결과|모집\\s*(마감|완료)|접수\\s*(종료|완료)|참가\\s*후기|활동\\s*성과|성과\\s*(발표|보고)|협약\\s*체결|업무\\s*협약",
  invitation: "추가\\s*모집|재모집|접수\\s*(중|시작|예정|연장)|신청\\s*(가능|받|하세요|바랍니다)|모집\\s*(중|시작|예정|한다|합니다)|참가자.{0,12}모집|참여자.{0,12}모집|신입생.{0,12}모집",
  futureInvitation: "추가\\s*모집|재모집|(다음|차기|내년).{0,25}(모집|접수|신청)|접수\\s*(중|예정|연장)|모집\\s*(중|예정)|신청\\s*(가능|하세요)",
  offTopic: "(교원|교사|교수|강사|직원|인턴|멘토|연구직).{0,6}(모집|채용)|(연구원|연구교원)\\s*(공개\\s*)?(모집|채용)|채용\\s*공고|임용후보자|임용시험|입찰|공시\\s*송달|공시송달|용역|평가위원|심사위원.{0,12}모집|교육전문직|교사용|명예퇴직|수석교사|스쿨뱅킹|출금동의|자동이체|기업.{0,8}모집|유아.{0,4}(모집|선발)|원아\\s*모집|대학원.{0,12}(모집|입학)|성인\\s*(대상|전용)",
  deadlineSoon: "마감\\s*(임박|예정|연장)|마감까지\\s*[0-9]+일",
  elementary: "초등|초[1-6]",
  secondary: "중등|중학|중[1-3]|청소년|고등|고[1-3]",
};
export function classifyNotice(title: string, snippet = "", schedule = "unknown"): NoticeIntent {
  if (schedule === "closed") return "closed";
  const hit = (key: keyof typeof NOTICE_PATTERNS, value: string) => new RegExp(NOTICE_PATTERNS[key], "i").test(value);
  if (hit("offTopic", title)) return "off_topic";
  if (hit("elementary", title) && !hit("secondary", title)) return "off_topic";
  if (hit("deadlineSoon", title)) return "candidate";
  if (hit("retrospective", title)) {
    // A report can contain an invitation for the NEXT round; preserve it for review.
    return hit("futureInvitation", `${title} ${snippet}`) ? "uncertain" : "retrospective";
  }
  if (hit("recruitment", title) || hit("invitation", snippet)) return "candidate";
  return "uncertain";
}
export function noticeSearchQuery(query: string) {
  return `${query} (모집 OR 접수 OR 신청 OR 모집요강 OR 전형일정 OR 선발공고 OR 입학설명회)`;
}

/** A youth keyword can describe beneficiaries of an adult mentor/job posting. */
export function isYouthOpportunity(title: string, audience = ""): boolean {
  if (classifyNotice(title) === "off_topic") return false;
  const eligibleYouth = /중학생|고등학생|중고등|중·고|중등|고등|청소년|대상\s*(제한|무관)|누구나|제한\s*없/.test(audience);
  if (/대학생|대학원생|성인|일반인\s*전용/.test(audience) && !eligibleYouth) return false;
  const explicitlyMixedYouth = /(?:청소년\s*(?:[·ㆍ,/]|및|과|와)\s*(?:대학생|대학원생)|(?:대학생|대학원생)\s*(?:[·ㆍ,/]|및|과|와)\s*청소년)/.test(title);
  if (/대학생|대학원생|청년인턴|청소년지도사|청소년배치지도사/.test(title) && !explicitlyMixedYouth && !/중학생|고등학생|중고등|중·고|대상\s*제한\s*없/.test(title)) return false;
  return true;
}

/** Only an explicit audience field can exclude an item based on body text. */
export function nonYouthAudienceReason(text: string): string | null {
  const fields = /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:(?:참가|응모|모집|신청|지원|교육|참여)\s*)?대상\s*[:：]?\s*([^\n]{1,140})/g;
  for (const match of text.matchAll(fields)) {
    let audience = match[1].trim();
    const next = text.slice(match.index! + match[0].length).match(/^\n\s*(?:[·•-]\s*)?((?:중학|고등|중등|초등|대학|누구나)[^\n]{0,140})/);
    if (next) audience += ` ${next[1]}`;
    if (/[,·ㆍ및]$/.test(audience) || audience.length > 120) continue;
    if (/초등|유아|유치원|대학생|대학원생|직장인|성인/.test(audience) && !/중등|중학|고등|고교|중[1-3]|고[1-3]|중[·ㆍ,]?고|청소년|누구나|제한\s*없|전\s*국민|연령\s*무관/.test(audience))
      return `본문의 참가 대상: ${audience} · 중·고등학생 대상이 아닌 자료`;
  }
  return null;
}
