/** Isolated PostgreSQL with mocked provider boundaries. Never contacts Notion or Canva. */
import {createHash,randomUUID} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {unzipSync} from 'fflate';
import sharp from 'sharp';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {channels,contentItems,contentRevisions,mediaAssets,notionSyncLinks,notionSyncPhotos} from '../shared/schema';
import type {NotionDocument} from '../shared/notionSync';
import {notionDocumentToCopy} from '../shared/notionStudioCopy';
import {studioKey} from '../shared/channelKeys';
import {emptyPayload} from '../shared/payloads';
import {resetDb,setTestEnv,login} from './helpers';

const testUrl=process.env.TEST_DATABASE_URL;
if(!testUrl||!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(testUrl).hostname)||!new URL(testUrl).pathname.endsWith('_test'))throw Error('Explicit loopback PostgreSQL TEST_DATABASE_URL ending _test is required');
setTestEnv();
const provider=vi.hoisted(()=>({build:vi.fn(),submitImport:vi.fn(),pollImport:vi.fn(),submitExport:vi.fn(),pollExport:vi.fn(),download:vi.fn(),notionPatch:vi.fn(),notionFetch:vi.fn()}));
vi.mock('../server/services/notionCanva',async original=>({...await original<object>(),buildNotionCanvaPptx:provider.build,submitNotionCanvaImport:provider.submitImport,getNotionCanvaImportJob:provider.pollImport,submitNotionCanvaExport:provider.submitExport,getNotionCanvaExportJob:provider.pollExport,downloadNotionCanvaExport:provider.download}));
vi.mock('../server/services/notionClient',async original=>({...await original<object>(),patchNotionDocumentProperties:provider.notionPatch,fetchNotionDocument:provider.notionFetch}));
const {getDb,closeDb}=await import('../server/db');
const {createRevision}=await import('../server/content');
const {notionCopyHash,saveNotionStudioDraft}=await import('../server/services/notionStudio');
const {createNotionStudioCanva,exportNotionStudioCanva,pollNotionStudioCanva,downloadNotionStudioOutput}=await import('../server/services/notionStudioCanva');
const {CanvaRestError}=await import('../server/services/canvaRest');
const {NOTION_CANVA_OUTRO}=await import('../server/services/notionCanva');
let pngs:Buffer[];
const deck=()=>({bytes:Buffer.from('mock local PPTX'),sourcePageCount:2,pageCount:3,width:1080 as const,height:1350 as const,warnings:[] as string[]});
beforeAll(async()=>{await resetDb();pngs=await Promise.all(['#FF493B','#72A7FF','#5ED7B5','#FFD166'].map(background=>sharp({create:{width:1080,height:1350,channels:3,background}}).png().toBuffer()));});
beforeEach(()=>{
 for(const mock of Object.values(provider))mock.mockReset();
 provider.build.mockResolvedValue(deck());provider.submitImport.mockResolvedValue({id:'import_1',status:'in_progress'});provider.pollImport.mockResolvedValue({id:'import_1',status:'in_progress'});
 provider.submitExport.mockResolvedValue({id:'export_1',status:'in_progress'});provider.pollExport.mockResolvedValue({id:'export_1',status:'in_progress'});provider.notionPatch.mockResolvedValue(undefined);
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Live provider calls prohibited');}));
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks();});
afterAll(closeDb);

