/** Isolated PostgreSQL: durable automatic editable Canva handoff, no live providers. */
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {and,eq} from 'drizzle-orm';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {appSettings,channels,contentItems,contentRevisions,notionSyncLinks,notionSyncPhotos,studioCards} from '../shared/schema';
import type {NotionDocument} from '../shared/notionSync';
import {notionDocumentToCopy} from '../shared/notionStudioCopy';
import {studioKey} from '../shared/channelKeys';
import {emptyPayload} from '../shared/payloads';
import {resetDb,setTestEnv} from './helpers';
const testUrl=process.env.TEST_DATABASE_URL;
if(!testUrl||!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(testUrl).hostname)||!new URL(testUrl).pathname.endsWith('_test'))throw Error('Explicit loopback PostgreSQL TEST_DATABASE_URL ending _test is required');
setTestEnv();
const provider=vi.hoisted(()=>({build:vi.fn(),submit:vi.fn(),poll:vi.fn(),patch:vi.fn(),fetch:vi.fn(),connected:vi.fn(),principal:vi.fn(),token:vi.fn()}));
vi.mock('../server/services/notionCanva',async original=>({...await original<object>(),buildNotionCanvaPptx:provider.build,submitNotionCanvaImport:provider.submit,getNotionCanvaImportJob:provider.poll}));
vi.mock('../server/services/notionClient',async original=>({...await original<object>(),patchNotionDocumentProperties:provider.patch,fetchNotionDocument:provider.fetch}));
vi.mock('../server/services/canva',async original=>({...await original<object>(),canvaConnected:provider.connected,accessToken:provider.token}));
vi.mock('../server/services/canvaRest',async original=>({...await original<object>(),getCanvaPrincipal:provider.principal}));
const {getDb,closeDb}=await import('../server/db');
const {createRevision}=await import('../server/content');
const {notionCopyHash,saveNotionStudioDraft,setNotionStudioStyle,importNotionStudio,pullNotionStudio,notionStudioDetail}=await import('../server/services/notionStudio');
const {createNotionStudioCanva}=await import('../server/services/notionStudioCanva');
const {saveNotionCanvaOnce}=await import('../server/worker/notionCanva');
const {CanvaRestError}=await import('../server/services/canvaRest');
beforeAll(resetDb);afterAll(closeDb);
beforeEach(async()=>{
 await getDb().update(notionSyncLinks).set({canva:{phase:'idle'},canvaAutoSave:{enabled:false,phase:'idle'}});
 for(const mock of Object.values(provider))mock.mockReset();
 provider.connected.mockReturnValue(true);provider.token.mockResolvedValue('private-fixture-token');provider.principal.mockResolvedValue({teamId:'team',userId:'user'});
 provider.build.mockResolvedValue({bytes:Buffer.from('editable PPTX'),sourcePageCount:2,pageCount:3,width:1080,height:1350,warnings:[]});
 provider.submit.mockResolvedValue({id:'import_1',status:'in_progress'});provider.poll.mockResolvedValue({id:'import_1',status:'in_progress'});provider.patch.mockResolvedValue(undefined);
 await getDb().update(appSettings).set({value:false}).where(eq(appSettings.key,'global_stop'));
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Live provider calls prohibited');}));
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture(){
 const db=getDb(),channel=(await db.select().from(channels)).find(c=>studioKey(c.slug)==='highscoop')!;
 const doc:NotionDocument={pageId:randomUUID(),url:'https://www.notion.so/test',lastEditedAt:'2026-11-10T00:00:00.000Z',contentKey:'test',title:'자동 저장 원고',coverTitle:'표지',channel:'HighScoop',category:'영재원',template:'',stage:'원고 검토',verified:true,caption:'',sourceHash:'a'.repeat(64),photos:[],pages:[{index:1,title:'표지',body:'설명',headingBlockId:'h1',titleBlockId:'t1',bodyBlockIds:['b1']},{index:2,title:'본문',body:'원문 본문',headingBlockId:'h2',titleBlockId:'t2',bodyBlockIds:['b2']}]};
 const copy=notionDocumentToCopy(doc),[item]=await db.insert(contentItems).values({channelId:channel.id,kind:channel.contentType,title:doc.title,origin:'manual',topicKey:'notion:'+doc.pageId}).returning();
 const revision=await createRevision(db,{contentItemId:item.id,author:'operator',payload:{...emptyPayload(channel.contentType,doc.title),cardCopy:copy},note:'fixture'});
 const [link]=await db.insert(notionSyncLinks).values({notionPageId:doc.pageId,notionUrl:doc.url,channelId:channel.id,contentItemId:item.id,sourceHash:doc.sourceHash,baseCopyHash:notionCopyHash(copy),sourceEditedAt:doc.lastEditedAt,sourceSnapshot:doc as unknown as Record<string,unknown>,coverStyle:'B'}).returning();
 return {db,item,revision,link,doc,copy};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function detail(f:Fixture){return notionStudioDetail(f.db,f.link.id);}
async function stored(f:Fixture){return (await f.db.select().from(notionSyncLinks).where(eq(notionSyncLinks.id,f.link.id)))[0];}
async function edit(f:Fixture,text='수정한 본문'){
 const d=await detail(f),copy=structuredClone(d.copy);copy.pages[0].body=text;
 return saveNotionStudioDraft(f.db,f.link.id,{version:d.link.version,itemVersion:d.itemVersion,copy,designEdits:d.designEdits!},'test');
}
async function due(f:Fixture){const row=await stored(f);await f.db.update(notionSyncLinks).set({canvaAutoSave:{...row.canvaAutoSave,notBefore:new Date(Date.now()-1000).toISOString(),leaseUntil:undefined,leaseToken:undefined}}).where(eq(notionSyncLinks.id,f.link.id));}
async function configure(f:Fixture,enabled:boolean){const d=await detail(f);return setNotionStudioStyle(f.db,f.link.id,{version:d.link.version,canvaAutoSave:enabled});}
async function finish(f:Fixture,id='new_design'){
 provider.poll.mockResolvedValueOnce({id:'import_1',status:'success',result:{designs:[{designId:id,editUrl:'https://www.canva.com/design/'+id+'/edit',viewUrl:null,pageCount:3}]}});
 await saveNotionCanvaOnce(f.db);
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
describe('durable Canva automatic saves',()=>{
 it('keeps missing-photo drafts without queueing Canva and resumes after selecting an actual owned photo',async()=>{
  const f=await fixture(),before=await detail(f),designEdits={emphasisByPage:{},templateByPage:{h2:'image_text' as const}},copy=structuredClone(before.copy);copy.pages[0].body='실물 사진을 기다리는 동안 완성한 원고';
  const draft=await saveNotionStudioDraft(f.db,f.link.id,{version:before.link.version,itemVersion:before.itemVersion,copy,designEdits},'test');
  expect(draft.copy.pages[0].body).toBe(copy.pages[0].body);expect(draft.link.canvaAutoSave).toMatchObject({enabled:true,phase:'blocked',sourceVersion:draft.itemVersion});expect(draft.link.canvaAutoSave?.error).toContain('사진 추가 대기');
  expect((await saveNotionCanvaOnce(f.db)).checked).toBe(0);expect(provider.build).not.toHaveBeenCalled();expect(provider.submit).not.toHaveBeenCalled();
  const bytes=await sharp({create:{width:30,height:40,channels:3,background:'#72A7FF'}}).png().toBuffer();
  const [photo]=await f.db.insert(notionSyncPhotos).values({linkId:f.link.id,sourceKey:'actual-memo',name:'실제 메모.png',mimeType:'image/png',bytes,sha256:createHash('sha256').update(bytes).digest('hex'),width:30,height:40}).returning();
  await f.db.update(notionSyncLinks).set({photoOrder:[photo.id]}).where(eq(notionSyncLinks.id,f.link.id));
  const refreshed=await detail(f),resumed=await saveNotionStudioDraft(f.db,f.link.id,{version:refreshed.link.version,itemVersion:refreshed.itemVersion,copy:refreshed.copy,designEdits:{...designEdits,photoByPage:{h2:photo.id}}},'test');
  expect(resumed.link.canvaAutoSave).toMatchObject({enabled:true,phase:'queued',error:null});await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);expect(provider.build.mock.calls[0][0].pages[1]).toMatchObject({body:copy.pages[0].body,imageId:String(photo.id)});
 });
 it('does not backfill unchanged existing links',async()=>{const f=await fixture();expect((await saveNotionCanvaOnce(f.db)).checked).toBe(0);expect(provider.submit).not.toHaveBeenCalled();expect((await detail(f)).link.canvaAutoSave).toEqual({enabled:true,phase:'idle'});});
 it('queues changed saves atomically, coalesces the latest revision, and skips no-op saves',async()=>{
  const f=await fixture(),first=await edit(f),a=(await stored(f)).canvaAutoSave;
  expect(first.link.canvaAutoSave).toMatchObject({enabled:true,phase:'queued',sourceVersion:first.itemVersion});expect(Date.parse(a.notBefore!)-Date.parse(a.requestedAt!)).toBe(15000);
  expect(provider.submit).not.toHaveBeenCalled();const again=await saveNotionStudioDraft(f.db,f.link.id,{version:first.link.version,itemVersion:first.itemVersion,copy:first.copy,designEdits:first.designEdits!},'test');expect((await stored(f)).canvaAutoSave.requestId).toBe(a.requestId);expect(again.itemVersion).toBe(first.itemVersion);
  const last=await edit(f,'마지막 저장 본문');expect((await stored(f)).canvaAutoSave.requestId).not.toBe(a.requestId);expect((await saveNotionCanvaOnce(f.db)).checked).toBe(0);
  await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);expect(provider.submit.mock.calls[0][1].title).toBe('[작업본] '+f.doc.title);expect(provider.build.mock.calls[0][0].pages[1].body).toBe('마지막 저장 본문');expect((await stored(f)).canvaAutoSave.sourceVersion).toBe(last.itemVersion);
 });
 it('resumes accepted receipts without a browser and leaves original manuscript intact',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);expect((await stored(f)).canvaAutoSave.phase).toBe('processing');
  await finish(f);const d=await detail(f);expect(d.link.canva).toMatchObject({phase:'ready',designId:'new_design',currentSource:true});expect(d.link.canvaAutoSave?.phase).toBe('idle');expect(d.copy.pages[0].body).toBe('수정한 본문');expect(provider.submit).toHaveBeenCalledTimes(1);expect(provider.patch).toHaveBeenCalledTimes(1);
  await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('keeps the previous editable design URL until the new import succeeds',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);await finish(f,'old_design');await edit(f,'새 원고');await due(f);await saveNotionCanvaOnce(f.db);
  expect((await detail(f)).link.canva).toMatchObject({phase:'importing',designId:'old_design',editUrl:'https://www.canva.com/design/old_design/edit',currentSource:false});await finish(f,'latest_design');expect((await detail(f)).link.canva).toMatchObject({designId:'latest_design',currentSource:true});
 });
 it('serializes simultaneous workers so only one editable design is submitted',async()=>{
  const f=await fixture();await edit(f);await due(f);const gate=deferred<unknown>();provider.build.mockImplementationOnce(()=>gate.promise);
  const first=saveNotionCanvaOnce(f.db);await vi.waitFor(()=>expect(provider.build).toHaveBeenCalledTimes(1));await saveNotionCanvaOnce(f.db);expect(provider.submit).not.toHaveBeenCalled();gate.resolve({bytes:Buffer.from('deck'),pageCount:3,warnings:[]});await first;expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('disabling cancels only pending saves and accepted imports still finish',async()=>{
  const f=await fixture();await edit(f);await configure(f,false);await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).not.toHaveBeenCalled();await edit(f,'자동 저장 끈 원고');expect((await stored(f)).canvaAutoSave).toMatchObject({enabled:false,phase:'idle'});
  await configure(f,true);await due(f);await saveNotionCanvaOnce(f.db);await configure(f,false);await finish(f);expect((await detail(f)).link.canvaAutoSave).toMatchObject({enabled:false,phase:'idle'});expect((await detail(f)).link.canva.designId).toBe('new_design');
 });
 it('honors disabling while local preparation is running before provider POST',async()=>{
  const f=await fixture();await edit(f);await due(f);const gate=deferred<unknown>();provider.build.mockImplementationOnce(()=>gate.promise);const job=saveNotionCanvaOnce(f.db);await vi.waitFor(()=>expect(provider.build).toHaveBeenCalledTimes(1));await configure(f,false);gate.resolve({bytes:Buffer.from('deck'),pageCount:3,warnings:[]});await job;expect(provider.submit).not.toHaveBeenCalled();expect((await stored(f)).canvaAutoSave).toMatchObject({enabled:false,phase:'idle'});
 });
 it('honors a global stop set during local preparation before the provider POST',async()=>{
  const f=await fixture();await edit(f);await due(f);const gate=deferred<unknown>();provider.build.mockImplementationOnce(()=>gate.promise);const job=saveNotionCanvaOnce(f.db);await vi.waitFor(()=>expect(provider.build).toHaveBeenCalledTimes(1));await f.db.update(appSettings).set({value:true}).where(eq(appSettings.key,'global_stop'));gate.resolve({bytes:Buffer.from('deck'),pageCount:3,warnings:[]});await job;expect(provider.submit).not.toHaveBeenCalled();expect((await stored(f)).canvaAutoSave.phase).toBe('queued');
 });
 it('retains a disconnected draft and makes the blocked state actionable without endless retries',async()=>{
  const f=await fixture();await edit(f);await due(f);provider.connected.mockReturnValue(false);await saveNotionCanvaOnce(f.db);expect((await detail(f)).link.canvaAutoSave).toMatchObject({phase:'blocked'});expect((await detail(f)).copy.pages[0].body).toBe('수정한 본문');expect(provider.build).not.toHaveBeenCalled();await saveNotionCanvaOnce(f.db);expect(provider.principal).not.toHaveBeenCalled();
  provider.connected.mockReturnValue(true);await configure(f,true);await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('does not repeat an uncertain provider POST, even after explicit re-enable',async()=>{
  const f=await fixture();await edit(f);await due(f);provider.submit.mockRejectedValueOnce(new CanvaRestError('응답 미확정',undefined,'result_unknown',true));await saveNotionCanvaOnce(f.db);expect((await stored(f)).canva.phase).toBe('result_unknown');expect((await stored(f)).canvaAutoSave.phase).toBe('blocked');await configure(f,true);await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('pauses definitive failures until an explicit retry',async()=>{
  const f=await fixture();await edit(f);await due(f);provider.build.mockRejectedValueOnce(Error('표 원고가 페이지에 너무 깁니다.'));await saveNotionCanvaOnce(f.db);expect((await stored(f)).canvaAutoSave.phase).toBe('failed');await saveNotionCanvaOnce(f.db);expect(provider.build).toHaveBeenCalledTimes(1);await configure(f,true);await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('retries a rejected POST with a retained older editor link only after explicit enable',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);await finish(f,'old_design');await edit(f,'새 원고');await due(f);
  provider.submit.mockRejectedValueOnce(new CanvaRestError('항목 거절',400,'invalid_request'));await saveNotionCanvaOnce(f.db);expect((await stored(f)).canva).toMatchObject({phase:'failed',designId:'old_design'});expect((await stored(f)).canvaAutoSave.phase).toBe('failed');
  await configure(f,true);await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(3);expect((await stored(f)).canva.phase).toBe('importing');
 });
 it('retries an asynchronous rejected job rather than deduping a failed source',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);provider.poll.mockResolvedValueOnce({id:'import_1',status:'failed'});await saveNotionCanvaOnce(f.db);expect((await stored(f)).canvaAutoSave.phase).toBe('failed');await configure(f,true);await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(2);
 });
 it('keeps polling an accepted receipt across transient read failures',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);provider.poll.mockRejectedValueOnce(new CanvaRestError('일시 조회 장애',503,'provider_unavailable'));await saveNotionCanvaOnce(f.db);expect((await stored(f)).canvaAutoSave.phase).toBe('processing');await finish(f);expect((await stored(f)).canvaAutoSave.phase).toBe('idle');expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('recovers a valid receipt from a malformed POST success without another import',async()=>{
  const f=await fixture();await edit(f);await due(f);provider.submit.mockRejectedValueOnce(new CanvaRestError('접수 응답 형식 확인 필요',502,'invalid_response',true,'accepted_import'));await saveNotionCanvaOnce(f.db);expect((await stored(f)).canva).toMatchObject({phase:'importing',jobId:'accepted_import'});expect((await stored(f)).canvaAutoSave.phase).toBe('processing');await finish(f);expect(provider.poll).toHaveBeenLastCalledWith(f.db,'accepted_import');expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('rechecks the principal after deferred rendering and never dispatches to a switched account',async()=>{
  const f=await fixture();await edit(f);await due(f);const gate=deferred<unknown>();provider.build.mockImplementationOnce(()=>gate.promise);const job=saveNotionCanvaOnce(f.db);await vi.waitFor(()=>expect(provider.build).toHaveBeenCalledTimes(1));provider.principal.mockResolvedValue({teamId:'other_team',userId:'user'});gate.resolve({bytes:Buffer.from('deck'),pageCount:3,warnings:[]});await job;expect(provider.submit).not.toHaveBeenCalled();expect((await stored(f)).canvaAutoSave.phase).toBe('blocked');expect((await detail(f)).copy.pages[0].body).toBe('수정한 본문');
 });
 it('rejects a changed token at the final dispatch boundary before network transmission',async()=>{
  const f=await fixture();await edit(f);await due(f);provider.submit.mockImplementationOnce(async(_db,_input,options)=>options.fetchImpl('https://api.canva.com/rest/v1/imports',{method:'POST',headers:{Authorization:'Bearer changed-token'}}));await saveNotionCanvaOnce(f.db);expect(fetch).not.toHaveBeenCalled();expect((await stored(f)).canvaAutoSave.phase).toBe('blocked');
 });
 it('does not queue unsupported channels or let them starve the supported batch',async()=>{
  const f=await fixture(),other=(await f.db.select().from(channels)).find(c=>studioKey(c.slug)!=='highscoop'&&c.active)!;await f.db.update(contentItems).set({channelId:other.id}).where(eq(contentItems.id,f.item.id));await f.db.update(notionSyncLinks).set({channelId:other.id}).where(eq(notionSyncLinks.id,f.link.id));await edit(f);expect((await detail(f)).link).toMatchObject({canvaAutoSaveSupported:false,canvaAutoSave:{enabled:false,phase:'idle'}});await expect(configure(f,true)).rejects.toMatchObject({status:422});
  await f.db.update(notionSyncLinks).set({canvaAutoSave:{enabled:true,phase:'queued',notBefore:new Date(0).toISOString()}}).where(eq(notionSyncLinks.id,f.link.id));const good=await fixture();await edit(good);await due(good);await saveNotionCanvaOnce(f.db,{limit:1});expect(provider.submit).toHaveBeenCalledTimes(1);expect((await stored(good)).canva.phase).toBe('importing');
 });
 it('recovers a pre-submit worker lease after restart',async()=>{
  const f=await fixture();await edit(f);await due(f);const a=(await stored(f)).canvaAutoSave;await f.db.update(notionSyncLinks).set({canvaAutoSave:{...a,phase:'processing',leaseToken:'expired',leaseUntil:new Date(Date.now()-1000).toISOString()}}).where(eq(notionSyncLinks.id,f.link.id));await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('does not promote a stale completed import after a cover change and then creates the latest source',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);let d=await detail(f);await setNotionStudioStyle(f.db,f.link.id,{version:d.link.version,coverStyle:'C'});await finish(f,'stale_design');d=await detail(f);expect(d.link.canva.designId).toBeUndefined();expect(d.link.canva.currentSource).toBe(false);expect(d.link.canvaAutoSave?.phase).toBe('queued');expect(provider.patch).not.toHaveBeenCalled();await due(f);await saveNotionCanvaOnce(f.db);expect(provider.submit).toHaveBeenCalledTimes(2);
 });
 it('continues explicit manual import receipts after a prior automatic failure',async()=>{
  const f=await fixture();await edit(f);await due(f);provider.connected.mockReturnValue(false);await saveNotionCanvaOnce(f.db);provider.connected.mockReturnValue(true);const d=await detail(f);await createNotionStudioCanva(f.db,f.link.id,{version:d.link.version,itemVersion:d.itemVersion},'manual');expect((await stored(f)).canvaAutoSave.phase).toBe('processing');await finish(f,'manual_design');expect((await detail(f)).link.canva.designId).toBe('manual_design');expect(provider.submit).toHaveBeenCalledTimes(1);
 });
 it('blocks switched Canva principals rather than reading another account receipt',async()=>{
  const f=await fixture();await edit(f);await due(f);await saveNotionCanvaOnce(f.db);provider.principal.mockResolvedValue({teamId:'different',userId:'user'});await saveNotionCanvaOnce(f.db);expect((await stored(f)).canvaAutoSave.phase).toBe('blocked');await configure(f,true);await saveNotionCanvaOnce(f.db);expect((await stored(f)).canvaAutoSave.phase).toBe('blocked');expect(provider.submit).toHaveBeenCalledTimes(1);expect(provider.poll).toHaveBeenCalledTimes(1);
 });
 it('queues new imports once, source pulls and cover settings without historical backfill',async()=>{
  const f=await fixture(),doc=structuredClone(f.doc);doc.pageId=randomUUID();provider.fetch.mockResolvedValue(doc);const imported=await importNotionStudio(f.db,{pageId:doc.pageId,channelId:f.link.channelId,expectedSourceHash:doc.sourceHash,coverStyle:'B'},'test');expect(imported.link.canvaAutoSave?.phase).toBe('queued');const repeated=await importNotionStudio(f.db,{pageId:doc.pageId,channelId:f.link.channelId,expectedSourceHash:doc.sourceHash,coverStyle:'B'},'test');expect(repeated.link.id).toBe(imported.link.id);expect(repeated.link.canvaAutoSave?.requestedAt).toBe(imported.link.canvaAutoSave?.requestedAt);
  const fresh=structuredClone(f.doc);fresh.sourceHash='b'.repeat(64);fresh.pages[1].cardFields={subtitle:'',body:fresh.pages[1].body,footnote:'새 원문 각주',sourceLabel:'출처'};provider.fetch.mockResolvedValue(fresh);const pulled=await pullNotionStudio(f.db,f.link.id,{version:f.link.version,itemVersion:f.item.version,expectedSourceHash:fresh.sourceHash,resolveConflict:false},'test');expect(pulled.link.canvaAutoSave?.phase).toBe('queued');expect(pulled.link.canva.currentSource).toBe(false);
 });
 it('respects the global stop and excludes trashed drafts before the batch limit',async()=>{
  const f=await fixture();await edit(f);await due(f);await f.db.update(appSettings).set({value:true}).where(eq(appSettings.key,'global_stop'));await saveNotionCanvaOnce(f.db);expect(provider.submit).not.toHaveBeenCalled();await f.db.update(appSettings).set({value:false}).where(eq(appSettings.key,'global_stop'));await f.db.update(studioCards).set({trashedAt:new Date()}).where(eq(studioCards.sourceItemId,f.item.id));await saveNotionCanvaOnce(f.db);expect(provider.submit).not.toHaveBeenCalled();
 });
});
