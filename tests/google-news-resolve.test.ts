import { describe, expect, it, vi } from "vitest";
import { googleNewsArticleId, googleNewsParameters, googleNewsRequestForm, parseGoogleNewsResponse, resolveGoogleNewsArticle } from "../server/services/googleNewsResolve";
import { fetchAndExtract } from "../server/services/extract";
import { GOOGLE_NEWS_RPC_URL, FetchFailure, safeFetch, validateGoogleNewsForm, type SafeFetchOptions } from "../server/services/safeFetch";
const id = "CBMiOpaqueArticle12345678";
const url = `https://news.google.com/rss/articles/${id}?oc=5`;
const publisher = "https://www.example.com/news/123?a=1&b=2";
const params = { articleId: id, timestamp: 1793250000, signature: "Test_signature-123" };
const html = `<c-wiz><div data-n-a-id="${id}" data-n-a-ts="${params.timestamp}" data-n-a-sg="${params.signature}"></div></c-wiz>`;
const body = "실제 원문 문장입니다. 연구진은 관찰 결과와 근거를 비교하고 독립적인 검증이 필요하다고 설명했습니다. ".repeat(5).trim();
const frame = (link = publisher, rpc = "Fbv4je") => [["wrb.fr", rpc, JSON.stringify(["garturlres", link]), null, null, null, "generic"]];
const response = (target: string, text: string, ct = "text/html") => ({ finalUrl: target, status: 200, contentType: ct, body: Buffer.from(text) });
function transport() {
  return vi.fn(async (target: string, options?: SafeFetchOptions) => {
    if (target === url) return response(url, html);
    if (target === GOOGLE_NEWS_RPC_URL) {
      expect(options?.googleNewsForm).toBe(googleNewsRequestForm(params));
      return response(target, `)]}'\n\n123\n${JSON.stringify(frame())}\n`, "application/json");
    }
    if (target === publisher) return response(target, `<title>실제 원문</title><article><p>${body}</p></article>`);
    throw new Error("Unexpected request: " + target);
  });
}

