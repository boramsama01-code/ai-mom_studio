import { describe, expect, it, vi } from "vitest";
import { extractHtml, fetchAndExtract } from "../server/services/extract";
import { articleAccessProblem, decodeGoogleNewsUrl, googleArticleLink, publisherArticleLink, structuredArticleBody } from "../server/services/articleSource";
import { FetchFailure, type safeFetch } from "../server/services/safeFetch";
const body = "과학 탐구에서는 관찰 결과와 주장에 대한 근거를 구분하고 여러 번 실험하여 결과를 비교합니다. ".repeat(6);
const article = (text = body) => `<html><title>실제 기사</title><article><p>${text}</p></article></html>`;
const response = (url: string, html: string) => ({ finalUrl: url, status: 200, contentType: "text/html; charset=utf-8", body: Buffer.from(html) });
const wrapper = "https://news.google.com/rss/articles/opaque-new-format";
const original = "https://www.hankyung.com/article/example";
const schema = (data: object) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe("article extraction regressions", () => {
  it("extracts a JSON-LD articleBody before script elements are removed", () => {
    const html = `<div id="app"></div>${schema({ "@type": "NewsArticle", headline: "구조화 기사", articleBody: body })}`;
    expect(extractHtml(html, original)).toMatchObject({ title: "구조화 기사", text: body.trim() });
  });
  it("supports @graph and preserves paragraph boundaries", () => {
    const html = schema({ "@graph": [{ "@type": "WebSite" }, { "@type": "https://schema.org/NewsArticle", articleBody: `<p>${body}</p><p>다음 문단입니다.</p>` }] });
    expect(structuredArticleBody(html).text).toContain("\n다음 문단입니다.");
  });
  it("ignores malformed metadata and never treats description as articleBody", () => {
    const html = '<script type="application/ld+json">not-json</script>' + schema({ "@type": "NewsArticle", description: body });
    expect(extractHtml(html, original).text).toBe("");
  });
  it("reads publisher-specific article selectors without navigation", () => {
    const html = `<nav>${"다른 기사 ".repeat(80)}</nav><div id="article-view-content-div"><p>${body}</p></div>`;
    expect(extractHtml(html, original).text).toBe(body.trim());
  });
  it("extracts Donga's public news_view section even when its body uses divs and line breaks", () => {
    const html = `<main id="contents"><header>사이트 메뉴</header><section class="news_view"><div>${body}</div><br><div>두 번째 본문 문단입니다.</div></section><section class="related"><a href="/other">다른 기사</a></section></main>`;
    const r = extractHtml(html, "https://www.donga.com/news/Economy/article/all/20261101/134946000/2");
    expect(r.text).toContain(body.trim()); expect(r.text).toContain("두 번째 본문 문단입니다.");
    expect(r.text).not.toContain("사이트 메뉴"); expect(r.text).not.toContain("다른 기사");
  });
  it("does not mistake a long menu for the article", () => {
    expect(extractHtml(`<body>${Array.from({ length: 60 }, () => '<a href="/">메뉴와 관련 기사</a>').join("")}</body>`, original).text).toBe("");
  });
  it("does not extract subscription-restricted structured content", async () => {
    const html = article() + schema({ "@type": "NewsArticle", isAccessibleForFree: false, articleBody: body });
    expect(articleAccessProblem(html)).toContain("구독");
    expect(extractHtml(html, original).text).toBe("");
    const fetcher = vi.fn(async () => response(original, html));
    expect(await fetchAndExtract(original, fetcher)).toMatchObject({ ok: false, status: "blocked" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("recognizes an HTTP-200 bot challenge instead of storing challenge text", async () => {
    const html = `<title>Just a moment...</title><form id="challenge-form">${body}</form>`;
    const result = await fetchAndExtract(original, vi.fn(async () => response(original, html)));
    expect(result).toMatchObject({ ok: false, status: "blocked" });
  });
  it.each([401, 402, 403, 429])("does not retry or bypass HTTP %i", async status => {
    const fetcher = vi.fn(async () => { throw new FetchFailure(`HTTP ${status}`, "http", status); });
    const result = await fetchAndExtract(original, fetcher);
    expect(result).toMatchObject({ ok: false, status: "blocked" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("decodes an old length-delimited Google News URL", () => {
    const encoded = Buffer.concat([Buffer.from([8, 19, 34, Buffer.byteLength(original)]), Buffer.from(original), Buffer.from([210, 1, 0])]).toString("base64url");
    expect(decodeGoogleNewsUrl(`https://news.google.com/rss/articles/${encoded}`)).toBe(original);
    expect(decodeGoogleNewsUrl(`https://example.com/rss/articles/${encoded}`)).toBeNull();
    expect(decodeGoogleNewsUrl(wrapper)).toBeNull();
  });
  it("follows an explicit original link and stores the publisher URL, not wrapper text", async () => {
    const fetcher = vi.fn(async (url: string) => response(url, url === wrapper ? `<a href="${original}">기사 원문</a>` : article()));
    const result = await fetchAndExtract(wrapper, fetcher);
    expect(result).toMatchObject({ ok: true, finalUrl: original, text: body.trim() });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not guess among ambiguous original links or use Google navigation", async () => {
    const html = `<a href="${original}">기사 원문</a><a href="https://example.com/other">기사 원문</a><article>${body}</article>`;
    expect(googleArticleLink(html, wrapper)).toBeNull();
    const fetcher = vi.fn(async () => response(wrapper, html));
    const result = await fetchAndExtract(wrapper, fetcher);
    expect(result).toMatchObject({ ok: false, status: "unsupported" });
    if (!result.ok) expect(result.error).toContain("중간 링크");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("honors the caller's extra-request budget", async () => {
    const fetcher = vi.fn(async () => response(wrapper, `<a href="${original}">기사 원문</a>`));
    const takeExtraCall = vi.fn(() => false);
    const result = await fetchAndExtract(wrapper, fetcher, { takeExtraCall });
    expect(result.ok).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
    expect(takeExtraCall).toHaveBeenCalledOnce();
  });
  it("matches an exact headline in an allowlisted public publisher RSS", async () => {
    const xml = `<rss><channel><item><title>같은 기사 제목</title><link>${original}</link><pubDate>${new Date().toUTCString()}</pubDate></item><item><title>비슷하지만 다른 제목</title><link>https://www.hankyung.com/article/other</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    const fetcher = vi.fn(async (url: string) => response(url, xml));
    expect(await publisherArticleLink({ title: "같은 기사 제목", publisherUrl: "https://www.hankyung.com" }, fetcher, 8000)).toBe(original);
    expect(fetcher.mock.calls[0][0]).toBe("https://www.hankyung.com/feed/all-news");
    expect(await publisherArticleLink({ title: "다른 제목", publisherUrl: "https://www.hankyung.com" }, fetcher, 8000)).toBeNull();
  });
  it("does not use arbitrary publisher hosts as a fetch proxy", async () => {
    const fetcher = vi.fn() as unknown as typeof safeFetch;
    expect(await publisherArticleLink({ title: "기사", publisherUrl: "http://127.0.0.1" }, fetcher, 8000)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports a JS-only page as unsupported and retains existing no-fabrication behavior", async () => {
    const result = await fetchAndExtract(original, vi.fn(async () => response(original, '<div id="app"></div><script src="/app.js"></script>')));
    expect(result).toMatchObject({ ok: false, status: "unsupported" });
    if (!result.ok) expect(result.error).toContain("자바스크립트");
  });
  it("does not make any LLM calls to reconstruct missing article text", async () => {
    const fetcher = vi.fn(async (url: string) => response(url, "<html>본문 없음</html>"));
    expect((await fetchAndExtract(original, fetcher)).ok).toBe(false);
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([original]);
  });
});
