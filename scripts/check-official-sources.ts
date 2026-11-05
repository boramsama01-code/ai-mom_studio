/** Read-only public-list check: no DB, secrets, AI, messages or publishing. */
import { load } from "cheerio";
import { OFFICIAL_CATALOG } from "../server/services/officialCatalog";
import { fetchBoardList } from "../server/services/boardAdapter";
import { safeFetch } from "../server/services/safeFetch";
import { decodePublicText } from "../server/services/publicTextResponse";

let succeeded = 0;
for (const source of OFFICIAL_CATALOG) {
  const result = await fetchBoardList(source.boardUrl, source.domain, source.config);
  if (result.ok) succeeded++;
  console.log(JSON.stringify({ name: source.name, url: source.boardUrl, ...result }, null, 2));
  if (process.argv.includes("--inspect")) {
    try {
      const res = await safeFetch(source.boardUrl, { timeoutMs: 10000, maxBytes: 2 * 1024 * 1024 });
      const $ = load(decodePublicText(res.body, res.contentType));
      console.log(JSON.stringify({ name: source.name, forms: $("form").map((_, el) => ({ action: $(el).attr("action"), fields: $(el).find("input,select").map((_, f) => ({ name: $(f).attr("name"), value: $(f).attr("value"), options: $(f).find("option").map((_, o) => $(o).attr("value")).get() })).get() })).get(), links: $("a[href]").toArray().filter(el => /mng_no=|wr_id=|articleNo=|bbsSn=|page|Page|fn_down/.test($(el).attr("href") ?? "")).slice(0, 20).map(el => $(el).prop("outerHTML")?.slice(0, 1200)), scripts: source.config.format === "ged_selection" ? $("script").text().slice(-18000) : undefined }));
    } catch (error) { console.log(`Inspect unavailable: ${(error as Error).message}`); }
  }
}
console.log(`Public source check: ${succeeded}/${OFFICIAL_CATALOG.length} returned entries.`);
if (succeeded !== OFFICIAL_CATALOG.length) process.exitCode = 1;
