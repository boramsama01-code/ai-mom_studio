import { expect, it } from "vitest";
import { parseBoardList } from "../server/services/boardAdapter";
import { nonYouthAudienceReason, isYouthOpportunity, classifyNotice } from "../shared/noticeIntent";
import { matchOfficialSource } from "../server/worker/evidence";
import type { OfficialSource } from "../shared/schema";
import { fetchAndExtract } from "../server/services/extract";

it("reads education CMS data IDs without executing handlers or leaving the verified domain", () => {
  const html = '<table><tr><td><a class="nttInfoBtn" data-id="123" href="javascript:;" title="중학생 캠프 모집">N<em>중학생 캠프 모집</em></a></td><td data-table="date">2026.11.05.</td></tr><tr><td><a class="nttInfoBtn" data-id="//evil.example" href="javascript:;">bad</a></td></tr></table>';
  const rows = parseBoardList(html, "https://www.ice.go.kr/ice/na/ntt/selectNttList.do?mi=10840&bbsId=1482", "ice.go.kr", { format: "school_ntt", linkSelector: "a.nttInfoBtn", dateSelector: '[data-table="date"]', useTitleAttribute: true });
  expect(rows).toHaveLength(1); expect(rows[0].title).toBe("중학생 캠프 모집");
  const url = new URL(rows[0].url);
  expect(url.pathname).toBe("/ice/na/ntt/selectNttInfo.do");
  expect(url.searchParams.get("nttSn")).toBe("123"); expect(url.searchParams.get("bbsId")).toBe("1482");
});

