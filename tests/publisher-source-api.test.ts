import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setTestEnv, resetDb, login } from './helpers';
setTestEnv();
const http=vi.hoisted(()=>vi.fn());
vi.mock('../server/services/safeFetch',async original=>({...await original<object>(),safeFetch:http}));
const {createApp}=await import('../server/app');
const {getDb,closeDb}=await import('../server/db');
const {sourceDocuments,contentItems,contentRevisions}=await import('../shared/schema');
const {upsertNaverDoc}=await import('../server/worker/discovery');
const {parseNewsPubDate}=await import('../server/services/dates');
const {FetchFailure}=await import('../server/services/safeFetch');
const app=createApp(),title='청소년 탐구 프로그램 참가자 모집',home='https://press.example/',direct=home+'article/1';
const text='청소년 탐구 프로그램은 학생들의 과학적 호기심을 키우기 위해 마련했습니다. 신청 일정과 자격은 주최기관 공고에서 확인할 수 있습니다. '.repeat(3).trim();
let docId:number,itemId:number,original:string;
beforeAll(resetDb);afterAll(closeDb);
beforeEach(async()=>{
 http.mockReset();const db=getDb();original='https://news.google.com/rss/articles/CBMi'+crypto.randomUUID().replace(/-/g,'');
 const [doc]=await db.insert(sourceDocuments).values({normalizedUrl:original,originalUrl:original,title,kind:'google_news_rss',fetchStatus:'blocked',fetchError:'Google 자동 요청 확인 화면',publishedAt:new Date('2026-10-31T01:00:00Z'),meta:{publisher:'테스트신문',publisherUrl:home,fetchUrl:original}}).returning();docId=doc.id;
 const [item]=await db.insert(contentItems).values({channelId:1,kind:'notice',primarySourceId:docId,title:'운영자가 고친 제목',evidenceStatus:'fetch_failed',edited:{title:'보존할 원고'},reviewStatus:'pending'}).returning();itemId=item.id;
 http.mockImplementation(async(url:string)=>{if(url!==home&&url!==direct)throw new Error('Unexpected external URL '+url);return {finalUrl:url,status:200,contentType:'text/html',body:Buffer.from(url===home?`<a href="${direct}">${title}</a>`:`<h1>${title}</h1><article>${text}</article>`)};});
});
it('manual refetch recovers the original body through its publisher and leaves edited payload/revisions untouched',async()=>{
 await getDb().update(sourceDocuments).set({meta:{publisher:'테스트신문',publisherUrl:home,fetchUrl:original,lastFetchFailure:{status:'blocked',error:'이전 실패'}}}).where(eq(sourceDocuments.id,docId));
 const {agent,csrf}=await login(app);
 const r=await agent.post(`/api/channels/1/items/${itemId}/fetch`).set('x-csrf-token',csrf).send({});expect(r.status).toBe(200);
 const [doc]=await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id,docId));
 expect(doc).toMatchObject({originalUrl:original,fetchStatus:'ok',fetchError:null,fetchedText:text});expect(doc.meta.finalUrl).toBe(direct);
 expect(doc.meta.lastFetchFailure).toBeUndefined();
 const [item]=await getDb().select().from(contentItems).where(eq(contentItems.id,itemId));
 expect(item).toMatchObject({title:'운영자가 고친 제목',edited:{title:'보존할 원고'},evidenceStatus:'needs_review',reviewStatus:'pending'});
 expect(await getDb().select().from(contentRevisions).where(eq(contentRevisions.contentItemId,itemId))).toHaveLength(0);
 expect(http.mock.calls.map(c=>c[0])).toEqual([home,direct]);
});
it('a failed refresh preserves a previously acquired body and returns recovery without downgrading the draft',async()=>{
 const savedAt=new Date('2026-10-31T02:00:00Z');
 await getDb().update(sourceDocuments).set({fetchStatus:'ok',fetchError:null,fetchedText:text,contentHash:'previously-verified-content-hash',lastFetchedAt:savedAt,meta:{publisherUrl:home,fetchUrl:original,finalUrl:direct}}).where(eq(sourceDocuments.id,docId));
 await getDb().update(contentItems).set({evidenceStatus:'needs_review',reviewStatus:'reviewed'}).where(eq(contentItems.id,itemId));
 http.mockRejectedValue(new FetchFailure('HTTP 403','http',403));
 const {agent,csrf}=await login(app);
 const r=await agent.post(`/api/channels/1/items/${itemId}/fetch`).set('x-csrf-token',csrf).send({});
 expect(r.status).toBe(502);expect(r.body).toMatchObject({status:'blocked',preservedBody:true,sourceUrl:direct,recovery:{code:'restricted'}});
 const [doc]=await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id,docId));
 expect(doc).toMatchObject({fetchStatus:'ok',fetchError:null,fetchedText:text,contentHash:'previously-verified-content-hash',lastFetchedAt:savedAt});
 expect(doc.meta.lastFetchFailure).toMatchObject({status:'blocked'});
 const [item]=await getDb().select().from(contentItems).where(eq(contentItems.id,itemId));
 expect(item).toMatchObject({evidenceStatus:'needs_review',reviewStatus:'reviewed',edited:{title:'보존할 원고'}});
 expect(http).toHaveBeenCalledOnce();
});
it('returns source links and paste guidance when no body has ever been acquired',async()=>{
 http.mockRejectedValue(new FetchFailure('HTTP 403','http',403));
 const {agent,csrf}=await login(app);
 const r=await agent.post(`/api/channels/1/items/${itemId}/fetch`).set('x-csrf-token',csrf).send({});
 expect(r.status).toBe(502);expect(r.body).toMatchObject({status:'blocked',preservedBody:false,recovery:{code:'restricted'}});
 expect(r.body.recovery.nextStep).toContain('붙여넣');expect(r.body.recovery.links.length).toBeGreaterThan(0);
 const [doc]=await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id,docId));
 expect(doc).toMatchObject({fetchStatus:'blocked',fetchedText:null});
 expect(http).toHaveBeenCalledOnce();
});
it('a matching publisher RSS duplicate upgrades the address without clearing failure or replacing identity/body',async()=>{
 const db=getDb();
 // Isolate the duplicate key because this suite deliberately creates the same headline.
 const unique=title+' '+docId;await db.update(sourceDocuments).set({title:unique}).where(eq(sourceDocuments.id,docId));
 const item={endpoint:'news' as const,provider:'rss_direct' as const,publisher:'테스트신문',publisherUrl:home,title:unique,description:'',link:direct,originallink:direct,published:parseNewsPubDate('2026-10-31T01:00:00Z'),raw:{}};
 expect(await upsertNaverDoc(db,item)).toEqual({id:docId});
 const [doc]=await db.select().from(sourceDocuments).where(eq(sourceDocuments.id,docId));
 expect(doc.meta.fetchUrl).toBe(direct);expect(doc.originalUrl).toBe(original);expect(doc.fetchStatus).toBe('blocked');expect(doc.fetchedText).toBeNull();
});
it('a publisher-name match with a different publisher domain cannot upgrade the address',async()=>{
 const db=getDb(),unique=title+' '+docId;await db.update(sourceDocuments).set({title:unique}).where(eq(sourceDocuments.id,docId));
 await upsertNaverDoc(db,{endpoint:'news',provider:'rss_direct',publisher:'테스트신문',publisherUrl:'https://different.example/',title:unique,description:'',link:'https://different.example/a',published:parseNewsPubDate('2026-10-31T01:00:00Z'),raw:{}});
 const [doc]=await db.select().from(sourceDocuments).where(eq(sourceDocuments.id,docId));expect(doc.meta.fetchUrl).toBe(original);
});
