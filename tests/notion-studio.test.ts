import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import {eq} from 'drizzle-orm';
import {setTestEnv,resetDb,login} from './helpers';
import type {NotionDocument} from '../shared/notionSync';
const api=vi.hoisted(()=>({fetch:vi.fn(),update:vi.fn(),patch:vi.fn(),photo:vi.fn(),configured:vi.fn(()=>true),query:vi.fn()}));
vi.mock('../server/services/notionClient',async original=>({...await original<object>(),fetchNotionDocument:api.fetch,updateNotionDocument:api.update,patchNotionDocumentProperties:api.patch,downloadNotionPhoto:api.photo,notionConfigured:api.configured,queryNotionDocuments:api.query}));
setTestEnv();
const pageId='4135c7c8-45fc-8101-ba1c-000000000001';
function document():NotionDocument{return {pageId,url:`https://www.notion.so/${pageId.replaceAll('-','')}`,lastEditedAt:'2026-11-09T02:00:00Z',contentKey:'test',title:'격리된 테스트 원고',coverTitle:'표지 제목',channel:'HighScoop',category:'꿀팁',template:'highscoop-a',stage:'원고 검토',verified:true,caption:'',sourceHash:'a'.repeat(64),pages:[{index:1,title:'원본 첫 장 제목',body:'표지 부제',headingBlockId:'h1',bodyBlockIds:['b1']},{index:2,title:'둘째 장',body:'본문 원본',headingBlockId:'h2',bodyBlockIds:['b2']}],photos:[{key:'photo-1',name:'휴대폰 사진.png',url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/photo.png?secret=signed'}]};}
let db:ReturnType<typeof import('../server/db').getDb>,app:ReturnType<typeof import('../server/app').createApp>,ch:number,doc:NotionDocument;
let schemas:typeof import('../shared/schema');
beforeAll(async()=>{
 // resetDb is destructive. This suite is restricted to the task's loopback test database.
 const u=new URL(process.env.APP_DATABASE_URL!);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/spacepenguin_test')throw new Error('Isolated loopback test DB required');
 db=(await import('../server/db')).getDb();schemas=await import('../shared/schema');
});
beforeEach(async()=>{
 await resetDb();app=(await import('../server/app')).createApp();vi.clearAllMocks();doc=document();api.configured.mockReturnValue(true);api.fetch.mockImplementation(async()=>structuredClone(doc));api.patch.mockResolvedValue(undefined);
 api.photo.mockResolvedValue({buffer:await sharp({create:{width:20,height:30,channels:3,background:'#88bbcc'}}).png().toBuffer(),mimeType:'image/png'});
 api.update.mockImplementation(async input=>{doc={...doc,coverTitle:input.coverTitle,pages:doc.pages.map((p,i)=>({...p,...input.pages[i]})),sourceHash:'c'.repeat(64)};return structuredClone(doc);});
 ch=(await db.select().from(schemas.channels)).find(c=>c.slug==='opportunities'||c.slug==='highscoop')!.id;
});
afterAll(async()=>{await (await import('../server/db')).closeDb();});
async function imported(){return (await import('../server/services/notionStudio')).importNotionStudio(db,{pageId,channelId:ch,expectedSourceHash:doc.sourceHash,coverStyle:'A'},'test');}
async function edit(itemId:number,text:string){const [item]=await db.select().from(schemas.contentItems).where(eq(schemas.contentItems.id,itemId));const [rev]=await db.select().from(schemas.contentRevisions).where(eq(schemas.contentRevisions.id,item.currentRevisionId!));const payload=structuredClone(rev.payload) as any;payload.cardCopy.pages[0].body=text;await (await import('../server/content')).createRevision(db,{contentItemId:itemId,author:'operator',payload});await db.update(schemas.contentItems).set({version:item.version+1}).where(eq(schemas.contentItems.id,itemId));}
describe('Notion ↔ Studio durable integration',()=>{
 it('deduplicates import, preserves originals privately and never grants publication approval',async()=>{
  const a=await imported(),b=await imported();expect(a.link.id).toBe(b.link.id);expect(await db.select().from(schemas.notionSyncLinks)).toHaveLength(1);
  expect(a.link.studioCardId).toBeTypeOf('number');expect(a.photos[0].url).toMatch(/^\/api\/notion\/links/);
  const [link]=await db.select().from(schemas.notionSyncLinks);expect(JSON.stringify(link.sourceSnapshot)).not.toContain('secret=signed');
  const [item]=await db.select().from(schemas.contentItems).where(eq(schemas.contentItems.id,a.link.itemId));expect(item.publishStatus).toBe('waiting');expect(item.evidenceStatus).toBe('needs_review');
  expect(await db.select().from(schemas.approvals)).toHaveLength(0);
  expect((await request(app).get(a.photos[0].url)).status).toBe(401);
  const {agent}=await login(app);expect((await agent.get(a.photos[0].url)).status).toBe(200);expect((await agent.get(`/api/notion/links/${a.link.id+1}/photos/${a.photos[0].id}`)).status).toBe(404);
 });
 it('requires current preview/version and existing CSRF for mutation',async()=>{
  const {agent,csrf}=await login(app);expect((await agent.post('/api/notion/import').send({})).status).toBe(403);
  const r=await agent.post('/api/notion/import').set('x-csrf-token',csrf).send({pageId,channelId:ch,expectedSourceHash:'b'.repeat(64),coverStyle:'A'});expect(r.status).toBe(409);expect(await db.select().from(schemas.notionSyncLinks)).toHaveLength(0);
  const a=await imported();const patch=await agent.patch(`/api/notion/links/${a.link.id}`).set('x-csrf-token',csrf).send({version:a.link.version,autoSync:false});expect(patch.status).toBe(200);expect(patch.body.link.autoSync).toBe(false);
  expect((await agent.patch(`/api/notion/links/${a.link.id}`).set('x-csrf-token',csrf).send({version:a.link.version,coverStyle:'B'})).status).toBe(409);
 });
 it('creates an immutable new revision when only Notion changes',async()=>{
  const a=await imported();doc.sourceHash='b'.repeat(64);doc.pages[1].body='노션 수정 내용';
  const b=await (await import('../server/services/notionStudio')).pullNotionStudio(db,a.link.id,{version:a.link.version,itemVersion:a.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:false},'test');
  expect(b.copy.pages[0].body).toBe('노션 수정 내용');expect(await db.select().from(schemas.contentRevisions).where(eq(schemas.contentRevisions.contentItemId,a.link.itemId))).toHaveLength(2);expect(b.link.status).toBe('synced');
 });
 it('returns both drafts on conflict and never writes Notion automatically',async()=>{
  const a=await imported();await edit(a.link.itemId,'Studio에서 고침');doc.sourceHash='b'.repeat(64);doc.pages[1].body='Notion에서 고침';
  const latest=await (await import('../server/services/notionStudio')).notionStudioDetail(db,a.link.id,true);const {agent,csrf}=await login(app);
  const r=await agent.post(`/api/notion/links/${a.link.id}/pull`).set('x-csrf-token',csrf).send({version:latest.link.version,itemVersion:latest.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:false});
  expect(r.status).toBe(409);expect(r.body.detail.copy.pages[0].body).toBe('Studio에서 고침');expect(r.body.detail.notion.pages[1].body).toBe('Notion에서 고침');expect(api.update).not.toHaveBeenCalled();
 });
 it('automatically syncs one-sided changes, pauses conflicts and respects the opt-out',async()=>{
  const a=await imported();doc.sourceHash='b'.repeat(64);doc.pages[1].body='자동으로 가져온 원고';
  const {syncNotionOnce}=await import('../server/worker/notion');expect((await syncNotionOnce(db)).pulled).toBe(1);
  await db.update(schemas.notionSyncLinks).set({lastCheckedAt:null}).where(eq(schemas.notionSyncLinks.id,a.link.id));await edit(a.link.itemId,'자동으로 반영할 원고');
  expect((await syncNotionOnce(db)).pushed).toBe(1);expect(api.update.mock.calls[0][0].pages[0].title).toBe('원본 첫 장 제목');
  await db.update(schemas.notionSyncLinks).set({lastCheckedAt:null}).where(eq(schemas.notionSyncLinks.id,a.link.id));await edit(a.link.itemId,'양쪽 수정 Studio');doc.sourceHash='d'.repeat(64);doc.pages[1].body='양쪽 수정 Notion';
  expect((await syncNotionOnce(db)).conflicts).toBe(1);expect(api.update).toHaveBeenCalledTimes(1);
  await db.update(schemas.notionSyncLinks).set({lastCheckedAt:null,autoSync:false}).where(eq(schemas.notionSyncLinks.id,a.link.id));expect((await syncNotionOnce(db)).checked).toBe(0);
 });
 it('preserves a draft when Notion link writeback fails and opens the same draft on retry',async()=>{
  api.patch.mockRejectedValue(new Error('write permission denied'));const a=await imported(),b=await imported();expect(b.link.id).toBe(a.link.id);expect(b.warnings.join(' ')).toContain('링크');expect(await db.select().from(schemas.notionSyncLinks)).toHaveLength(1);
 });
 it('stores one immutable photo when the files property and body reference identical bytes',async()=>{
  doc.photos.push({...doc.photos[0],key:'body-photo',name:'같은 사진.png'});const a=await imported();expect(a.photos).toHaveLength(1);expect(await db.select().from(schemas.notionSyncPhotos)).toHaveLength(1);
 });
 it('detects a revision race even if another writer did not bump item.version',async()=>{
  const a=await imported();doc.sourceHash='b'.repeat(64);doc.pages[1].body='새 노션 본문';
  api.fetch.mockImplementationOnce(async()=>{
   const [item]=await db.select().from(schemas.contentItems).where(eq(schemas.contentItems.id,a.link.itemId));const [rev]=await db.select().from(schemas.contentRevisions).where(eq(schemas.contentRevisions.id,item.currentRevisionId!));const payload=structuredClone(rev.payload) as any;payload.cardCopy.pages[0].body='경합한 스튜디오 수정';await (await import('../server/content')).createRevision(db,{contentItemId:item.id,author:'operator',payload});return structuredClone(doc);
  });
  await expect((await import('../server/services/notionStudio')).pullNotionStudio(db,a.link.id,{version:a.link.version,itemVersion:a.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:false},'test')).rejects.toMatchObject({status:409});
  expect((await (await import('../server/services/notionStudio')).notionStudioDetail(db,a.link.id)).copy.pages[0].body).toBe('경합한 스튜디오 수정');
 });
});
