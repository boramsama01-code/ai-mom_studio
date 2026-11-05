import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db';
import { appSettings, canvaLibraryDesigns, canvaLibraryPreviewJobs, canvaLibraryPreviews, type CanvaLibraryStoredPage } from '../../shared/schema';
import { CANVA_LIBRARY_DEFAULT_FOLDER_ID, CANVA_LIBRARY_SYNC_INTERVAL_SECONDS, canvaFolderDatasetErrors, canvaFolderSnapshotSchema, canvaLibraryPreviewGeometry, parseCanvaFolderId, type CanvaLibraryItem, type CanvaTemplateLibraryState } from '../../shared/canvaTemplateLibrary';
import { canvaConfigured, canvaConnected } from './canva';
import { canvaInputHash } from './canvaEditorialAssets';
import { downloadCanvaLibraryExport } from './canvaLibraryAssets';
import { tryBackgroundImageWork } from './readingCardRaster';
import { HttpError } from '../routes/util';
import * as rest from './canvaRest';

export const CANVA_LIBRARY_SETTING='canva_template_library';
const configSchema=z.object({
  folderId:z.string().default(CANVA_LIBRARY_DEFAULT_FOLDER_ID),folderName:z.string().nullable().default(null),enabled:z.boolean().default(true),
  principal:z.string().nullable().default(null),generation:z.number().int().nonnegative().default(0),authenticated:z.boolean().default(false),autofill:z.boolean().default(false),
  lastSyncedAt:z.string().nullable().default(null),nextSyncAt:z.number().default(0),
  status:z.enum(['not_configured','not_connected','needs_reconnect','syncing','ready','disabled','error']).default('not_connected'),
  errorCode:z.string().nullable().default(null),message:z.string().nullable().default(null),failures:z.number().default(0),
  leaseOwner:z.string().nullable().default(null),leaseUntil:z.number().default(0),
});
type Config=z.infer<typeof configSchema>;
type Design=typeof canvaLibraryDesigns.$inferSelect;
type PreviewJob=typeof canvaLibraryPreviewJobs.$inferSelect;
type Tx=Parameters<Parameters<DB['transaction']>[0]>[0];
const principalKey=(principal:rest.CanvaPrincipal)=>`${principal.teamId}:${principal.userId}`;
const configValue=(value:unknown):Config=>configSchema.parse(value??{});
async function ensureConfig(db:DB){await db.insert(appSettings).values({key:CANVA_LIBRARY_SETTING,value:configValue({})}).onConflictDoNothing();}
export async function getCanvaLibraryConfig(db:DB):Promise<Config>{
  const [row]=await db.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
  return configValue(row?.value);
}
function connectionStatus(config:Config):CanvaTemplateLibraryState['syncStatus']{
  if(!canvaConfigured())return 'not_configured';
  if(!canvaConnected())return 'not_connected';
  if(!config.enabled)return 'disabled';
  if(!config.authenticated&&config.nextSyncAt<=Date.now()&&['not_configured','not_connected','syncing'].includes(config.status))return 'syncing';
  return config.status;
}
const cachedUrl=(row:Design,page:number)=>`/api/canva/template-library/designs/${encodeURIComponent(row.sourceId)}/preview?page=${page}&v=${encodeURIComponent(row.previewVersion??'')}`;
export async function getCanvaTemplateLibrary(db:DB):Promise<CanvaTemplateLibraryState>{
  const config=await getCanvaLibraryConfig(db),configured=canvaConfigured(),connected=configured&&canvaConnected()&&config.authenticated;
  const visiblePrincipal=config.principal;
  const rows=visiblePrincipal?await db.select().from(canvaLibraryDesigns).where(and(eq(canvaLibraryDesigns.principal,visiblePrincipal),eq(canvaLibraryDesigns.folderId,config.folderId))).orderBy(desc(canvaLibraryDesigns.seenAt),asc(canvaLibraryDesigns.title)):[];
  // Cache existence comes from the committed export version, never an expiring provider URL.
  const previews=rows.length?await db.select({designId:canvaLibraryPreviews.designId,page:canvaLibraryPreviews.page}).from(canvaLibraryPreviews).where(inArray(canvaLibraryPreviews.designId,rows.map(row=>row.id))):[];
  const items:CanvaLibraryItem[]=rows.map(row=>{
    const hasPage=(page:number)=>previews.some(preview=>preview.designId===row.id&&preview.page===page);
    return {id:row.sourceId,key:`canva-library:${row.sourceId}`,designId:row.sourceId,title:row.title,sourceType:row.sourceType as CanvaLibraryItem['sourceType'],
      pageCount:row.pageCount,updatedAt:row.sourceUpdatedAt===null?null:Number(row.sourceUpdatedAt),syncedAt:row.syncedAt?.toISOString()??null,editUrl:row.editUrl,
      thumbnailUrl:hasPage(0)?cachedUrl(row,0):null,pages:row.pages.map((page,index)=>({pageNumber:page.pageNumber,width:page.width,height:page.height,previewUrl:hasPage(index)?cachedUrl(row,index):null})),
      status:row.status as CanvaLibraryItem['status'],reason:row.previewErrorMessage??row.reason??(row.status==='ready'&&row.previewVersion!==row.sourceUpdatedAt?'최신 Canva 원본의 미리보기를 준비 중입니다. 확인이 끝나면 원고를 채울 수 있습니다.':null),canCreate:connected&&config.enabled&&config.autofill&&row.status==='ready'&&row.metadataVersion===row.sourceUpdatedAt&&row.previewStatus==='ready'&&row.previewVersion===row.sourceUpdatedAt,
      previewStatus:row.previewStatus as CanvaLibraryItem['previewStatus']};
  });
  const status=connectionStatus(config);
  return {configured,connected,autofill:connected&&config.autofill,folderId:config.folderId,folderName:config.folderName,folderUrl:`https://www.canva.com/folder/${config.folderId}`,
    enabled:config.enabled,syncIntervalSeconds:CANVA_LIBRARY_SYNC_INTERVAL_SECONDS,lastSyncedAt:config.lastSyncedAt,syncStatus:status,
    errorCode:status==='not_configured'?'not_configured':status==='not_connected'?'not_connected':config.errorCode,
    message:status==='not_configured'?'설정에서 Canva 연결 키를 등록해 주세요.':status==='not_connected'?'Canva 계정을 연결하면 폴더의 디자인과 미리보기를 자동으로 확인합니다.':config.message,items};
}

