import { describe, expect, it, vi } from "vitest";
import { fetchPublisherArticle, exactPublisherLinks, publisherFeedLinks, publisherSearchLink, samePublisherUrl, headlineKey } from "../server/services/publisherLookup";
import { FetchFailure, type SafeFetchOptions } from "../server/services/safeFetch";
import { createNewsSearch } from "../server/services/newsSearch";
import { readFileSync } from "node:fs";
const home="https://publisher.example/", article=home+"news/1", wrapper="https://news.google.com/rss/articles/CBMiOpaqueModernArticle";
const title="청소년 역사기행 참가자 모집", body="청소년의 탐구와 체험 프로그램 참가자를 모집합니다. 모집 조건과 일정은 주최 기관의 원문을 확인해야 합니다. ".repeat(5).trim();
const html=`<meta property="og:title" content="${title}"><article><p>${body}</p></article>`;
const res=(url:string,text:string)=>({finalUrl:url,status:200,contentType:"text/html",body:Buffer.from(text)});
const context={title,publisherUrl:home};
const link=`<a href="/news/1">${title}</a>`;
const form='<form method="get" action="/search"><input name="q" type="search"></form>';
const rss=`<rss><channel><item><title>${title}</title><link>${article}</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
function transport(pages:Record<string,string>){return vi.fn(async(url:string,_opts?:SafeFetchOptions)=>{if(!(url in pages))throw new Error('Unexpected request '+url);return res(url,pages[url]);});}

describe("publisher-first article navigation",()=>{
 it("resolves a Google discovery record by its exact publisher homepage link without contacting Google",async()=>{
   const fetcher=transport({[home]:link,[article]:html});
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:true,text:body,finalUrl:article});
   expect(fetcher.mock.calls.map(c=>c[0])).toEqual([home,article]);
   expect(fetcher.mock.calls.every(c=>!c[0].includes('google.')&&!c[1]?.googleNewsForm)).toBe(true);
 });
 it("uses only the advertised GET search form",async()=>{
   const search=new URL('/search',home);search.searchParams.set('q',title);
   const fetcher=transport({[home]:form,[search.href]:link,[article]:html});
   expect((await fetchPublisherArticle(wrapper,fetcher,context)).ok).toBe(true);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it.each([404,410,200])("continues to advertised public search when the RSS is missing or not XML (HTTP %i)",async status=>{
   const search=new URL('/search',home);search.searchParams.set('q',title);
   const fetcher=transport({[home]:form+'<link rel="alternate" type="application/rss+xml" href="/rss.xml">',[search.href]:link,[article]:html});
   const normal=fetcher.getMockImplementation()!;
   fetcher.mockImplementation(async(url,opts)=>{
     if(url===home+'rss.xml') { if(status!==200) throw new FetchFailure(`HTTP ${status}`,'http',status); return res(url,'<html>RSS 서비스를 종료했습니다.</html>'); }
     return normal(url,opts);
   });
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:true,text:body});
   expect(fetcher.mock.calls.map(c=>c[0])).toEqual([home,home+'rss.xml',search.href,article]);
 });
 it.each([403,429])("stops if the feed itself denies access (HTTP %i)",async status=>{
   const fetcher=transport({[home]:form+'<link rel="alternate" type="application/rss+xml" href="/rss.xml">'}),normal=fetcher.getMockImplementation()!;
   fetcher.mockImplementation(async(url,opts)=>{if(url===home+'rss.xml')throw new FetchFailure(`HTTP ${status}`,'http',status);return normal(url,opts);});
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:false,status:'blocked'});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it("uses an advertised publisher RSS as an index, never as the article body",async()=>{
   const fetcher=transport({[home]:'<link rel="alternate" type="application/rss+xml" href="/rss.xml">',[home+'rss.xml']:rss,[article]:html});
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:true,text:body});
   expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it("requires the fetched page headline to match, not just a search result",async()=>{
   const fetcher=transport({[home]:link,[article]:html.replace(title,'다른 기사')});
   const result=await fetchPublisherArticle(wrapper,fetcher,context);expect(result.ok).toBe(false);
   if(!result.ok)expect(result.error).toContain('제목');
 });
 it("does not substitute a similar title, card-news rewrite, or a summary",async()=>{
   const fetcher=transport({[home]:`<a href="/other">[카드뉴스] ${title}</a>`});
   const result=await fetchPublisherArticle(wrapper,fetcher,context);expect(result.ok).toBe(false);expect(fetcher).toHaveBeenCalledOnce();
 });
 it("does not guess among multiple exact matches",async()=>{
   const fetcher=transport({[home]:link+link.replace('/news/1','/news/2')});
   expect((await fetchPublisherArticle(wrapper,fetcher,context)).ok).toBe(false);expect(fetcher).toHaveBeenCalledOnce();
 });
 it("honors the extra-request budget before requesting the article",async()=>{
   const fetcher=transport({[home]:link,[article]:html}),budget=vi.fn(()=>false);
   expect((await fetchPublisherArticle(wrapper,fetcher,{...context,takeExtraCall:budget})).ok).toBe(false);
   expect(fetcher).toHaveBeenCalledOnce();expect(budget).toHaveBeenCalledOnce();
 });
 it.each([401,402,403,429])("stops on publisher HTTP %i without Google, proxy or retry",async status=>{
   const fetcher=vi.fn(async()=>{throw new FetchFailure(`HTTP ${status}`,'http',status);});
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:false,status:'blocked'});expect(fetcher).toHaveBeenCalledOnce();
 });
 it("stops on a publisher challenge page",async()=>{
   const fetcher=transport({[home]:'<title>Just a moment</title><form id="challenge-form"></form>'});
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:false,status:'blocked'});expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(['http://127.0.0.1/','http://169.254.169.254/','https://accounts.google.com/','javascript:alert(1)'])('rejects unsafe publisher %s before fetching',async publisherUrl=>{
   const fetcher=vi.fn();expect((await fetchPublisherArticle(wrapper,fetcher,{title,publisherUrl})).ok).toBe(false);expect(fetcher).not.toHaveBeenCalled();
 });
 it("missing metadata leaves an explicit unresolved record without a Google request",async()=>{
   const fetcher=vi.fn();expect((await fetchPublisherArticle(wrapper,fetcher)).ok).toBe(false);expect(fetcher).not.toHaveBeenCalled();
 });
 it("does not treat an outside redirect as a publisher result",async()=>{
   const fetcher=vi.fn(async()=>res('https://www.google.com/sorry/','challenge'));
   expect(await fetchPublisherArticle(wrapper,fetcher,context)).toMatchObject({ok:false,status:'blocked'});expect(fetcher).toHaveBeenCalledOnce();
 });
 it("retains ordinary direct-URL extraction",async()=>{
   const fetcher=transport({[article]:html});expect(await fetchPublisherArticle(article,fetcher)).toMatchObject({ok:true,text:body});
 });
 it("only normalizes quotes/spacing, preserving meaningful signs and digits",()=>{
   expect(headlineKey('‘탐구’ 참가자')).toBe(headlineKey('탐구 참가자'));
   expect(headlineKey('1+2')).not.toBe(headlineKey('12'));expect(headlineKey('2026')).not.toBe(headlineKey('2027'));
 });
 it("rejects cross-publisher links and unsafe forms",()=>{
   expect(samePublisherUrl('https://publisher.example.evil.com/a',home)).toBeNull();
   expect(exactPublisherLinks(`<a href="https://other.example/a">${title}</a>`,home,title)).toEqual([]);
   expect(publisherSearchLink(form.replace('method="get"','method="post"'),home,title)).toBeNull();
   expect(publisherSearchLink(form.replace('/search','https://www.google.com/search'),home,title)).toBeNull();
   expect(publisherSearchLink(form.replace('type="search"','type="password"'),home,title)).toBeNull();
   expect(publisherFeedLinks('<link rel="alternate" type="application/rss+xml" href="http://127.0.0.1/rss">',home)).toEqual([]);
 });
 it("production collection and manual refetch both import the publisher-first function",()=>{
   for(const file of ['server/worker/collect.ts','server/routes/items.ts']) expect(readFileSync(file,'utf8')).toContain('fetchPublisherArticle as fetchAndExtract');
 });
 it("prefers an independent direct article over a newer Google wrapper within the same relevance tier",async()=>{
   const now=new Date('2026-10-31T12:00:00Z');
   const xml=(name:string,url:string,date:string)=>`<rss><channel><item><title>${name}</title><link>${url}</link><pubDate>${date}</pubDate></item></channel></rss>`;
   const search=createNewsSearch({now,feeds:[{name:'신문',site:home,url:home+'rss'}],loadXml:async url=>url.includes('news.google.com')?xml('과학 최신 소식',wrapper,'2026-10-31T11:00:00Z'):xml('과학 탐구 모집',article,'2026-10-30T10:00:00Z')});
   const items=await search.search('과학','news',1,{naver:0,limit:3});expect(items[0].provider).toBe('rss_direct');
 });
});
