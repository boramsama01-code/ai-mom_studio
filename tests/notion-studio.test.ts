import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import pg from 'pg';
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
 it('saves visual editor copy with CAS while keeping protected fields, extras, notes and previous revisions',async()=>{
  doc.pages[1].cardFields={subtitle:'고정 소제목',body:'본문 원본',footnote:'공식 각주',sourceLabel:'교육청 원문'};doc.pages[1].body='고정 소제목\n\n본문 원본';doc.pages[1].emphasis='원본';doc.sourceReferences=[{title:'기관 원문',url:'https://ged.kedi.re.kr/notice/2027'}];doc.sourceCard={title:'원문 확인',body:'공식 요강 확인'};doc.teaser={title:'다음 원고',body:'댓글 안내'};
  const a=await imported(),beforeLink=(await db.select().from(schemas.notionSyncLinks))[0],beforeRevision=(await db.select().from(schemas.contentRevisions))[0];
  await db.update(schemas.contentRevisions).set({payload:{...beforeRevision.payload,internalReview:{memo:'보존할 내부 검토'}}}).where(eq(schemas.contentRevisions.id,beforeRevision.id));
  const copy=structuredClone(a.copy);copy.pages[0].title='수정 제목';copy.pages[0].body='고정 소제목\n\n새 본문';const body={version:a.link.version,itemVersion:a.itemVersion,copy,designEdits:{emphasisByPage:{h2:'새 본문'}}};
  const {agent,csrf}=await login(app);expect((await agent.patch(`/api/notion/links/${a.link.id}/copy`).send(body)).status).toBe(403);
  const saved=await agent.patch(`/api/notion/links/${a.link.id}/copy`).set('x-csrf-token',csrf).send(body);expect(saved.status).toBe(200);expect(saved.body.copy).toEqual(copy);expect(saved.body.itemVersion).toBe(a.itemVersion+1);expect(saved.body.designEdits).toEqual(body.designEdits);
  const afterLink=(await db.select().from(schemas.notionSyncLinks))[0];expect(afterLink.sourceSnapshot).toEqual(beforeLink.sourceSnapshot);expect(api.update).not.toHaveBeenCalled();
  const revisions=await db.select().from(schemas.contentRevisions).where(eq(schemas.contentRevisions.contentItemId,a.link.itemId));expect(revisions).toHaveLength(2);expect(revisions.at(-1)!.payload.internalReview).toEqual({memo:'보존할 내부 검토'});expect(revisions.at(-1)!.payload.notionDesignEdits).toEqual(body.designEdits);
  expect(saved.body.source.pages[1].cardFields).toMatchObject({subtitle:'고정 소제목',footnote:'공식 각주',sourceLabel:'교육청 원문'});expect(saved.body.source.sourceReferences).toEqual(doc.sourceReferences);expect(saved.body.source.teaser).toEqual(doc.teaser);
  expect((await agent.patch(`/api/notion/links/${a.link.id}/copy`).set('x-csrf-token',csrf).send(body)).status).toBe(409);
  const next={...body,itemVersion:saved.body.itemVersion};next.copy=structuredClone(copy);next.copy.pages[0].body='소제목을 지운 잘못된 본문';expect((await agent.patch(`/api/notion/links/${a.link.id}/copy`).set('x-csrf-token',csrf).send(next)).status).toBe(422);
 });
 it('returns local native photo/fade and source QR previews without writing or contacting Notion again',async()=>{
  doc.sourceReferences=Array.from({length:5},(_,i)=>({title:`기관 ${i+1}`,url:`https://ged.kedi.re.kr/notice/${i+1}`}));const a=await imported(),{agent,csrf}=await login(app),body={version:a.link.version,itemVersion:a.itemVersion,copy:a.copy,designEdits:{emphasisByPage:{}},page:0},fetches=api.fetch.mock.calls.length;
  expect((await request(app).post(`/api/notion/links/${a.link.id}/preview`).send(body)).status).toBe(401);
  const preview=await agent.post(`/api/notion/links/${a.link.id}/preview`).set('x-csrf-token',csrf).send(body);expect(preview.status).toBe(200);expect(preview.headers['content-type']).toContain('image/jpeg');expect(preview.headers['cache-control']).toContain('no-store');expect(await sharp(preview.body).metadata()).toMatchObject({width:1080,height:1350});
  const source=await agent.post(`/api/notion/links/${a.link.id}/preview`).set('x-csrf-token',csrf).send({...body,page:3});expect(source.status).toBe(200);expect(api.fetch).toHaveBeenCalledTimes(fetches);expect(api.update).not.toHaveBeenCalled();expect(await db.select().from(schemas.contentRevisions)).toHaveLength(1);
  expect((await agent.post(`/api/notion/links/${a.link.id}/preview`).set('x-csrf-token',csrf).send({...body,itemVersion:a.itemVersion+1})).status).toBe(409);
 });
 it('exposes the linked main Studio editor and filters orphaned emphasis overrides on a later Notion pull',async()=>{
  const a=await imported(),service=await import('../server/services/notionStudio');
  const saved=await service.saveNotionStudioDraft(db,a.link.id,{version:a.link.version,itemVersion:a.itemVersion,copy:a.copy,designEdits:{emphasisByPage:{h1:'표지',h2:'본문'}}},'test');
  const {agent}=await login(app),studio=await agent.get(`/api/studio/cards/${a.link.studioCardId}`);expect(studio.status).toBe(200);expect(studio.body.card.notionLinkId).toBe(a.link.id);
  doc.sourceHash='b'.repeat(64);doc.pages[1].headingBlockId='replacement-row';
  const next=await service.pullNotionStudio(db,a.link.id,{version:saved.link.version,itemVersion:saved.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:false},'test');expect(next.designEdits).toEqual({emphasisByPage:{h1:'표지'}});
  await expect(service.saveNotionStudioDraft(db,a.link.id,{version:next.link.version,itemVersion:next.itemVersion,copy:next.copy,designEdits:next.designEdits!},'test')).resolves.toMatchObject({copy:next.copy});
 });
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
 it('applies a replaced Notion cover when resolving a text conflict toward Studio and retains the original binary',async()=>{
  const a=await imported(),service=await import('../server/services/notionStudio'),old=(await db.select().from(schemas.notionSyncPhotos))[0];
  await edit(a.link.itemId,'Studio에서 선택한 최종 문구');
  doc.sourceHash='b'.repeat(64);doc.photos=[{key:'replacement-cover',name:'새 표지.png',url:doc.photos[0].url.replace('photo.png','replacement.png')}];
  const replacement=await sharp({create:{width:24,height:36,channels:3,background:'#ee4422'}}).png().toBuffer();api.photo.mockResolvedValue({buffer:replacement,mimeType:'image/png'});
  const current=await service.notionStudioDetail(db,a.link.id),next=await service.pushNotionStudio(db,a.link.id,{version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:true},'test');
  expect(next.copy.pages[0].body).toBe('Studio에서 선택한 최종 문구');expect(doc.pages[1].body).toBe('Studio에서 선택한 최종 문구');expect(next.link.status).toBe('synced');
  expect(next.photos).toHaveLength(1);expect(next.photos[0].id).not.toBe(old.id);expect(next.photos[0].name).toBe('새 표지.png');
  const rows=await db.select().from(schemas.notionSyncPhotos);expect(rows.find(p=>p.id===next.photos[0].id)!.bytes).toEqual(replacement);expect(rows.find(p=>p.id===old.id)!.bytes).toEqual(old.bytes);
  const [link]=await db.select().from(schemas.notionSyncLinks);expect(link.sourceHash).toBe(doc.sourceHash);expect(link.photoOrder).toEqual([next.photos[0].id]);expect(link.sourceSnapshot.photos).toEqual([{key:'replacement-cover',name:'새 표지.png'}]);
  await db.update(schemas.notionSyncLinks).set({lastCheckedAt:null}).where(eq(schemas.notionSyncLinks.id,a.link.id));
  expect(await (await import('../server/worker/notion')).syncNotionOnce(db)).toMatchObject({checked:1,pulled:0,pushed:0});expect((await service.notionStudioDetail(db,a.link.id)).photos[0].id).toBe(next.photos[0].id);
 });
 it.each([
  {change:'reorders',start:['first','second'],next:['second','first']},
  {change:'adds',start:['first'],next:['first','second']},
  {change:'removes',start:['first','second'],next:['second']},
  {change:'clears',start:['first'],next:[]},
 ])('$change Notion photo slots while pushing the selected Studio text',async({start,next:keys})=>{
  const photos=Object.fromEntries(['first','second'].map(key=>[key,{key,name:`${key}.png`,url:`https://prod-files-secure.s3.us-west-2.amazonaws.com/test/${key}.png`}]));
  const buffers={first:await sharp({create:{width:20,height:30,channels:3,background:'#113355'}}).png().toBuffer(),second:await sharp({create:{width:25,height:35,channels:3,background:'#ddaa22'}}).png().toBuffer()};
  api.photo.mockImplementation(async(url:string)=>({buffer:buffers[url.includes('second.png')?'second':'first'],mimeType:'image/png'}));doc.photos=start.map(key=>photos[key]);
  const a=await imported(),service=await import('../server/services/notionStudio'),originals=await db.select().from(schemas.notionSyncPhotos);await edit(a.link.itemId,'선택한 Studio 문구');
  doc.photos=keys.map(key=>photos[key]);doc.sourceHash='b'.repeat(64);const current=await service.notionStudioDetail(db,a.link.id);
  const pushed=await service.pushNotionStudio(db,a.link.id,{version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:true},'test');
  expect(pushed.photos.map(p=>p.name)).toEqual(keys.map(key=>`${key}.png`));expect(pushed.copy.pages[0].body).toBe('선택한 Studio 문구');
  const [link]=await db.select().from(schemas.notionSyncLinks),stored=await db.select().from(schemas.notionSyncPhotos);expect(link.photoOrder).toEqual(pushed.photos.map(p=>p.id));expect(link.sourceSnapshot.photos).toEqual(keys.map(key=>({key,name:`${key}.png`})));expect(link.sourceHash).toBe(doc.sourceHash);
  for(const photo of pushed.photos)expect(stored.find(p=>p.id===photo.id)!.bytes).toEqual(buffers[photo.name==='second.png'?'second':'first']);
  for(const photo of originals)expect(stored.find(p=>p.id===photo.id)!.bytes).toEqual(photo.bytes);
 });
 it('keeps stored photos usable when only a signed image URL renews during a text push',async()=>{
  const a=await imported(),service=await import('../server/services/notionStudio');await edit(a.link.itemId,'원고만 변경');doc.photos[0].url=doc.photos[0].url.replace('secret=signed','secret=renewed');api.photo.mockRejectedValue(new Error('A renewed URL must not require a new image download'));
  api.update.mockImplementationOnce(async input=>{doc={...doc,coverTitle:input.coverTitle,pages:doc.pages.map((p,i)=>({...p,...input.pages[i]})),photos:[{...doc.photos[0],url:doc.photos[0].url.replace('secret=renewed','secret=readback-renewed')}],sourceHash:'c'.repeat(64)};return structuredClone(doc);});
  const current=await service.notionStudioDetail(db,a.link.id),pushed=await service.pushNotionStudio(db,a.link.id,{version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:false},'test');
  expect(pushed.copy.pages[0].body).toBe('원고만 변경');expect(pushed.photos).toEqual(a.photos);expect(pushed.link.status).toBe('synced');
 });
 it('refreshes a replaced body image even when its block key and caption stay the same',async()=>{
  doc.photos[0].key='block:unchanged-image-block';doc.photos[0].name='그대로인 사진 설명';const a=await imported(),service=await import('../server/services/notionStudio');await edit(a.link.itemId,'Studio 최종 문구');
  doc.sourceHash='b'.repeat(64);doc.photos[0].url=doc.photos[0].url.replace('photo.png','new-body-image.png');const replacement=await sharp({create:{width:23,height:31,channels:3,background:'#22bb44'}}).png().toBuffer();api.photo.mockResolvedValue({buffer:replacement,mimeType:'image/png'});
  const current=await service.notionStudioDetail(db,a.link.id),pushed=await service.pushNotionStudio(db,a.link.id,{version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:true},'test');
  expect(pushed.photos[0].id).not.toBe(a.photos[0].id);expect(pushed.photos[0].name).toBe(a.photos[0].name);const [photo]=await db.select().from(schemas.notionSyncPhotos).where(eq(schemas.notionSyncPhotos.id,pushed.photos[0].id));expect(photo.bytes).toEqual(replacement);expect(pushed.link.status).toBe('synced');
 });
 it('keeps the previous photo and baseline without writing Notion if a replacement download fails',async()=>{
  const a=await imported(),service=await import('../server/services/notionStudio'),[before]=await db.select().from(schemas.notionSyncLinks);await edit(a.link.itemId,'보존할 Studio 수정');
  doc.sourceHash='b'.repeat(64);doc.photos=[{...doc.photos[0],key:'replacement',name:'읽지 못한 새 표지.png'}];api.photo.mockRejectedValue(new Error('replacement download failed'));
  const current=await service.notionStudioDetail(db,a.link.id);await expect(service.pushNotionStudio(db,a.link.id,{version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:true},'test')).rejects.toThrow('replacement download failed');
  expect(api.update).not.toHaveBeenCalled();const [after]=await db.select().from(schemas.notionSyncLinks);expect(after.sourceHash).toBe(before.sourceHash);expect(after.sourceSnapshot).toEqual(before.sourceSnapshot);expect(after.photoOrder).toEqual(before.photoOrder);expect(after.operationToken).toBeNull();expect(await db.select().from(schemas.notionSyncPhotos)).toHaveLength(1);expect((await service.notionStudioDetail(db,a.link.id)).copy.pages[0].body).toBe('보존할 Studio 수정');
 });
 it('checks retained photo capacity before a Notion write without counting an already stored image twice',async()=>{
  const a=await imported(),service=await import('../server/services/notionStudio'),[before]=await db.select().from(schemas.notionSyncLinks),[oldPhoto]=await db.select().from(schemas.notionSyncPhotos);await edit(a.link.itemId,'용량 확인 전 보존할 문구');
  doc.sourceHash='b'.repeat(64);doc.photos=[{...doc.photos[0],key:'replacement-cover',name:'용량 초과 표지.png',url:doc.photos[0].url.replace('photo.png','replacement.png')}];
  const replacement=await sharp({create:{width:24,height:36,channels:3,background:'#cc3344'}}).png().toBuffer();api.photo.mockResolvedValue({buffer:replacement,mimeType:'image/png'});
  // Substitute only the aggregate byte count, keeping transactions, locks and
  // persisted photos real. This tests the 200MB boundary without a 200MB blob.
  let retainedBytes=200*1024*1024-replacement.length+1;const query=pg.Client.prototype.query;
  const querySpy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(this:pg.Client,...args:Parameters<typeof query>){
   const config=args[0] as unknown as {text?:string;rowMode?:string};
   if(config.text?.includes('sum(octet_length(')&&config.text.includes('notion_sync_photos'))return Promise.resolve({rows:config.rowMode==='array'?[[String(retainedBytes)]]:[{size:String(retainedBytes)}]});
   return (query as Function).apply(this,args);
  } as typeof query);
  try{
   const current=await service.notionStudioDetail(db,a.link.id),input={version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:true};
   await expect(service.pushNotionStudio(db,a.link.id,input,'test')).rejects.toMatchObject({status:413});expect(api.update).not.toHaveBeenCalled();
   const [after]=await db.select().from(schemas.notionSyncLinks);expect(after.sourceHash).toBe(before.sourceHash);expect(after.sourceSnapshot).toEqual(before.sourceSnapshot);expect(after.photoOrder).toEqual(before.photoOrder);expect(after.operationToken).toBeNull();expect(await db.select().from(schemas.notionSyncPhotos)).toHaveLength(1);
   retainedBytes=200*1024*1024;api.photo.mockResolvedValue({buffer:oldPhoto.bytes,mimeType:'image/png'});
   const pushed=await service.pushNotionStudio(db,a.link.id,input,'test');expect(pushed.link.status).toBe('synced');expect(pushed.photos.map(p=>p.id)).toEqual(before.photoOrder);expect(await db.select().from(schemas.notionSyncPhotos)).toHaveLength(1);expect(doc.pages[1].body).toBe('용량 확인 전 보존할 문구');
  }finally{querySpy.mockRestore();}
 });
 it.each(['key','path'])('does not acknowledge a different image %s changed during Notion text writeback',async(change)=>{
  const a=await imported(),service=await import('../server/services/notionStudio'),[before]=await db.select().from(schemas.notionSyncLinks);await edit(a.link.itemId,'반영할 Studio 문구');doc.sourceHash='b'.repeat(64);doc.photos=[{...doc.photos[0],key:'prepared-replacement',name:'준비한 사진.png'}];
  api.update.mockImplementationOnce(async input=>{doc={...doc,pages:doc.pages.map((p,i)=>({...p,...input.pages[i]})),photos:[change==='key'?{...doc.photos[0],key:'unprepared-racing-photo',name:'경합한 사진.png'}:{...doc.photos[0],url:doc.photos[0].url.replace('photo.png','unprepared-racing-photo.png')}],sourceHash:'c'.repeat(64)};return structuredClone(doc);});
  const current=await service.notionStudioDetail(db,a.link.id);await expect(service.pushNotionStudio(db,a.link.id,{version:current.link.version,itemVersion:current.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:true},'test')).rejects.toMatchObject({status:409});
  expect(doc.pages[1].body).toBe('반영할 Studio 문구');const [after]=await db.select().from(schemas.notionSyncLinks);expect(after.sourceHash).toBe(before.sourceHash);expect(after.sourceSnapshot).toEqual(before.sourceSnapshot);expect(after.photoOrder).toEqual(before.photoOrder);expect(after.operationToken).toBeNull();expect(after.lastError).toBeTruthy();expect(await db.select().from(schemas.notionSyncPhotos)).toHaveLength(1);
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
