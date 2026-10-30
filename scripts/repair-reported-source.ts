/** Explicit maintenance only. Repairs source #2600 after identity/title checks. Never edits drafts or publishes. */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { fetchAndExtract } from "../server/services/extract";
import { sourceFetchUrl } from "../server/services/sourceFetchUrl";
const sourceId = 2600;
// Obtained twice from the exact Google article ID in the read-only diagnostics, not guessed.
const verifiedOriginal = "http://www.aifnlife.co.kr/news/articleView.html?idxno=27978";
const key = (text: string) => text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "").toLowerCase();
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), sourceId, restored: false, sourceWrites: 0, draftsModified: 0, paidAiCalls: 0, externalPosts: 0 };
const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL, connectionTimeoutMillis: 8000 });
try {
  if (process.env.REPAIR_REPORTED_SOURCE !== "2600") throw new Error("Explicit single-source repair flag missing");
  await client.connect();
  const before = (await client.query("SELECT * FROM source_documents WHERE id=$1", [sourceId])).rows[0];
  if (!before || before.kind !== "google_news_rss" || before.is_sample || new URL(before.original_url).hostname !== "news.google.com" || !before.title.includes("[AI 월드]") || !before.title.includes("빌 게이츠")) throw new Error("Source identity mismatch");
  if (before.fetch_status === "ok" && before.fetched_text && before.content_hash) {
    report.alreadyRestored = true;
  } else {
    if (before.fetched_text || before.content_hash || !String(before.fetch_error).includes("HTTP 302")) throw new Error("Source changed since diagnostic; existing content preserved");
    const result = await fetchAndExtract(verifiedOriginal);
    if (!result.ok) { report.reason = result.error; throw new Error("Publisher fetch failed; no database writes"); }
    if (key(result.title) !== key(before.title) || result.text.length < 80 || new URL(result.finalUrl).hostname !== "www.aifnlife.co.kr") throw new Error("Publisher identity/title check failed; no database writes");
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const fresh = (await client.query("SELECT * FROM source_documents WHERE id=$1 FOR UPDATE", [sourceId])).rows[0];
    if (!fresh || fresh.original_url !== before.original_url || fresh.title !== before.title || fresh.fetched_text || fresh.content_hash || !String(fresh.fetch_error).includes("HTTP 302")) throw new Error("Concurrent source update; preserving it");
    const meta = { ...fresh.meta, finalUrl: result.finalUrl, pageTitle: result.title, recoveredBy: "reported-http302-fix", recoveredAt: new Date().toISOString() };
    await client.query("UPDATE source_documents SET fetch_status='ok', fetch_error=NULL, fetched_text=$2, content_hash=$3, attachments=$4::jsonb, meta=$5::jsonb, last_fetched_at=now(), updated_at=now() WHERE id=$1", [sourceId, result.text, result.hash, JSON.stringify(result.attachments), JSON.stringify(meta)]);
    await client.query("UPDATE content_items SET evidence_status='needs_review', updated_at=now() WHERE primary_source_id=$1 AND evidence_status='fetch_failed'", [sourceId]);
    await client.query("INSERT INTO audit_logs (actor,action,entity,entity_id,detail) VALUES ($1,$2,$3,$4,$5::jsonb)", ["operator-requested-repair", "fetch_source_recovery", "source_document", String(sourceId), JSON.stringify({ reason: "reported_HTTP_302", finalUrl: result.finalUrl, characters: result.text.length, titleMatched: true, draftsModified: 0 })]);
    await client.query("COMMIT");
    report.sourceWrites = 1;
  }
  const saved = (await client.query("SELECT original_url, fetch_status, fetch_error, fetched_text, content_hash, meta FROM source_documents WHERE id=$1", [sourceId])).rows[0];
  report.restored = saved.fetch_status === "ok" && saved.fetch_error === null && saved.fetched_text?.length >= 80;
  report.characters = saved.fetched_text?.length ?? 0;
  report.nextFetchUrl = sourceFetchUrl({ originalUrl: saved.original_url, meta: saved.meta, fetchedText: saved.fetched_text, contentHash: saved.content_hash });
  report.items = (await client.query("SELECT id, channel_id FROM content_items WHERE primary_source_id=$1 AND is_sample=false", [sourceId])).rows;
} catch (e) {
  await client.query("ROLLBACK").catch(() => undefined);
  report.error = e instanceof Error && !/(password|connection|postgres|ssl)/i.test(e.message) ? e.message : "Source repair could not complete; no credentials logged";
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
  writeFileSync("reported-source-repair.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
