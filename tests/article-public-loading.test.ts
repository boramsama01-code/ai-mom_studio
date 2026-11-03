import { describe, expect, it, vi } from "vitest";
import { extractHtml, fetchAndExtract } from "../server/services/extract";
import { fetchPublisherArticle } from "../server/services/publisherLookup";
import { decodePublicText } from "../server/services/publicTextResponse";
import { FetchFailure, type SafeFetchOptions } from "../server/services/safeFetch";

const original = "https://press.example/news/123";
const amp = "https://press.example/news/123/amp";
const title = "청소년 과학 탐구 모집";
const body = "학생들은 공개된 실험 결과를 비교하고 근거가 충분한지 확인합니다. 참가 조건과 일정은 주최 기관에서 공고했습니다. ".repeat(4).trim();
const response = (url: string, html: string, contentType = "text/html") => ({ finalUrl: url, status: 200, contentType, body: Buffer.from(html) });
const emptyArticle = `<meta property="og:title" content="${title}"><link rel="amphtml" href="${amp}"><div id="app"></div>`;
const article = `<meta property="og:title" content="${title}"><link rel="canonical" href="${original}"><article>${body}</article>`;
const transport = (pages: Record<string, string>) => vi.fn(async (url: string, _options?: SafeFetchOptions) => {
  if (!(url in pages)) throw new Error("Unexpected request");
  return response(url, pages[url]);
});
const korean = "한글 기사";
// The fixture's declared EUC-KR text, independent of the decoder under test.
const euc = (value: string) => Buffer.concat(value.split(korean).flatMap((part, i) => i ? [Buffer.from("c7d1b1db20b1e2bbe7", "hex"), Buffer.from(part)] : [Buffer.from(part)]));

describe("public publisher response decoding", () => {
  it.each(['text/html; charset="EUC-KR"', "text/html; charset = 'ks_c_5601-1987'"])("reads Korean from a quoted header: %s", type => {
    expect(decodePublicText(euc(korean), type)).toBe(korean);
  });
  it("recognizes a legacy meta charset and an RSS XML encoding declaration", () => {
    const html = `<meta http-equiv="Content-Type" content="text/html; charset=EUC-KR"><h1>${korean}</h1>`;
    const xml = `<?xml version="1.0" encoding="EUC-KR"?><rss><title>${korean}</title></rss>`;
    expect(decodePublicText(euc(html))).toBe(html);
    expect(decodePublicText(euc(xml), "application/rss+xml")).toBe(xml);
  });
  it("honors a BOM and tolerates an unrecognized encoding label", () => {
    expect(decodePublicText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(korean)]), "text/html; charset=euc-kr")).toBe(korean);
    expect(decodePublicText(Buffer.from(korean), "text/html; charset=unknown-label")).toBe(korean);
  });
  it("uses the same decoder when matching the publisher index and the article headline", async () => {
    const home = "https://press.example/", text = korean.repeat(30);
    const fetcher = vi.fn(async (url: string) => ({ finalUrl: url, status: 200, contentType: 'text/html; charset="EUC-KR"',
      body: euc(url === home ? `<a href="${original}">${korean}</a>` : `<h1>${korean}</h1><div id="article_content">${text}</div>`) }));
    expect(await fetchPublisherArticle("https://news.google.com/rss/articles/opaque-id", fetcher, { title: korean, publisherUrl: home })).toMatchObject({ ok: true, finalUrl: original, text });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([home, original]);
  });
  it("accepts a complete HTML document mislabeled text/plain, but never treats ordinary plain text as HTML", async () => {
    expect(await fetchAndExtract(original, vi.fn(async () => response(original, `<!doctype html><html>${article}</html>`, "text/plain")))).toMatchObject({ ok: true, text: body });
    expect(await fetchAndExtract(original, vi.fn(async () => response(original, body, "text/plain")))).toMatchObject({ ok: false, status: "unsupported" });
  });
  it("does not save RSS descriptions as the article body", async () => {
    const rss = `<rss><channel><item><title>${title}</title><description><p>${body}</p></description></item></channel></rss>`;
    const result = await fetchAndExtract(original, vi.fn(async () => response(original, rss, "application/rss+xml")));
    expect(result).toMatchObject({ ok: false, status: "unsupported" });
    if (!result.ok) expect(result.error).toContain("RSS 기사 목록");
  });
  it("reads a typed JSON-LD news subtype and verifies its headline during publisher navigation", async () => {
    const schema = `<script type="Application/LD+JSON; charset=utf-8"><!--${JSON.stringify({ "@type": "AnalysisNewsArticle", headline: title, articleBody: body })}--></script>`;
    expect(extractHtml(schema, original)).toMatchObject({ title, text: body });
    const home = "https://press.example/";
    const fetcher = transport({ [home]: `<a href="${original}">${title}</a>`, [original]: schema });
    expect(await fetchPublisherArticle("https://news.google.com/rss/articles/opaque-id", fetcher, { title, publisherUrl: home })).toMatchObject({ ok: true, text: body });
  });
});

