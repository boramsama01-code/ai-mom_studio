import { describe, expect, it } from "vitest";
import { fetchBoardList, officialHostMatches, parseBoardDate, parseBoardList } from "../server/services/boardAdapter";
import { boardMatchesCategory, officialCategory, officialFirstSearchLimit } from "../server/services/officialCatalog";

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
    expect(officialFirstSearchLimit("notice", 100, 1)).toBe(8);
    expect(officialFirstSearchLimit("current_dialogue", 40, 1)).toBe(20);
    expect(officialFirstSearchLimit("notice", 100, 0)).toBe(100);
    expect(officialFirstSearchLimit("notice", 0, 1)).toBe(0);
  });
});