describe("modern Google News URL resolution", () => {
  it.each(["rss/articles", "articles", "read"])("accepts the %s path", path => {
    expect(googleNewsArticleId(`https://news.google.com/${path}/${id}?hl=ko`)).toBe(id);
  });
  it.each(["https://news.google.com.evil.test/articles/CBMi123456", "http://news.google.com/articles/CBMi123456", "https://user@news.google.com/articles/CBMi123456", "https://news.google.com:8080/articles/CBMi123456", "https://news.google.com/search?q=hello"])("rejects unrelated or unsafe input: %s", input => {
    expect(googleNewsArticleId(input)).toBeNull();
  });
  it("reads parameters only for the exact article", () => {
    expect(googleNewsParameters(url, html)).toEqual(params);
    expect(googleNewsParameters(url, html.replace(id, "DifferentArticle123"))).toBeNull();
  });
  it("accepts one legacy parameter element without an id, but refuses ambiguity", () => {
    expect(googleNewsParameters(url, html.replace(`data-n-a-id="${id}"`, ""))).toEqual(params);
    expect(googleNewsParameters(url, html + html.replace(params.signature, "Different_signature"))).toBeNull();
  });
  it.each(["NaN", "-1", "0", "9007199254740993", "1;alert(1)"])("rejects invalid timestamp %s", timestamp => {
    expect(googleNewsParameters(url, html.replace(String(params.timestamp), timestamp))).toBeNull();
  });
  it("encodes the exact article id without executing or interpolating page code", () => {
    const form = googleNewsRequestForm(params);
    expect(() => validateGoogleNewsForm(GOOGLE_NEWS_RPC_URL, form)).not.toThrow();
    const envelope = JSON.parse(new URLSearchParams(form).get("f.req")!);
    const args = JSON.parse(envelope[0][0][1]);
    expect(args[0]).toBe("garturlreq"); expect(args.slice(2)).toEqual([id, params.timestamp, params.signature]);
  });
  it("parses both plain JSON and anti-XSSI length-prefixed frames", () => {
    expect(parseGoogleNewsResponse(JSON.stringify(frame()))).toBe(publisher);
    expect(parseGoogleNewsResponse(`)]}'\n\n123\n${JSON.stringify(frame())}\n\n45\n[["di",1]]\n`)).toBe(publisher);
  });
  it("ignores unrelated RPC URLs, null payloads and malformed responses", () => {
    expect(parseGoogleNewsResponse(JSON.stringify(frame(publisher, "unrelated")))).toBeNull();
    expect(parseGoogleNewsResponse('[["wrb.fr","Fbv4je",null]]')).toBeNull();
    expect(parseGoogleNewsResponse('not JSON https://www.example.com/fake')).toBeNull();
    expect(parseGoogleNewsResponse(JSON.stringify([...frame(), ...frame("https://www.example.com/other")]))).toBeNull();
  });
  it.each(["javascript:alert(1)", "http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "https://user:password@example.com/", "https://news.google.com/read/again", "http://localhost/x", "http://example.com:8000/"])("does not follow unsafe resolved URL %s", value => {
    expect(parseGoogleNewsResponse(JSON.stringify(frame(value)))).toBeNull();
  });
  it("fetches wrapper → exact Google lookup → publisher body, without an LLM", async () => {
    const fetcher = transport();
    const result = await fetchAndExtract(url, fetcher);
    expect(result).toMatchObject({ ok: true, finalUrl: publisher, title: "실제 원문", text: body });
    expect(fetcher.mock.calls.map(([u]) => u)).toEqual([url, GOOGLE_NEWS_RPC_URL, publisher]);
  });
  it("charges the RPC and publisher requests to the same extra-call budget", async () => {
    const fetcher = transport(), takeExtraCall = vi.fn(() => true);
    expect((await fetchAndExtract(url, fetcher, { takeExtraCall })).ok).toBe(true);
    expect(takeExtraCall).toHaveBeenCalledTimes(2);
  });
  it("does not call Google RPC when there is no remaining request budget", async () => {
    const fetcher = transport();
    const result = await fetchAndExtract(url, fetcher, { takeExtraCall: () => false });
    expect(result.ok).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not fetch the publisher when the remaining budget allows only the RPC", async () => {
    const fetcher = transport(), takeExtraCall = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    expect((await fetchAndExtract(url, fetcher, { takeExtraCall })).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 402, 403, 429])("stops without retry or fallback on lookup HTTP %i", async status => {
    const fetcher = vi.fn(async (target: string) => {
      if (target === url) return response(url, html);
      throw new FetchFailure(`HTTP ${status}`, "http", status);
    });
    expect(await fetchAndExtract(url, fetcher, { title: "기사", publisherUrl: "https://www.hankyung.com" })).toMatchObject({ ok: false, status: "blocked" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never calls the lookup when the article page is a bot challenge", async () => {
    const fetcher = vi.fn(async () => response(url, '<title>Just a moment</title>' + html));
    expect(await fetchAndExtract(url, fetcher)).toMatchObject({ ok: false, status: "blocked" }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects a login or consent HTML page from the RPC", async () => {
    const fetcher = vi.fn(async (target: string) => response(target, target === url ? html : "<title>Sign in</title>"));
    expect(await fetchAndExtract(url, fetcher)).toMatchObject({ ok: false, status: "blocked" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("checks the shared deadline before issuing lookup requests", async () => {
    const fetcher = transport();
    await expect(resolveGoogleNewsArticle(url, html, fetcher, { deadline: Date.now() - 1 })).rejects.toThrow("시간 한도");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects form posts to every destination except the fixed Google lookup", async () => {
    await expect(safeFetch("http://127.0.0.1/", { googleNewsForm: googleNewsRequestForm(params) })).rejects.toThrow("허용되지 않은");
    expect(() => validateGoogleNewsForm(GOOGLE_NEWS_RPC_URL, "f.req=[]")).toThrow();
    expect(() => validateGoogleNewsForm(GOOGLE_NEWS_RPC_URL, googleNewsRequestForm(params) + "&other=secret")).toThrow();
    expect(() => validateGoogleNewsForm(GOOGLE_NEWS_RPC_URL, "x".repeat(60001))).toThrow();
  });
});
