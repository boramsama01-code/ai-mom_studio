import { readFileSync, writeFileSync } from 'node:fs';
function patch(path, before, after) {
  const text=readFileSync(path,'utf8');
  if(text.includes(after)) return;
  if(text.split(before).length!==2) throw new Error('Patch anchor mismatch: '+path+' '+before.slice(0,70));
  writeFileSync(path,text.replace(before,after));
}
patch('server/services/safeFetch.ts', '  googleNewsForm?: string;', '  googleNewsForm?: string;\n  /** Optional exact host boundary, rechecked before every redirected request. */\n  allowedHosts?: string[];');
patch('server/services/safeFetch.ts', '    try { await assertPublicHttpUrl(current); }', '    if (opts.allowedHosts && !opts.allowedHosts.includes(new URL(current).hostname.toLowerCase()))\n      throw new FetchFailure("허용한 언론사 외부로 이동하여 요청을 중단했습니다.", "blocked");\n    try { await assertPublicHttpUrl(current); }');
patch('server/routes/items.ts', 'import { fetchAndExtract } from "../services/extract";', 'import { fetchPublisherArticle as fetchAndExtract } from "../services/publisherLookup";');
patch('server/worker/collect.ts', 'import { fetchAndExtract, extractPdf } from "../services/extract";', 'import { extractPdf } from "../services/extract";\nimport { fetchPublisherArticle as fetchAndExtract } from "../services/publisherLookup";');
patch('server/services/newsSearch.ts', 'export const PUBLIC_NEWS_FEEDS = [', 'export const PUBLIC_NEWS_FEEDS = [\n  { name: "포천좋은신문", url: "https://www.pcgoodnews.co.kr/data/rss/news.xml", site: "https://www.pcgoodnews.co.kr" },');
patch('server/services/newsSearch.ts', 'rank(a) - rank(b) || (b.published.iso || "").localeCompare(a.published.iso || "")', 'rank(a) - rank(b) || Number(a.provider === "google_news_rss") - Number(b.provider === "google_news_rss") || (b.published.iso || "").localeCompare(a.published.iso || "")');
patch('server/worker/discovery.ts', 'import { normalizeUrl } from "../services/url";', 'import { normalizeUrl } from "../services/url";\nimport { samePublisherUrl } from "../services/publisherLookup";');
patch('server/worker/discovery.ts', 'const [existing] = await db.select({ id: sourceDocuments.id }).from(sourceDocuments).where(and(', 'const [existing] = await db.select().from(sourceDocuments).where(and(');
patch('server/worker/discovery.ts', '    if (existing) return existing;', [
'    if (existing) {',
'      // Upgrade a known duplicate address; never replace its identity or fetched body.',
'      const direct = it.provider === "rss_direct" && it.publisherUrl ? samePublisherUrl(identityUrl, it.publisherUrl) : null;',
'      if (direct && existing.kind === "google_news_rss" && !existing.fetchedText &&',
'          typeof existing.meta.publisherUrl === "string" && samePublisherUrl(direct, existing.meta.publisherUrl)) {',
'        await db.update(sourceDocuments).set({ meta: sql`${sourceDocuments.meta} || ${JSON.stringify({ fetchUrl: direct, directSource: "publisher_rss_exact" })}::jsonb`, updatedAt: new Date() })',
'          .where(and(eq(sourceDocuments.id, existing.id), sql`${sourceDocuments.fetchedText} IS NULL`));',
'      }',
'      return { id: existing.id };',
'    }',
].join('\n'));
patch('server/app.ts', 'sourceResolver: "google-news-redirect-v2"', 'sourceResolver: "publisher-direct-v3"');
patch('tests/collection.test.ts', 'const { runCollect } = await import("../server/worker/collect");', 'const { runCollect } = await import("../server/worker/collect");\nconst { PUBLIC_NEWS_FEEDS } = await import("../server/services/newsSearch");');
patch('tests/collection.test.ts', 'rssFeedOk: 6, googleQueries: 1', 'rssFeedOk: PUBLIC_NEWS_FEEDS.length, googleQueries: 1');
console.log('Publisher-first policy applied; Google RSS discovery retained, Google article/RPC decoding not used by application collection or refetch.');