export async function configureCanvaLibrary(db:DB,input:{folderId:string;enabled:boolean}){
  const folderId=parseCanvaFolderId(input.folderId);
  if(!folderId)throw new HttpError(400,'Canva 폴더 주소 또는 FA로 시작하는 폴더 ID를 입력해 주세요.');
  await ensureConfig(db);
  await db.transaction(async tx=>{
    const [row]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');
    const previous=configValue(row.value),changed=previous.folderId!==folderId;
    const next:Config={...previous,generation:previous.generation+1,folderId,enabled:input.enabled,folderName:changed?null:previous.folderName,lastSyncedAt:changed?null:previous.lastSyncedAt,
      authenticated:changed?false:previous.authenticated,status:input.enabled?'syncing':'disabled',nextSyncAt:0,leaseOwner:null,leaseUntil:0,errorCode:null,message:null};
    await tx.update(appSettings).set({value:next,updatedAt:new Date()}).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
  });
}

/** Changing credentials invalidates old readers before a newly authorized scan starts. */
export async function invalidateCanvaLibraryConnection(db:DB){
  await ensureConfig(db);
  await db.transaction(async tx=>{
    const [row]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');const config=configValue(row.value);
    await tx.update(appSettings).set({value:{...config,generation:config.generation+1,principal:null,authenticated:false,autofill:false,status:config.enabled?'syncing':'disabled',leaseOwner:null,leaseUntil:0,nextSyncAt:0,errorCode:null,message:null,failures:0},updatedAt:new Date()}).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
  });
}

