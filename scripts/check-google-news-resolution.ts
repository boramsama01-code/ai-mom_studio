/** Explicit diagnostic only: at most three articles, a READ ONLY DB transaction, no AI or writes. */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { safeFetch, GOOGLE_NEWS_RPC_URL } from "../server/services/safeFetch";
import { fetchAndExtract } from "../server/services/extract";
import { parseGoogleNewsResponse } from "../server/services/googleNewsResolve";
import { parseNewsRss } from "../server/services/newsSearch";
type Sample = { sourceId?: number; title: string; url: string; publisherUrl?: string };
let samples: Sample[] = [];
const notices: string[] = [];
if (process.env.APP_DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const r = await client.query(`SELECT id, title, original_url, meta FROM source_documents
      WHERE kind = 'google_news_rss' AND is_sample = false AND fetch_status <> 'ok'
      ORDER BY updated_at DESC, id DESC LIMIT 3`);
    samples = r.rows.map(row => ({ sourceId: row.id, title: row.title, url: row.original_url,
      publisherUrl: typeof row.meta?.publisherUrl === "string" ? row.meta.publisherUrl : undefined }));
    await client.query("ROLLBACK");
  } catch {
    // Do not log database exception text: some drivers include connection details.
    notices.push("Saved-source read unavailable; no production data was changed.");
  } finally { await client.end().catch(() => undefined); }
}
if (!samples.length) {
  try {
    const url = "https://news.google.com/rss/search?q=" + encodeURIComponent("과학 when:2d") + "&hl=ko&gl=KR&ceid=KR:ko";
    const r = await safeFetch(url, { timeoutMs: 8000 });
    samples = parseNewsRss(r.body.toString("utf8"), { name: "Google 뉴스", url, site: "https://news.google.com" }, new Date(), true)
      .slice(0, 3).map(item => ({ title: item.title, url: item.link, publisherUrl: item.publisherUrl }));
  } catch { notices.push("Public sample feed unavailable."); }
}
const results: Record<string, unknown>[] = [];
for (const sample of samples) {
  const calls: string[] = []; let resolvedUrl: string | null = null;
  const fetcher: typeof safeFetch = async (url, options) => {
    calls.push(url === GOOGLE_NEWS_RPC_URL ? "google_url_lookup" : new URL(url).hostname);
    const r = await safeFetch(url, options);
    if (url === GOOGLE_NEWS_RPC_URL) resolvedUrl = parseGoogleNewsResponse(r.body.toString("utf8"));
    return r;
  };
  const result = await fetchAndExtract(sample.url, fetcher, { title: sample.title, publisherUrl: sample.publisherUrl });
  results.push({ ...sample, resolvedUrl, calls, bodyOk: result.ok,
    ...(result.ok ? { finalUrl: result.finalUrl, characters: result.text.length, pageTitle: result.title }
      : { status: result.status, reason: result.error }) });
  await new Promise(r => setTimeout(r, 1500));
}
const report = { checkedAt: new Date().toISOString(), environment: "GitHub Actions", productionWrites: 0, paidAiCalls: 0,
  samples: samples.length, bodySuccesses: results.filter(r => r.bodyOk).length, notices, results };
writeFileSync("google-news-resolution-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
