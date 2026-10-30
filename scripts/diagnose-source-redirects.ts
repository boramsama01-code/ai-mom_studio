/** Diagnostic: read at most three failed sources. No DB writes, AI calls or redirect following for POST. */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { safeFetch, GOOGLE_NEWS_RPC_URL } from "../server/services/safeFetch";
import { googleNewsParameters, googleNewsRequestForm, parseGoogleNewsResponse } from "../server/services/googleNewsResolve";
import { fetch as httpFetch } from "undici";

type Sample = { id: number; title: string; original_url: string; fetch_error: string | null; meta: Record<string, unknown> };
const samples: Sample[] = [];
const notices: string[] = [];
if (process.env.APP_DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const r = await client.query(`SELECT id, title, original_url, fetch_error, meta FROM source_documents
      WHERE kind = 'google_news_rss' AND is_sample = false AND fetch_status <> 'ok'
      ORDER BY (fetch_error LIKE '%HTTP 302%') DESC NULLS LAST, last_fetched_at DESC NULLS LAST, id DESC LIMIT 3`);
    samples.push(...r.rows);
    await client.query("ROLLBACK");
  } catch { notices.push("Failed-source metadata unavailable. No data changed."); }
  finally { await client.end().catch(() => undefined); }
}
function locationLabel(value: string | null) {
  if (!value) return null;
  try { const u = new URL(value, GOOGLE_NEWS_RPC_URL); return { origin: u.origin, path: u.pathname, queryKeys: [...u.searchParams.keys()] }; }
  catch { return { invalid: true }; }
}
const results: Record<string, unknown>[] = [];
for (const sample of samples) {
  const result: Record<string, unknown> = { sourceId: sample.id, title: sample.title, previousError: sample.fetch_error,
    originalUrl: sample.original_url, savedFinalUrl: sample.meta?.finalUrl ?? null, savedFetchUrl: sample.meta?.fetchUrl ?? null };
  try {
    const page = await safeFetch(sample.original_url, { timeoutMs: 8000 });
    const p = googleNewsParameters(page.finalUrl, page.body.toString("utf8"));
    result.pageStatus = page.status; result.hasLookupParameters = !!p;
    if (p) {
      // Fixed Google endpoint only, never follow a redirect or forward the form to another host.
      const r = await httpFetch(GOOGLE_NEWS_RPC_URL, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "ai-mom-studio/0.1 (+education notice monitor; contact via site operator)", "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "accept-language": "ko-KR,ko;q=0.9", accept: "application/json,text/plain,*/*;q=0.1", referer: "https://news.google.com/" },
        body: googleNewsRequestForm(p) });
      result.lookupStatus = r.status; result.redirect = locationLabel(r.headers.get("location"));
      if (r.status === 200 && !/text\/html/i.test(r.headers.get("content-type") || "")) {
        const bytes = await r.arrayBuffer();
        if (bytes.byteLength <= 512000) result.resolvedUrl = parseGoogleNewsResponse(Buffer.from(bytes).toString("utf8"));
      } else await r.body?.cancel();
    }
  } catch (e) { result.error = (e as Error).message; }
  results.push(result);
  await new Promise(r => setTimeout(r, 1600));
}
const report = { checkedAt: new Date().toISOString(), environment: "GitHub Actions, not Render", productionWrites: 0, paidAiCalls: 0, notices, results };
writeFileSync("source-redirect-diagnostic.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