/** Reconsent/manual refresh resumes checking, without replaying any uncertain export POST. */
export async function resetCanvaLibraryBackoff(db:DB){
  await ensureConfig(db);
  await db.transaction(async tx=>{
    const [row]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');
    const config=configValue(row.value);
    if(config.leaseOwner&&config.leaseUntil>Date.now())return;
    await tx.update(appSettings).set({value:{...config,nextSyncAt:0,failures:0,status:config.enabled?'syncing':'disabled'},updatedAt:new Date()}).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
    if(!config.enabled||!config.principal)return;
    const retryable=await tx.select({job:canvaLibraryPreviewJobs,design:canvaLibraryDesigns}).from(canvaLibraryPreviewJobs).innerJoin(canvaLibraryDesigns,eq(canvaLibraryDesigns.id,canvaLibraryPreviewJobs.designId))
      .where(and(eq(canvaLibraryDesigns.principal,config.principal),eq(canvaLibraryDesigns.folderId,config.folderId),sql`${canvaLibraryDesigns.sourceUpdatedAt} = ${canvaLibraryPreviewJobs.sourceVersion}`,inArray(canvaLibraryPreviewJobs.status,['failed','queued']))).for('update',{of:canvaLibraryPreviewJobs});
    for(const {job,design} of retryable){
      // Unknown POSTs are excluded. A terminal export needs explicit manual
      // refresh; its previous ID remains recorded before a replacement is sent.
      const terminal=job.status==='failed'&&job.exportJobId&&['export_failed','export_expired'].includes(job.errorCode??'');
      const knownRead=job.status==='failed'&&job.exportJobId&&['polling','download'].includes(job.phase);
      const unsent=job.status==='failed'&&job.phase==='prepare'&&!job.exportJobId;
      const consentRetry=job.status==='queued'&&['not_connected','auth_required','permission_denied','missing_scope','rate_limited','quota_exceeded','account_changed'].includes(job.errorCode??'');
      if(!terminal&&!knownRead&&!consentRetry&&!unsent||terminal&&job.previousExportJobIds.length>=20)continue;
      await tx.update(canvaLibraryPreviewJobs).set({status:'queued',phase:terminal?'prepare':knownRead?'polling':job.phase,
        ...(terminal?{exportJobId:null,previousExportJobIds:[...job.previousExportJobIds,job.exportJobId!]}:{}),nextRunAt:new Date(),leaseOwner:null,leaseUntil:null,errorCode:null,errorMessage:null,updatedAt:new Date()}).where(eq(canvaLibraryPreviewJobs.id,job.id));
      await tx.update(canvaLibraryDesigns).set({previewStatus:design.previewVersion?'stale':'pending',previewErrorCode:null,previewErrorMessage:null,updatedAt:new Date()}).where(eq(canvaLibraryDesigns.id,design.id));
    }
  });
}
async function finishSync(db:DB,config:Config,patch:Partial<Config>){
  await db.update(appSettings).set({value:{...config,...patch,leaseOwner:null,leaseUntil:0},updatedAt:new Date()})
    .where(and(eq(appSettings.key,CANVA_LIBRARY_SETTING),sql`${appSettings.value}->>'leaseOwner' = ${config.leaseOwner}`,sql`(${appSettings.value}->>'generation')::integer = ${config.generation}`));
}
async function fencedSync<T>(db:DB,config:Config,operation:(tx:Tx)=>Promise<T>):Promise<T>{
  return db.transaction(async tx=>{
    const [row]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');const current=configValue(row?.value);
    if(current.leaseOwner!==config.leaseOwner||current.generation!==config.generation||current.folderId!==config.folderId||!current.enabled||current.leaseUntil<=Date.now())
      throw new HttpError(409,'Canva 동기화 설정이 바뀌어 이전 조회를 중단했습니다.',{code:'sync_superseded'});
    await tx.update(appSettings).set({value:{...current,leaseUntil:Date.now()+180_000},updatedAt:new Date()}).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
    return operation(tx);
  });
}
export function canvaLibraryFailure(error:unknown,failures=0){
  const code=error instanceof rest.CanvaRestError?error.reason:error instanceof HttpError&&typeof error.extra?.code==='string'?error.extra.code:'sync_failed';
  const reconnect=['not_connected','auth_required','permission_denied','missing_scope','account_changed'].includes(code);
  const delay=reconnect?15*60_000:code==='quota_exceeded'?60*60_000:code==='rate_limited'?5*60_000:Math.min(15*60_000,30_000*2**Math.min(failures,5));
  return {code,reconnect,delay,message:error instanceof rest.CanvaRestError||error instanceof HttpError?error.message:'Canva 동기화 중 응답을 확인하지 못했습니다. 마지막 정상 미리보기와 선택지를 유지합니다.'};
}
async function claimSync(db:DB):Promise<Config|null>{
  await ensureConfig(db);
  return db.transaction(async tx=>{
    const [row]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');
    const config=configValue(row.value),now=Date.now();
    if(!config.enabled||config.nextSyncAt>now||config.leaseUntil>now)return null;
    const claimed={...config,status:'syncing' as const,leaseOwner:randomUUID(),leaseUntil:now+180_000};
    await tx.update(appSettings).set({value:claimed,updatedAt:new Date()}).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
    return claimed;
  });
}
const toStoredPages=(pages:rest.CanvaPageMetadata[]):CanvaLibraryStoredPage[]=>pages.map(({id,pageNumber,width,height})=>({id,pageNumber,width,height}));
export function canvaLibraryDesignStatus(pageCount:number|null,pages:CanvaLibraryStoredPage[],dataset:Record<string,{type:string}>):Pick<Design,'status'|'reason'>{
  if(pageCount!==8||pages.length!==8||pages.some((page,index)=>page.pageNumber!==index+1||page.width!==1080||page.height!==1350))
    return {status:'unsupported_pages',reason:'미리보기와 Canva 직접 편집을 사용할 수 있습니다. Studio 원고 자동 채우기는 1080×1350 크기의 8장 디자인을 지원합니다.'};
  if(pages.some(page=>!page.id))return {status:'unavailable',reason:'Canva가 고정 페이지 ID를 제공하지 않아 원본의 페이지 변경을 확인할 수 없습니다.'};
  const errors=canvaFolderDatasetErrors(dataset);
  return errors.length?{status:'needs_fields',reason:`Canva의 대량 만들기(Bulk Create)에서 표준 원고 필드를 연결해 주세요. ${errors.slice(0,3).join(', ')}${errors.length>3?` 외 ${errors.length-3}개`:''}`}:{status:'ready',reason:null};
}

