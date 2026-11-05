/** Public article metadata only: no browser execution, login, paywall or challenge bypass. */
import { load } from "cheerio";
import { isIP } from "node:net";
import { PUBLIC_NEWS_FEEDS, parseNewsRss } from "./newsSearch";
import type { safeFetch } from "./safeFetch";
import { isPrivateIp } from "./url";
import { decodePublicText } from "./publicTextResponse";

export type ArticleContext = { title?: string; publisherUrl?: string; takeExtraCall?: () => boolean };
const clean = (s: string) => s.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
export const articleHeadlineKey = (s: string) => s.normalize("NFKC").replace(/[…]/g, "...").replace(/[‘’“”"'「」『』]/g, "").replace(/[\s\u200b]+/g, "").trim();
const publisherHost = (host: string) => host.toLowerCase().replace(/^(?:www|m|amp)\./, "");
const restrictedPage = /\/(?:login|signin|captcha|challenge|consent|paywall|subscribe|logout|delete|remove)(?:[/.]|$)/i;
export function isGoogleNewsUrl(value: string): boolean {
  try { return new URL(value).hostname === "news.google.com"; } catch { return false; }
}
function publicLink(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const u = new URL(value, base);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port)) || /(^|\.)google\.[a-z.]+$/.test(host)
      || /(^|\.)(localhost|internal|local|invalid)$/.test(host) || (isIP(host) && isPrivateIp(host))) return null;
    u.hash = "";
    return u.href;
  } catch { return null; }
}

/** Older Google News URLs contain a length-delimited public URL, not an encrypted article. */
export function decodeGoogleNewsUrl(value: string): string | null {
  if (!isGoogleNewsUrl(value)) return null;
  const m = new URL(value).pathname.match(/^\/(?:rss\/)?articles\/([A-Za-z0-9_-]{8,8192})\/?$/);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64url");
  if (bytes[0] !== 8 || bytes[1] !== 19 || bytes[2] !== 34) return null;
  let len = 0, shift = 0, pos = 3;
  while (pos < bytes.length && shift <= 21) {
    const n = bytes[pos++]; len += (n & 127) * 2 ** shift;
    if (!(n & 128)) return len > 0 && pos + len <= bytes.length ? publicLink(bytes.subarray(pos, pos + len).toString("utf8")) : null;
    shift += 7;
  }
  return null;
}