it("reads only visible Linkareer activities from public JSON, with a real listing date", () => {
  const data = { props: { pageProps: { props: { __APOLLO_STATE__: {
    "Activity:123": { __typename: "Activity", title: "청소년 영상 공모전", createdAt: Date.parse("2026-11-05T23:00:00Z") },
    "Activity:999": { __typename: "Activity", title: "광고", createdAt: 1 },
  } } } } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script><a href="/activity/123">이미지</a><a href="/activity/123">제목</a>`;
  const rows = parseBoardList(html, "https://linkareer.com/search?q=청소년", "linkareer.com", { format: "linkareer", linkSelector: "a" });
  expect(rows).toEqual([{ title: "청소년 영상 공모전", url: "https://linkareer.com/activity/123", dateText: "2026-11-06" }]);
});
it("parses Daejeon's public notice links but refuses private posts and another board", () => {
  const link = (board: string, seq: string, privateFlag: string) => `<a onclick="goView('${board}','${seq}','0','${privateFlag}','W','1','N','','0','0','0')" href="#contents">청소년 공모전</a>`;
  const rows = parseBoardList(link("450", "123", "null") + link("450", "124", "Y") + link("9", "125", "null"), "https://www.dje.go.kr/boardCnts/list.do?boardID=450&m=030101&s=dje", "dje.go.kr", { format: "dje_board", linkSelector: "a" });
  expect(rows).toHaveLength(1);
  expect(new URL(rows[0].url).searchParams.get("boardSeq")).toBe("123");
});

it("excludes staff recruitment and college-only mentors while preserving mixed-age contests", () => {
  for (const title of ["청소년 AI 페스티벌 서포터즈 대학생 모집", "청소년 마케터 대학생 멘토 모집", "교육청 평가위원 공개 모집", "고등학교 입찰 공고", "중등 교사 임용후보자 선발 공고", "직장어린이집 원아 모집"]) expect(isYouthOpportunity(title), title).toBe(false);
  expect(isYouthOpportunity("청소년 봉사자 모집", "대학생 및 대학원생")).toBe(false);
  expect(isYouthOpportunity("과학 공모전", "중학생·고등학생·대학생 및 일반인")).toBe(true);
  expect(isYouthOpportunity("청소년·대학생 과학 공모전")).toBe(true);
  expect(isYouthOpportunity("대학생 및 청소년 영상 공모전")).toBe(true);
  expect(isYouthOpportunity("청소년 AI 페스티벌 대학생 모집")).toBe(false);
  expect(classifyNotice("고등학생 과학캠프 참가자 모집")).toBe("candidate");
});

it("never treats a verified aggregator domain as the organizer's official evidence", () => {
  const source = { domain: "linkareer.com", verifiedAt: new Date(), adapterConfig: { sourceRole: "discovery" } } as unknown as OfficialSource;
  expect(matchOfficialSource("https://linkareer.com/activity/123", [source])).toBeNull();
  const school = { ...source, domain: "ice.go.kr", adapterConfig: {} };
  expect(matchOfficialSource("https://www.ice.go.kr/notice", [school])).toBe(school);
});
it("checks explicit body audience fields without inferring eligibility from a keyword in prose", () => {
  expect(nonYouthAudienceReason("AI 놀이학교\n대상초등학생\n장소과학관")).toContain("초등학생");
  expect(nonYouthAudienceReason("청소년 지원 봉사\n모집 대상: 대학생 및 대학원생\n신청: 폼")).toContain("대학생");
  expect(nonYouthAudienceReason("대상: 초등학생\n중학생과 고등학생\n신청방법: 온라인")).toBeNull();
  expect(nonYouthAudienceReason("교육대상: 초·중·고등학생과 대학생")).toBeNull();
  expect(nonYouthAudienceReason("대상: 초등 5학년~중1")).toBeNull();
  expect(nonYouthAudienceReason("대상: 초등 5~6학년")).toContain("초등");
  expect(nonYouthAudienceReason("대학생 멘토와 함께하는 중학생 실험교실입니다.")).toBeNull();
});
it("isolates the activity's title and body from Linkareer navigation and unrelated resumes", async () => {
  const body = "청소년이 참가하는 환경 공모 프로젝트입니다. 응모 방법과 지역 자격을 확인해 주세요. ".repeat(4);
  const html = `<h1>링커리어</h1><div class="activity-detail-content"><h1>청소년 환경 공모전</h1><div class="ActivityDetailTabContent__StyledWrapper-abc"><p>${body}</p></div><div class="content">${"다른 사람의 자기소개서 ".repeat(100)}</div></div>`;
  const url = "https://linkareer.com/activity/123";
  const fetcher = async () => ({ finalUrl: url, body: Buffer.from(html), contentType: "text/html", status: 200 });
  const result = await fetchAndExtract(url, fetcher, { title: "청소년 환경 공모전" });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.text).toBe(body.trim());
  expect((await fetchAndExtract(url, fetcher, { title: "다른 공모전" })).ok).toBe(false);
});
it("keeps education article text nested inside a public CMS form", async () => {
  const text = "중학생 신청 자격과 참가 일정 안내입니다. ".repeat(8);
  const url = "https://goe.go.kr/goe/na/ntt/selectNttInfo.do?nttSn=123";
  const markup = `<h1>교육청</h1><form><div class="bbs_ViewA"><h3>과학캠프 모집</h3><div class="bbsV_cont"><p>${text}</p><input value="not article text"/></div></div></form>`;
  const r = await fetchAndExtract(url, async () => ({ finalUrl: url, body: Buffer.from(markup), status: 200, contentType: "text/html" }), { title: "과학캠프 모집" });
  expect(r.ok).toBe(true); if (r.ok) expect(r.text).toBe(text.trim());
});
it("does not include sidebar advertisements or listing badges in contest titles", () => {
  const markup = '<a href="?gbn=view&ix=1">광고</a><div class="ms-list"><ul class="list"><li><div class="tit"><a href="?gbn=view&ix=2">청소년 영상 공모전 <span class="stat">SPECIAL</span></a></div></li></ul></div>';
  const rows = parseBoardList(markup, "https://www.wevity.com/index.php?c=find", "wevity.com", { linkSelector: '.ms-list .list .tit > a[href*="gbn=view"][href*="ix="]', titleExcludeSelector: ".stat" });
  expect(rows).toHaveLength(1); expect(rows[0].title).toBe("청소년 영상 공모전");
});
