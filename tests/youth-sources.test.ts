import { expect, it } from "vitest";
import { parseBoardList } from "../server/services/boardAdapter";
import { isYouthOpportunity, classifyNotice } from "../shared/noticeIntent";
import { matchOfficialSource } from "../server/worker/evidence";
import type { OfficialSource } from "../shared/schema";

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

it("excludes staff recruitment and college-only mentors while preserving mixed-age contests", () => {
  for (const title of ["청소년 AI 페스티벌 서포터즈 대학생 모집", "청소년 마케터 대학생 멘토 모집", "교육청 평가위원 공개 모집", "고등학교 입찰 공고", "중등 교사 임용후보자 선발 공고", "직장어린이집 원아 모집"]) expect(isYouthOpportunity(title), title).toBe(false);
  expect(isYouthOpportunity("청소년 봉사자 모집", "대학생 및 대학원생")).toBe(false);
  expect(isYouthOpportunity("과학 공모전", "중학생·고등학생·대학생 및 일반인")).toBe(true);
  expect(classifyNotice("고등학생 과학캠프 참가자 모집")).toBe("candidate");
});

it("never treats a verified aggregator domain as the organizer's official evidence", () => {
  const source = { domain: "linkareer.com", verifiedAt: new Date(), adapterConfig: { sourceRole: "discovery" } } as unknown as OfficialSource;
  expect(matchOfficialSource("https://linkareer.com/activity/123", [source])).toBeNull();
  const school = { ...source, domain: "ice.go.kr", adapterConfig: {} };
  expect(matchOfficialSource("https://www.ice.go.kr/notice", [school])).toBe(school);
});
