import { describe, expect, it, vi } from "vitest";
import { createNewsSearch, matchesNewsQuery, parseNewsRss } from "../server/services/newsSearch";
import { NaverError } from "../server/services/naver";
import { outletOf } from "../server/services/discover";

const now = new Date("2026-10-26T01:00:00Z");
const feed = { name: "과학신문", url: "https://science.example/rss", site: "https://science.example" };
const rss = (title = "과학고 입학설명회", link = "https://science.example/1", date = "2026-10-26T00:00:00Z", source = "") => `<rss><channel><item><title>${title}</title><link>${link}</link><description>입학 설명회 안내</description><pubDate>${date}</pubDate>${source}</item></channel></rss>`;

describe("노들섬 방식의 독립적인 공개 뉴스 수집", () => {
  it("공고 채널만 모집 검색을 좁히고 오래된 신청 공고를 최신 사후 기사보다 먼저 반환한다", async () => {
    const xml = `<rss><channel>${rss("과학캠프 성료", "https://science.example/report").match(/<item>.*<\/item>/)![0]}${rss("과학캠프 참가자 모집", "https://science.example/invite", "2026-10-25T00:00:00Z").match(/<item>.*<\/item>/)![0]}</channel></rss>`;
    for (const recruitment of [true, false]) {
      const urls: string[] = [];
      const session = createNewsSearch({ preferNaver: false, now, recruitment, feeds: [], loadXml: async url => { urls.push(url); return xml; } });
      const result = await session.search("과학캠프", "news", 1, { naver: 0, limit: 5 });
      expect(result[0].title).toBe(recruitment ? "과학캠프 참가자 모집" : "과학캠프 성료");
      expect(new URL(urls[0]).searchParams.get("q")!.includes("모집 OR 접수")).toBe(recruitment);
    }
  });
  it("Google RSS 언론사와 게시일을 보존하고 오래된 자료와 잘못된 링크를 제외한다", () => {
    const item = parseNewsRss(rss("블랙홀 관측 - 과학신문", "https://news.google.com/rss/articles/1", undefined, '<source url="https://science.example">과학신문</source>'), feed, now, true)[0];
    expect(item).toMatchObject({ title: "블랙홀 관측", publisher: "과학신문", provider: "google_news_rss" });
    expect(outletOf(item)).toBe("science.example");
    expect(parseNewsRss(rss("old", undefined, "2026-09-01T00:00:00Z"), feed, now)).toEqual([]);
    expect(parseNewsRss(rss("unsafe", "javascript:alert(1)"), feed, now)).toEqual([]);
    expect(() => parseNewsRss("<html>login</html>", feed, now)).toThrow("RSS/Atom");
    expect(matchesNewsQuery({ title: "과학고 입학 설명회", description: "" }, "과학고 입학설명회")).toBe(true);
  });
  it("네이버 인증이 실패해도 공개 뉴스는 저장할 결과를 반환하고 같은 블로그 인증을 반복하지 않는다", async () => {
    const naver = vi.fn(async () => { throw new NaverError("인증/권한 오류 (HTTP 401)", "auth", 401); });
    const session = createNewsSearch({ preferNaver: false, now, feeds: [feed], naver, loadXml: async () => rss() });
    const counter = { naver: 0, limit: 20 };
    await expect(session.search("감자튀김", "blog", 5, counter)).rejects.toMatchObject({ kind: "auth" });
    await expect(session.search("소스", "blog", 5, counter)).rejects.toMatchObject({ kind: "auth" });
    expect(naver).toHaveBeenCalledTimes(1);
    expect(await session.search("과학고", "news", 5, counter)).toHaveLength(1);
  });
  it("Google 제한 응답 뒤에는 추가 요청 없이 직접 RSS를 계속 검색한다", async () => {
    const loadXml = vi.fn(async (url: string) => { if (url.includes("news.google.com")) throw new Error("HTTP 429"); return rss(); });
    const session = createNewsSearch({ preferNaver: false, now, feeds: [feed], loadXml });
    const counter = { naver: 0, limit: 20 };
    expect(await session.search("과학고", "news", 5, counter)).toHaveLength(1);
    expect(await session.search("입학설명회", "news", 5, counter)).toHaveLength(1);
    expect(loadXml).toHaveBeenCalledTimes(2);
    expect(session.counts).toMatchObject({ rssFeedOk: 1, googleFailed: 1, googleQueries: 1 });
    expect(session.warnings[0].message).toContain("추가 요청은 중단");
  });
  it("출처 하나의 실패는 다른 출처를 막지 않고 모두 실패하면 정상 0건으로 처리하지 않는다", async () => {
    const bad = { ...feed, name: "오류신문", url: "https://broken.example/rss" };
    const session = createNewsSearch({ preferNaver: false, now, feeds: [bad, feed], loadXml: async url => { if (url !== feed.url) throw new Error("HTTP 503"); return rss(); } });
    expect(await session.search("과학고", "news", 5, { naver: 0, limit: 5 })).toHaveLength(1);
    expect(session.counts.rssFeedFailed).toBe(1);
    const allFailed = createNewsSearch({ preferNaver: false, now, feeds: [feed], loadXml: async () => { throw new Error("HTTP 503"); } });
    await expect(allFailed.search("과학고", "news", 5, { naver: 0, limit: 5 })).rejects.toThrow("모두 응답하지");
  });
});
