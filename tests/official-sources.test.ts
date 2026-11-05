import { describe, expect, it } from "vitest";
import { fetchBoardList, officialHostMatches, parseBoardDate, parseBoardList } from "../server/services/boardAdapter";
import { boardMatchesCategory, officialCategory, officialFirstSearchLimit } from "../server/services/officialCatalog";
import { articleHeadlines, matchesPrimaryArticleHeadline } from "../server/services/articleSource";
import { fetchAndExtract } from "../server/services/extract";

describe("official public lists", () => {
  it("reads RSS and Atom without collecting links outside the institution or credentials", () => {
    const rss = `<rss><channel><item><title>청소년 캠프 모집</title><link>https://school.ac.kr/notice/1</link><pubDate>Thu, 05 Nov 2026 01:00:00 GMT</pubDate></item><item><title>외부</title><link>https://school.ac.kr.evil.com/a</link></item><item><title>인증</title><link>https://user:pass@school.ac.kr/a</link></item></channel></rss>`;
    expect(parseBoardList(rss, "https://school.ac.kr/rss", "school.ac.kr", { linkSelector: "item", format: "rss" })).toEqual([{ url: "https://school.ac.kr/notice/1", title: "청소년 캠프 모집", dateText: "2026-11-05" }]);
    expect(parseBoardList(`<feed><entry><title>접수 연장</title><link rel="alternate" href="/notice/2"/><updated>2026-11-04T22:00:00Z</updated></entry></feed>`, "https://school.ac.kr/feed", "school.ac.kr", { linkSelector: "entry", format: "rss" })[0]).toEqual({ title: "접수 연장", url: "https://school.ac.kr/notice/2", dateText: "2026-11-05" });
  });
  it("reads GED public download parameters without executing JavaScript", () => {
    const html = `<table><tr><td>1</td><td>2027</td><td>중등 영재 모집</td><td><a class="sdown" onclick="fn_down( '2027', '10101', '123' )">다운로드</a></td></tr></table>`;
    const result = parseBoardList(html, "https://ged.kedi.re.kr/slct/noti/slctNotiStat.do", "ged.kedi.re.kr", { format: "ged_selection", linkSelector: "a.sdown" });
    expect(result).toHaveLength(1);
    expect(new URL(result[0].url).searchParams.get("seq")).toBe("123");
    expect(result[0].dateText).toBeNull();
    expect(parseBoardList(html, "https://evil.example/", "ged.kedi.re.kr", { format: "ged_selection", linkSelector: "a.sdown" })).toEqual([]);
  });
  it("traverses GED pages only within the caller's request budget", async () => {
    const fetchPage = async (url: string) => {
      const page = new URL(url).searchParams.get("pageIndex");
      expect(new URL(url).searchParams.get("pageUnit")).toBe("100");
      return { body: Buffer.from(`<a onclick="fn_pageing(3)">3</a><table><tr><td>1</td><td>2027</td><td>중등 영재 모집 ${page}</td><td><a class="sdown" onclick="fn_down('2027','101','${page}')">첨부</a></td></tr></table>`), contentType: "text/html", finalUrl: url, status: 200 };
    };
    let remaining = 1;
    const result = await fetchBoardList("https://ged.kedi.re.kr/slct/noti/slctNotiStat.do", "ged.kedi.re.kr", { format: "ged_selection", linkSelector: "a" }, fetchPage, { takeExtraCall: () => remaining-- > 0 });
    expect(result).toMatchObject({ ok: true, pages: 2 });
    if (!result.ok) throw new Error(result.error);
    expect(result.entries).toHaveLength(2);
    expect(result.warnings?.[0]).toContain("3페이지 중 2페이지");
  });
  it("parses Korean RSS timezone and preserves a school's required page parameter", () => {
    const rss = `<rss><item><title>보도자료</title><link>https://school.ac.kr/1</link><pubDate>Thu, 5 Nov 2026 08:05:44 KST</pubDate></item></rss>`;
    expect(parseBoardList(rss, "https://school.ac.kr/feed", "school.ac.kr", { format: "rss", linkSelector: "item" })[0].dateText).toBe("2026-11-05");
    expect(parseBoardList('<a href="/Home/BoardRead/78?DataId=123&amp;pageNo=1">공고</a>', "https://ksa.hs.kr/Home/Board/78", "ksa.hs.kr", { linkSelector: "a" })[0].url).toContain("pageNo=1");
  });
  it("rejects unsupported protocol, malformed dates and lookalike domains", () => {
    expect(officialHostMatches("evilschool.ac.kr", "school.ac.kr")).toBe(false);
    expect(officialHostMatches("www.school.ac.kr", "school.ac.kr")).toBe(true);
    expect(parseBoardDate("2026.02.30")).toBeNull();
    expect(parseBoardDate("2026.11.05")).toBe("2026-11-05");
    expect(parseBoardList(`<a href="ftp://school.ac.kr/a">bad</a><a href="https://school.ac.kr/a">ok</a>`, "https://school.ac.kr", "school.ac.kr", { linkSelector: "a" }).map(e => e.title)).toEqual(["ok"]);
  });
  it("reports a broken list or login as failure instead of a healthy zero", async () => {
    for (const body of ['<html>구조 변경</html>', '<input type="password">']) {
      const result = await fetchBoardList("https://school.ac.kr/list", "school.ac.kr", { linkSelector: ".notice a" }, async () => ({ body: Buffer.from(body), contentType: "text/html", finalUrl: "https://school.ac.kr/list", status: 200 }));
      expect(result.ok).toBe(false);
    }
    const redirected = await fetchBoardList("https://school.ac.kr/list", "school.ac.kr", { linkSelector: "a" }, async () => ({ body: Buffer.from('<a href="https://school.ac.kr/a">title</a>'), contentType: "text/html", finalUrl: "https://evil.example", status: 200 }));
    expect(redirected.ok).toBe(false);
  });
  it("keeps school camps separate from admissions and reduces only healthy-source searches", () => {
    const source = { name: "school", schoolType: "gifted", adapterConfig: {} };
    expect(officialCategory("opportunities", source, "2027학년도 입학전형 요강")).toBe("고등입시");
    expect(officialCategory("opportunities", source, "과학실험교실 신청 안내")).toBe("캠프·체험 선발모집");
    expect(boardMatchesCategory("opportunities", source, "캠프·체험 선발모집")).toBe(true);
    expect(boardMatchesCategory("opportunities", source, "전국대회")).toBe(false);
    expect(officialFirstSearchLimit("notice", 100, 1)).toBe(24);
    expect(officialFirstSearchLimit("current_dialogue", 40, 1)).toBe(20);
    expect(officialFirstSearchLimit("notice", 100, 0)).toBe(100);
    expect(officialFirstSearchLimit("notice", 0, 1)).toBe(0);
  });
  it("identifies verified official detail headings without accepting a related title or another host", async () => {
    const html = `<meta property="og:title" content="사이언스올/과학문화프로그램"><h1>사이언스올</h1><div class="board_view bd_noti"><div class="title"><p class="tit">중등 실험교실 모집</p></div><p>${"중학생 교육 대상과 신청 안내. ".repeat(10)}</p></div><div class="board_view bd_content"><h2>다른 캠프</h2>${"관련 콘텐츠 ".repeat(100)}</div>`;
    const url = "https://www.scienceall.com/brd/board/407/L/menu/293?brdType=R&bbsSn=123";
    expect(articleHeadlines(html, url)).toEqual(["중등 실험교실 모집"]);
    expect(matchesPrimaryArticleHeadline(html, "다른 캠프", url)).toBe(false);
    expect(matchesPrimaryArticleHeadline(html, "중등 실험교실 모집", url.replace("www.scienceall.com", "example.org"))).toBe(false);
    const fetched = await fetchAndExtract(url, async () => ({ finalUrl: url, body: Buffer.from(html), contentType: "text/html", status: 200 }), { title: "중등 실험교실 모집" });
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.text).not.toContain("관련 콘텐츠");
    const koi = '<h1>공지사항</h1><table><tr><td class="subject"><b aria-current="page">한국정보올림피아드 접수</b></td></tr></table>';
    expect(articleHeadlines(koi, "https://koi.or.kr/notice/2026/03/01/open")).toEqual(["한국정보올림피아드 접수"]);
    const kaist = '<h1><a href="/">KAIST</a></h1><meta property="og:title" content="새 연구 결과">';
    expect(articleHeadlines(kaist, "https://www.kaist.ac.kr/news/html/news/?mode=V&mng_no=1")).toEqual(["새 연구 결과"]);
  });
});