async function fixture(){
 const db=getDb(),channel=(await db.select().from(channels)).find(c=>studioKey(c.slug)==='highscoop')!;
 expect(channel).toBeTruthy();
 const doc:NotionDocument={pageId:randomUUID(),url:'https://www.notion.so/test',lastEditedAt:'2026-11-09T00:00:00.000Z',contentKey:'isolated',title:'영재교육 원고',coverTitle:'원서 접수 전에 확인할 것',channel:'HighScoop',category:'영재원',template:'',stage:'원고 검토',verified:true,caption:'별도 캡션',sourceHash:'a'.repeat(64),photos:[],pages:[{index:1,title:'원고 표지',body:'표지 설명',headingBlockId:'h1',titleBlockId:'t1',bodyBlockIds:['b1']},{index:2,title:'내지 제목',body:'원문 본문 그대로',headingBlockId:'h2',titleBlockId:'t2',bodyBlockIds:['b2']}]};
 const copy=notionDocumentToCopy(doc);
 const [created]=await db.insert(contentItems).values({channelId:channel.id,kind:channel.contentType,title:doc.title,origin:'manual',topicKey:'notion:'+doc.pageId}).returning();
 const revision=await createRevision(db,{contentItemId:created.id,author:'operator',payload:{...emptyPayload(channel.contentType,doc.title),cardCopy:copy},note:'원고 원본'});
 const [link]=await db.insert(notionSyncLinks).values({notionPageId:doc.pageId,notionUrl:doc.url,channelId:channel.id,contentItemId:created.id,sourceHash:doc.sourceHash,baseCopyHash:notionCopyHash(copy),sourceEditedAt:doc.lastEditedAt,sourceSnapshot:doc as unknown as Record<string,unknown>,coverStyle:'B'}).returning();
 return {db,item:created,revision,link,doc,copy};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function saved(f:Fixture){return (await f.db.select().from(notionSyncLinks).where(eq(notionSyncLinks.id,f.link.id)))[0];}
async function request(f:Fixture){const link=await saved(f),[item]=await f.db.select().from(contentItems).where(eq(contentItems.id,f.item.id));return {version:link.version,itemVersion:item.version};}
async function ready(f:Fixture){
 await createNotionStudioCanva(f.db,f.link.id,await request(f),'isolated-test');
 provider.pollImport.mockResolvedValueOnce({id:'import_1',status:'success',result:{designs:[{designId:'design_'+f.link.id,editUrl:'https://www.canva.com/design/test/edit',viewUrl:null,pageCount:3}]}});
 return pollNotionStudioCanva(f.db,f.link.id);
}
async function completed(f:Fixture,images=pngs.slice(0,3),jobId='export_1'){
 provider.submitExport.mockResolvedValueOnce({id:jobId,status:'in_progress'});
 await exportNotionStudioCanva(f.db,f.link.id,await request(f),'isolated-test');
 provider.pollExport.mockResolvedValueOnce({id:jobId,status:'success',result:{urls:images.map((_,i)=>`https://export-download.canva.com/${jobId}/${i}`)}});
 provider.download.mockImplementation(async(url:string)=>images[Number(url.split('/').at(-1))]);
 return pollNotionStudioCanva(f.db,f.link.id);
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}

describe('Notion -> Canva coordination on isolated PostgreSQL',()=>{
 it('passes the selected current kit, capture and separate overlay to native export and invalidates changed marks',async()=>{
  const f=await fixture(),overlay=await sharp({create:{width:1080,height:1350,channels:4,background:{r:255,g:0,b:0,alpha:0}}}).png().toBuffer(),photos=[];
  for(const [i,bytes]of [pngs[0],pngs[1],overlay].entries())photos.push((await f.db.insert(notionSyncPhotos).values({linkId:f.link.id,sourceKey:`kit-photo-${i}`,name:`자료${i}.png`,mimeType:'image/png',bytes,sha256:createHash('sha256').update(bytes).digest('hex'),width:1080,height:1350}).returning())[0]);
  await f.db.update(notionSyncLinks).set({photoOrder:photos.map(photo=>photo.id)}).where(eq(notionSyncLinks.id,f.link.id));
  const copy={...f.copy,templateKey:'highscoop:admissions'},designEdits={emphasisByPage:{},templateByPage:{h2:'document_excerpt' as const},photoByPage:{h2:photos[1].id},overlayByPage:{h2:photos[2].id}};
  const edited=await saveNotionStudioDraft(f.db,f.link.id,{...await request(f),copy,designEdits},'test');
  await ready(f);const [input,media]=provider.build.mock.calls[0];
  expect(input).toMatchObject({coverStyle:'A',category:'입시',categoryColor:'#72A7FF'});expect(input.pages[1]).toMatchObject({interiorTemplate:'document_excerpt',imageId:String(photos[1].id),overlayImageId:String(photos[2].id),body:'원문 본문 그대로'});
  expect(media.map((photo:{id:string})=>photo.id)).toEqual(photos.map(photo=>String(photo.id)));expect(((await saved(f)).sourceSnapshot as unknown as NotionDocument).category).toBe('영재원');
  const [item]=await f.db.select().from(contentItems).where(eq(contentItems.id,f.item.id)),[revision]=await f.db.select().from(contentRevisions).where(eq(contentRevisions.id,item.currentRevisionId!));
  await f.db.update(contentRevisions).set({payload:{...revision.payload,notionDesignEdits:{...edited.designEdits,overlayByPage:{h2:photos[1].id}}}}).where(eq(contentRevisions.id,revision.id));
  await expect(exportNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});expect(provider.submitExport).not.toHaveBeenCalled();
 });
 it('keeps a dialogue text-only until its photo is explicitly selected',async()=>{
  const f=await fixture(),photos=[];
  for(let i=0;i<2;i++)photos.push((await f.db.insert(notionSyncPhotos).values({linkId:f.link.id,sourceKey:`dialogue-${i}`,name:`화면${i}.png`,mimeType:'image/png',bytes:pngs[i],sha256:createHash('sha256').update(pngs[i]).digest('hex'),width:1080,height:1350}).returning())[0]);
  await f.db.update(notionSyncLinks).set({photoOrder:photos.map(photo=>photo.id)}).where(eq(notionSyncLinks.id,f.link.id));
  const copy=structuredClone(f.copy);copy.pages[0].body='화자|내용\n엄마|왜 재미있어?\n아이|친구들과 내 세계를 만들 수 있어서요.';
  await saveNotionStudioDraft(f.db,f.link.id,{...await request(f),copy,designEdits:{emphasisByPage:{},templateByPage:{h2:'dialogue'}}},'test');
  await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  const [input,media]=provider.build.mock.calls[0];expect(input.pages[1]).toMatchObject({interiorTemplate:'dialogue',body:copy.pages[0].body});expect(input.pages[1].imageId).toBeUndefined();expect(media.map((photo:{id:string})=>photo.id)).toEqual([String(photos[0].id)]);
 });
 it('uses explicit interior templates and any owned selected photo in Canva while preserving protected text and source layouts',async()=>{
  const f=await fixture();f.doc.pages[1].infographic='application_steps';f.doc.pages[1].cardFields={subtitle:'원문 소제목',body:'원문 본문 그대로',footnote:'원문 각주',sourceLabel:'공식 원문'};
  f.doc.pages[1].body='원문 소제목\n\n원문 본문 그대로';
  const photos=[];for(let i=0;i<3;i++)photos.push((await f.db.insert(notionSyncPhotos).values({linkId:f.link.id,sourceKey:`photo-${i}`,name:`사진${i}.png`,mimeType:'image/png',bytes:pngs[i],sha256:createHash('sha256').update(pngs[i]).digest('hex'),width:1080,height:1350}).returning())[0]);
  await f.db.update(notionSyncLinks).set({sourceSnapshot:f.doc as unknown as Record<string,unknown>,photoOrder:photos.map(p=>p.id)}).where(eq(notionSyncLinks.id,f.link.id));
  const copy=notionDocumentToCopy(f.doc),designEdits={emphasisByPage:{h2:'본문'},templateByPage:{h2:'image_text' as const},photoByPage:{h2:photos[2].id}};
  await saveNotionStudioDraft(f.db,f.link.id,{...await request(f),copy,designEdits},'test');
  await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  const [input,media]=provider.build.mock.calls[0];
  expect(input.pages[1]).toMatchObject({interiorTemplate:'image_text',interiorSubtitle:'원문 소제목',body:'원문 본문 그대로',imageId:String(photos[2].id),footnote:'원문 각주',sourceLabel:'공식 원문',emphasis:'본문'});
  expect(input.pages[1].infographic).toBeUndefined();expect(media.map((p:{id:string})=>p.id)).toEqual([String(photos[0].id),String(photos[2].id)]);
  expect(((await saved(f)).sourceSnapshot as unknown as NotionDocument).pages[1].infographic).toBe('application_steps');
 });
 it('invalidates an exported design when only an interior template choice changes',async()=>{
  const f=await fixture();await ready(f);const [revision]=await f.db.select().from(contentRevisions).where(eq(contentRevisions.id,f.revision.id));
  await f.db.update(contentRevisions).set({payload:{...revision.payload,notionDesignEdits:{emphasisByPage:{},templateByPage:{h2:'text'}}}}).where(eq(contentRevisions.id,revision.id));
  await expect(exportNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});expect(provider.submitExport).not.toHaveBeenCalled();
 });
 it('returns the current link version after a slow Notion refresh so an explicit export can use it',async()=>{
  const f=await fixture();await ready(f);const original=await saved(f);
  provider.notionFetch.mockImplementation(async()=>structuredClone(f.doc));
  provider.notionFetch.mockImplementationOnce(async()=>{await f.db.update(notionSyncLinks).set({version:original.version+1,autoSync:false}).where(eq(notionSyncLinks.id,f.link.id));return structuredClone(f.doc);});
  const app=(await import('../server/app')).createApp(),{agent,csrf}=await login(app);
  const response=await agent.get(`/api/notion/links/${f.link.id}?refresh=1`);expect(response.status).toBe(200);expect(response.body.link).toMatchObject({version:original.version+1,autoSync:false});expect(response.body.itemVersion).toBe(f.item.version);
  const exported=await agent.post(`/api/notion/links/${f.link.id}/canva/export`).set('x-csrf-token',csrf).send({version:response.body.link.version,itemVersion:response.body.itemVersion,confirmed:true});expect(exported.status).toBe(200);expect(provider.submitExport).toHaveBeenCalledTimes(1);
 });
 it('returns the current item revision and copy after a concurrent edit while Notion is being read',async()=>{
  const f=await fixture(),nextCopy=structuredClone(f.copy);nextCopy.pages[0].body='다른 창에서 저장한 본문';provider.notionFetch.mockImplementation(async()=>structuredClone(f.doc));
  provider.notionFetch.mockImplementationOnce(async()=>{await createRevision(f.db,{contentItemId:f.item.id,author:'operator',payload:{...emptyPayload('notice',f.doc.title),cardCopy:nextCopy},note:'concurrent fixture edit'});await f.db.update(contentItems).set({version:f.item.version+1}).where(eq(contentItems.id,f.item.id));return structuredClone(f.doc);});
  const app=(await import('../server/app')).createApp(),{agent,csrf}=await login(app),response=await agent.get(`/api/notion/links/${f.link.id}?refresh=1`);expect(response.status).toBe(200);expect(response.body.itemVersion).toBe(f.item.version+1);expect(response.body.copy.pages[0].body).toBe('다른 창에서 저장한 본문');
  const copy=structuredClone(response.body.copy);copy.pages[0].body+='\n확인 후 수정';const result=await agent.patch(`/api/notion/links/${f.link.id}/copy`).set('x-csrf-token',csrf).send({version:response.body.link.version,itemVersion:response.body.itemVersion,copy,designEdits:{emphasisByPage:{}}});expect(result.status).toBe(200);expect(result.body.copy.pages[0].body).toBe(copy.pages[0].body);expect(provider.submitExport).not.toHaveBeenCalled();
 });
 it('keeps legacy empty-override design fingerprints valid and detects design-only edits',async()=>{
  const f=await fixture();await ready(f);const before=await saved(f);
  const legacyFingerprint=createHash('sha256').update(JSON.stringify({revisionId:f.revision.id,itemVersion:f.item.version,title:f.item.title,copy:f.copy,coverStyle:'B',photoOrder:[],category:'영재원'})).digest('hex');
  await f.db.update(notionSyncLinks).set({canva:{...before.canva,sourceFingerprint:legacyFingerprint} as typeof before.canva}).where(eq(notionSyncLinks.id,f.link.id));
  await exportNotionStudioCanva(f.db,f.link.id,await request(f),'test');expect(provider.submitExport).toHaveBeenCalledTimes(1);
  const other=await fixture();await ready(other);const [revision]=await other.db.select().from(contentRevisions).where(eq(contentRevisions.id,other.revision.id));
  await other.db.update(contentRevisions).set({payload:{...revision.payload,notionDesignEdits:{emphasisByPage:{h1:'디자인만 변경'}}}}).where(eq(contentRevisions.id,revision.id));
  await expect(exportNotionStudioCanva(other.db,other.link.id,await request(other),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});expect(provider.submitExport).toHaveBeenCalledTimes(1);
 });
 it('uses saved Studio emphasis overrides in later Canva creation without changing the source emphasis',async()=>{
  const f=await fixture();f.doc.pages[1].emphasis='원본 강조';await f.db.update(notionSyncLinks).set({sourceSnapshot:f.doc as unknown as Record<string,unknown>}).where(eq(notionSyncLinks.id,f.link.id));
  await saveNotionStudioDraft(f.db,f.link.id,{...await request(f),copy:f.copy,designEdits:{emphasisByPage:{h1:'표지',h2:'본문'}}},'test');
  await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');expect(provider.build.mock.calls[0][0].pages).toMatchObject([{emphasis:'표지'},{emphasis:'본문'}]);expect((await saved(f)).sourceSnapshot.pages).toEqual(f.doc.pages);
 });
 it('keeps source QR and teaser pages between the current manuscript and the brand outro in the saved output',async()=>{
  const f=await fixture(),sourceReferences=[{title:'공식 모집 공고',url:'https://ged.kedi.re.kr/notice/2027'}],teaser={title:'3일만에 쓰는 영재교육원 연구계획서',body:'궁금한 점을 댓글로 남겨주세요.'};
  f.doc.pages[0].cardFields={subtitle:'',body:f.doc.pages[0].body,footnote:'확인된 기관 사례',sourceLabel:'공식 공고'};f.doc.pages[1].infographic='application_steps';
  await f.db.update(notionSyncLinks).set({sourceSnapshot:{...f.doc,sourceReferences,teaser}}).where(eq(notionSyncLinks.id,f.link.id));
  provider.build.mockResolvedValue({...deck(),pageCount:5});
  await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  expect(provider.build.mock.calls[0][0]).toMatchObject({sourceReferences,teaser});
  expect(provider.build.mock.calls[0][0].pages).toMatchObject([{footnote:'확인된 기관 사례',sourceLabel:'공식 공고'},{infographic:'application_steps'}]);
  provider.pollImport.mockResolvedValueOnce({id:'import_1',status:'success',result:{designs:[{designId:'design_extras',editUrl:'https://www.canva.com/design/extras/edit',viewUrl:null,pageCount:5}]}});
  await pollNotionStudioCanva(f.db,f.link.id);await completed(f,[pngs[0],pngs[1],pngs[2],pngs[3],pngs[0]]);
  const link=await saved(f),[output]=await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,link.canva.outputAssetId!));
  expect(output.carousel!.pages.map(p=>p.title)).toEqual([f.copy.cover.title,f.copy.pages[0].title,'원문 공고 확인',teaser.title,NOTION_CANVA_OUTRO.title]);
  expect((await f.db.select().from(contentItems).where(eq(contentItems.id,f.item.id)))[0].currentRevisionId).toBe(f.revision.id);
  const zip=unzipSync(await downloadNotionStudioOutput(f.db,f.link.id));expect(Object.keys(zip)).toEqual(['01.png','02.png','03.png','04.png','05.png']);
 });
 it('exports and labels all six source pages for 23 institutional QRs without moving the teaser or outro',async()=>{
  const f=await fixture(),sourceReferences=Array.from({length:23},(_,i)=>({title:`기관 ${i+1} 공식 공고`,url:`https://ged.kedi.re.kr/notice/${i}`})),sourceCard={title:'기관별 원문 공고',body:'기관명을 확인하고 QR을 스캔하세요.'},teaser={title:'연구계획서 다음 편',body:'궁금한 점을 댓글로 남겨주세요.'};
  await f.db.update(notionSyncLinks).set({sourceSnapshot:{...f.doc,sourceReferences,sourceCard,teaser}}).where(eq(notionSyncLinks.id,f.link.id));provider.build.mockResolvedValue({...deck(),pageCount:10});
  await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');expect(provider.build.mock.calls[0][0]).toMatchObject({sourceReferences,sourceCard,teaser});
  provider.pollImport.mockResolvedValueOnce({id:'import_1',status:'success',result:{designs:[{designId:'design_many_sources',editUrl:'https://www.canva.com/design/many/edit',viewUrl:null,pageCount:10}]}});
  await pollNotionStudioCanva(f.db,f.link.id);await completed(f,Array.from({length:10},(_,i)=>pngs[i%pngs.length]));
  const link=await saved(f),[output]=await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,link.canva.outputAssetId!)),pages=output.carousel!.pages;
  expect(provider.submitExport.mock.calls[0][1]).toMatchObject({pageCount:10});expect(pages).toHaveLength(10);
  for(let group=0;group<6;group++)expect(pages[group+2]).toMatchObject({title:`기관별 원문 공고 (${group+1}/6)`,altText:`원문 공고 확인: ${sourceReferences.slice(group*4,group*4+4).map(ref=>ref.title).join(', ')}`});
  expect(pages.slice(-2).map(page=>page.title)).toEqual([teaser.title,NOTION_CANVA_OUTRO.title]);
  expect(Object.keys(unzipSync(await downloadNotionStudioOutput(f.db,f.link.id)))).toHaveLength(10);
 });
 it('serializes double clicks, pins the real revision and includes exactly one brand outro',async()=>{
  const f=await fixture(),r=await request(f);
  const results=await Promise.allSettled([createNotionStudioCanva(f.db,f.link.id,r,'test'),createNotionStudioCanva(f.db,f.link.id,r,'test')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect(provider.submitImport).toHaveBeenCalledTimes(1);
  expect((await saved(f)).canva).toMatchObject({phase:'importing',sourceVersion:f.item.version,sourceRevisionId:f.revision.id,pageCount:3,jobId:'import_1'});
 });
 it('rechecks a new revision after local build even if item.version did not change',async()=>{
  const f=await fixture();
  provider.build.mockImplementationOnce(async()=>{await createRevision(f.db,{contentItemId:f.item.id,author:'operator',payload:{...f.revision.payload,cardCopy:{...f.copy,cover:{...f.copy.cover,title:'바뀐 표지'}}}});return deck();});
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'studio_source_changed'}});
  expect(provider.submitImport).not.toHaveBeenCalled();expect((await saved(f)).canva.phase).toBe('idle');
 });
 it('keeps a received import job pending after receipt persistence fails instead of enabling a second POST',async()=>{
  const f=await fixture(),realUpdate=f.db.update.bind(f.db);let fail=true;
  vi.spyOn(f.db,'update').mockImplementation(((table:unknown)=>{
   const query=realUpdate(table as any);
   if(table===notionSyncLinks){const set=query.set.bind(query);vi.spyOn(query,'set').mockImplementation(((values:any)=>{if(fail&&values.canva?.jobId==='import_1'&&values.operationToken===null){fail=false;throw Error('Simulated DB write interruption');}return set(values);}) as typeof query.set);}
   return query;
  }) as typeof f.db.update);
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toThrow('Simulated DB write interruption');
  expect((await saved(f)).canva).toMatchObject({phase:'importing',jobId:'import_1'});
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_job_pending'}});expect(provider.submitImport).toHaveBeenCalledTimes(1);
 });
 it('keeps uncertain POST results blocked and recovers expired export reservations without old receipts',async()=>{
  const f=await fixture();provider.submitImport.mockRejectedValueOnce(new CanvaRestError('Lost receipt',undefined,'result_unknown',true));
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({outcomeUnknown:true});
  expect((await saved(f)).canva.phase).toBe('result_unknown');
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409});expect(provider.submitImport).toHaveBeenCalledTimes(1);
  const g=await fixture();await ready(g);const link=await saved(g);
  await g.db.update(notionSyncLinks).set({canva:{...link.canva,phase:'exporting',exportJobId:undefined},operationToken:'expired',operationUntil:new Date(0)}).where(eq(notionSyncLinks.id,g.link.id));
  expect((await pollNotionStudioCanva(g.db,g.link.id)).link.canva.phase).toBe('result_unknown');expect(provider.pollExport).not.toHaveBeenCalled();
 });
 it('clears a prior export receipt while a new submission is in flight',async()=>{
  const f=await fixture();await ready(f);await completed(f);
  provider.pollExport.mockClear();const started=deferred<void>(),receipt=deferred<{id:string;status:'in_progress'}>();
  provider.submitExport.mockImplementationOnce(async()=>{started.resolve();return receipt.promise;});
  const pending=exportNotionStudioCanva(f.db,f.link.id,await request(f),'test');await started.promise;
  expect((await saved(f)).canva.exportJobId).toBeUndefined();await pollNotionStudioCanva(f.db,f.link.id);expect(provider.pollExport).not.toHaveBeenCalled();
  receipt.resolve({id:'export_2',status:'in_progress'});await pending;
  expect((await saved(f)).canva).toMatchObject({phase:'exporting',exportJobId:'export_2'});expect(provider.pollExport).toHaveBeenCalledWith(expect.anything(),'export_2');
 });
 it('preserves a validated job ID from an incomplete POST response and keeps successful but mismatched results blocked',async()=>{
  const f=await fixture();provider.submitImport.mockRejectedValueOnce(new CanvaRestError('Incomplete response',502,'invalid_response',true,'received_import'));
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({jobId:'received_import'});
  expect((await saved(f)).canva).toMatchObject({phase:'importing',jobId:'received_import'});
  provider.pollImport.mockResolvedValueOnce({id:'received_import',status:'success',result:{designs:[{designId:'existing_design',editUrl:'https://www.canva.com/design/existing/edit',viewUrl:null,pageCount:2}]}});
  expect((await pollNotionStudioCanva(f.db,f.link.id)).link.canva).toMatchObject({phase:'result_unknown',jobId:'received_import'});
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_job_pending'}});expect(provider.submitImport).toHaveBeenCalledTimes(1);
 });
 it('does not attach an older import to a newer revision or write its URL back to Notion',async()=>{
  const f=await fixture();await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  const revision=await createRevision(f.db,{contentItemId:f.item.id,author:'operator',payload:{...f.revision.payload,cardCopy:{...f.copy,cover:{...f.copy.cover,title:'최신 원고'}}}});
  provider.pollImport.mockResolvedValueOnce({id:'import_1',status:'success',result:{designs:[{designId:'old_design',editUrl:'https://www.canva.com/design/old/edit',viewUrl:null,pageCount:3}]}});
  await pollNotionStudioCanva(f.db,f.link.id);
  const [item]=await f.db.select().from(contentItems).where(eq(contentItems.id,f.item.id));expect(item.currentRevisionId).toBe(revision.id);expect(item.canvaDesign).toBeNull();expect(provider.notionPatch).not.toHaveBeenCalled();
  await expect(exportNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});
 });
 it('serializes Notion result-link writeback before a newer Canva design can be submitted',async()=>{
  const f=await fixture();await createNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  provider.pollImport.mockResolvedValueOnce({id:'import_1',status:'success',result:{designs:[{designId:'design_1',editUrl:'https://www.canva.com/design/1/edit',viewUrl:null,pageCount:3}]}});
  const started=deferred<void>(),finish=deferred<void>();provider.notionPatch.mockImplementationOnce(async()=>{started.resolve();return finish.promise;});
  const polling=pollNotionStudioCanva(f.db,f.link.id);await started.promise;
  await expect(createNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409});expect(provider.submitImport).toHaveBeenCalledTimes(1);
  finish.resolve();await polling;expect((await saved(f)).operationToken).toBeNull();
 });
 it('rejects export after revision-only or cover-style changes',async()=>{
  const f=await fixture();await ready(f);
  await createRevision(f.db,{contentItemId:f.item.id,author:'operator',payload:f.revision.payload});
  await expect(exportNotionStudioCanva(f.db,f.link.id,await request(f),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});
  const g=await fixture();await ready(g);await g.db.update(notionSyncLinks).set({coverStyle:'C',version:(await saved(g)).version+1}).where(eq(notionSyncLinks.id,g.link.id));
  await expect(exportNotionStudioCanva(g.db,g.link.id,await request(g),'test')).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});expect(provider.submitExport).not.toHaveBeenCalled();
 });
 it('imports repeated PNGs once under concurrent polls, preserves source copy and appends the real outro metadata',async()=>{
  const f=await fixture();await ready(f);await exportNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  provider.pollExport.mockResolvedValue({id:'export_1',status:'success',result:{urls:['https://export-download.canva.com/0','https://export-download.canva.com/1','https://export-download.canva.com/2']}});provider.download.mockResolvedValue(pngs[0]);
  await Promise.all([pollNotionStudioCanva(f.db,f.link.id),pollNotionStudioCanva(f.db,f.link.id)]);
  const link=await saved(f),[item]=await f.db.select().from(contentItems).where(eq(contentItems.id,f.item.id));
  const rows=await f.db.select().from(mediaAssets).where(eq(mediaAssets.contentItemId,f.item.id)),revisions=await f.db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId,f.item.id));
  expect(link.canva).toMatchObject({phase:'complete',sourceRevisionId:f.revision.id,pageCount:3});expect(rows).toHaveLength(1);expect(revisions).toHaveLength(2);expect(item.currentRevisionId).toBe(f.revision.id);expect(item.version).toBe(f.item.version);
  expect(rows[0].revisionId).not.toBe(f.revision.id);expect(rows[0].carousel?.pages).toHaveLength(3);expect(new Set(rows[0].carousel?.pages.map(p=>p.id)).size).toBe(1);
  expect(rows[0].carousel?.pages[2]).toMatchObject({title:NOTION_CANVA_OUTRO.title,altText:NOTION_CANVA_OUTRO.altText});
  const [source]=await f.db.select().from(contentRevisions).where(eq(contentRevisions.id,f.revision.id));expect(source.payload.cardCopy).toEqual(f.copy);
  const zip=unzipSync(await downloadNotionStudioOutput(f.db,f.link.id));expect(Object.keys(zip)).toEqual(['01.png','02.png','03.png']);for(const bytes of Object.values(zip))expect(Buffer.from(bytes)).toEqual(pngs[0]);
  await pollNotionStudioCanva(f.db,f.link.id);expect(await f.db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId,f.item.id))).toHaveLength(2);
 });
 it('keeps earlier results immutable when the same cover is exported with different inner pages',async()=>{
  const f=await fixture();await ready(f);await completed(f);const firstLink=await saved(f),[first]=await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,firstLink.canva.outputAssetId!));const oldManifest=structuredClone(first.carousel);
  await completed(f,[pngs[0],pngs[3],pngs[2]],'export_2');const secondLink=await saved(f),[second]=await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,secondLink.canva.outputAssetId!));
  const [unchanged]=await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,first.id));
  expect(second.id).not.toBe(first.id);expect(second.revisionId).not.toBe(first.revisionId);expect(unchanged.carousel).toEqual(oldManifest);expect(unchanged.bytes).toEqual(first.bytes);
  expect((await f.db.select().from(contentItems).where(eq(contentItems.id,f.item.id)))[0].currentRevisionId).toBe(f.revision.id);
 });
 it('refuses a late export after a revision changes during download and preserves the old result',async()=>{
  const f=await fixture();await ready(f);await completed(f);const prior=await saved(f),[old]=await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,prior.canva.outputAssetId!));
  await exportNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  provider.pollExport.mockResolvedValueOnce({id:'export_1',status:'success',result:{urls:['https://export-download.canva.com/0','https://export-download.canva.com/1','https://export-download.canva.com/2']}});
  let changed=false;provider.download.mockImplementation(async(url:string)=>{if(!changed){changed=true;await createRevision(f.db,{contentItemId:f.item.id,author:'operator',payload:{...f.revision.payload,cardCopy:{...f.copy,cover:{...f.copy.cover,title:'새 원고'}}}});}return pngs[Number(url.split('/').at(-1))];});
  await expect(pollNotionStudioCanva(f.db,f.link.id)).rejects.toMatchObject({status:409,extra:{code:'canva_source_changed'}});
  expect((await saved(f)).canva).toMatchObject({phase:'failed',outputAssetId:old.id});expect((await f.db.select().from(mediaAssets).where(eq(mediaAssets.id,old.id)))[0].carousel).toEqual(old.carousel);
  expect(await f.db.select().from(mediaAssets).where(eq(mediaAssets.contentItemId,f.item.id))).toHaveLength(3);
 });
 it('surfaces unused photos and rejects a malformed completed export without replacing an earlier result',async()=>{
  const f=await fixture(),photoIds:number[]=[];
  for(let i=0;i<4;i++){const [p]=await f.db.insert(notionSyncPhotos).values({linkId:f.link.id,sourceKey:'photo-'+i,name:'사진'+i,mimeType:'image/png',bytes:pngs[i],sha256:String(i).repeat(64),width:1080,height:1350}).returning({id:notionSyncPhotos.id});photoIds.push(p.id);}
  await f.db.update(notionSyncLinks).set({photoOrder:photoIds}).where(eq(notionSyncLinks.id,f.link.id));await ready(f);expect((await saved(f)).canva.error).toContain('사진 2개');
  await completed(f);const prior=await saved(f);await exportNotionStudioCanva(f.db,f.link.id,await request(f),'test');
  provider.pollExport.mockResolvedValueOnce({id:'export_1',status:'success',result:{urls:['https://export-download.canva.com/0']}});provider.download.mockResolvedValue(pngs[0]);
  await expect(pollNotionStudioCanva(f.db,f.link.id)).rejects.toThrow('이미지 수');expect((await saved(f)).canva).toMatchObject({phase:'failed',outputAssetId:prior.canva.outputAssetId});
 });
});