/** One complete folder scan. Unseen designs are marked missing only after all pages succeed. */
export async function syncCanvaTemplateLibrary(db:DB){
  const config=await claimSync(db);if(!config)return false;
  if(!canvaConfigured()||!canvaConnected()){
    await finishSync(db,config,{authenticated:false,autofill:false,status:canvaConfigured()?'not_connected':'not_configured',nextSyncAt:Date.now()+15*60_000,errorCode:'not_connected',message:'Canva 계정을 연결하고 폴더 읽기 권한을 승인해 주세요.'});return false;
  }
  try{
    const [principal,capabilities,folder]=await Promise.all([rest.getCanvaPrincipal(db),rest.getCanvaCapabilities(db),rest.getCanvaFolder(db,config.folderId)]);
    const key=principalKey(principal),canAutofill=capabilities.capabilities.includes('autofill'),items:rest.CanvaFolderDesign[]=[],tokens=new Set<string>();
    let continuation:string|undefined;
    do{
      const page=await rest.listCanvaFolderDesigns(db,config.folderId,continuation);items.push(...page.items);
      await fencedSync(db,config,async()=>undefined);
      if(items.length>1000||page.continuation&&tokens.has(page.continuation))throw new HttpError(422,'폴더 조회 한도를 초과했거나 목록의 페이지가 반복되었습니다. 1,000개 이하의 템플릿 전용 폴더를 선택해 주세요.',{code:'folder_limit'});
      continuation=page.continuation??undefined;if(continuation)tokens.add(continuation);
    }while(continuation);
    if(new Set(items.map(item=>`${item.type}:${item.id}`)).size!==items.length)throw new HttpError(502,'Canva 폴더 목록에 중복 항목이 있어 삭제·추가 판단을 보류했습니다.',{code:'invalid_response'});
    const seenAt=new Date();let refreshed=0;
    for(const item of items){
      const version=item.updatedAt===null?null:String(item.updatedAt);
      const {row,changed}=await fencedSync(db,config,async tx=>{
        const [prior]=await tx.select().from(canvaLibraryDesigns).where(and(eq(canvaLibraryDesigns.principal,key),eq(canvaLibraryDesigns.sourceType,item.type),eq(canvaLibraryDesigns.sourceId,item.id)));
        const changed=!prior||prior.sourceUpdatedAt!==version||prior.status==='missing';
        const [row]=await tx.insert(canvaLibraryDesigns).values({principal:key,folderId:config.folderId,sourceType:item.type,sourceId:item.id,title:item.title,sourceUpdatedAt:version,editUrl:item.editUrl,pageCount:item.pageCount,seenAt})
          .onConflictDoUpdate({target:[canvaLibraryDesigns.principal,canvaLibraryDesigns.sourceType,canvaLibraryDesigns.sourceId],set:{folderId:config.folderId,title:item.title,sourceUpdatedAt:version,editUrl:item.editUrl??prior?.editUrl,seenAt,updatedAt:seenAt,...(changed?{status:'unavailable',reason:'변경된 Canva 원본의 페이지와 필드를 확인 중입니다.',previewStatus:prior?.previewVersion?'stale':'pending'}:{})}}).returning();
        return {row,changed};
      });
      if(item.type==='brand_template'){
        await fencedSync(db,config,async tx=>{await tx.update(canvaLibraryDesigns).set({status:'unsupported_pages',reason:'이 브랜드 템플릿을 Canva 디자인으로 복제해 같은 폴더에 저장하면 페이지 미리보기와 원고 자동 채우기를 검사합니다.',metadataVersion:version??'unversioned',syncedAt:seenAt,previewStatus:'unavailable'}).where(eq(canvaLibraryDesigns.id,row.id));});continue;
      }
      if(!changed&&canAutofill===config.autofill&&row.metadataVersion===(version??'unversioned')||refreshed>=20)continue;
      refreshed++;
      try{
        const [design,sourcePages]=await Promise.all([rest.getCanvaDesign(db,item.id),rest.getCanvaLibraryPages(db,item.id)]);
        const pages=toStoredPages(sourcePages);
        let dataset:Record<string,{type:string}>={},datasetUnavailable=false,datasetTransient=false;
        if(canAutofill&&design.pageCount===8){
          try{dataset=await rest.getCanvaDataset(db,{type:'design',id:item.id});}
          catch(error){
            const failure=canvaLibraryFailure(error);
            if(failure.reconnect||['rate_limited','quota_exceeded'].includes(failure.code))throw error;
            // A newly created, unlabeled design is still a valid preview source.
            datasetUnavailable=true;datasetTransient=!(error instanceof rest.CanvaRestError)||!['invalid_request','not_found','capability_missing'].includes(failure.code);
          }
        }
        const confirmed=await rest.getCanvaDesign(db,item.id);
        if(design.updatedAt!==confirmed.updatedAt||version!==null&&version!==String(confirmed.updatedAt))continue;
        const sourceVersion=design.updatedAt===null?null:String(design.updatedAt),status=sourceVersion===null?{status:'unavailable',reason:'Canva 원본의 수정 버전을 확인할 수 없어 자동 채우기를 준비하지 않았습니다.'}:canvaLibraryDesignStatus(design.pageCount,pages,dataset);
        const canPreview=sourceVersion!==null&&canvaLibraryPreviewGeometry(pages)!==null&&pages.every(page=>page.width!==null&&page.height!==null&&page.width*page.height<=40_000_000);
        await fencedSync(db,config,async tx=>{
          await tx.update(canvaLibraryDesigns).set({title:design.title??item.title,sourceUpdatedAt:sourceVersion,metadataVersion:datasetTransient?null:sourceVersion??'unversioned',editUrl:design.editUrl??item.editUrl,pageCount:design.pageCount,pages,dataset,datasetHash:canvaInputHash(dataset),...status,
          ...(datasetUnavailable&&sourceVersion!==null&&status.status==='needs_fields'?{status:datasetTransient?'unavailable':'needs_fields',reason:datasetTransient?'자동 채우기 필드를 확인하지 못해 다음 동기화에서 다시 확인합니다. 미리보기와 직접 편집은 사용할 수 있습니다.':'이 디자인의 자동 채우기 필드를 아직 읽을 수 없습니다. Canva에서 표준 원고 라벨을 연결한 뒤 원본을 저장해 주세요. 미리보기와 직접 편집은 사용할 수 있습니다.'}:{}),
          ...(!canAutofill&&status.status==='needs_fields'?{reason:'현재 Canva 계정·팀에서 자동 채우기를 사용할 수 없습니다. Canva 직접 편집과 미리보기 동기화는 사용할 수 있습니다.'}:{}),
          ...(!canPreview?{previewStatus:'unavailable',previewErrorMessage:'이 디자인의 페이지 크기 또는 수정 버전을 확인할 수 없습니다.'}:{}),syncedAt:seenAt,updatedAt:seenAt}).where(eq(canvaLibraryDesigns.id,row.id));
          if(canPreview)await tx.insert(canvaLibraryPreviewJobs).values({designId:row.id,sourceVersion:sourceVersion!,pages}).onConflictDoNothing();
        });
      }catch(error){
        const failure=canvaLibraryFailure(error);
        if(failure.reconnect||['rate_limited','quota_exceeded','sync_superseded'].includes(failure.code))throw error;
        await fencedSync(db,config,async tx=>{await tx.update(canvaLibraryDesigns).set({status:'unavailable',reason:failure.message,updatedAt:new Date()}).where(eq(canvaLibraryDesigns.id,row.id));});
      }
    }
    await fencedSync(db,config,async tx=>{await tx.update(canvaLibraryDesigns).set({status:'missing',reason:'선택한 Canva 폴더에서 제외되었거나 더 이상 접근할 수 없습니다. 이전 결과는 보존되어 있습니다.',updatedAt:new Date()})
      .where(and(eq(canvaLibraryDesigns.principal,key),eq(canvaLibraryDesigns.folderId,config.folderId),sql`${canvaLibraryDesigns.seenAt} < ${seenAt}`));});
    await finishSync(db,config,{principal:key,authenticated:true,autofill:canAutofill,folderName:folder.name,status:'ready',lastSyncedAt:new Date().toISOString(),nextSyncAt:Date.now()+CANVA_LIBRARY_SYNC_INTERVAL_SECONDS*1000,errorCode:null,message:canAutofill?null:'현재 연결한 계정에는 원고 자동 채우기 기능이 없습니다. 미리보기 동기화와 Canva 직접 편집은 사용할 수 있습니다.',failures:0});
    return true;
  }catch(error){
    const failure=canvaLibraryFailure(error,config.failures);
    await finishSync(db,config,{authenticated:failure.reconnect?false:config.authenticated,status:failure.reconnect?'needs_reconnect':'error',errorCode:failure.code,message:failure.message,failures:config.failures+1,nextSyncAt:Date.now()+failure.delay});return false;
  }
}

