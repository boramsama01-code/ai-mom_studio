/**
 * Public news collection, adapted from nodeul_news's independent-source pipeline.
 * Google News RSS + publisher RSS continue without a Naver key. Blog is optional.
 * Bound requests, record partial coverage, and stop a failed provider for this run.
 * Never bypass a login, paywall, rate limit, or bot challenge.
 */
import { load } from "cheerio";
import { safeFetch } from "./safeFetch";
import { stripHtml } from "./text";
import { parseNewsPubDate } from "./dates";
import { naverSearch, NaverError, searchCalls, type NaverItem } from "./naver";

export const PUBLIC_NEWS_FEEDS = [
  { name: "연합뉴스", url: "https://www.yna.co.kr/rss/news.xml", site: "https://www.yna.co.kr" },
  { name: "동아일보", url: "https://rss.donga.com/total.xml", site: "https://www.donga.com" },
  { name: "한국경제", url: "https://www.hankyung.com/feed/all-news", site: "https://www.hankyung.com" },
  { name: "전자신문", url: "https://rss.etnews.com/Section901.xml", site: "https://www.etnews.com" },
  { name: "지디넷코리아", url: "https://zdnet.co.kr/feed/article_list2.xml", site: "https://zdnet.co.kr" },
  { name: "MBC", url: "https://imnews.imbc.com/rss/news/news_00.xml", site: "https://imnews.imbc.com" },
];
type Feed = { name: string; url: string; site: string };
export type RssLoader = (url: string) => Promise<string>;
export type SearchFunction = typeof naverSearch;
const publicUrl = (value: string) => { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : ""; } catch { return ""; } };

