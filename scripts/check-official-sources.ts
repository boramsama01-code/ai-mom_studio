/** Read-only public-list check: no DB, secrets, AI, messages or publishing. */
import { load } from "cheerio";
import { OFFICIAL_CATALOG } from "../server/services/officialCatalog";
import { fetchBoardList } from "../server/services/boardAdapter";
import { fetchPublisherArticle } from "../server/services/publisherLookup";
import { safeFetch } from "../server/services/safeFetch";
import { decodePublicText } from "../server/services/publicTextResponse";
import { classifyNotice } from "../shared/noticeIntent";

let succeeded = 0;
const sources = OFFICIAL_CATALOG.filter(s => s.enabled !== false);
for (const source of sources) {
  const result = await fetchBoardList(source.boardUrl, source.domain, source.config, undefined, { takeExtraCall: () => true });
  if (result.ok) succeeded++;
  console.log(JSON.stringify({ name: source.name, url: source.boardUrl, ...result, ...(result.ok ? { total: result.entries.length, entries: result.entries.slice(0, 2) } : {}) }, null, 2));
  if (result.ok) {
    const sample = result.entries.find(e => !source.config.recruitmentOnly || classifyNotice(e.title) === "candidate") ?? result.entries[0];
    const inspectFetch: typeof safeFetch = async (url, opts) => {
      const res = await safeFetch(url, opts);
      if (process.argv.includes("--inspect")) {
        const $ = load(decodePublicText(res.body, res.contentType));
        console.log(JSON.stringify({ name: source.name, articleMarkup: { expected: sample.title, url: res.finalUrl,
          heads: $("h1,h2,h3,h4,meta[property='og:title'],meta[name='twitter:title']").toArray().map(el => $(el).prop("outerHTML")?.slice(0, 600)).slice(0, 35),
          candidates: $("[id],[class]").toArray().filter(el => /title|subject|board_view|view_cont|viewCont|bbs_view|post-content|news_view|ntt|bbsContent/i.test(($(el).attr("class") ?? "") + " " + ($(el).attr("id") ?? ""))).slice(-40).map(el => $(el).prop("outerHTML")?.slice(0, 800)),
          bodyCandidates: $("main,article,[class*='cont'],[class*='body'],[class*='view']").toArray().filter(el => $(el).text().length > 100 && $(el).text().length < 20000).slice(-20).map(el => ({ tag: el.tagName, id: $(el).attr("id"), class: $(el).attr("class"), length: $(el).text().trim().length, preview: $(el).text().trim().slice(0, 150) }))
        }}));
      }
      return res;
    };
    const article = await fetchPublisherArticle(sample.url, inspectFetch, { title: sample.title, takeExtraCall: () => false });
    console.log(JSON.stringify({ name: source.name, article: article.ok ? { ok: true, finalUrl: article.finalUrl, textLength: article.text.length, preview: article.text.slice(0, 300), end: article.text.slice(-200), attachments: article.attachments.map(a => ({ kind: a.kind, status: a.status })) } : article }));
  }
  if (process.argv.includes("--inspect")) {
    try {
      const res = await safeFetch(source.boardUrl, { timeoutMs: 10000, maxBytes: 2 * 1024 * 1024 });
      const $ = load(decodePublicText(res.body, res.contentType));
      console.log(JSON.stringify({ name: source.name, forms: $("form").map((_, el) => ({ action: $(el).attr("action"), fields: $(el).find("input,select").map((_, f) => ({ name: $(f).attr("name"), value: $(f).attr("value"), options: $(f).find("option").map((_, o) => $(o).attr("value")).get() })).get() })).get(), links: $("a[href]").toArray().filter(el => /mng_no=|wr_id=|articleNo=|bbsSn=|page|Page|fn_down/.test($(el).attr("href") ?? "")).slice(0, 20).map(el => $(el).prop("outerHTML")?.slice(0, 1200)), rssItem: source.config.format === "rss" ? $("item,entry").first().prop("outerHTML")?.slice(0, 2500) : undefined, scripts: source.config.format === "ged_selection" ? $("script").text().slice(-18000) : undefined }));
    } catch (error) { console.log(`Inspect unavailable: ${(error as Error).message}`); }
  }
}
console.log(`Public source check: ${succeeded}/${sources.length} active sources returned entries; ${OFFICIAL_CATALOG.length - sources.length} disabled.`);
if (succeeded !== sources.length) process.exitCode = 1;