describe("bounded same-article public alternates", () => {
  it("reads the publisher's declared AMP page after an empty public HTML response", async () => {
    const fetcher = transport({ [original]: emptyArticle, [amp]: article });
    expect(await fetchAndExtract(original, fetcher)).toMatchObject({ ok: true, finalUrl: amp, text: body });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([original, amp]);
    expect(fetcher.mock.calls[1][1]?.allowedHosts).toEqual(["press.example", "www.press.example", "m.press.example", "amp.press.example"]);
  });
  it("uses an advertised canonical page while retaining the exact headline check", async () => {
    const mobile = "https://m.press.example/news/123";
    const fetcher = transport({ [mobile]: `<meta property="og:title" content="${title}"><link rel="canonical" href="${original}">`, [original]: article });
    expect(await fetchAndExtract(mobile, fetcher)).toMatchObject({ ok: true, finalUrl: original, text: body });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects another article even if its canonical metadata is inconsistent", async () => {
    const fetcher = transport({ [original]: emptyArticle, [amp]: article.replace(title, "전혀 다른 행사") });
    const result = await fetchAndExtract(original, fetcher);
    expect(result).toMatchObject({ ok: false, status: "unsupported" });
    if (!result.ok) expect(result.error).toContain("같은 기사인지");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["https://other.example/news/123", "http://127.0.0.1/news/123", "https://press.example/login", "https://u:p@press.example/news/123", "https://press.example:8000/news/123"])("does not request an unsafe or unrelated alternate: %s", url => {
    const fetcher = transport({ [original]: emptyArticle.replace(amp, url) });
    return fetchAndExtract(original, fetcher).then(result => { expect(result.ok).toBe(false); expect(fetcher).toHaveBeenCalledOnce(); });
  });
  it("never follows an alternate after a paywall or bot challenge", async () => {
    for (const restricted of ["<title>Just a moment...</title>", `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", isAccessibleForFree: false, articleBody: body })}</script>`]) {
      const fetcher = transport({ [original]: restricted + emptyArticle });
      expect(await fetchAndExtract(original, fetcher)).toMatchObject({ ok: false, status: "blocked" });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("does not store a login page reached by an ordinary redirect", async () => {
    const fetcher = vi.fn(async () => response("https://press.example/member/login", `<article>${body}</article>${emptyArticle}`));
    expect(await fetchAndExtract(original, fetcher)).toMatchObject({ ok: false, status: "blocked" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("stops when the alternate refuses access, without another fallback", async () => {
    const fetcher = vi.fn(async (url: string) => { if (url === amp) throw new FetchFailure("HTTP 403", "http", 403); return response(url, emptyArticle); });
    expect(await fetchAndExtract(original, fetcher)).toMatchObject({ ok: false, status: "blocked" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("honors the caller's budget and never chains more than one alternate", async () => {
    const fetcher = transport({ [original]: emptyArticle, [amp]: emptyArticle.replace(amp, amp + "/another") });
    expect((await fetchAndExtract(original, fetcher, { takeExtraCall: () => false })).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear();
    expect((await fetchAndExtract(original, fetcher)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects an alternate that redirects to a different publisher", async () => {
    const fetcher = vi.fn(async (url: string) => response(url === amp ? "https://other.example/article" : url, url === amp ? article : emptyArticle));
    expect(await fetchAndExtract(original, fetcher)).toMatchObject({ ok: false, status: "unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
