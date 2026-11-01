/** Public HTTP regression check. No database, AI calls, credentials or publishing. */
import { fetchPublisherArticle } from "../server/services/publisherLookup";
const cases = [
  { name: "전자신문 공개 원문", url: "https://m.etnews.com/20261027000007" },
  { name: "동아일보 공개 원문", url: "https://www.donga.com/news/Economy/article/all/20261101/134946000/2" },
  { name: "이전 Google 중간 링크 · 싱글리스트", url: "https://news.google.com/rss/articles/CBMiZkFVX3lxTFBndzU2cUpma2pxRmFwM0lpdzZ4ZVYyaGxsemJEZFVmN3REOU9jQVIzd1VnUE4xdzAzZ0tLd21VaDIyQS1VM3hhaXUyNG53ODViZ2FVV24yNHVUZjNQcUs1WGYyeXFuUQ?oc=5", title: "맘스터치, '스낵박스' 3종 출시…스낵·디저트 라인업 확대", publisherUrl: "https://www.slist.kr/" },
];
for (const source of cases) {
  const r = await fetchPublisherArticle(source.url, undefined, source);
  console.log(JSON.stringify({ name: source.name, ...(r.ok ? { ok: true, finalUrl: r.finalUrl, characters: r.text.length } : { ok: false, status: r.status, reason: r.error }) }));
}