export async function getCanvaLibraryPreview(db:DB,sourceId:string,page:number){
  const config=await getCanvaLibraryConfig(db);
  const principal=config.principal;if(!principal)return null;
  const [row]=await db.select({preview:canvaLibraryPreviews}).from(canvaLibraryPreviews).innerJoin(canvaLibraryDesigns,eq(canvaLibraryDesigns.id,canvaLibraryPreviews.designId))
    .where(and(eq(canvaLibraryDesigns.principal,principal),eq(canvaLibraryDesigns.folderId,config.folderId),eq(canvaLibraryDesigns.sourceId,sourceId),eq(canvaLibraryPreviews.page,page)));
  return row?.preview??null;
}

/** Validate live metadata on explicit creation; this never generates or modifies a Canva design. */
export async function checkedCanvaLibrarySelection(db:DB,designId:string,expectedUpdatedAt?:number){
  const config=await getCanvaLibraryConfig(db);
  if(!config.enabled||!config.authenticated||!config.principal||!canvaConnected())throw new HttpError(422,'Canva 폴더 연결을 먼저 확인하고 다시 선택해 주세요.',{code:'not_connected'});
  const [row]=await db.select().from(canvaLibraryDesigns).where(and(eq(canvaLibraryDesigns.principal,config.principal),eq(canvaLibraryDesigns.folderId,config.folderId),eq(canvaLibraryDesigns.sourceType,'design'),eq(canvaLibraryDesigns.sourceId,designId)));
  if(!row||row.status!=='ready')throw new HttpError(422,'선택한 Canva 원본의 8장 페이지와 원고 필드가 준비되지 않았습니다.',{code:'library_not_ready'});
  if(row.previewStatus!=='ready'||row.previewVersion!==row.sourceUpdatedAt)throw new HttpError(409,'최신 Canva 원본의 미리보기를 먼저 확인해 주세요. 동기화가 끝나면 다시 선택할 수 있습니다.',{code:'library_preview_pending'});
  const [principal,capabilities,design,pages,dataset]=await Promise.all([rest.getCanvaPrincipal(db),rest.getCanvaCapabilities(db),rest.getCanvaDesign(db,designId),rest.getCanvaPages(db,designId),rest.getCanvaDataset(db,{type:'design',id:designId})]);
  if(principalKey(principal)!==config.principal)throw new HttpError(409,'Canva 계정·팀이 바뀌었습니다. 폴더를 다시 동기화해 주세요.',{code:'account_changed'});
  if(!capabilities.capabilities.includes('autofill'))throw new HttpError(422,'현재 Canva 계정·팀에서 원고 자동 채우기를 사용할 수 없습니다.',{code:'capability_missing'});
  const confirmed=await rest.getCanvaDesign(db,designId);
  const currentConfig=await getCanvaLibraryConfig(db);
  if(currentConfig.generation!==config.generation||currentConfig.principal!==config.principal||!currentConfig.authenticated)throw new HttpError(409,'Canva 연결 또는 폴더가 변경됐습니다. 최신 동기화 상태에서 다시 선택해 주세요.',{code:'account_changed'});
  if(design.updatedAt===null||design.updatedAt!==confirmed.updatedAt||String(design.updatedAt)!==row.sourceUpdatedAt||expectedUpdatedAt!==undefined&&expectedUpdatedAt!==design.updatedAt)
    throw new HttpError(409,'Canva 원본이 변경됐습니다. 지금 동기화한 뒤 최신 미리보기를 확인하고 다시 선택해 주세요.',{code:'library_source_changed'});
  const status=canvaLibraryDesignStatus(design.pageCount,toStoredPages(pages.items),dataset);
  if(status.status!=='ready'||canvaInputHash(dataset)!==row.datasetHash||canvaInputHash(pages.items.map(page=>page.id))!==canvaInputHash(row.pages.map(page=>page.id)))
    throw new HttpError(409,'Canva 원본의 페이지·필드가 변경됐습니다. 폴더를 다시 동기화해 주세요.',{code:'library_source_changed'});
  const snapshot=canvaFolderSnapshotSchema.parse({designId,sourceUpdatedAt:String(design.updatedAt),datasetHash:canvaInputHash(dataset),pageIds:pages.items.map(page=>page.id),title:design.title??row.title,imagePolicy:'preserve_canva'});
  return {row,principal:config.principal,dataset,snapshot,editUrl:design.editUrl};
}

