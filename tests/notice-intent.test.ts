import { describe, expect, it } from "vitest";
import { classifyNotice, noticeSearchQuery } from "../shared/noticeIntent";
import { parseBoardList } from "../server/services/boardAdapter";

export const NOTICE_CASES = [
  ["2027학년도 중등 영재교육대상자 모집요강", "", "candidate"],
  ["전국 청소년 과학캠프 참가자 모집", "", "candidate"],
  ["과학영재교육연구원 중학생 모집", "", "candidate"],
  ["과학고 입학설명회 개최 안내", "", "candidate"],
  ["청소년 캠프 모집 마감 임박", "", "candidate"],
  ["청소년 로보틱스 작품공모전", "", "candidate"],
  ["학생들의 새로운 도전", "청소년 참가자를 모집합니다.", "candidate"],
  ["과학캠프 성황리 마무리", "작년에 참가자를 모집했다.", "retrospective"],
  ["과학고 입학설명회 성료", "모집요강 설명으로 큰 호응", "retrospective"],
  ["전국 청소년 대회 금메달 수상", "", "retrospective"],
  ["영재교육원 합격자 발표", "", "retrospective"],
  ["캠프 참가자 모집 마감", "", "retrospective"],
  ["캠프 성료…다음 기수 추가 모집", "", "uncertain"],
  ["캠프 성료", "다음 달 참가자 모집 예정", "uncertain"],
  ["교육원 연구교원 모집", "", "off_topic"],
  ["서울대학교 대학원 신입생 모집", "", "off_topic"],
  ["초등 영재교육대상자 모집요강", "", "off_topic"],
  ["초등·중등 영재교육대상자 모집요강", "", "candidate"],
  ["성인대상 과학적 취미활동", "", "off_topic"],
  ["과학고 교육의 미래", "학생들이 과학을 연구한다", "uncertain"],
] as const;
describe("모집 공고 선별", () => {
  it.each(NOTICE_CASES)("%s", (title, snippet, expected) => expect(classifyNotice(title, snippet)).toBe(expected));
  it("확인된 마감을 우선하고 게시일에서 접수 가능 여부를 추정하지 않는다", () => {
    expect(classifyNotice("캠프 참가자 모집", "", "closed")).toBe("closed");
    expect(classifyNotice("캠프 참가자 모집", "", "unknown")).toBe("candidate");
    expect(noticeSearchQuery("과학캠프")).toContain("(모집 OR 접수");
  });
  it("GED 공개 행의 정확한 제목과 문서 팝업을 보존하고 다른 도메인에서는 해석하지 않는다", () => {
    const html = `<table><tr><td>518</td><td>2027</td><td>2027학년도 중등 영재교육대상자 모집요강</td><td><a class="sdown" onclick="javascript:fn_down('2027','10101013020','25769');">다운로드</a></td></tr></table>`;
    const cfg = { format: "ged_selection" as const, linkSelector: "a.sdown", maxItems: 10 };
    const result = parseBoardList(html, "https://ged.kedi.re.kr/slct/noti/slctNotiStat.do", "ged.kedi.re.kr", cfg);
    expect(result).toEqual([{ title: "2027학년도 중등 영재교육대상자 모집요강", url: "https://ged.kedi.re.kr/inno/slctNotiInnoPop.do?pop1=Y&stndYear=2027&orgId=10101013020&seq=25769", dateText: null }]);
    expect(parseBoardList(html, "https://other.example", "other.example", cfg)).toEqual([]);
  });
  it("사이언스올 행사기간을 게시일로 오인하지 않고 교육·캠프 링크만 선택한다", () => {
    const html = `<a href="?bbsSn=1"><div><span class="cate">교육·캠프</span><p>청소년 캠프 모집</p><li>2026-10-01 ~ 2026-11-01</li></div></a><a href="?bbsSn=2"><span class="cate">공연·전시</span><p>전시회</p></a>`;
    const result = parseBoardList(html, "https://www.scienceall.com/brd/board/407/L/menu/293", "scienceall.com", { linkSelector: 'a[href*="bbsSn="]:has(.cate:contains("교육·캠프"))', titleSelector: "div > p" });
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ title: "청소년 캠프 모집", dateText: null });
  });
});