function articleNodes(html: string): Record<string, unknown>[] {
  const $ = load(html), found: Record<string, unknown>[] = [];
  let visited = 0;
  function walk(v: unknown, depth = 0) {
    if (++visited > 1000 || depth > 12 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    const obj = v as Record<string, unknown>;
    const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
    if (types.some(t => typeof t === "string" && /(?:^|[/#])(?:Article|NewsArticle|BlogPosting|TechArticle|(?:Reportage|Analysis|Opinion|Review|Background)NewsArticle)$/.test(t))) found.push(obj);
    for (const key of ["@graph", "mainEntity", "hasPart"]) if (obj[key]) walk(obj[key], depth + 1);
  }
  $("script[type]").filter((_, el) => ($(el).attr("type") || "").split(";", 1)[0].trim().toLowerCase() === "application/ld+json").slice(0, 20).each((_, el) => {
    const raw = $(el).text().trim().replace(/^<!--([\s\S]*)-->$/, "$1").replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
    if (raw.length > 500_000) return;
    try { walk(JSON.parse(raw)); } catch { /* malformed metadata is not executable code */ }
  });
  return found;
}
export function articleAccessProblem(html: string, pageUrl?: string): string | null {
  const $ = load(html);
  const title = $("title").text().trim();
  if ($("#challenge-form, #cf-challenge-running, form[action*='captcha']").length || /^(just a moment|access denied|attention required|robot check)/i.test(title))
    return "사이트가 자동 조회를 차단했습니다. 인증·봇 검증은 우회하지 않습니다. 원문을 직접 열어 확인해 주세요.";
  if (articleNodes(html).some(a => a.isAccessibleForFree === false || a.isAccessibleForFree === "false"))
    return "로그인·구독 제한이 표시된 기사입니다. 제한을 우회하지 않습니다. 열람 권한이 있는 원문은 직접 확인해 주세요.";
  let loginUrl = false;
  try { loginUrl = !!pageUrl && restrictedPage.test(new URL(pageUrl).pathname); } catch { /* URL validation happens at fetch time. */ }
  if (loginUrl || ($("input[type='password']").length && /^(?:로그인|회원 로그인|sign\s?in|log\s?in)(?:$|\b|\s|[|:·-])/i.test(title)))
    return "원문 대신 로그인·접근 확인 페이지가 열렸습니다. 원문을 직접 열어 확인하거나 열람 권한이 있는 본문을 붙여넣어 주세요.";
  return null;
}

const relatedContent = "aside,nav,footer,[role='navigation'],.related-news,.related-articles,.related,.recommended,.recommendations,.advertisement,[aria-hidden='true'],[hidden]";

/** Verified official detail layouts often use the site/section name as h1/og:title. */
function officialDetailHeadlines(html: string, pageUrl?: string): string[] {
  if (!pageUrl) return [];
  let u: URL;
  try { u = new URL(pageUrl); } catch { return []; }
  const host = u.hostname.replace(/^www\./, "");
  const selector = host === "scienceall.com" && u.pathname.startsWith("/brd/board/") && u.searchParams.has("bbsSn") ? ".board_view.bd_noti .title .tit"
    : host === "koi.or.kr" && /^\/notice\/\d{4}\/\d{2}\/\d{2}\//.test(u.pathname) ? "td.subject > b[aria-current='page']"
    : host === "mcst.go.kr" && /\/s_notice\/press\/pressView\.jsp$/.test(u.pathname) && u.searchParams.has("pSeq") ? "h3.view_title"
    : host === "ksa.hs.kr" && /^\/Home\/BoardRead\/\d+$/.test(u.pathname) && u.searchParams.has("DataId") ? ".board_view > .title_bar"
    : host === "kaist.ac.kr" && u.pathname === "/news/html/news/" && u.searchParams.get("mode") === "V" && u.searchParams.has("mng_no") ? "meta[property='og:title']" : null;
  if (!selector) return [];
  const $ = load(html);
  $(relatedContent).remove();
  const nodes = $(selector);
  if (nodes.length !== 1) return [];
  const value = clean(nodes.attr("content") || nodes.text());
  return value ? [value] : [];
}

/** Only page-level and primary visible headlines can identify an article. */
function primaryMarkupHeadlines(html: string): string[] {
  const $ = load(html), titles = new Set<string>();
  $(relatedContent).remove();
  // A related-news h2, anchor label or summary cannot override the actual h1.
  for (const selector of ["article h1", "main h1", "h1", "article [itemprop='headline']", "main [itemprop='headline']"]) {
    const headings = $(selector).filter((_, el) => !$(el).closest("a").length);
    if (!headings.length) continue;
    headings.slice(0, 10).each((_, el) => { const value = clean($(el).text()); if (value) titles.add(value); });
    break;
  }
  $("meta[property='og:title'],meta[name='twitter:title']").slice(0, 10).each((_, el) => {
    const value = clean($(el).attr("content") || ""); if (value) titles.add(value);
  });
  return [...titles];
}

function articleNodeUrls(article: Record<string, unknown>): string[] {
  const values = [article.url, article["@id"], article.mainEntityOfPage];
  return values.flatMap(value => typeof value === "string" ? [value] : value && typeof value === "object" && !Array.isArray(value)
    ? [String((value as Record<string, unknown>)["@id"] || (value as Record<string, unknown>).url || "")] : []).filter(Boolean);
}

/** Bind JSON-LD headline and body from one node. Never choose the longest related story. */
function primaryStructuredArticles(html: string, pageUrl?: string, expectedTitle?: string): Record<string, unknown>[] {
  const $ = load(html), nodes = articleNodes(html);
  const titles = primaryMarkupHeadlines(html);
  if (expectedTitle) titles.push(expectedTitle);
  const keys = new Set(titles.map(articleHeadlineKey));
  const matching = keys.size ? nodes.filter(node => typeof node.headline === "string" && keys.has(articleHeadlineKey(node.headline))
    && (!expectedTitle || articleHeadlineKey(node.headline) === articleHeadlineKey(expectedTitle))) : nodes;
  const canonical = $("link[rel~='canonical'][href]").attr("href");
  const page = pageUrl ? publicLink(canonical || pageUrl, pageUrl) : null;
  const bound = page ? matching.filter(node => articleNodeUrls(node).some(value => {
    const url = publicLink(value, pageUrl); return url && articleIdentityUrl(url) === articleIdentityUrl(page);
  })) : [];
  if (bound.length) return bound;
  // Without a primary headline or matching canonical, multiple Article nodes are ambiguous.
  return matching.length === 1 ? matching : [];
}

/** Descriptions, related headings and unrelated JSON-LD nodes are never identity evidence. */
export function articleHeadlines(html: string, pageUrl?: string): string[] {
  const official = officialDetailHeadlines(html, pageUrl);
  if (official.length) return official;
  const primary = primaryMarkupHeadlines(html);
  if (primary.length) return primary;
  return primaryStructuredArticles(html, pageUrl).flatMap(article => typeof article.headline === "string" && article.headline.trim() ? [clean(article.headline)] : []);
}

export function matchesPrimaryArticleHeadline(html: string, title: string, pageUrl?: string): boolean {
  const key = articleHeadlineKey(title), primary = articleHeadlines(html, pageUrl);
  // Conflicting primary metadata is unresolved, even when one metadata entry matches.
  return !!key && primary.length > 0 && primary.every(value => articleHeadlineKey(value) === key);
}

export type PublicArticleAlternate = { url: string; canonical: string; titles: string[]; allowedHosts: string[] };
function articleIdentityUrl(value: string): string {
  const u = new URL(value); u.hash = ""; u.hostname = publisherHost(u.hostname);
  for (const key of [...u.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return `${u.hostname}${u.pathname.replace(/\/$/, "")}${u.search}`;
}

/** Follow one explicitly advertised public rendition. Never guess AMP/mobile paths or cross publishers. */
export function publicArticleAlternate(html: string, base: string, context: ArticleContext = {}): PublicArticleAlternate | null {
  const original = publicLink(base);
  if (!original || articleAccessProblem(html, base)) return null;
  const $ = load(html), host = publisherHost(new URL(original).hostname);
  const samePublisher = (value: string | undefined) => {
    const url = publicLink(value, base);
    if (!url || publisherHost(new URL(url).hostname) !== host || new URL(url).pathname === "/" || restrictedPage.test(new URL(url).pathname)) return null;
    return url;
  };
  const canonicalUrls = [...new Set($("link[rel~='canonical'][href]").toArray().map(el => samePublisher($(el).attr("href"))).filter((url): url is string => !!url))];
  const canonical = canonicalUrls.length === 1 ? canonicalUrls[0] : original;
  const titles = articleHeadlines(html, base);
  if (!titles.length && context.title?.trim()) titles.push(context.title);
  for (const selector of ["link[rel~='amphtml'][href]", "link[rel~='alternate'][media][href]:not([hreflang])", "link[rel~='canonical'][href]"]) {
    const urls = [...new Set($(selector).toArray().map(el => samePublisher($(el).attr("href"))).filter((url): url is string => !!url && url !== original))];
    if (urls.length !== 1) continue;
    return { url: urls[0], canonical, titles, allowedHosts: [host, ...["www", "m", "amp"].map(prefix => `${prefix}.${host}`)] };
  }
  return null;
}

/** An alternate must identify the same article by canonical URL or the same complete headline. */
export function sameArticleAlternate(html: string, finalUrl: string, alternate: PublicArticleAlternate): boolean {
  const url = publicLink(finalUrl);
  if (!url || !alternate.allowedHosts.includes(new URL(url).hostname) || restrictedPage.test(new URL(url).pathname)) return false;
  const expected = new Set(alternate.titles.map(articleHeadlineKey));
  const titles = articleHeadlines(html, finalUrl);
  const sameTitle = titles.some(title => expected.has(articleHeadlineKey(title)));
  if (expected.size && titles.length && !titles.every(title => expected.has(articleHeadlineKey(title)))) return false;
  const $ = load(html);
  const canonicalMatches = $("link[rel~='canonical'][href]").toArray().some(el => {
    const canonical = publicLink($(el).attr("href"), url);
    return canonical && articleIdentityUrl(canonical) === articleIdentityUrl(alternate.canonical);
  });
  return sameTitle || canonicalMatches || articleIdentityUrl(url) === articleIdentityUrl(alternate.canonical);
}
export function structuredArticleBody(html: string, pageUrl?: string, expectedTitle?: string): { title: string; text: string } {
  if (articleAccessProblem(html)) return { title: "", text: "" };
  const candidates = primaryStructuredArticles(html, pageUrl, expectedTitle).filter(a => typeof a.articleBody === "string");
  const bodies = new Set(candidates.map(article => String(article.articleBody).trim()));
  const article = bodies.size === 1 ? candidates[0] : undefined;
  if (!article) return { title: "", text: "" };
  const $ = load(String(article.articleBody));
  $("script,style,iframe").remove();
  $("br").replaceWith("\n"); $("p,div,li").append("\n");
  return { title: typeof article.headline === "string" ? article.headline : "", text: clean($.text()).slice(0, 20_000) };
}

/** Only explicit original-article links; never pick an arbitrary related or advertising link. */
export function googleArticleLink(html: string, base: string): string | null {
  if (!isGoogleNewsUrl(base)) return null;
  const $ = load(html), links = new Set<string>();
  $("[data-n-au], link[rel='canonical'], meta[property='og:url']").each((_, el) => {
    const u = publicLink($(el).attr("data-n-au") || $(el).attr("href") || $(el).attr("content"), base);
    if (u) links.add(u);
  });
  $("a[href]").each((_, el) => {
    if (!/^(원문(?: 보기| 기사)?|기사 원문|전체 기사(?: 읽기)?|read (?:the )?full article|go to article)$/i.test($(el).text().trim())) return;
    const u = publicLink($(el).attr("href"), base); if (u) links.add(u);
  });
  return links.size === 1 ? [...links][0] : null;
}

/** Match the SAME headline on a known publisher's public RSS; no fuzzy title guessing. */
export async function publisherArticleLink(context: ArticleContext, fetchImpl: typeof safeFetch, timeoutMs: number): Promise<string | null> {
  if (!context.title || !context.publisherUrl) return null;
  let host: string;
  try { host = new URL(context.publisherUrl).hostname.replace(/^www\./, ""); } catch { return null; }
  const feed = PUBLIC_NEWS_FEEDS.find(f => new URL(f.site).hostname.replace(/^www\./, "") === host);
  if (!feed || (context.takeExtraCall && !context.takeExtraCall())) return null;
  const r = await fetchImpl(feed.url, { maxBytes: 2 * 1024 * 1024, timeoutMs: Math.min(8000, timeoutMs), accept: "application/rss+xml,application/xml,text/xml" });
  const urls = new Set(parseNewsRss(decodePublicText(r.body, r.contentType), feed, new Date())
    .filter(item => articleHeadlineKey(item.title) === articleHeadlineKey(context.title!))
    .map(item => publicLink(item.originallink || item.link)).filter((u): u is string => !!u));
  return urls.size === 1 ? [...urls][0] : null;
}
