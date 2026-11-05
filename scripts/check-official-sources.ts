/** Read-only public-list check: no DB, secrets, AI, messages or publishing. */
import { load } from "cheerio";
import { OFFICIAL_CATALOG } from "../server/services/officialCatalog";
import { fetchBoardList } from "../server/services/boardAdapter";
import { fetchPublisherArticle } from "../server/services/publisherLookup";
import { safeFetch } from "../server/services/safeFetch";
import { decodePublicText } from "../server/services/publicTextResponse";

let succeeded = 0;
for (const source of OFFICIAL_CATALOG) {
  const result = await fetchBoardList(source.boardUrl, source.domain, source.config, undefined, { takeExtraCall: () => true });
  if (result.ok) succeeded++;
  console.log(JSON.stringify({ name: source.name, url: source.boardUrl, ...result, ...(result.ok ? { total: result.entries.length, entries: result.entries.slice(0, 2) } : {}) }, null, 2));
  if (result.ok) {
    const article = await fetchPublisherArticle(result.entries[0].url, undefined, { title: result.entries[0].title, takeExtraCall: () => false });
    console.log(JSON.stringify({ name: source.name, article: article.ok ? { ok: true, finalUrl: article.finalUrl, textLength: article.text.length, attachments: article.attachments.map(a => ({ kind: a.kind, status: a.status })) } : article }));
  }
  if (process.argv.includes("--inspect")) {
    try {
      const res = await safeFetch(source.boardUrl, { timeoutMs: 10000, maxBytes: 2 * 1024 * 1024 });
      const $ = load(decodePublicText(res.body, res.contentType));
      console.log(JSON.stringify({ name: source.name, forms: $("form").map((_, el) => ({ action: $(el).attr("action"), fields: $(el).find("input,select").map((_, f) => ({ name: $(f).attr("name"), value: $(f).attr("value"), options: $(f).find("option").map((_, o) => $(o).attr("value")).get() })).get() })).get(), links: $("a[href]").toArray().filter(el => /mng_no=|wr_id=|articleNo=|bbsSn=|page|Page|fn_down/.test($(el).attr("href") ?? "")).slice(0, 20).map(el => $(el).prop("outerHTML")?.slice(0, 1200)), rssItem: source.config.format === "rss" ? $("item,entry").first().prop("outerHTML")?.slice(0, 2500) : undefined, scripts: source.config.format === "ged_selection" ? $("script").text().slice(-18000) : undefined }));
    } catch (error) { console.log(`Inspect unavailable: ${(error as Error).message}`); }
  }
}
console.log(`Public source check: ${succeeded}/${OFFICIAL_CATALOG.length} returned entries.`);
if (succeeded !== OFFICIAL_CATALOG.length) process.exitCode = 1;
