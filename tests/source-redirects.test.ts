import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeFetch, FetchFailure, GOOGLE_NEWS_RPC_URL, googleNewsRedirectFailure } from "../server/services/safeFetch";
import { fetchAndExtract } from "../server/services/extract";
import { googleNewsRequestForm } from "../server/services/googleNewsResolve";
import { sourceFetchUrl } from "../server/services/sourceFetchUrl";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), checked: vi.fn() }));
vi.mock("undici", () => ({ Agent: class {}, fetch: mocks.fetch }));
vi.mock("../server/services/url", async original => ({ ...await original<object>(), assertPublicHttpUrl: async (value: string) => {
  mocks.checked(value);
  const u = new URL(value);
  if (u.hostname === "127.0.0.1" || u.hostname === "169.254.169.254") throw new Error("private host");
  return u;
} }));
const id = "CBMiTestArticle12345678", wrapper = `https://news.google.com/rss/articles/${id}`;
const publisher = "https://publisher.example/news/123";
const form = googleNewsRequestForm({ articleId: id, signature: "example_signature", timestamp: 1793250000 });
const page = `<div data-n-a-id="${id}" data-n-a-sg="example_signature" data-n-a-ts="1793250000"></div>`;
const body = "실제로 확인한 기사 본문입니다. 관찰 결과와 근거를 비교하며 확인하지 못한 내용은 추측하지 않습니다. ".repeat(5).trim();
const redirect = (url: string, status = 302) => new Response(null, { status, headers: { location: url } });
beforeEach(() => { mocks.fetch.mockReset(); mocks.checked.mockClear(); });

describe("302 transport regression", () => {
  it("follows normal public GET redirects and rechecks every destination", async () => {
    mocks.fetch.mockResolvedValueOnce(redirect(publisher)).mockResolvedValueOnce(new Response(body));
    expect(await safeFetch("https://publisher.example/old")).toMatchObject({ finalUrl: publisher, status: 200 });
    expect(mocks.checked.mock.calls.map(c => c[0])).toEqual(["https://publisher.example/old", publisher]);
    expect(mocks.fetch.mock.calls[1][1].body).toBeUndefined();
  });
  it("does not label an unknown 302 as access denial or forward the signed POST", async () => {
    mocks.fetch.mockResolvedValueOnce(redirect("https://news.google.com/unknown?token=do-not-print"));
    const error = await safeFetch(GOOGLE_NEWS_RPC_URL, { googleNewsForm: form }).catch(e => e);
    expect(error).toBeInstanceOf(FetchFailure);
    expect(error.kind).toBe("redirect"); expect(error.status).toBe(302);
    expect(error.message).not.toContain("원문 접근 제한"); expect(error.message).not.toContain("do-not-print");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("treats a publisher redirect as a resolved URL, then fetches it with GET", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(page, { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(redirect(publisher))
      .mockResolvedValueOnce(new Response(`<article>${body}</article>`, { headers: { "content-type": "text/html" } }));
    const result = await fetchAndExtract(wrapper);
    expect(result).toMatchObject({ ok: true, finalUrl: publisher, text: body });
    expect(mocks.fetch.mock.calls.map(c => c[0])).toEqual([wrapper, GOOGLE_NEWS_RPC_URL, publisher]);
    expect(mocks.fetch.mock.calls[1][1].method).toBe("POST");
    expect(mocks.fetch.mock.calls[2][1].method).toBeUndefined();
    expect(mocks.fetch.mock.calls[2][1].body).toBeUndefined();
  });
  it.each(["https://www.google.com/sorry/index?continue=secret", "https://accounts.google.com/ServiceLogin", "https://consent.google.com/m"])("keeps Google challenge/login redirects explicit and unfollowed: %s", async target => {
    mocks.fetch.mockResolvedValueOnce(new Response(page, { headers: { "content-type": "text/html" } })).mockResolvedValueOnce(redirect(target));
    const result = await fetchAndExtract(wrapper);
    expect(result).toMatchObject({ ok: false, status: "blocked" });
    if (!result.ok) { expect(result.error).toContain("Google 조회 단계"); expect(result.error).not.toContain("continue=secret"); }
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves an unknown redirect explanation instead of inventing a login restriction", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(page, { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(redirect("https://news.google.com/other"));
    const result = await fetchAndExtract(wrapper);
    expect(result).toMatchObject({ ok: false, status: "unsupported" });
    if (!result.ok) expect(result.error).toContain("판단하지 않습니다");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "https://publisher.example/login", "javascript:alert(1)"])("never follows unsafe or login lookup redirects: %s", async target => {
    mocks.fetch.mockResolvedValueOnce(new Response(page, { headers: { "content-type": "text/html" } })).mockResolvedValueOnce(redirect(target));
    expect((await fetchAndExtract(wrapper)).ok).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("stops at a private address in ordinary GET redirects before another network call", async () => {
    mocks.fetch.mockResolvedValueOnce(redirect("http://127.0.0.1/"));
    await expect(safeFetch(publisher)).rejects.toMatchObject({ kind: "blocked" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("does not retry a lookup rate limit and identifies the Google stage", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(page, { headers: { "content-type": "text/html" } })).mockResolvedValueOnce(new Response(null, { status: 429 }));
    const result = await fetchAndExtract(wrapper);
    expect(result).toMatchObject({ ok: false, status: "blocked" });
    if (!result.ok) expect(result.error).toContain("아직 언론사 본문을 요청한 단계가 아닙니다");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not confuse a lookalike Google hostname with a Google challenge", () => {
    expect(googleNewsRedirectFailure(302, "https://google.com.evil.example/sorry/index").kind).toBe("redirect");
  });
});

describe("verified source URL cache", () => {
  const source = { originalUrl: wrapper, meta: { fetchUrl: wrapper, finalUrl: publisher }, contentHash: "existing-fetched-content-hash", fetchedText: body };
  it("reuses the previously fetched publisher URL even after a failed refetch", async () => {
    expect(sourceFetchUrl(source)).toBe(publisher);
    mocks.fetch.mockResolvedValueOnce(new Response(`<article>${body}</article>`, { headers: { "content-type": "text/html" } }));
    expect((await fetchAndExtract(sourceFetchUrl(source))).ok).toBe(true);
    expect(mocks.fetch.mock.calls.map(c => c[0])).toEqual([publisher]);
  });
  it("does not trust a guessed URL without a previously fetched body and hash", () => {
    expect(sourceFetchUrl({ ...source, fetchedText: null })).toBe(wrapper);
    expect(sourceFetchUrl({ ...source, contentHash: null })).toBe(wrapper);
  });
  it.each(["http://127.0.0.1/x", "http://[::1]/", "http://host.internal/x", "javascript:alert(1)", "https://user:secret@publisher.example/", "https://news.google.com/read/another", "http://publisher.example:8000/"])("ignores unsafe cached URL: %s", value => {
    expect(sourceFetchUrl({ ...source, meta: { ...source.meta, finalUrl: value } })).toBe(wrapper);
  });
  it("preserves the existing Naver/mobile/direct-source fetching choice", () => {
    expect(sourceFetchUrl({ ...source, originalUrl: "https://publisher.example/news/1", meta: { fetchUrl: "https://n.news.naver.com/article/1/2", finalUrl: publisher } })).toBe("https://n.news.naver.com/article/1/2");
  });
});