async function savePreviewStep(db:DB,job:PreviewJob,patch:Partial<typeof canvaLibraryPreviewJobs.$inferInsert>,delay=0){
  const [saved]=await db.update(canvaLibraryPreviewJobs).set({status:'queued',leaseOwner:null,leaseUntil:null,nextRunAt:new Date(Date.now()+delay),updatedAt:new Date(),...patch})
    .where(and(eq(canvaLibraryPreviewJobs.id,job.id),eq(canvaLibraryPreviewJobs.leaseOwner,job.leaseOwner!),eq(canvaLibraryPreviewJobs.status,'running'))).returning();
  if(!saved)throw new HttpError(409,'미리보기 작업을 다른 처리기가 인계했습니다.',{code:'lease_lost'});
}
async function persistPreviewExport(db:DB,job:PreviewJob,id:string){
  // A late response can settle the same immutable dispatch after a process restart.
  await db.update(canvaLibraryPreviewJobs).set({exportJobId:id,status:'queued',phase:'polling',leaseOwner:null,leaseUntil:null,nextRunAt:new Date(Date.now()+5000),errorCode:null,errorMessage:null,updatedAt:new Date()})
    .where(and(eq(canvaLibraryPreviewJobs.id,job.id),eq(canvaLibraryPreviewJobs.phase,'submitting'),or(eq(canvaLibraryPreviewJobs.leaseOwner,job.leaseOwner!),eq(canvaLibraryPreviewJobs.status,'result_unknown'))));
}
async function previewStep(db:DB,job:PreviewJob,config:Config){
  const [design]=await db.select().from(canvaLibraryDesigns).where(eq(canvaLibraryDesigns.id,job.designId));
  if(!design||design.principal!==config.principal||design.folderId!==config.folderId||design.status==='missing'||design.sourceUpdatedAt!==job.sourceVersion)
    return savePreviewStep(db,job,{status:'superseded'});
  if(job.phase==='prepare'){
    const [principal,source]=await Promise.all([rest.getCanvaPrincipal(db),rest.getCanvaDesign(db,design.sourceId)]);
    if(principalKey(principal)!==design.principal)throw new HttpError(409,'Canva 계정·팀이 바뀌었습니다. 다시 연결한 뒤 동기화해 주세요.',{code:'account_changed'});
    if(String(source.updatedAt)!==job.sourceVersion)return savePreviewStep(db,job,{status:'superseded'});
    const claimed=await db.transaction(async tx=>{
      const [setting]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');const current=configValue(setting?.value);
      if(current.generation!==config.generation||current.principal!==config.principal||current.folderId!==config.folderId||!current.enabled||!current.authenticated)throw new HttpError(409,'Canva 연결·폴더가 변경되어 이전 미리보기 조회를 중단했습니다.',{code:'sync_superseded'});
      const [row]=await tx.update(canvaLibraryPreviewJobs).set({phase:'submitting',attempts:job.attempts+1,updatedAt:new Date()}).where(and(eq(canvaLibraryPreviewJobs.id,job.id),eq(canvaLibraryPreviewJobs.leaseOwner,job.leaseOwner!),eq(canvaLibraryPreviewJobs.status,'running'))).returning();return row;
    });
    if(!claimed)throw new HttpError(409,'미리보기 작업을 다른 처리기가 인계했습니다.',{code:'lease_lost'});
    job.phase='submitting';
    const output=await rest.submitCanvaLibraryExport(db,design.sourceId,job.pages);
    await persistPreviewExport(db,job,output.id);return;
  }
  if(!job.exportJobId)throw new HttpError(409,'미리보기 내보내기의 접수 결과가 미확정입니다. 중복 요청하지 않았습니다.',{code:'result_unknown'});
  const output=await rest.getCanvaLibraryExportJob(db,job.exportJobId);
  if(output.status==='failed')throw new HttpError(422,'Canva 미리보기 내보내기가 실패했습니다. 프리미엄 요소와 디자인 접근 권한을 확인해 주세요.',{code:'export_failed'});
  if(output.status==='in_progress')return savePreviewStep(db,job,{},5000);
  if(job.phase==='polling')return savePreviewStep(db,job,{phase:'download'});
  if(job.phase!=='download')throw new HttpError(409,'미리보기의 저장된 작업 단계를 확인할 수 없습니다.',{code:'result_unknown'});
  const prepared=await tryBackgroundImageWork(()=>downloadCanvaLibraryExport(output.result!.urls,job.pages));
  if(!prepared.accepted)return savePreviewStep(db,job,{},5000);
  const images=prepared.value,source=await rest.getCanvaDesign(db,design.sourceId);
  if(String(source.updatedAt)!==job.sourceVersion)return savePreviewStep(db,job,{status:'superseded'});
  await db.transaction(async tx=>{
    const [setting]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');const activeConfig=configValue(setting?.value);
    if(activeConfig.generation!==config.generation||activeConfig.principal!==config.principal||activeConfig.folderId!==config.folderId||!activeConfig.enabled||!activeConfig.authenticated)throw new HttpError(409,'Canva 연결·폴더가 변경되어 이전 미리보기 저장을 중단했습니다.',{code:'sync_superseded'});
    const [locked]=await tx.select().from(canvaLibraryPreviewJobs).where(eq(canvaLibraryPreviewJobs.id,job.id)).for('update');
    const [current]=await tx.select().from(canvaLibraryDesigns).where(eq(canvaLibraryDesigns.id,design.id)).for('update');
    if(locked.status!=='running'||locked.leaseOwner!==job.leaseOwner)throw new HttpError(409,'미리보기 작업을 다른 처리기가 인계했습니다.',{code:'lease_lost'});
    if(current.sourceUpdatedAt!==job.sourceVersion){await tx.update(canvaLibraryPreviewJobs).set({status:'superseded',leaseOwner:null,leaseUntil:null,updatedAt:new Date()}).where(eq(canvaLibraryPreviewJobs.id,job.id));return;}
    for(const image of images)await tx.insert(canvaLibraryPreviews).values({...image,designId:design.id,sourceVersion:job.sourceVersion}).onConflictDoUpdate({target:[canvaLibraryPreviews.designId,canvaLibraryPreviews.page],set:{...image,sourceVersion:job.sourceVersion,updatedAt:new Date()}});
    await tx.delete(canvaLibraryPreviews).where(and(eq(canvaLibraryPreviews.designId,design.id),notInArray(canvaLibraryPreviews.page,images.map(image=>image.page))));
    await tx.update(canvaLibraryDesigns).set({previewVersion:job.sourceVersion,previewStatus:'ready',previewUpdatedAt:new Date(),previewErrorCode:null,previewErrorMessage:null,updatedAt:new Date()}).where(eq(canvaLibraryDesigns.id,design.id));
    await tx.update(canvaLibraryPreviewJobs).set({status:'ready',phase:'complete',leaseOwner:null,leaseUntil:null,errorCode:null,errorMessage:null,updatedAt:new Date()}).where(eq(canvaLibraryPreviewJobs.id,job.id));
  });
}

