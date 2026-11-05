/** Real PostgreSQL claims and immutable snapshots; every Canva/network operation is mocked. */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSettings, canvaLibraryDesigns, canvaLibraryPreviewJobs, canvaLibraryPreviews, canvaMasters, canvaRenderJobs, contentItems } from '../shared/schema';
import { CANVA_READING_TEXT_FIELDS } from '../shared/canvaEditorial';
import { canvaTemplateLibraryStateSchema } from '../shared/canvaTemplateLibrary';
import { setTestEnv, resetDb } from './helpers';
import { createFamilyPgFixture } from './fixtures/familyEvidencePg';

setTestEnv();
const api=vi.hoisted(()=>({configured:true,connected:true,principal:vi.fn(),capabilities:vi.fn(),folder:vi.fn(),list:vi.fn(),design:vi.fn(),pages:vi.fn(),eightPages:vi.fn(),dataset:vi.fn(),submitPreview:vi.fn(),getPreview:vi.fn(),download:vi.fn(),autofill:vi.fn(),getAutofill:vi.fn(),prepare:vi.fn()}));
vi.mock('../server/services/canva',async original=>({...await original<object>(),canvaConfigured:()=>api.configured,canvaConnected:()=>api.connected}));
vi.mock('../server/services/canvaRest',async original=>({...await original<object>(),getCanvaPrincipal:api.principal,getCanvaCapabilities:api.capabilities,getCanvaFolder:api.folder,listCanvaFolderDesigns:api.list,getCanvaDesign:api.design,getCanvaLibraryPages:api.pages,getCanvaPages:api.eightPages,getCanvaDataset:api.dataset,submitCanvaLibraryExport:api.submitPreview,getCanvaLibraryExportJob:api.getPreview,submitCanvaAutofill:api.autofill,getCanvaAutofillJob:api.getAutofill}));
vi.mock('../server/services/canvaLibraryAssets',()=>({downloadCanvaLibraryExport:api.download}));
vi.mock('../server/services/canvaEditorialAssets',async original=>({...await original<object>(),prepareCanvaImages:api.prepare}));
const {getDb,closeDb}=await import('../server/db');
const {CanvaRestError}=await import('../server/services/canvaRest');
const {canvaInputHash}=await import('../server/services/canvaEditorialAssets');
const {CANVA_LIBRARY_SETTING,getCanvaLibraryConfig,getCanvaTemplateLibrary,getCanvaLibraryPreview,configureCanvaLibrary,invalidateCanvaLibraryConnection,resetCanvaLibraryBackoff,syncCanvaTemplateLibrary,runCanvaLibraryPreviewJobs,checkedCanvaLibrarySelection}=await import('../server/services/canvaTemplateLibrary');
const {enqueueCanvaRender,runCanvaJobs,canvaJobDto}=await import('../server/services/canvaEditorial');
const {reconcileCanvaJob,canvaRecoveryToken}=await import('../server/services/canvaReconciliation');
const folderId='FAfixture';let sourceId:string,version:number;
const sourcePages=()=>Array.from({length:8},(_,index)=>({id:`page_${index+1}`,pageNumber:index+1,width:1080,height:1350,thumbnailUrl:null}));
const dataset=()=>Object.fromEntries(CANVA_READING_TEXT_FIELDS.map(name=>[name,{type:'text'}]));
beforeAll(async()=>{await resetDb();});
beforeEach(async()=>{
  for(const mock of Object.values(api))if(vi.isMockFunction(mock))mock.mockReset();
  api.configured=true;api.connected=true;sourceId=`Dfixture_${randomUUID()}`;version=123;
  await getDb().update(canvaLibraryPreviewJobs).set({status:'cancelled'});await getDb().update(canvaRenderJobs).set({status:'cancelled'});
  await getDb().delete(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
  api.principal.mockResolvedValue({userId:'user',teamId:'team'});api.capabilities.mockResolvedValue({capabilities:['autofill']});api.folder.mockResolvedValue({id:folderId,name:'원본 폴더'});
  api.list.mockImplementation(async()=>({items:[{type:'design',id:sourceId,title:'직접 편집한 원본',updatedAt:version,pageCount:8,editUrl:`https://www.canva.com/design/${sourceId}/edit`}],continuation:null}));
  api.design.mockImplementation(async(_db,id)=>({id,title:'직접 편집한 원본',updatedAt:version,pageCount:8,owner:{userId:'user',teamId:'team'},editUrl:`https://www.canva.com/design/${id}/edit`,viewUrl:null}));
  api.pages.mockImplementation(async()=>sourcePages());api.eightPages.mockImplementation(async()=>({validEightPageMaster:true,items:sourcePages()}));api.dataset.mockImplementation(async()=>dataset());
  api.submitPreview.mockResolvedValue({id:'export_preview',status:'in_progress'});api.getPreview.mockResolvedValue({id:'export_preview',status:'success',result:{urls:['https://export-download.canva.com/pages.zip']}});
  api.download.mockImplementation(async()=>sourcePages().map((_,page)=>({page,bytes:Buffer.from(`preview-${version}-${page}`),mime:'image/webp',width:540,height:675,sha256:canvaInputHash({version,page})})));
  api.autofill.mockResolvedValue({id:'autofill_created',status:'in_progress'});api.getAutofill.mockResolvedValue({id:'autofill_created',status:'in_progress'});
  api.prepare.mockImplementation(()=>{throw new Error('Native folder design must retain its own pictures');});
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unmocked network request prohibited');}));
  await configureCanvaLibrary(getDb(),{folderId,enabled:true});
});
afterAll(async()=>{vi.unstubAllGlobals();await closeDb();});
async function sync(){await resetCanvaLibraryBackoff(getDb());return syncCanvaTemplateLibrary(getDb());}
async function designRow(){return (await getDb().select().from(canvaLibraryDesigns).where(eq(canvaLibraryDesigns.sourceId,sourceId)))[0];}
async function previewJobs(){return getDb().select().from(canvaLibraryPreviewJobs).where(eq(canvaLibraryPreviewJobs.designId,(await designRow()).id));}
async function previewTick(){const row=await designRow();await getDb().update(canvaLibraryPreviewJobs).set({nextRunAt:new Date(0)}).where(eq(canvaLibraryPreviewJobs.designId,row.id));await runCanvaLibraryPreviewJobs(getDb());}
async function ready(){await sync();await previewTick();await previewTick();await previewTick();return designRow();}
async function jobTick(id:number){await getDb().update(canvaRenderJobs).set({nextRunAt:new Date(0)}).where(eq(canvaRenderJobs.id,id));await runCanvaJobs(getDb(),1);return (await getDb().select().from(canvaRenderJobs).where(eq(canvaRenderJobs.id,id)))[0];}

describe('Canva folder metadata and preview persistence',()=>{
  it('does not call stored credential presence a verified connection',async()=>{
    const initial=await getCanvaTemplateLibrary(getDb());expect(initial.configured).toBe(true);expect(initial.connected).toBe(false);
    api.folder.mockRejectedValue(new CanvaRestError('폴더 권한을 다시 승인해 주세요.',403,'permission_denied',false,null,{reason:'missing_scope'}));
    await sync();const state=await getCanvaTemplateLibrary(getDb());expect(state).toMatchObject({connected:false,syncStatus:'needs_reconnect',errorCode:'missing_scope'});
    const calls=api.folder.mock.calls.length;await syncCanvaTemplateLibrary(getDb());expect(api.folder).toHaveBeenCalledTimes(calls);
    expect((await getCanvaLibraryConfig(getDb())).nextSyncAt).toBeGreaterThan(Date.now()+14*60_000);
  });
  it('claims concurrent scans once, creates one preview job per source version, and never calls Autofill',async()=>{
    await Promise.all([syncCanvaTemplateLibrary(getDb()),syncCanvaTemplateLibrary(getDb())]);
    expect(api.list).toHaveBeenCalledOnce();expect(await previewJobs()).toHaveLength(1);expect(api.autofill).not.toHaveBeenCalled();
    await sync();expect(await previewJobs()).toHaveLength(1);
    await previewTick();await previewTick();await previewTick();
    const state=canvaTemplateLibraryStateSchema.parse(await getCanvaTemplateLibrary(getDb()));
    expect(state.items.find(item=>item.id===sourceId)).toMatchObject({canCreate:true,previewStatus:'ready'});
    await sync();await previewTick();expect(api.submitPreview).toHaveBeenCalledOnce();
  });
  it('preserves the last preview while refreshing a changed source and creates a new version only once',async()=>{
    const old=await ready();version=124;await sync();
    const changed=await designRow();expect(changed.previewVersion).toBe('123');expect(changed.sourceUpdatedAt).toBe('124');expect(changed.previewStatus).toBe('stale');expect(await previewJobs()).toHaveLength(2);
    await expect(checkedCanvaLibrarySelection(getDb(),sourceId,124)).rejects.toMatchObject({extra:{code:'library_preview_pending'}});
    expect((await getCanvaTemplateLibrary(getDb())).items.find(item=>item.id===sourceId)?.thumbnailUrl).toContain('v=123');
    await previewTick();await previewTick();await previewTick();expect((await designRow()).previewVersion).toBe('124');expect(api.submitPreview).toHaveBeenCalledTimes(2);
    expect((await getDb().select().from(canvaLibraryPreviews).where(eq(canvaLibraryPreviews.designId,old.id)))).toHaveLength(8);
  });
  it('preserves selected designs on incomplete pagination and marks removals only after a complete scan',async()=>{
    await ready();api.list.mockResolvedValueOnce({items:[],continuation:'more'}).mockRejectedValueOnce(new CanvaRestError('잠시 후 확인',429,'rate_limited'));
    await sync();expect((await designRow()).status).toBe('ready');
    api.list.mockResolvedValue({items:[],continuation:null});await sync();expect((await designRow()).status).toBe('missing');
    expect((await getCanvaTemplateLibrary(getDb())).items.find(item=>item.id===sourceId)).toMatchObject({status:'missing',canCreate:false});
  });
  it('never replays an uncertain export after a restart or another folder scan',async()=>{
    await sync();api.submitPreview.mockRejectedValue(new CanvaRestError('응답 없음',undefined,'result_unknown',true));
    await previewTick();expect((await previewJobs())[0].status).toBe('result_unknown');await sync();await previewTick();expect(api.submitPreview).toHaveBeenCalledOnce();
  });
  it('recovers an accepted export ID using GET even when its initial response was malformed',async()=>{
    await sync();api.submitPreview.mockRejectedValue(new CanvaRestError('결과 형식 미확인',502,'invalid_response',true,'known_export'));
    await previewTick();expect((await previewJobs())[0]).toMatchObject({status:'queued',phase:'polling',exportJobId:'known_export'});
    await previewTick();await previewTick();expect(api.submitPreview).toHaveBeenCalledOnce();expect(api.getPreview).toHaveBeenCalledWith(expect.anything(),'known_export');expect((await designRow()).previewStatus).toBe('ready');
  });
  it('retains cached images and backs off the whole preview queue on export quota exhaustion',async()=>{
    await ready();version=124;await sync();api.submitPreview.mockRejectedValue(new CanvaRestError('한도',429,'rate_limited',false,null,{reason:'quota_exceeded'}));
    await previewTick();const state=await getCanvaTemplateLibrary(getDb());expect(state).toMatchObject({syncStatus:'error',errorCode:'quota_exceeded'});expect(state.items.find(item=>item.id===sourceId)).toMatchObject({previewStatus:'stale',canCreate:false});
    const count=api.submitPreview.mock.calls.length;await previewTick();expect(api.submitPreview).toHaveBeenCalledTimes(count);
  });
  it('lists unlabeled and nonstandard designs and never sends brand template IDs to design APIs',async()=>{
    api.dataset.mockResolvedValue({});await sync();expect((await designRow()).status).toBe('needs_fields');
    const brandId='BTbrand';api.list.mockResolvedValue({items:[{type:'brand_template',id:brandId,title:'브랜드 템플릿',updatedAt:123,pageCount:null,editUrl:'https://www.canva.com/brand/BTbrand'}],continuation:null});
    await sync();expect(api.design.mock.calls.some(([,id])=>id===brandId)).toBe(false);
    expect((await getCanvaTemplateLibrary(getDb())).items.find(item=>item.id===brandId)).toMatchObject({status:'unsupported_pages',canCreate:false,previewStatus:'unavailable'});
  });
  it('still caches every preview when an unlabeled design dataset is rejected as not fillable',async()=>{
    api.dataset.mockRejectedValue(new CanvaRestError('자동 채우기 필드 없음',400,'invalid_request',false,null,{providerCode:'design_not_fillable'}));
    await ready();expect((await getCanvaTemplateLibrary(getDb())).items.find(item=>item.id===sourceId)).toMatchObject({status:'needs_fields',canCreate:false,previewStatus:'ready'});
    expect(api.submitPreview).toHaveBeenCalledOnce();expect(api.autofill).not.toHaveBeenCalled();
  });
  it('retries an accepted download with GET after manual refresh without a second export',async()=>{
    await sync();await previewTick();await previewTick();api.download.mockRejectedValueOnce(new Error('temporary download failure'));
    await previewTick();expect((await previewJobs())[0].status).toBe('failed');
    await sync();await previewTick();await previewTick();expect((await designRow()).previewStatus).toBe('ready');expect(api.submitPreview).toHaveBeenCalledOnce();
  });
  it('only manually replaces a terminal failed export and retains the old provider ID',async()=>{
    await sync();await previewTick();api.getPreview.mockResolvedValueOnce({id:'export_preview',status:'failed'});await previewTick();
    expect((await previewJobs())[0]).toMatchObject({status:'failed',errorCode:'export_failed',exportJobId:'export_preview'});
    await previewTick();expect(api.submitPreview).toHaveBeenCalledOnce();
    await sync();expect((await previewJobs())[0]).toMatchObject({status:'queued',phase:'prepare',exportJobId:null,previousExportJobIds:['export_preview']});
    api.submitPreview.mockResolvedValue({id:'export_retried',status:'in_progress'});await previewTick();await previewTick();await previewTick();expect((await designRow()).previewStatus).toBe('ready');expect(api.submitPreview).toHaveBeenCalledTimes(2);
  });
  it('does not expose the previous account cache after an explicit disconnect or reconnection',async()=>{
    await ready();expect(await getCanvaLibraryPreview(getDb(),sourceId,0)).not.toBeNull();
    await invalidateCanvaLibraryConnection(getDb());expect((await getCanvaTemplateLibrary(getDb())).items).toEqual([]);expect(await getCanvaLibraryPreview(getDb(),sourceId,0)).toBeNull();
    expect((await getCanvaTemplateLibrary(getDb())).connected).toBe(false);
  });
  it('fences an older folder scan after the folder changes during its provider request',async()=>{
    await ready();await resetCanvaLibraryBackoff(getDb());
    let release!:(value:any)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    api.list.mockImplementationOnce(async()=>{entered();return new Promise(resolve=>{release=resolve;});});
    const oldScan=syncCanvaTemplateLibrary(getDb());await started;
    await configureCanvaLibrary(getDb(),{folderId:'FAreplacement',enabled:true});version=124;api.folder.mockResolvedValue({id:'FAreplacement',name:'새 폴더'});
    await syncCanvaTemplateLibrary(getDb());release({items:[{type:'design',id:sourceId,title:'오래된 폴더 결과',updatedAt:123,pageCount:8,editUrl:null}],continuation:null});await oldScan;
    expect(await designRow()).toMatchObject({folderId:'FAreplacement',sourceUpdatedAt:'124',title:'직접 편집한 원본'});
  });
  it('does not let a late auth error invalidate a newly verified connection',async()=>{
    await sync();let reject!:(error:Error)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    api.submitPreview.mockImplementationOnce(async()=>{entered();return new Promise((_resolve,rejectPromise)=>{reject=rejectPromise;});});
    const oldPreview=runCanvaLibraryPreviewJobs(getDb());await started;
    await invalidateCanvaLibraryConnection(getDb());await syncCanvaTemplateLibrary(getDb());reject(new CanvaRestError('이전 연결 만료',401,'auth_required'));await oldPreview;
    expect(await getCanvaTemplateLibrary(getDb())).toMatchObject({connected:true,syncStatus:'ready'});
  });
  it('does not let a late successful metadata scan clear a quota backoff',async()=>{
    await sync();await resetCanvaLibraryBackoff(getDb());let release!:(value:any)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    api.list.mockImplementationOnce(async()=>{entered();return new Promise(resolve=>{release=resolve;});});
    const scan=syncCanvaTemplateLibrary(getDb());await started;
    api.submitPreview.mockRejectedValue(new CanvaRestError('한도',429,'rate_limited',false,null,{reason:'quota_exceeded'}));await runCanvaLibraryPreviewJobs(getDb());
    release({items:[],continuation:null});await scan;expect(await getCanvaTemplateLibrary(getDb())).toMatchObject({syncStatus:'error',errorCode:'quota_exceeded'});
    expect((await getCanvaLibraryConfig(getDb())).nextSyncAt).toBeGreaterThan(Date.now()+59*60_000);expect((await designRow()).status).toBe('ready');
  });
});
describe('explicit native Canva generation from a folder',()=>{
  it('freezes the source version, keeps local copy/layout, and fills only text on explicit creation',async()=>{
    await ready();const f=await createFamilyPgFixture(getDb());
    const request={channelId:2,itemId:f.item.id,version:f.item.version,requestId:randomUUID(),libraryDesignId:sourceId,expectedLibraryUpdatedAt:123,actor:'test'};
    const job=await enqueueCanvaRender(getDb(),request);
    expect((job.input.copy as {templateKey:string}).templateKey).toBe(f.copy.templateKey);expect(job.input.folderTemplate).toMatchObject({designId:sourceId,sourceUpdatedAt:'123',imagePolicy:'preserve_canva'});
    expect(canvaJobDto(job).result).toMatchObject({libraryDesignId:sourceId,librarySourceUpdatedAt:123});
    expect((await jobTick(job.id)).phase).toBe('autofill_prepare');await jobTick(job.id);
    expect(api.autofill).toHaveBeenCalledOnce();expect(api.prepare).not.toHaveBeenCalled();
    const input=api.autofill.mock.calls[0][1];expect(input.id).toBe(sourceId);expect(Object.values(input.data).every((field:any)=>field.type==='text')).toBe(true);expect(input.data.P01_IMAGE_CREDIT).toBeUndefined();
    version=124;expect((await enqueueCanvaRender(getDb(),request)).id).toBe(job.id);expect(api.autofill).toHaveBeenCalledOnce();
  });
  it('rejects a stale expected source, keeps earlier snapshots, and creates a new master after a changed preview is ready',async()=>{
    await ready();const first=await createFamilyPgFixture(getDb()),second=await createFamilyPgFixture(getDb());
    const old=await enqueueCanvaRender(getDb(),{channelId:2,itemId:first.item.id,version:first.item.version,requestId:randomUUID(),libraryDesignId:sourceId,expectedLibraryUpdatedAt:123,actor:'test'});
    version=124;await sync();await previewTick();await previewTick();await previewTick();
    await expect(checkedCanvaLibrarySelection(getDb(),sourceId,123)).rejects.toMatchObject({extra:{code:'library_source_changed'}});
    const next=await enqueueCanvaRender(getDb(),{channelId:2,itemId:second.item.id,version:second.item.version,requestId:randomUUID(),libraryDesignId:sourceId,expectedLibraryUpdatedAt:124,actor:'test'});
    expect(next.masterId).not.toBe(old.masterId);const [prior]=await getDb().select().from(canvaMasters).where(eq(canvaMasters.id,old.masterId));expect(prior.sourceUpdatedAt).toBe('123');
    expect((await jobTick(old.id)).status).toBe('failed');expect(api.autofill).not.toHaveBeenCalled();
  });
  it('retains the folder snapshot through unknown-result manual recovery without another Autofill',async()=>{
    await ready();const f=await createFamilyPgFixture(getDb());
    const job=await enqueueCanvaRender(getDb(),{channelId:2,itemId:f.item.id,version:f.item.version,requestId:randomUUID(),libraryDesignId:sourceId,expectedLibraryUpdatedAt:123,actor:'test'});
    const [unknown]=await getDb().update(canvaRenderJobs).set({status:'result_unknown',phase:'autofill_submitting'}).where(eq(canvaRenderJobs.id,job.id)).returning();
    const saved=await reconcileCanvaJob(getDb(),{channelId:2,itemId:f.item.id,jobId:job.id,version:f.item.version,designId:`Drecovered_${randomUUID()}`,confirmed:true,expectedRecoveryToken:canvaRecoveryToken(unknown)!,actor:'test'});
    expect(saved.input.folderTemplate).toEqual(job.input.folderTemplate);expect(saved.purpose).toBe('import');expect(saved.phase).toBe('export_prepare');expect(api.autofill).not.toHaveBeenCalled();
    const [item]=await getDb().select().from(contentItems).where(eq(contentItems.id,f.item.id));expect(item.currentRevisionId).toBe(f.revision.id);
  });
  it('keeps the generated design ID but stops automatic output when the original changes during Autofill',async()=>{
    await ready();const f=await createFamilyPgFixture(getDb());
    const job=await enqueueCanvaRender(getDb(),{channelId:2,itemId:f.item.id,version:f.item.version,requestId:randomUUID(),libraryDesignId:sourceId,expectedLibraryUpdatedAt:123,actor:'test'});
    await jobTick(job.id);await jobTick(job.id);
    const generatedId=`Dgenerated_${randomUUID()}`;api.getAutofill.mockResolvedValue({id:'autofill_created',status:'success',result:{designId:generatedId,editUrl:`https://www.canva.com/design/${generatedId}/edit`}});
    const accepted=await jobTick(job.id);expect(accepted).toMatchObject({designId:generatedId,phase:'folder_source_check'});
    version=124;const stopped=await jobTick(job.id);expect(stopped).toMatchObject({status:'failed',phase:'folder_source_check',designId:generatedId,errorCode:'library_source_changed',exportJobId:null});expect(api.autofill).toHaveBeenCalledOnce();
    const [item]=await getDb().select().from(contentItems).where(eq(contentItems.id,f.item.id));expect(item.currentRevisionId).toBe(f.revision.id);
    const imported=await enqueueCanvaRender(getDb(),{channelId:2,itemId:f.item.id,version:f.item.version,requestId:randomUUID(),importFromJobId:job.id,actor:'test'});
    expect(imported).toMatchObject({purpose:'import',designId:generatedId});expect(imported.input.folderTemplate).toEqual(job.input.folderTemplate);
  });
});
