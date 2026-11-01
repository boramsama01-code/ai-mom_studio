/** Independent publisher navigation. No Google decoding, page scripts, cookies or CAPTCHA retries. */
import { load } from "cheerio";
import { isIP } from "node:net";
import { safeFetch, FetchFailure } from "./safeFetch";
import { isPrivateIp } from "./url";
import { PUBLIC_NEWS_FEEDS, parseNewsRss } from "./newsSearch";
import { articleAccessProblem, decodeGoogleNewsUrl, isGoogleNewsUrl, type ArticleContext } from "./articleSource";
import { fetchAndExtract, type ExtractResult } from "./extract";

export const headlineKey = (s: string) => s.normalize("NFKC").replace(/[…]/g, "...").replace(/[‘’“”"'「」『』]/g, "").replace(/[\s\u200b]+/g, "").trim();
const hostKey = (s: string) => s.toLowerCase().replace(/^(www|m|rss)\./, "");
const restrictedPath = /\/(?:login|signin|captcha|challenge|consent|paywall|subscribe|logout|delete|remove)(?:[/.]|$)/i;
function publicUrl(value: string, base?: string): URL | null {
  try {
    const u = new URL(value, base), h = u.hostname.replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return null;
    if (/(^|\.)google\.[a-z.]+$/.test(h) || /(^|\.)(localhost|internal|local|invalid)$/.test(h) || (isIP(h) && isPrivateIp(h)) || restrictedPath.test(u.pathname)) return null;
    u.hash = ""; return u;
  } catch { return null; }
}
export function samePublisherUrl(value: string, publisher: string): string | null {
  const u = publicUrl(value, publisher), p = publicUrl(publisher);
  return u && p && hostKey(u.hostname) === hostKey(p.hostname) ? u.href : null;
}

/** Match an entire headline, not a substring, summary or similar article. */
export function exactPublisherLinks(html: string, base: string, title: string): string[] {
  const $ = load(html), key = headlineKey(title), links = new Set<string>();
  if (!key) return [];
  $("a[href]").slice(0, 1500).each((_, el) => {
    const node = $(el), labels = [node.attr("title") || "", node.attr("aria-label") || "", node.text(),
      ...node.find("h1,h2,h3,h4,.title,.tit,.headline").toArray().map(e => $(e).text())];
    if (!labels.some(label => headlineKey(label) === key)) return;
    const url = samePublisherUrl(node.attr("href") || "", base);
    if (url && new URL(url).pathname !== "/") links.add(url);
  });
  return [...links];
}
export function publisherFeedLinks(html: string, base: string): string[] {
  const $ = load(html), urls = new Set<string>();
  $("link[rel='alternate'][type*='xml'],a[href]").each((_, el) => {
    const node = $(el), href = node.attr("href") || "";
    if (el.tagName === "a" && !/(?:^|[/_.-])(?:rss|feed)(?:[/_.?-]|$)/i.test(href)) return;
    const url = samePublisherUrl(href, base); if (url) urls.add(url);
  });
  return [...urls].slice(0, 2);
}
/** Only a site's advertised GET search form. No guessed endpoints or POST requests. */
export function publisherSearchLink(html: string, base: string, title: string): string | null {
  const $ = load(html), urls = new Set<string>();
  $("form").slice(0, 20).each((_, el) => {
    const form = $(el), method = (form.attr("method") || "get").toLowerCase();
    const action = samePublisherUrl(form.attr("action") || "", base);
    if (method !== "get" || !action || !/(?:^|[/_.-])search(?:[/_.-]|$)/i.test(new URL(action).pathname)) return;
    const inputs = form.find("input").toArray();
    if (inputs.some(e => ["password", "file"].includes($(e).attr("type") || ""))) return;
    const field = inputs.find(e => /^(q|query|search|keyword|search_word|searchword|searchtext)$/i.test($(e).attr("name") || "") && ["text", "search", ""].includes($(e).attr("type") || ""));
    if (!field) return;
    const u = new URL(action);
    for (const e of inputs) {
      const n = $(e), name = n.attr("name") || "";
      if (n.attr("type") === "hidden" && /^(mode|type|section|search_field|search_type|code)$/i.test(name)) u.searchParams.set(name, (n.attr("value") || "").slice(0, 100));
    }
    u.searchParams.set($(field).attr("name")!, title.slice(0, 200)); urls.add(u.href);
  });
  return urls.size === 1 ? [...urls][0] : null;
}
export function pageHasHeadline(html: string, title: string): boolean {
  const $ = load(html), key = headlineKey(title);
  return $("h1,h2,[itemprop='headline'],meta[property='og:title'],meta[name='twitter:title']").toArray().some(el => headlineKey($(el).attr("content") || $(el).text()) === key);
}

/** Signature matches fetchAndExtract so both collection and manual refetch share this policy. */
export async function fetchPublisherArticle(url: string, fetchImpl: typeof safeFetch = safeFetch, context: ArticleContext = {}): Promise<ExtractResult> {
  const decoded = decodeGoogleNewsUrl(url);
  if (!isGoogleNewsUrl(url) || decoded) {
    // Never let a direct URL redirect restart the retired Google RPC path.
    const directOnly: typeof safeFetch = async (target, options) => {
      if (isGoogleNewsUrl(target)) throw new FetchFailure("Google 중간 링크 자동 해석은 중단했습니다. 언론사 원문 주소 확인이 필요합니다.", "redirect");
      return fetchImpl(target, options);
    };
    return fetchAndExtract(decoded || url, directOnly, context);
  }
  const home = publicUrl(context.publisherUrl || "");
  if (!home || !context.title?.trim()) return { ok: false, status: "unsupported", error: "언론사 주소·기사 제목이 없어 원문 연결을 확인하지 못했습니다. Google 자동 주소 조회는 사용하지 않습니다." };
  home.pathname = "/"; home.search = "";
  const title = context.title;
  const allowedHosts = [hostKey(home.hostname), ...["www", "m", "rss"].map(p => `${p}.${hostKey(home.hostname)}`)];
  const deadline = Date.now() + 24_000;
  let calls = 0;
  const read: typeof safeFetch = async (target, options = {}) => {
    if (!samePublisherUrl(target, home.href)) throw new FetchFailure("언론사와 다른 도메인의 주소는 원문으로 사용하지 않았습니다.", "blocked");
    if (calls >= 5 || Date.now() >= deadline) throw new FetchFailure("언론사 원문 확인 시간·요청 한도에 도달했습니다.", "timeout");
    if (calls > 0 && context.takeExtraCall && !context.takeExtraCall()) throw new FetchFailure("이번 수집의 원문 호출 한도에 도달했습니다.", "too_large");
    calls++;
    const r = await fetchImpl(target, { ...options, allowedHosts, maxBytes: 2 * 1024 * 1024, timeoutMs: Math.max(1, Math.min(7000, deadline - Date.now())) });
    if (!samePublisherUrl(r.finalUrl, home.href)) throw new FetchFailure("언론사 외부의 페이지로 이동하여 중단했습니다.", "blocked");
    const problem = articleAccessProblem(r.body.toString("utf8"));
    if (problem) throw new FetchFailure(problem, "blocked");
    return r;
  };
  try {
    const homepage = await read(home.href);
    const html = homepage.body.toString("utf8");
    let candidates = exactPublisherLinks(html, homepage.finalUrl, title);
    if (candidates.length > 1) return { ok: false, status: "unsupported", error: "같은 제목의 원문 주소가 여러 개여서 임의로 선택하지 않았습니다." };
    if (!candidates.length) {
      const known = PUBLIC_NEWS_FEEDS.find(f => hostKey(new URL(f.site).hostname) === hostKey(home.hostname));
      const feeds = [...new Set([...(known ? [known.url] : []), ...publisherFeedLinks(html, homepage.finalUrl)])].slice(0, 2);
      for (const feed of feeds) {
        try {
          const response = await read(feed);
          const items = parseNewsRss(response.body.toString("utf8"), { name: "publisher", url: feed, site: home.href }, new Date());
          candidates = [...new Set(items.filter(i => headlineKey(i.title) === headlineKey(title)).map(i => samePublisherUrl(i.originallink || i.link, home.href)).filter((u): u is string => !!u))];
          if (candidates.length) break;
        } catch (e) {
          // A missing/broken feed is not a publisher access denial. Still try its
          // advertised public GET search. Restrictions and exhausted budgets stop.
          if (e instanceof FetchFailure && (e.kind !== "http" || ![404, 410].includes(e.status || 0))) throw e;
          if (!(e instanceof FetchFailure) && (!(e instanceof Error) || e.message !== "RSS/Atom 형식의 응답이 아닙니다")) throw e;
        }
      }
      if (candidates.length > 1) return { ok: false, status: "unsupported", error: "같은 제목의 RSS 원문이 여러 개여서 임의로 선택하지 않았습니다." };
      if (!candidates.length) {
        const search = publisherSearchLink(html, homepage.finalUrl, title);
        if (search) {
          const response = await read(search);
          candidates = exactPublisherLinks(response.body.toString("utf8"), response.finalUrl, title);
        }
      }
    }
    if (candidates.length !== 1) return { ok: false, status: "unsupported", error: "언론사 공개 목록·RSS·검색에서 제목이 정확히 일치하는 원문을 찾지 못했습니다. Google 확인 화면은 요청하지 않았으며 다른 기사로 대체하지 않았습니다." };
    const checked: typeof safeFetch = async (target, options) => {
      const r = await read(target, options);
      if (!pageHasHeadline(r.body.toString("utf8"), title)) throw new FetchFailure("원문 페이지의 제목이 수집 제목과 일치하지 않아 본문을 저장하지 않았습니다.", "redirect");
      return r;
    };
    return await fetchAndExtract(candidates[0], checked);
  } catch (e) {
    return { ok: false, status: e instanceof FetchFailure && (e.kind === "blocked" || [401, 402, 403, 429].includes(e.status || 0)) ? "blocked" : "failed",
      error: `언론사 직접 확인 실패: ${e instanceof Error ? e.message : "조회 오류"}. Google 자동 조회로 재시도하지 않았습니다.` };
  }
}
