import { afterEach, describe, expect, it, vi } from "vitest";
import { articleHeadlines, sameArticleAlternate, structuredArticleBody } from "../server/services/articleSource";
import { extractHtml, fetchAndExtract } from "../server/services/extract";
import { fetchPublisherArticle, pageHasHeadline } from "../server/services/publisherLookup";
import { createNewsSearch } from "../server/services/newsSearch";
import * as transport from "../server/services/safeFetch";

const title = "청소년 역사기행 참가자 모집";
const otherTitle = "다른 지역의 별도 행사";
const primaryBody = "올바른 주기사의 모집 조건과 일정입니다. 대상과 신청 방법을 원문에서 확인합니다. ".repeat(5).trim();
const relatedBody = "관련 기사에는 다른 대상과 다른 신청 일정이 설명되어 있습니다. ".repeat(50).trim();
const home = "https://publisher.example/";
const article = `${home}article/1`;
const response = (url: string, html: string) => ({ finalUrl: url, status: 200, contentType: "text/html", body: Buffer.from(html) });
const schema = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

afterEach(() => vi.restoreAllMocks());

describe("primary article identity and paired JSON-LD", () => {
  it("does not accept a sidebar heading that matches while the primary headline differs", async () => {
    const html = `<main><h1>${otherTitle}</h1><article>${relatedBody}</article></main><aside><h2>${title}</h2></aside>`;
    expect(articleHeadlines(html)).toEqual([otherTitle]);
    expect(pageHasHeadline(html, title, article)).toBe(false);
    const fetcher = vi.fn(async (url: string) => response(url, url === home ? `<a href="${article}">${title}</a>` : html));
    expect(await fetchPublisherArticle("https://news.google.com/rss/articles/opaque-modern-id", fetcher, { title, publisherUrl: home })).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects contradictory primary metadata instead of accepting any matching title", () => {
    const html = `<meta property="og:title" content="${title}"><article><h1>${otherTitle}</h1><p>${relatedBody}</p></article>`;
    expect(pageHasHeadline(html, title, article)).toBe(false);
  });

  it("rejects a mismatched direct URL when the discovery record has an expected headline", async () => {
    const fetcher = vi.fn(async (url: string) => response(url, `<h1>${otherTitle}</h1><article>${relatedBody}</article><h2>${title}</h2>`));
    expect(await fetchAndExtract(article, fetcher, { title })).toMatchObject({ ok: false, status: "unsupported" });
  });

  it("does not let a matching related heading authorize a different AMP article", () => {
    const html = `<link rel="canonical" href="${article}"><h1>${otherTitle}</h1><h2>${title}</h2>`;
    expect(sameArticleAlternate(html, `${home}amp/1`, { url: `${home}amp/1`, canonical: article, titles: [title], allowedHosts: ["publisher.example"] })).toBe(false);
  });

  it("takes headline and body from the primary JSON-LD node instead of the longer related node", () => {
    const html = `<h1>${title}</h1>${schema({ "@graph": [
      { "@type": "NewsArticle", headline: title, articleBody: primaryBody, mainEntityOfPage: article },
      { "@type": "NewsArticle", headline: otherTitle, articleBody: relatedBody, mainEntityOfPage: `${home}article/2` },
    ] })}`;
    expect(extractHtml(html, article)).toMatchObject({ title, text: primaryBody });
    expect(structuredArticleBody(html, article)).toEqual({ title, text: primaryBody });
  });

  it("uses the canonical article association when multiple schema nodes have no visible heading", () => {
    const html = schema([
      { "@type": "NewsArticle", headline: otherTitle, articleBody: relatedBody, url: `${home}article/2` },
      { "@type": "NewsArticle", headline: title, articleBody: primaryBody, mainEntityOfPage: { "@id": `${article}#webpage` } },
    ]);
    expect(extractHtml(html, article)).toMatchObject({ title, text: primaryBody });
  });

  it("leaves multiple unbound articles unresolved and does not borrow their body", () => {
    const html = schema([
      { "@type": "NewsArticle", headline: title, articleBody: primaryBody },
      { "@type": "NewsArticle", headline: otherTitle, articleBody: relatedBody },
    ]);
    expect(extractHtml(html, article)).toMatchObject({ title: "", text: "" });
    expect(pageHasHeadline(html, title, article)).toBe(false);
  });
});

it("decodes the initial publisher RSS before matching Korean search terms", async () => {
  const korean = "한글 기사", now = new Date();
  const xml = `<?xml version="1.0" encoding="EUC-KR"?><rss><channel><item><title>${korean}</title><link>${article}</link><pubDate>${now.toUTCString()}</pubDate></item></channel></rss>`;
  // Independent EUC-KR fixture for '한글 기사'; no encoder under test is used to prepare it.
  const bytes = Buffer.concat(xml.split(korean).flatMap((part, index) => index ? [Buffer.from("c7d1b1db20b1e2bbe7", "hex"), Buffer.from(part)] : [Buffer.from(part)]));
  const fetcher = vi.spyOn(transport, "safeFetch").mockImplementation(async url => ({ finalUrl: url, status: 200, contentType: "application/rss+xml", body: url.includes("news.google.com") ? Buffer.from("<rss><channel/></rss>") : bytes }));
  const search = createNewsSearch({ preferNaver: false, now, feeds: [{ name: "신문", site: home, url: `${home}feed.xml` }] });
  const items = await search.search("한글", "news", 10, { naver: 0, limit: 2 });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ title: korean, provider: "rss_direct" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