/** At most one new export per five-second tick; DB claims survive restarts and multiple replicas. */
export async function runCanvaLibraryPreviewJobs(db:DB){
  const config=await getCanvaLibraryConfig(db);
  if(!config.enabled||!config.authenticated||!config.principal||!canvaConfigured()||!canvaConnected()||config.status==='needs_reconnect'||config.status==='error'&&config.nextSyncAt>Date.now())return;
  const job=await db.transaction(async tx=>{
    const [setting]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');const current=configValue(setting?.value);
    if(current.generation!==config.generation||current.principal!==config.principal||!current.enabled||!current.authenticated)return null;
    const expired=await tx.update(canvaLibraryPreviewJobs).set({status:'result_unknown',leaseOwner:null,leaseUntil:null,errorCode:'result_unknown',errorMessage:'미리보기 요청의 접수 결과가 미확정입니다. 같은 원본 버전에 중복 요청하지 않았습니다.',updatedAt:new Date()})
      .where(and(eq(canvaLibraryPreviewJobs.status,'running'),eq(canvaLibraryPreviewJobs.phase,'submitting'),isNull(canvaLibraryPreviewJobs.exportJobId),lte(canvaLibraryPreviewJobs.leaseUntil,new Date()))).returning();
    for(const old of expired)await tx.update(canvaLibraryDesigns).set({previewStatus:sql`case when ${canvaLibraryDesigns.previewVersion} is null then 'failed' else 'stale' end`,previewErrorCode:'result_unknown',previewErrorMessage:old.errorMessage,updatedAt:new Date()}).where(and(eq(canvaLibraryDesigns.id,old.designId),eq(canvaLibraryDesigns.sourceUpdatedAt,old.sourceVersion)));
    await tx.update(canvaLibraryPreviewJobs).set({status:'queued',leaseOwner:null,leaseUntil:null,updatedAt:new Date()})
      .where(and(eq(canvaLibraryPreviewJobs.status,'running'),sql`${canvaLibraryPreviewJobs.phase} <> 'submitting'`,lte(canvaLibraryPreviewJobs.leaseUntil,new Date())));
    const [row]=await tx.select({job:canvaLibraryPreviewJobs}).from(canvaLibraryPreviewJobs).innerJoin(canvaLibraryDesigns,eq(canvaLibraryDesigns.id,canvaLibraryPreviewJobs.designId))
      .where(and(eq(canvaLibraryPreviewJobs.status,'queued'),lte(canvaLibraryPreviewJobs.nextRunAt,new Date()),eq(canvaLibraryDesigns.principal,config.principal!),eq(canvaLibraryDesigns.folderId,config.folderId))).orderBy(asc(canvaLibraryPreviewJobs.nextRunAt),asc(canvaLibraryPreviewJobs.id)).limit(1).for('update',{of:canvaLibraryPreviewJobs,skipLocked:true});
    if(!row)return null;
    const [claimed]=await tx.update(canvaLibraryPreviewJobs).set({status:'running',leaseOwner:randomUUID(),leaseUntil:new Date(Date.now()+120_000),updatedAt:new Date()}).where(eq(canvaLibraryPreviewJobs.id,row.job.id)).returning();return claimed;
  });
  if(!job)return;
  try{await previewStep(db,job,config);}
  catch(error){
    if(error instanceof rest.CanvaRestError&&error.jobId&&job.phase==='submitting'){
      await persistPreviewExport(db,job,error.jobId);return;
    }
    const failure=canvaLibraryFailure(error,job.attempts),unknown=job.phase==='submitting'&&(!(error instanceof rest.CanvaRestError)||error.outcomeUnknown);
    const retry=!unknown&&(failure.reconnect||['rate_limited','quota_exceeded','provider_unavailable','result_unknown','sync_superseded','preview_download_retry'].includes(failure.code));
    await savePreviewStep(db,job,{status:unknown?'result_unknown':retry?'queued':'failed',phase:job.phase==='submitting'&&!unknown?'prepare':job.phase,errorCode:unknown?'result_unknown':failure.code,errorMessage:failure.message},failure.delay);
    await db.transaction(async tx=>{
      const [setting]=await tx.select().from(appSettings).where(eq(appSettings.key,CANVA_LIBRARY_SETTING)).for('update');const current=configValue(setting?.value);
      if(current.generation!==config.generation||current.principal!==config.principal||current.folderId!==config.folderId)return;
      const [row]=await tx.select().from(canvaLibraryDesigns).where(eq(canvaLibraryDesigns.id,job.designId));
      if(row?.sourceUpdatedAt===job.sourceVersion&&failure.code!=='sync_superseded')await tx.update(canvaLibraryDesigns).set({previewStatus:row.previewVersion?'stale':'failed',previewErrorCode:failure.code,previewErrorMessage:unknown?'미리보기 내보내기 접수 결과가 미확정입니다. 마지막 정상 이미지를 유지하며 같은 버전에 중복 요청하지 않습니다.':failure.message,updatedAt:new Date()}).where(eq(canvaLibraryDesigns.id,job.designId));
      if(failure.reconnect||['account_changed','rate_limited','quota_exceeded'].includes(failure.code)){
        await tx.update(appSettings).set({value:{...current,generation:current.generation+1,leaseOwner:null,leaseUntil:0,authenticated:failure.reconnect||failure.code==='account_changed'?false:current.authenticated,status:failure.reconnect||failure.code==='account_changed'?'needs_reconnect':'error',errorCode:failure.code,message:failure.message,nextSyncAt:Date.now()+failure.delay},updatedAt:new Date()}).where(eq(appSettings.key,CANVA_LIBRARY_SETTING));
      }
    });
  }
}