export function parseNewsRss(xml: string, feed: Feed, now: Date, google = false): NaverItem[] {
  if (!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error("RSS/Atom 형식의 응답이 아닙니다");
  const $ = load(xml, { xmlMode: true });
  const items: NaverItem[] = [];
  $("item, entry").each((_, node) => {
    const e = $(node), source = e.find("source").first();
    let title = stripHtml(e.find("title").first().text()).trim();
    const publisher = stripHtml(source.text()).trim() || (google ? title.split(" - ").slice(-1)[0] : feed.name);
    if (google && publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -publisher.length - 3).trim();
    const link = publicUrl(e.find("link").first().text().trim() || e.find('link[rel="alternate"]').attr("href") || e.find("link").attr("href") || "");
    const raw = e.find("pubDate, published, updated, dc\\:date").first().text().trim();
    const published = parseNewsPubDate(raw);
    const time = published.iso ? Date.parse(published.iso) : NaN;
    if (!title || !link || !Number.isFinite(time) || time > now.getTime() + 5 * 60_000 || time < now.getTime() - 7 * 86400_000) return;
    const description = stripHtml(e.find("description, summary, content, content\\:encoded").first().text()).slice(0, 2000);
    items.push({ endpoint: "news", title: title.slice(0, 500), description, link, originallink: google ? undefined : link,
      published, raw: {}, provider: google ? "google_news_rss" : "rss_direct", publisher,
      publisherUrl: publicUrl(source.attr("url") || (google ? "" : feed.site)), feedUrl: feed.url });
  });
  return items;
}

export function matchesNewsQuery(item: Pick<NaverItem, "title" | "description">, query: string) {
  const text = `${item.title} ${item.description}`.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const terms = query.normalize("NFKC").toLowerCase().replace(/["'()]/g, " ").split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every(t => text.includes(t.replace(/[^\p{L}\p{N}]/gu, "")));
}

export function uniqueNews(items: NaverItem[]) {
  const urls = new Set<string>(), titles = new Set<string>();
  return items.filter(item => {
    const url = item.originallink || item.link;
    const key = `${item.publisher || ""}|${item.title.normalize("NFKC").replace(/\s+/g, "").toLowerCase()}|${item.published.iso?.slice(0, 10)}`;
    if (urls.has(url) || (item.publisher && titles.has(key))) return false;
    urls.add(url); titles.add(key); return true;
  });
}

let googleTail = Promise.resolve();
let nextGoogleAt = 0;
async function pacedGoogle<T>(fn: () => Promise<T>, paced: boolean): Promise<T> {
  if (!paced) return fn();
  const result = googleTail.then(async () => {
    const wait = nextGoogleAt - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    nextGoogleAt = Date.now() + 1500;
    return fn();
  });
  googleTail = result.then(() => undefined, () => undefined);
  return result;
}

export function createNewsSearch(opts: { now?: Date; loadXml?: RssLoader; feeds?: Feed[]; naver?: SearchFunction } = {}) {
  const now = opts.now ?? new Date(), feeds = opts.feeds ?? PUBLIC_NEWS_FEEDS;
  const counts = { rssRequests: 0, rssFeedOk: 0, rssFeedFailed: 0, googleQueries: 0, googleFailed: 0, blogSkipped: 0 };
  const warnings: Array<{ scope: string; message: string }> = [];
  const loadXml = opts.loadXml ?? (async (url: string) => (await safeFetch(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9" })).body.toString("utf8"));
  let direct: Promise<NaverItem[]> | null = null, googleStopped = false, blogError: NaverError | null = null;
  const warn = (scope: string, message: string) => { if (!warnings.some(w => w.scope === scope)) warnings.push({ scope, message }); };
  async function directItems() {
    direct ??= (async () => {
      const items: NaverItem[] = [];
      // Two simultaneous public feeds at most; each has its own error state.
      for (let i = 0; i < feeds.length; i += 2) {
        const batch = await Promise.allSettled(feeds.slice(i, i + 2).map(async feed => {
          counts.rssRequests++;
          try { const found = parseNewsRss(await loadXml(feed.url), feed, now); counts.rssFeedOk++; return found; }
          catch (e) { counts.rssFeedFailed++; warn(`rss:${feed.name}`, `${feed.name} RSS: ${(e as Error).message}`); return []; }
        }));
        for (const result of batch) if (result.status === "fulfilled") items.push(...result.value);
      }
      return items;
    })();
    return direct;
  }
  const search: SearchFunction = async (query, endpoint, display, counter) => {
    if (searchCalls(counter) >= counter.limit) throw new NaverError("이번 실행의 검색 한도 도달", "rate_limit");
    if (endpoint === "blog") {
      if (blogError) { counts.blogSkipped++; throw blogError; }
      try { return await (opts.naver ?? naverSearch)(query, endpoint, display, counter); }
      catch (e) {
        if (e instanceof NaverError && ["auth", "not_configured", "rate_limit"].includes(e.kind)) {
          blogError = e;
          warn("naver_blog", "네이버 블로그 검색이 연결되지 않아 블로그 결과를 생략했습니다. 공개 뉴스 수집은 계속됩니다.");
        }
        throw e;
      }
    }
    counter.rss = (counter.rss ?? 0) + 1;
    const matches = (await directItems()).filter(item => matchesNewsQuery(item, query));
    let google: NaverItem[] = [], googleOk = false;
    if (!googleStopped) {
      const url = new URL("https://news.google.com/rss/search");
      url.search = new URLSearchParams({ q: `${query} when:7d`, hl: "ko", gl: "KR", ceid: "KR:ko" }).toString();
      try {
        google = await pacedGoogle(async () => {
          counts.rssRequests++; counts.googleQueries++;
          return parseNewsRss(await loadXml(url.href), { name: "Google 뉴스", url: url.href, site: "https://news.google.com" }, now, true);
        }, !opts.loadXml);
        googleOk = true;
        if (google.length >= 100) warn("google_limit", "Google 뉴스 RSS의 결과 상한에 도달했습니다. 전체 기사 수집을 보장하지 않습니다.");
      } catch (e) {
        googleStopped = true; counts.googleFailed++;
        warn("google_news_rss", `Google 뉴스 RSS: ${(e as Error).message}. 이번 실행의 추가 요청은 중단하고 언론사 RSS를 계속 확인합니다.`);
      }
    }
    if (!googleOk && counts.rssFeedOk === 0) throw new NaverError("공개 뉴스 수집 경로가 모두 응답하지 않았습니다. 실행 기록을 확인하세요.", "network");
    return uniqueNews([...matches, ...google]).sort((a, b) => (b.published.iso || "").localeCompare(a.published.iso || "")).slice(0, display);
  };
  return { search, counts, warnings };
}
