/** Read-only maintenance probe for public education/contest listings. */
import { load } from "cheerio";
import { safeFetch } from "../server/services/safeFetch";
import { decodePublicText } from "../server/services/publicTextResponse";
const sources = [
  ["서울 공지", "https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1100"],
  ["부산 공지", "https://www.pen.go.kr/main/na/ntt/selectNttList.do?mi=31659&bbsId=2282"],
  ["부산 영재", "https://www.pen.go.kr/dep08/na/ntt/selectNttList.do?mi=31184&bbsId=2555"],
  ["인천 공지", "https://www.ice.go.kr/ice/na/ntt/selectNttList.do?mi=10840&bbsId=1482"],
  ["대전 공지", "https://www.dje.go.kr/boardCnts/list.do?boardID=450&m=030101&s=dje"],
  ["경기 공지", "https://goe.go.kr/goe/na/ntt/selectNttList.do?bbsId=2012&mi=10100"],
  ["강원 공지", "https://www.gwe.go.kr/main/bbs/list.do?key=bTIzMDcyMTA1MzUxNTI="],
  ["충북 공지", "https://www.cbe.go.kr/cbe/na/ntt/selectNttList.do?mi=11576&bbsId=1762"],
  ["전북 공지", "https://www.jbe.go.kr/index.jbe?menuCd=DOM_000000103001000000"],
  ["경남 고입", "https://highschool.gne.go.kr/s10/hsa/archive/notice.do"],
  ["대구", "https://www.dge.go.kr/main/main.do"], ["충남", "https://www.cne.go.kr/cne/main.do"],
  ["링커리어", "https://linkareer.com/search?direction=DESC&page=1&q=%EC%B2%AD%EC%86%8C%EB%85%84&sort=RELEVANCE&tab=open-activity"],
  ["위비티 청소년", "https://www.wevity.com/index.php?c=find&s=1&gub=2&cidx=30"],
  ["콘테스트코리아 청소년", "https://www.contestkorea.com/sub/list.php?int_gbn=1&Txt_code1[0]=28&Txt_code1[1]=29"],
  ["문체부 다운로드 함수", "https://www.mcst.go.kr/site/common/js/common_function.js?ver=20260625194422"],
  ["문체부 첨부", "https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pMenuCD=0302000000&pSeq=22829"],
];
async function inspect(name: string, url: string) {
  try {
    const r = await safeFetch(url, { timeoutMs: 12000, maxBytes: 3 * 1024 * 1024 });
    const raw = decodePublicText(r.body, r.contentType);
    if (name === "문체부 다운로드 함수") { console.log(JSON.stringify({name, functions: raw.match(/function (?:file_download|view_file)[^]*?(?=function |$)/g)?.map(v=>v.slice(0,3500))})); return; }
    const $ = load(raw);
    const inline = $("script:not([src])").text();
    const next = $("#__NEXT_DATA__").text();
    const all = $("a[href],a[onclick]").toArray().map(el => ({ text: $(el).text().replace(/\s+/g," ").trim().slice(0, 120), href: $(el).attr("href"), onclick: $(el).attr("onclick"), title: $(el).attr("title") }));
    console.log(JSON.stringify({ name, url: r.finalUrl, title: $("title").text(), navigation: all.filter(a => /공지사항|학생행사|공모전|영재교육|청소년/.test(a.text) && a.text.length < 80).slice(0, 22), detailLinks: all.filter(a => /nttSn=|bbsDocNo=|dataSid=|BoardRead|\/activity\/\d|ix=|str_no=|nttId=|seq=|idx=|view.do|selectBbs|boardSeq/.test((a.href || "") + (a.onclick || ""))).slice(0, 6),
      markup: $("table tbody tr, .list li").toArray().filter(el=>/202[67]|신청|모집/.test($(el).text())).slice(0,3).map(el => $(el).prop("outerHTML")?.replace(/\s+/g," ").slice(0,3000)),
      contestRows: /위비티|콘테스트/.test(name) ? $("a[href*='ix='],a[href*='str_no=']").toArray().filter(el=>$(el).text().trim().length>10).slice(0,40).map(el=>({anchor:$(el).prop("outerHTML")?.replace(/\s+/g," ").slice(0,800), parents:$(el).parents().toArray().slice(0,5).map(x=>({tag:x.tagName,class:$(x).attr("class"),id:$(x).attr("id")}))})) : undefined,
      linkMarkup: $("a[href],a[onclick]").toArray().filter(el=>/202[67]|모집|공모|선발/.test($(el).text())).slice(-15).map(el=>$(el).parent().prop("outerHTML")?.replace(/\s+/g," ").slice(0,1800)),
      listFunctions: inline.match(/(?:function\s+(?:goView|fn_view|view|selectNttInfo)[^]*?\n\})|(?:nttInfoBtn[^]*?\n\s*\}\);)/g)?.map(v=>v.slice(0,1600)),
      scriptsSrc: name.includes("문체부") ? $("script[src]").toArray().map(el=>$(el).attr("src")) : undefined,
      redirect: /대구|충남/.test(name) ? { meta: $("meta[http-equiv],iframe").toArray().map(el=>$(el).prop("outerHTML")), script: inline.slice(0,1500) } : undefined,
      activities: next ? Object.values(JSON.parse(next).props.pageProps.props.__APOLLO_STATE__).filter((x: any)=>x.__typename === "Activity").slice(0,3) : undefined, attachmentLinks: name.includes("문체부") ? all.filter(a => /\.pdf|다운로드|downFile/i.test(a.text + a.href + a.onclick)) : undefined,
      inlineData: false && name === "링커리어" ? $("script:not([src])").toArray().map(el => ({ id: $(el).attr("id"), type: $(el).attr("type"), bytes: $(el).text().length, sample: $(el).text().slice(0, 500) })).filter(s => s.bytes > 1000).slice(0, 5) : undefined,
      scripts: name.includes("문체부") ? $("script:not([src])").text().match(/function\s+[\w$]*(?:down|Down|File)[\w$]*[^]*?\n\}/g)?.map(s => s.slice(0, 1600)).slice(0, 6) : undefined
    }));
  } catch (e) { console.log(JSON.stringify({ name, url, error: (e as Error).message })); }
}
for (let i=0; i<sources.length; i+=3) await Promise.allSettled(sources.slice(i,i+3).map(([name,url])=>inspect(name,url)));
