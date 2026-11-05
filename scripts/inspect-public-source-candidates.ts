/** Read-only maintenance probe for public education/contest listings. */
import { load } from "cheerio";
import { safeFetch } from "../server/services/safeFetch";
import { decodePublicText } from "../server/services/publicTextResponse";
const sources = [
  ["서울", "https://www.sen.go.kr/sen/index.do"], ["부산", "https://www.pen.go.kr/main/main.do"],
  ["대구", "https://www.dge.go.kr/main/index.do"], ["인천", "https://www.ice.go.kr/ice/"],
  ["광주(기존)", "https://gen.go.kr/xboard/board.php?tbnum=20"], ["전남광주(교육부 안내)", "https://www.jge.go.kr/"],
  ["대전", "https://www.dje.go.kr/main.do"], ["울산", "https://www.use.go.kr/"],
  ["세종", "https://www.sje.go.kr/sje/main.do"], ["경기", "https://www.goe.go.kr/"],
  ["강원", "https://www.gwe.go.kr/main/index.do"], ["충북", "https://www.cbe.go.kr/cbe/"],
  ["충남", "https://www.cne.go.kr/"], ["전북", "https://www.jbe.go.kr/"],
  ["전남(기존)", "https://www.jne.go.kr/"], ["경북", "https://www.gbe.kr/"],
  ["경남", "https://www.gne.go.kr/"], ["제주", "https://www.jje.go.kr/"],
  ["링커리어", "https://linkareer.com/search?direction=DESC&page=1&q=%EC%B2%AD%EC%86%8C%EB%85%84&sort=RELEVANCE&tab=open-activity"],
  ["위비티 청소년", "https://www.wevity.com/index.php?c=find&cidx=30&gp=1&gub=2&mode=future&s=1"],
  ["콘테스트코리아", "https://www.contestkorea.com/"],
  ["문체부 첨부", "https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=22829"],
];
async function inspect(name: string, url: string) {
  try {
    const r = await safeFetch(url, { timeoutMs: 12000, maxBytes: 3 * 1024 * 1024 });
    const $ = load(decodePublicText(r.body, r.contentType));
    const all = $("a[href],a[onclick]").toArray().map(el => ({ text: $(el).text().replace(/\s+/g," ").trim().slice(0, 120), href: $(el).attr("href"), onclick: $(el).attr("onclick"), title: $(el).attr("title") }));
    console.log(JSON.stringify({ name, url: r.finalUrl, title: $("title").text(), navigation: all.filter(a => /공지사항|학생행사|공모전|영재교육|청소년/.test(a.text) && a.text.length < 80).slice(0, 22), detailLinks: all.filter(a => /nttSn=|bbsDocNo=|dataSid=|BoardRead|\/activity\/\d|ix=|str_no=|nttId=|seq=|idx=/.test(a.href || "")).slice(0, 8), attachmentLinks: name.includes("문체부") ? all.filter(a => /\.pdf|다운로드|downFile/i.test(a.text + a.href + a.onclick)) : undefined,
      inlineData: name === "링커리어" ? $("script:not([src])").toArray().map(el => ({ id: $(el).attr("id"), type: $(el).attr("type"), bytes: $(el).text().length, sample: $(el).text().slice(0, 500) })).filter(s => s.bytes > 1000).slice(0, 5) : undefined,
      scripts: name.includes("문체부") ? $("script:not([src])").text().match(/function\s+[\w$]*(?:down|Down|File)[\w$]*[^]*?\n\}/g)?.map(s => s.slice(0, 1600)).slice(0, 6) : undefined
    }));
  } catch (e) { console.log(JSON.stringify({ name, url, error: (e as Error).message })); }
}
for (let i=0; i<sources.length; i+=3) await Promise.allSettled(sources.slice(i,i+3).map(([name,url])=>inspect(name,url)));
