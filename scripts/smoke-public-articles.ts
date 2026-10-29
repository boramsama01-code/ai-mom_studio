/** Run manually with tsx. Public HTTP reads only; no DB writes, LLMs or publishing. */
import { safeFetch } from "../server/services/safeFetch";
import { fetchAndExtract } from "../server/services/extract";
import { PUBLIC_NEWS_FEEDS, parseNewsRss } from "../server/services/newsSearch";
import { writeFileSync } from "node:fs";
const results: Record<string, unknown>[] = [];
for (const name of ["동아일보", "한국경제", "전자신문"]) {
  const feed = PUBLIC_NEWS_FEEDS.find(f => f.name === name)!;
  try {
    const response = await safeFetch(feed.url, { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024 });
    const item = parseNewsRss(response.body.toString("utf8"), feed, new Date())[0];
    if (!item) { results.push({ publisher: name, ok: false, reason: "No current article in feed" }); continue; }
    const result = await fetchAndExtract(item.originallink || item.link, undefined, { title: item.title, publisherUrl: item.publisherUrl });
    results.push(result.ok ? { publisher: name, ok: true, url: result.finalUrl, title: item.title, characters: result.text.length }
      : { publisher: name, ok: false, url: item.link, status: result.status, reason: result.error });
  } catch (e) { results.push({ publisher: name, ok: false, reason: (e as Error).message }); }
}
try {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent("과학 when:2d") + "&hl=ko&gl=KR&ceid=KR:ko";
  const response = await safeFetch(url, { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024 });
  const item = parseNewsRss(response.body.toString("utf8"), { name: "Google 뉴스", url, site: "https://news.google.com" }, new Date(), true)[0];
  if (item) {
    const result = await fetchAndExtract(item.link, undefined, { title: item.title, publisherUrl: item.publisherUrl });
    results.push(result.ok ? { provider: "google_news_rss", publisher: item.publisher, ok: true, url: result.finalUrl, characters: result.text.length }
      : { provider: "google_news_rss", publisher: item.publisher, ok: false, status: result.status, reason: result.error });
  }
} catch (e) { results.push({ provider: "google_news_rss", ok: false, reason: (e as Error).message }); }
const report = { checkedAt: new Date().toISOString(), environment: "GitHub Actions, not the production Render server", results };
console.log(JSON.stringify(report, null, 2));
writeFileSync("public-article-smoke.json", JSON.stringify(report, null, 2));
