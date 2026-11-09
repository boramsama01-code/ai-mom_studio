/** Isolated PostgreSQL with mocked provider boundaries. Never contacts Notion or Canva. */
import {randomUUID} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {unzipSync} from 'fflate';
import sharp from 'sharp';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {channels,contentItems,contentRevisions,mediaAssets,notionSyncLinks,notionSyncPhotos} from '../shared/schema';
import type {NotionDocument} from '../shared/notionSync';
import {notionDocumentToCopy} from '../shared/notionStudioCopy';
import {studioKey} from '../shared/channelKeys';
import {emptyPayload} from '../shared/payloads';
import {resetDb,setTestEnv} from './helpers';

const testUrl=process.env.TEST_DATABASE_URL;
if(!testUrl||!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(testUrl).hostname)||!new URL(testUrl).pathname.endsWith('_test'))throw Error('Explicit loopback PostgreSQL TEST_DATABASE_URL ending _test is required');
setTestEnv();
const provider=vi.hoisted(()=>({build:vi.fn(),submitImport:vi.fn(),pollImport:vi.fn(),submitExport:vi.fn(),pollExport:vi.fn(),download:vi.fn(),notionPatch:vi.fn()}));
vi.mock('../server/services/notionCanva',async original=>({...await original<object>(),buildNotionCanvaPptx:provider.build,submitNotionCanvaImport:provider.submitImport,getNotionCanvaImportJob:provider.pollImport,submitNotionCanvaExport:provider.submitExport,getNotionCanvaExportJob:provider.pollExport,downloadNotionCanvaExport:provider.download}));
vi.mock('../server/services/notionClient',async original=>({...await original<object>(),patchNotionDocumentProperties:provider.notionPatch}));
const {getDb,closeDb}=await import('../server/db');
const {createRevision}=await import('../server/content');
const {notionCopyHash}=await import('../server/services/notionStudio');
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
