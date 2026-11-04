import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { canvaAssetUploads, canvaMasters, canvaRenderJobs, contentItems, contentRevisions, mediaAssets } from '../../shared/schema';
import { familyCardCopySchema, evidenceBindingSchema, pageDesignsSchema, type CardCopyV2, type PageDesigns } from '../../shared/familyDialogue';
import { CANVA_MAPPING_VERSION, CANVA_PAGE_IDS, canvaTextFields, canvaVariant, validateCanvaDataset, type CanvaConceptMode, type CanvaJobDto, type CanvaMasterDto, type CanvaField } from '../../shared/canvaEditorial';
import { HttpError } from '../routes/util';
import { createRevision, invalidateApprovals } from '../content';
import { audit } from '../audit';
import { sha256 } from './text';
import { canvaInputHash, prepareCanvaImages, downloadCanvaExport, publicationJpegs, assertCanvaDesignSettings } from './canvaEditorialAssets';
import * as rest from './canvaRest';
import { ensureSourceWorkspace } from './sourceWorkspace';
import { canvaRecoveryToken } from './canvaReconciliation';
import { canvaReconciliations } from '../../shared/canvaReconciliation';
import { checkCanvaTextLimits } from '../../shared/canvaTextLimits';
import { familyMetadataFromPayload } from './familyEditorial';
import { assertFamilyEvidenceForCopy } from './familyEditorialPersistence';

type Job=typeof canvaRenderJobs.$inferSelect;
type Master=typeof canvaMasters.$inferSelect;
type Tx=Parameters<Parameters<DB['transaction']>[0]>[0];
type Input={payload:Record<string,unknown>;title:string;copy:CardCopyV2;pageDesigns:PageDesigns;evidenceSetId:string;mappingVersion:string;datasetHash:string};
class CanvaAssetPersistenceError extends rest.CanvaRestError {
  constructor(public uploadRowId:number,public imageHash:string,providerJobId:string){super('Canva 이미지 작업 ID를 저장하는 중 연결이 끊겼습니다. 같은 요청을 다시 보내지 않았습니다.',undefined,'result_unknown',true,providerJobId);}
}
const active=['queued','running'];
const submitting=['autofill_submitting','export_submitting'];
const principalKey=(p:rest.CanvaPrincipal)=>`${p.teamId}:${p.userId}`;
const asInput=(job:Job)=>job.input as unknown as Input;
function assertCanvaTextFits(copy:CardCopyV2,master:Master,purpose:'create'|'import'|'autofill') {
  const fit=checkCanvaTextLimits(copy,{sourceId:master.sourceId,templateVersion:master.templateVersion,purpose});
  if(!fit.ok)throw new HttpError(422,`문구는 저장되어 있습니다. Canva로 만들기 전에 다음 칸을 줄이거나 줄바꿈을 정리해 주세요. ${fit.issues.slice(0,3).map(issue=>issue.message).join(' ')}`,{code:'canva_text_overflow',details:fit.issues});
}
export const canvaMasterDto=(m:Master):CanvaMasterDto=>({id:m.id,conceptMode:m.conceptMode,hasExternalActivity:m.hasExternalActivity,templateVersion:m.templateVersion,sourceType:m.sourceType,sourceId:m.sourceId,status:m.status,editUrl:m.editUrl,validatedAt:m.validatedAt.toISOString()});
export function canvaJobDto(job:Job):CanvaJobDto {
  const result=job.result;
  const reconciliations=canvaReconciliations(result);
  return {id:job.id,requestId:job.requestId,purpose:job.purpose,status:job.status,phase:job.phase,sourceRevisionId:job.sourceRevisionId,sourceVersion:job.sourceVersion,designId:job.designId,editUrl:job.editUrl,exportJobId:job.exportJobId,outputAssetId:job.outputAssetId,outputRevisionId:job.outputRevisionId,errorCode:job.errorCode,errorMessage:job.errorMessage,createdAt:job.createdAt.toISOString(),recoveryToken:canvaRecoveryToken(job),result:result?{pages:result.pages,originals:result.originals,templateVersion:result.templateVersion,datasetHash:result.datasetHash,mappingVersion:result.mappingVersion,exportedAt:result.exportedAt,contentRevision:result.contentRevision,evidenceSetId:result.evidenceSetId,...(reconciliations.length?{reconciled:true,reconciliation:reconciliations[0],reconciliationHistory:reconciliations.slice(1)}:{}),...(result.reuseReason==='caption_only'?{reusedFromJobId:result.reusedFromJobId,reuseReason:result.reuseReason,reusedAt:result.reusedAt}:{})}:null};
}

export async function registerCanvaMaster(db:DB,a:{channelId:number;sourceId:string;conceptMode:CanvaConceptMode;hasExternalActivity:boolean;templateVersion:string;actor:string}) {
  const [capabilities,principal,design,pages,dataset]=await Promise.all([
    rest.getCanvaCapabilities(db),rest.getCanvaPrincipal(db),rest.getCanvaDesign(db,a.sourceId),rest.getCanvaPages(db,a.sourceId),rest.getCanvaDataset(db,{type:'design',id:a.sourceId}),
  ]);
  if(!capabilities.capabilities.includes('autofill')) throw new HttpError(422,'현재 Canva 계정에서 자동 채우기를 사용할 수 없습니다. 연결한 계정·팀의 기능을 확인해 주세요.');
  if(design.pageCount!==8 || !pages.validEightPageMaster) throw new HttpError(422,'등록할 마스터는 정확히 1080×1350 크기의 8장이어야 합니다.');
  if(design.updatedAt===null)throw new HttpError(422,'Canva 마스터의 수정 시각을 확인할 수 없습니다. 원본 버전을 확인한 뒤 등록해 주세요.',{code:'master_version_unavailable'});
  if(pages.items.some(p=>!p.id)) throw new HttpError(422,'Canva가 이 디자인의 고정 페이지 ID를 제공하지 않아 페이지 변경을 확인할 수 없습니다. 페이지 ID를 제공하는 새 디자인으로 마스터를 등록해 주세요.',{code:'page_identity_unavailable'});
  const errors=validateCanvaDataset(dataset,a);
  if(errors.length) throw new HttpError(422,'Canva 마스터의 자동 채우기 필드가 준비되지 않았습니다.',{code:'dataset_mismatch',details:errors});
  const result=await db.insert(canvaMasters).values({channelId:a.channelId,sourceId:a.sourceId,sourceUpdatedAt:String(design.updatedAt),sourceType:'design',conceptMode:a.conceptMode,hasExternalActivity:a.hasExternalActivity,templateVersion:a.templateVersion,principal:principalKey(principal),dataset,datasetHash:canvaInputHash(dataset),pageIds:pages.items.map(p=>p.id!),editUrl:design.editUrl,validatedAt:new Date()}).onConflictDoNothing().returning();
  if(!result.length) throw new HttpError(409,'이 변형의 같은 템플릿 버전이 이미 등록되어 있습니다. 새 버전 이름으로 등록해 주세요.');
  await audit(db,{actor:a.actor,action:'canva_master_register',entity:'canva_master',entityId:result[0].id,channelId:a.channelId,detail:{sourceId:a.sourceId,templateVersion:a.templateVersion,datasetHash:result[0].datasetHash}});
  return result[0];
}

export async function enqueueCanvaRender(db:DB,a:{channelId:number;itemId:number;version:number;requestId:string;masterId?:number;importFromJobId?:number;actor:string}) {
  const purpose=a.importFromJobId?'import':'create';
  const requestHash=canvaInputHash({channelId:a.channelId,itemId:a.itemId,version:a.version,masterId:a.masterId ?? null,importFromJobId:a.importFromJobId ?? null});
  return db.transaction(async tx=>{
    const [item]=await tx.select().from(contentItems).where(and(eq(contentItems.id,a.itemId),eq(contentItems.channelId,a.channelId))).for('update');
    if(!item) throw new HttpError(404,'콘텐츠를 찾을 수 없습니다.');
    const [existing]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.channelId,a.channelId),eq(canvaRenderJobs.requestId,a.requestId)));
    if(existing){if(existing.requestHash!==requestHash) throw new HttpError(409,'같은 요청 ID로 다른 Canva 작업을 요청할 수 없습니다.');return existing;}
    const [unknown]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId,item.id),eq(canvaRenderJobs.status,'result_unknown'))).limit(1);
    if(unknown) throw new HttpError(409,'이 콘텐츠의 이전 Canva 요청 결과가 미확정입니다. 원고 버전이나 요청 ID를 바꿔도 새 디자인을 중복 요청하지 않습니다. 이전 작업부터 확인해 주세요.',{code:'result_unknown',jobId:unknown.id});
    if(item.version!==a.version || !item.currentRevisionId) throw new HttpError(409,'원고가 다른 곳에서 변경되었습니다. 최신 저장본을 확인해 주세요.');
    const [revision]=await tx.select().from(contentRevisions).where(eq(contentRevisions.id,item.currentRevisionId));
    const payload=revision.payload;
    const parsed=familyCardCopySchema.safeParse(payload.cardCopy),designs=pageDesignsSchema.safeParse(payload.pageDesigns),evidence=evidenceBindingSchema.safeParse(payload.evidenceBinding);
    if(!parsed.success || !designs.success || !evidence.success) throw new HttpError(422,'새 8장 원고와 근거·이미지 설정을 저장한 뒤 Canva로 만들어 주세요.');
    const metadata=familyMetadataFromPayload(payload);
    if(!metadata)throw new HttpError(422,'현재 원고의 편집 기획과 근거 기록을 먼저 확인해 주세요.');
    // Do not spend an external upload/autofill/export request on an unbound or
    // foreign evidence set. Final approval repeats this check for its revision.
    await assertFamilyEvidenceForCopy(tx as DB,item,parsed.data,metadata);
    const variant=canvaVariant(parsed.data);
    if(purpose==='create'&&parsed.data.pages.find(p=>p.id==='perspectives')!.layout==='columns') throw new HttpError(422,'등록된 Canva 마스터는 두 시선의 상하 배치입니다. 상하 배치를 선택하거나 자체 이미지로 만들어 주세요.');
    const [prior]=a.importFromJobId?await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.id,a.importFromJobId),eq(canvaRenderJobs.contentItemId,item.id),eq(canvaRenderJobs.channelId,a.channelId))):[];
    if(a.importFromJobId && !prior?.designId) throw new HttpError(404,'이 콘텐츠의 Canva 디자인을 찾을 수 없습니다.');
    // Import keeps the existing copy's provenance. A later master change, or a
    // different current authoring layout, must not prevent comparing that copy.
    const [master]=prior
      ?await tx.select().from(canvaMasters).where(and(eq(canvaMasters.channelId,a.channelId),eq(canvaMasters.id,prior.masterId))).limit(1)
      :await tx.select().from(canvaMasters).where(and(eq(canvaMasters.channelId,a.channelId),eq(canvaMasters.status,'ready'),eq(canvaMasters.conceptMode,variant.conceptMode),eq(canvaMasters.hasExternalActivity,variant.hasExternalActivity),...(a.masterId?[eq(canvaMasters.id,a.masterId)]:[]))).orderBy(desc(canvaMasters.id)).limit(1);
    if(!master) throw new HttpError(purpose==='import'?404:422,purpose==='import'?'이 콘텐츠의 기존 Canva 마스터 기록을 찾을 수 없습니다.':'이 개념·활동 구조에 맞는 Canva 마스터를 먼저 등록해 주세요.');
    assertCanvaTextFits(parsed.data,master,purpose);
    if(purpose==='create')assertCanvaDesignSettings(designs.data);
    const [pending]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId,item.id),inArray(canvaRenderJobs.status,active))).limit(1);
    if(pending){if(pending.sourceVersion===a.version&&pending.masterId===master.id&&pending.purpose===purpose&&(purpose==='create'||pending.designId===prior?.designId))return pending;throw new HttpError(409,'진행 중인 Canva 작업을 먼저 확인하거나 대기를 취소해 주세요.');}
    const input:Input={payload,title:item.title,copy:parsed.data,pageDesigns:designs.data,evidenceSetId:evidence.data.evidenceSetId,mappingVersion:CANVA_MAPPING_VERSION,datasetHash:master.datasetHash};
    const [job]=await tx.insert(canvaRenderJobs).values({channelId:a.channelId,contentItemId:item.id,sourceRevisionId:revision.id,sourceVersion:item.version,masterId:master.id,requestId:a.requestId,requestHash,purpose,principal:prior?.principal??master.principal,input:input as unknown as Record<string,unknown>,designId:prior?.designId ?? null}).returning();
    await audit(tx as DB,{actor:a.actor,action:'canva_render_requested',entity:'canva_render',entityId:job.id,channelId:a.channelId,detail:{purpose,sourceRevisionId:revision.id,masterId:master.id}});
    return job;
  });
}

async function checkedPrincipal(db:DB,job:Job){if(principalKey(await rest.getCanvaPrincipal(db))!==job.principal)throw new HttpError(409,'작업을 시작한 Canva 계정·팀과 현재 연결이 다릅니다. 원래 계정으로 다시 연결해 주세요.',{code:'account_changed'});}
async function saveStep(db:DB,job:Job,patch:Partial<typeof canvaRenderJobs.$inferInsert>,delayMs=0){
  const [saved]=await db.update(canvaRenderJobs).set({status:'queued',leaseOwner:null,leaseUntil:null,nextRunAt:new Date(Date.now()+delayMs),updatedAt:new Date(),...patch}).where(and(eq(canvaRenderJobs.id,job.id),eq(canvaRenderJobs.leaseOwner,job.leaseOwner!),eq(canvaRenderJobs.status,'running'))).returning();
  if(!saved) throw new HttpError(409,'이 작업의 대기를 중단했거나 다른 처리기가 인계했습니다.');
  return saved;
}
async function markSubmitting(db:DB,job:Job,phase:string){
  const [saved]=await db.update(canvaRenderJobs).set({phase,updatedAt:new Date()}).where(and(eq(canvaRenderJobs.id,job.id),eq(canvaRenderJobs.leaseOwner,job.leaseOwner!),eq(canvaRenderJobs.status,'running'))).returning();
  if(!saved) throw new HttpError(409,'Canva 작업 대기를 중단했습니다.');
  job.phase=phase;
}
async function persistProviderId(db:DB,job:Job,kind:'autofill'|'export',id:string){
  // A late response after a restart can still settle this exact immutable request.
  await db.update(canvaRenderJobs).set({[kind==='autofill'?'autofillJobId':'exportJobId']:id,phase:`${kind}_polling`,status:'queued',leaseOwner:null,leaseUntil:null,nextRunAt:new Date(Date.now()+2000),errorCode:null,errorMessage:null,updatedAt:new Date()}).where(and(eq(canvaRenderJobs.id,job.id),eq(canvaRenderJobs.phase,`${kind}_submitting`),or(eq(canvaRenderJobs.leaseOwner,job.leaseOwner!),eq(canvaRenderJobs.status,'result_unknown'))));
}

async function uploadOne(db:DB,job:Job,image:{hash:string;bytes:Buffer;field:string}) {
  await db.insert(canvaAssetUploads).values({principal:job.principal,sha256:image.hash}).onConflictDoNothing();
  let [cached]=await db.select().from(canvaAssetUploads).where(and(eq(canvaAssetUploads.principal,job.principal),eq(canvaAssetUploads.sha256,image.hash)));
  if(cached.assetId && cached.status==='ready') return cached.assetId;
  if(cached.uploadJobId){
    const result=await rest.getCanvaAssetUploadJob(db,cached.uploadJobId);
    if(result.status==='failed'){await db.update(canvaAssetUploads).set({status:'failed',errorCode:result.errorCode??'job_failed',updatedAt:new Date()}).where(eq(canvaAssetUploads.id,cached.id));throw new HttpError(422,'Canva 이미지 업로드가 실패했습니다. 원본 이미지는 유지했습니다.',{code:'asset_failed'});}
    if(result.status==='success'&&result.result){await db.update(canvaAssetUploads).set({status:'ready',assetId:result.result.assetId,updatedAt:new Date()}).where(eq(canvaAssetUploads.id,cached.id));return result.result.assetId;}
    return null;
  }
  if(cached.status==='unknown') throw new HttpError(422,'이미지 업로드 결과를 확인해야 합니다. 같은 파일을 자동으로 다시 올리지 않았습니다.',{code:'asset_result_unknown'});
  if(cached.status==='failed') throw new HttpError(422,'이미지 업로드가 거절되었습니다. 연결·권한·파일을 확인한 뒤 작업 재개를 선택해 주세요.',{code:'asset_failed'});
  if(cached.status==='submitting'){
    if(Date.now()-cached.updatedAt.getTime()>120_000) await db.update(canvaAssetUploads).set({status:'unknown',errorCode:'result_unknown',updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,cached.id),isNull(canvaAssetUploads.uploadJobId),eq(canvaAssetUploads.status,'submitting')));
    return null;
  }
  await checkedPrincipal(db,job);
  const [claim]=await db.update(canvaAssetUploads).set({status:'submitting',updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,cached.id),eq(canvaAssetUploads.status,'queued'))).returning();
  if(!claim) return null;
  let submitted:rest.CanvaRestJob<rest.CanvaAssetResult>;
  try{
    submitted=await rest.submitCanvaAssetUpload(db,image.bytes,`${image.field}-${image.hash.slice(0,12)}`);
  }catch(error){
    const e=error as rest.CanvaRestError;
    if(e instanceof rest.CanvaRestError && e.jobId){
      try{await db.update(canvaAssetUploads).set({uploadJobId:e.jobId,status:'polling',errorCode:null,updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,cached.id),isNull(canvaAssetUploads.uploadJobId)));}
      catch{throw new CanvaAssetPersistenceError(cached.id,image.hash,e.jobId);}
      return null; // Recover this ID with GET; never POST it again.
    }
    const unknown=!(e instanceof rest.CanvaRestError)||e.outcomeUnknown;
    await db.update(canvaAssetUploads).set({status:unknown?'unknown':'failed',errorCode:e instanceof rest.CanvaRestError?e.code:'result_unknown',updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,cached.id),isNull(canvaAssetUploads.uploadJobId)));
    throw error;
  }
  // A database failure after acceptance must leave the dispatch marked submitting.
  // It must never be rewritten to a known failed upload that could be POSTed again.
  try{await db.update(canvaAssetUploads).set({uploadJobId:submitted.id,status:'polling',errorCode:null,updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,cached.id),isNull(canvaAssetUploads.uploadJobId)));}
  catch{throw new CanvaAssetPersistenceError(cached.id,image.hash,submitted.id);}
  return null;
}

/** One bounded state transition. No process-local promise is the durable source of truth. */
async function processCanvaStep(db:DB,job:Job){
  const input=asInput(job);
  if(job.phase==='validate'||job.phase==='export_prepare') {
    const metadata=familyMetadataFromPayload(input.payload);
    if(!metadata)throw new HttpError(422,'이 Canva 작업의 원고·근거 기록을 확인할 수 없습니다. 기존 결과는 보존했습니다.');
    await assertFamilyEvidenceForCopy(db,{id:job.contentItemId,channelId:job.channelId},input.copy,metadata);
  }
  const [master]=await db.select().from(canvaMasters).where(eq(canvaMasters.id,job.masterId));
  if(!master) throw new HttpError(404,'Canva 마스터 등록을 찾을 수 없습니다.');
  if(job.phase==='validate'){
    await checkedPrincipal(db,job);
    // An existing copy is independently editable. A later change or loss of
    // access to its master must not prevent reviewing/exporting that copy.
    if(job.purpose==='import'){
      const pages=await rest.getCanvaPages(db,job.designId!);
      if(!pages.validEightPageMaster)throw new HttpError(422,'Canva 디자인은 1080×1350 크기의 8장이어야 합니다.',{code:'page_mismatch'});
      return saveStep(db,job,{phase:'export_prepare'});
    }
    const capabilities=await rest.getCanvaCapabilities(db);
    if(!capabilities.capabilities.includes('autofill')&&job.purpose==='create')throw new HttpError(422,'현재 Canva 계정에서 자동 채우기를 사용할 수 없습니다.',{code:'capability_missing'});
    const dataset=await rest.getCanvaDataset(db,{type:master.sourceType as 'design'|'brand_template',id:master.sourceId});
    const errors=validateCanvaDataset(dataset,canvaVariant(input.copy));
    if(errors.length || canvaInputHash(dataset)!==input.datasetHash){await db.update(canvaMasters).set({status:'field_changed'}).where(eq(canvaMasters.id,master.id));throw new HttpError(409,'Canva 마스터의 필드가 변경됐습니다. 설정에서 새 버전을 검사·등록해 주세요.',{code:'dataset_changed'});}
    const [pages,design]=await Promise.all([rest.getCanvaPages(db,master.sourceId),rest.getCanvaDesign(db,master.sourceId)]);
    if(!pages.validEightPageMaster)throw new HttpError(422,'Canva 디자인은 1080×1350 크기의 8장이어야 합니다.',{code:'page_mismatch'});
    if(canvaInputHash(pages.items.map(p=>p.id))!==canvaInputHash(master.pageIds))throw new HttpError(409,'Canva 마스터의 페이지가 바뀌었습니다. 새 버전으로 등록해 주세요.',{code:'page_changed'});
    if(String(design.updatedAt)!==master.sourceUpdatedAt){await db.update(canvaMasters).set({status:'design_changed'}).where(eq(canvaMasters.id,master.id));throw new HttpError(409,'Canva 마스터의 글꼴·배치·내용이 등록 후 바뀌었습니다. 새 버전으로 검사·등록해 주세요.',{code:'master_changed'});}
    return saveStep(db,job,{phase:'images'});
  }
  if(job.phase==='images'){
    const images=await prepareCanvaImages(db,{itemId:job.contentItemId,channelId:job.channelId,copy:input.copy,pageDesigns:input.pageDesigns});
    const uploaded={...(job.result?.uploadedImages as Record<string,{assetId:string;hash:string}>??{})};
    const next=images.find(image=>uploaded[image.field]?.hash!==image.hash);
    if(!next) return saveStep(db,job,{phase:'autofill_prepare'});
    const assetId=await uploadOne(db,job,next);
    if(assetId)uploaded[next.field]={assetId,hash:next.hash};
    return saveStep(db,job,{result:{...job.result,uploadedImages:uploaded}},assetId?0:5000);
  }
  if(job.phase==='autofill_prepare'){
    await checkedPrincipal(db,job);
    const dataset=await rest.getCanvaDataset(db,{type:master.sourceType as 'design'|'brand_template',id:master.sourceId});
    if(canvaInputHash(dataset)!==input.datasetHash || validateCanvaDataset(dataset,canvaVariant(input.copy)).length)throw new HttpError(409,'자동 채우기 직전에 마스터 필드 변경을 감지했습니다. 기존 작업을 보존합니다.',{code:'dataset_changed'});
    const masterNow=await rest.getCanvaDesign(db,master.sourceId);
    if(String(masterNow.updatedAt)!==master.sourceUpdatedAt){await db.update(canvaMasters).set({status:'design_changed'}).where(eq(canvaMasters.id,master.id));throw new HttpError(409,'이미지를 준비하는 동안 Canva 마스터가 바뀌었습니다. 새 버전으로 검사·등록해 주세요.',{code:'master_changed'});}
    assertCanvaTextFits(input.copy,master,'autofill');
    const data:Record<string,CanvaField>={...canvaTextFields(input.copy)};
    for(const [field,value] of Object.entries(job.result?.uploadedImages as Record<string,{assetId:string}>??{})) data[field]={type:'image',asset_id:value.assetId};
    if(Object.keys(data).length!==Object.keys(validateExpected(input.copy)).length)throw new HttpError(422,'Canva로 보낼 이미지 필드가 아직 준비되지 않았습니다.');
    await markSubmitting(db,job,'autofill_submitting');
    const submitted=await rest.submitCanvaAutofill(db,{type:master.sourceType as 'design'|'brand_template',id:master.sourceId,title:`${input.title.slice(0,180)} · ${job.requestId.slice(0,8)}`,data});
    return persistProviderId(db,job,'autofill',submitted.id);
  }
  if(job.phase==='autofill_polling'){
    if(!job.autofillJobId)throw new HttpError(409,'자동 채우기 결과가 미확정입니다. 새 요청을 보내지 않았습니다.',{code:'result_unknown'});
    const result=await rest.getCanvaAutofillJob(db,job.autofillJobId);
    if(result.status==='failed')throw new HttpError(422,'Canva 자동 채우기가 실패했습니다. 문구와 이미지는 그대로 유지했습니다.',{code:result.errorCode??'autofill_failed'});
    if(result.status==='in_progress')return saveStep(db,job,{},5000);
    return saveStep(db,job,{designId:result.result!.designId,editUrl:result.result!.editUrl,phase:'export_prepare'});
  }
  if(job.phase==='export_prepare'){
    await checkedPrincipal(db,job);
    const [design,pages]=await Promise.all([rest.getCanvaDesign(db,job.designId!),rest.getCanvaPages(db,job.designId!)]);
    if(design.pageCount!==8||!pages.validEightPageMaster)throw new HttpError(422,'자동 채우기 결과가 정확한 8장 규격과 일치하지 않습니다.',{code:'page_mismatch'});
    if(design.updatedAt===null)throw new HttpError(422,'Canva 디자인의 수정 시각을 확인할 수 없어 출력 버전을 확정하지 않았습니다.');
    if(job.designUpdatedAt!==null && String(design.updatedAt)!==job.designUpdatedAt)throw new HttpError(409,'출력 이후 Canva 디자인이 수정되었습니다. 최신 디자인 가져오기에서 문구를 대조해 주세요.',{code:'design_changed'});
    await db.update(canvaRenderJobs).set({designUpdatedAt:String(design.updatedAt),editUrl:design.editUrl,updatedAt:new Date()}).where(and(eq(canvaRenderJobs.id,job.id),eq(canvaRenderJobs.leaseOwner,job.leaseOwner!)));
    await markSubmitting(db,job,'export_submitting');
    const submitted=await rest.submitCanvaExport(db,job.designId!);
    return persistProviderId(db,job,'export',submitted.id);
  }
  if(job.phase==='export_polling'){
    if(!job.exportJobId)throw new HttpError(409,'내보내기 결과가 미확정입니다. 자동 재요청하지 않았습니다.',{code:'result_unknown'});
    const result=await rest.getCanvaExportJob(db,job.exportJobId);
    if(result.status==='failed')throw new HttpError(422,'Canva 내보내기가 실패했습니다. 계정의 프리미엄 요소·권한을 확인해 주세요. 이전 이미지는 유지했습니다.',{code:result.errorCode??'export_failed'});
    if(result.status==='in_progress')return saveStep(db,job,{},5000);
    return saveStep(db,job,{phase:'download',result:{...job.result,downloadUrls:result.result!.urls}});
  }
  if(job.phase==='download'){
    // Confirm the existing job with GET. Expired results require an explicit re-export action.
    const output=await rest.getCanvaExportJob(db,job.exportJobId!);
    if(output.status!=='success'||!output.result)throw new HttpError(422,'Canva 출력 파일을 아직 가져올 수 없습니다. 저장된 내보내기 작업을 다시 확인해 주세요.');
    const pngs=await downloadCanvaExport(output.result.urls),jpegs=await publicationJpegs(pngs);
    const design=await rest.getCanvaDesign(db,job.designId!);
    if(String(design.updatedAt)!==job.designUpdatedAt)throw new HttpError(409,'내보내는 동안 Canva 디자인이 수정됐습니다. 이 출력을 확정하지 않았습니다. 최신 디자인 가져오기를 다시 선택해 주세요.',{code:'design_changed'});
    return saveCanvaOutput(db,job,master,pngs,jpegs);
  }
  throw new HttpError(409,'Canva 요청의 접수 결과를 확인해야 합니다. 자동으로 중복 실행하지 않았습니다.',{code:'result_unknown'});
}
import { expectedCanvaDataset as validateExpectedForVariant } from '../../shared/canvaEditorial';
const validateExpected=(copy:CardCopyV2)=>validateExpectedForVariant(canvaVariant(copy));

async function saveCanvaOutput(db:DB,job:Job,master:Master,pngs:Buffer[],jpegs:Buffer[]){
  return db.transaction(async tx=>{
    const [item]=await tx.select().from(contentItems).where(eq(contentItems.id,job.contentItemId)).for('update');
    const [lockedJob]=await tx.select().from(canvaRenderJobs).where(eq(canvaRenderJobs.id,job.id)).for('update');
    if(lockedJob.status!=='running'||lockedJob.leaseOwner!==job.leaseOwner)throw new HttpError(409,'중단된 작업의 출력은 현재 원고에 덮어쓰지 않았습니다.');
    const input=asInput(job),stale=item.version!==job.sourceVersion||item.currentRevisionId!==job.sourceRevisionId;
    const apply=!stale&&job.purpose==='create';
    const exportedAt=new Date().toISOString();
    const metadata={rendererProvider:'canva',canvaDesignId:job.designId,templateVersion:master.templateVersion,sourceDesignId:master.sourceId,dataFieldMappingVersion:input.mappingVersion,datasetHash:input.datasetHash,contentRevision:job.sourceRevisionId,evidenceSetId:input.evidenceSetId,requestHash:job.requestHash,autofillJobId:job.autofillJobId,exportJobId:job.exportJobId,designUpdatedAt:job.designUpdatedAt,exportedAt};
    const revision=await createRevision(tx,{contentItemId:item.id,author:'operator',payload:{...input.payload,rendererProvider:'canva',canvaExport:metadata},note:job.purpose==='import'?'Canva 최신 디자인 가져오기 · 문구 대조 필요':'Canva 8장 생성·출력 저장',makeCurrent:apply});
    const caption=input.payload.captionPackage as {contentRevision?:number}|null|undefined;
    if(caption?.contentRevision===job.sourceRevisionId)await tx.update(contentRevisions).set({payload:{...revision.payload,captionPackage:{...caption,contentRevision:revision.id}}}).where(eq(contentRevisions.id,revision.id));
    const pages:Array<{id:number;sha256:string;title:string;altText:string}>=[],originals:Array<{id:number;sha256:string;page:number}>=[];
    for(let i=0;i<8;i++){
      const page=input.copy.pages[i],title='title' in page.fields?page.fields.title:page.id==='cover'?page.fields.headline:page.id==='outro'?page.fields.brandName:page.id;
      const [png]=await tx.insert(mediaAssets).values({channelId:job.channelId,contentItemId:item.id,revisionId:revision.id,kind:'canva_export_original',source:'canva',templateKey:`canva:${job.designId}`,mime:'image/png',width:1080,height:1350,bytes:pngs[i],sha256:sha256(pngs[i])}).returning({id:mediaAssets.id,sha256:mediaAssets.sha256});
      const [jpeg]=await tx.insert(mediaAssets).values({channelId:job.channelId,contentItemId:item.id,revisionId:revision.id,kind:i===0?'card':'carousel_page',source:'canva',templateKey:`canva:${job.designId}`,mime:'image/jpeg',width:1080,height:1350,bytes:jpegs[i],sha256:sha256(jpegs[i])}).returning({id:mediaAssets.id,sha256:mediaAssets.sha256});
      originals.push({...png,page:i+1});pages.push({...jpeg,title,altText:`${i+1}장. ${title}`});
    }
    await tx.update(mediaAssets).set({carousel:{version:1,pages,copy:input.copy,cover:{kind:'upload',credit:'Canva에서 내보낸 8장 · 게시용 JPEG'},rendererProvider:'canva'} as typeof mediaAssets.$inferInsert.carousel}).where(eq(mediaAssets.id,pages[0].id));
    const result={pages,originals,templateVersion:master.templateVersion,datasetHash:input.datasetHash,mappingVersion:input.mappingVersion,exportedAt,contentRevision:job.sourceRevisionId,evidenceSetId:input.evidenceSetId,uploadedImages:job.result?.uploadedImages,previousExportJobIds:job.result?.previousExportJobIds,...(job.result?.reconciled?{reconciled:true,reconciliation:job.result.reconciliation,reconciliationHistory:job.result.reconciliationHistory,reconciledProviderIds:job.result.reconciledProviderIds}:{})};
    if(apply)await tx.update(contentItems).set({version:item.version+1,canvaDesign:{designId:job.designId!,editUrl:job.editUrl,viewUrl:null,revisionId:revision.id,createdAt:exportedAt},updatedAt:new Date()}).where(eq(contentItems.id,item.id));
    await tx.update(canvaRenderJobs).set({status:stale?'superseded':apply?'ready':'needs_review',phase:'complete',result,outputAssetId:pages[0].id,outputRevisionId:revision.id,leaseOwner:null,leaseUntil:null,errorCode:stale?'source_changed':null,errorMessage:stale?'완료 중 원고가 바뀌어 현재 저장본에 적용하지 않았습니다. Canva 출력은 별도로 보존했습니다.':null,updatedAt:new Date()}).where(eq(canvaRenderJobs.id,job.id));
    await audit(tx as DB,{actor:'canva-worker',action:'canva_export_saved',entity:'canva_render',entityId:job.id,channelId:job.channelId,detail:{revisionId:revision.id,applied:apply,originalHashes:originals.map(p=>p.sha256),publicationHashes:pages.map(p=>p.sha256)}});
  });
}

export async function acceptCanvaImport(db:DB,a:{channelId:number;itemId:number;jobId:number;version:number;textConfirmedUnchanged:true;actor:string}){
  return db.transaction(async tx=>{
    const [item]=await tx.select().from(contentItems).where(and(eq(contentItems.id,a.itemId),eq(contentItems.channelId,a.channelId))).for('update');
    const [job]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.id,a.jobId),eq(canvaRenderJobs.contentItemId,a.itemId),eq(canvaRenderJobs.channelId,a.channelId))).for('update');
    if(!item||!job||job.status!=='needs_review'||!job.outputRevisionId)throw new HttpError(409,'가져온 Canva 출력의 검수 상태를 다시 확인해 주세요.');
    if(item.version!==a.version||item.version!==job.sourceVersion||item.currentRevisionId!==job.sourceRevisionId)throw new HttpError(409,'대조하는 동안 원고가 바뀌었습니다. 새 저장본으로 다시 가져와 주세요.');
    await tx.update(contentItems).set({currentRevisionId:job.outputRevisionId,version:item.version+1,reviewStatus:'review_required',publishStatus:'waiting',canvaDesign:{designId:job.designId!,editUrl:job.editUrl,viewUrl:null,revisionId:job.outputRevisionId,createdAt:new Date().toISOString()},updatedAt:new Date()}).where(eq(contentItems.id,item.id));
    await invalidateApprovals(tx,item.id,'Canva 편집 결과 가져옴 — 문구·이미지 재검토 필요');
    await ensureSourceWorkspace(tx,item.id);
    await tx.update(canvaRenderJobs).set({status:'ready',updatedAt:new Date()}).where(eq(canvaRenderJobs.id,job.id));
    await audit(tx as DB,{actor:a.actor,action:'canva_import_confirmed',entity:'canva_render',entityId:job.id,channelId:a.channelId,detail:{textComparedByOperator:true,revisionId:job.outputRevisionId}});
  });
}

export async function cancelCanvaJob(db:DB,channelId:number,itemId:number,id:number){
  return db.transaction(async tx=>{
    const [job]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.id,id),eq(canvaRenderJobs.channelId,channelId),eq(canvaRenderJobs.contentItemId,itemId))).for('update');
    if(!job)throw new HttpError(404,'작업을 찾을 수 없습니다.');
    if(!active.includes(job.status))return job;
    // A dispatch already in progress cannot be unsent; keep recovery running once its ID arrives.
    if(submitting.includes(job.phase)||job.autofillJobId||job.exportJobId)throw new HttpError(409,'Canva에 이미 접수된 작업입니다. 창을 닫아도 결과 확인을 계속하며 기존 콘텐츠는 보존합니다.');
    const [saved]=await tx.update(canvaRenderJobs).set({status:'cancelled',leaseOwner:null,leaseUntil:null,updatedAt:new Date()}).where(eq(canvaRenderJobs.id,id)).returning();return saved;
  });
}
export async function resumeCanvaJob(db:DB,channelId:number,itemId:number,id:number,options:{action?:'reexport';expectedExportJobId?:string}={}){
  return db.transaction(async tx=>{
    const [job]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.id,id),eq(canvaRenderJobs.channelId,channelId),eq(canvaRenderJobs.contentItemId,itemId))).for('update');
    if(!job)throw new HttpError(404,'작업을 찾을 수 없습니다.');
    if(!['failed','result_unknown'].includes(job.status))return job;
    if(options.action==='reexport'){
      const terminalExport=job.errorCode==='export_expired'||job.errorCode==='job_failed'&&job.phase==='export_polling';
      if(!terminalExport||!job.exportJobId||!job.designId||options.expectedExportJobId!==job.exportJobId)throw new HttpError(409,'만료·실패가 확인된 현재 출력 작업만 다시 내보낼 수 있습니다. 최신 작업 상태를 확인해 주세요.');
      const old=Array.isArray(job.result?.previousExportJobIds)?job.result.previousExportJobIds.filter((value):value is string=>typeof value==='string'):[];
      if(old.length>=20)throw new HttpError(422,'이 작업의 명시적 재내보내기 한도에 도달했습니다. 디자인·권한을 확인해 주세요.');
      const result={...job.result,previousExportJobIds:[...old,job.exportJobId]};
      delete (result as Record<string,unknown>).downloadUrls;
      const [saved]=await tx.update(canvaRenderJobs).set({status:'queued',phase:'export_prepare',exportJobId:null,result,startedAt:new Date(),errorCode:null,errorMessage:null,leaseOwner:null,leaseUntil:null,nextRunAt:new Date(),updatedAt:new Date()}).where(eq(canvaRenderJobs.id,id)).returning();
      return saved;
    }
    if(options.expectedExportJobId)throw new HttpError(400,'출력 작업 ID는 명시적인 다시 내보내기 요청에만 사용할 수 있습니다.');
    if(job.status==='result_unknown'&&!job.autofillJobId&&!job.exportJobId&&job.phase!=='images')throw new HttpError(409,'Canva 작업 ID를 받지 못해 생성 여부가 미확정입니다. Canva에서 생성 여부를 먼저 확인해 주세요. 자동으로 새 요청을 보내지 않습니다.');
    let phase=job.exportJobId?'export_polling':job.autofillJobId?'autofill_polling':job.phase;
    if(submitting.includes(phase)){
      const knownRejection=job.status==='failed'&&['auth_required','permission_denied','rate_limited','invalid_request','not_connected','not_found'].includes(job.errorCode??'');
      if(!knownRejection)throw new HttpError(409,'외부 요청의 접수 여부부터 확인해야 합니다.');
      phase=phase==='autofill_submitting'?'autofill_prepare':'export_prepare';
    }
    if(phase==='images'){
      const input=asInput(job),images=await prepareCanvaImages(tx as DB,{itemId:job.contentItemId,channelId:job.channelId,copy:input.copy,pageDesigns:input.pageDesigns});
      const uploads=await tx.select().from(canvaAssetUploads).where(and(eq(canvaAssetUploads.principal,job.principal),inArray(canvaAssetUploads.sha256,images.map(image=>image.hash)))).for('update');
      if(uploads.some(upload=>!upload.uploadJobId&&['unknown','submitting'].includes(upload.status)))throw new HttpError(409,'접수 여부가 미확정인 이미지 업로드가 남아 있습니다. 같은 파일을 다시 올리지 않고 Canva에서 결과 확인을 기다립니다.',{code:'asset_result_unknown'});
      // This is a deliberate user retry, never an automatic replay. Only confirmed
      // HTTP rejection/failed-job records are reset; a missing response stays unknown.
      const retryable=['auth_required','permission_denied','rate_limited','invalid_request','not_connected','job_failed'];
      for(const upload of uploads)if(upload.status==='failed'&&retryable.includes(upload.errorCode??'')){
        await tx.update(canvaAssetUploads).set({status:'queued',uploadJobId:null,assetId:null,errorCode:null,updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,upload.id),eq(canvaAssetUploads.status,'failed')));
      }
    }
    const [saved]=await tx.update(canvaRenderJobs).set({status:'queued',phase,startedAt:new Date(),errorCode:null,errorMessage:null,leaseOwner:null,leaseUntil:null,nextRunAt:new Date(),updatedAt:new Date()}).where(eq(canvaRenderJobs.id,id)).returning();
    return saved;
  });
}

export async function runCanvaJobs(db:DB,limit=2){
  // Recover a lost lease. Submitted requests without IDs remain unknown, never re-POSTed.
  await db.update(canvaRenderJobs).set({status:'result_unknown',leaseOwner:null,leaseUntil:null,errorCode:'result_unknown',errorMessage:'서버가 다시 시작되어 Canva 요청의 접수 여부를 확인해야 합니다. 자동으로 중복 요청하지 않았습니다.',updatedAt:new Date()}).where(and(eq(canvaRenderJobs.status,'running'),lte(canvaRenderJobs.leaseUntil,new Date()),inArray(canvaRenderJobs.phase,submitting)));
  await db.update(canvaRenderJobs).set({status:'queued',leaseOwner:null,leaseUntil:null,updatedAt:new Date()}).where(and(eq(canvaRenderJobs.status,'running'),lte(canvaRenderJobs.leaseUntil,new Date())));
  for(let i=0;i<limit;i++){
    const job=await db.transaction(async tx=>{
      const [next]=await tx.select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.status,'queued'),lte(canvaRenderJobs.nextRunAt,new Date()))).orderBy(asc(canvaRenderJobs.nextRunAt),asc(canvaRenderJobs.id)).limit(1).for('update',{skipLocked:true});
      if(!next)return null;
      const [claimed]=await tx.update(canvaRenderJobs).set({status:'running',leaseOwner:randomUUID(),leaseUntil:new Date(Date.now()+180_000),startedAt:next.startedAt??new Date(),updatedAt:new Date()}).where(eq(canvaRenderJobs.id,next.id)).returning();return claimed;
    });
    if(!job)break;
    try{
      if(job.startedAt&&Date.now()-job.startedAt.getTime()>30*60_000)throw new HttpError(422,'Canva 작업이 30분을 넘었습니다. 현재 작업 ID로 결과를 다시 확인해 주세요.',{code:'wait_budget_exceeded'});
      await processCanvaStep(db,job);
    }catch(error){
      const e=error as rest.CanvaRestError;
      if(error instanceof CanvaAssetPersistenceError){
        // Retry only the idempotent local ID write, never the accepted upload POST.
        await db.update(canvaAssetUploads).set({uploadJobId:error.jobId,status:'polling',errorCode:null,updatedAt:new Date()}).where(and(eq(canvaAssetUploads.id,error.uploadRowId),eq(canvaAssetUploads.principal,job.principal),eq(canvaAssetUploads.sha256,error.imageHash),isNull(canvaAssetUploads.uploadJobId)));
        await saveStep(db,job,{},5000);continue;
      }
      if(e instanceof rest.CanvaRestError&&e.jobId&&submitting.includes(job.phase)){await persistProviderId(db,job,job.phase.startsWith('autofill')?'autofill':'export',e.jobId);continue;}
      const unknown=e instanceof rest.CanvaRestError&&e.outcomeUnknown || error instanceof HttpError&&['result_unknown','asset_result_unknown'].includes(String(error.extra?.code)) || submitting.includes(job.phase)&&!(e instanceof rest.CanvaRestError&&!e.outcomeUnknown);
      const code=e instanceof rest.CanvaRestError?e.code:error instanceof HttpError?String(error.extra?.code??'validation_failed'):'processing_failed';
      const message=e instanceof rest.CanvaRestError?e.message:error instanceof HttpError?error.message:'Canva 결과를 처리하지 못했습니다. 기존 원고와 이미지는 유지했습니다.';
      await db.update(canvaRenderJobs).set({status:unknown?'result_unknown':'failed',errorCode:code,errorMessage:message,leaseOwner:null,leaseUntil:null,updatedAt:new Date()}).where(and(eq(canvaRenderJobs.id,job.id),eq(canvaRenderJobs.leaseOwner,job.leaseOwner!),eq(canvaRenderJobs.status,'running')));
    }
  }
}

/** Explicit renderer change always creates a revision; it cannot reuse a Canva approval. */
export async function selectLocalRenderer(db:DB,a:{channelId:number;itemId:number;version:number;actor:string}){
  return db.transaction(async tx=>{
    const [item]=await tx.select().from(contentItems).where(and(eq(contentItems.id,a.itemId),eq(contentItems.channelId,a.channelId))).for('update');
    if(!item||!item.currentRevisionId)throw new HttpError(404,'저장된 원고를 찾을 수 없습니다.');
    if(item.version!==a.version)throw new HttpError(409,'다른 곳에서 원고가 변경됐습니다. 최신 저장본을 확인해 주세요.');
    const [pending]=await tx.select({id:canvaRenderJobs.id}).from(canvaRenderJobs).where(and(eq(canvaRenderJobs.contentItemId,item.id),inArray(canvaRenderJobs.status,['queued','running']))).limit(1);
    if(pending)throw new HttpError(409,'진행 중인 Canva 작업을 확인하거나 취소한 뒤 자체 이미지를 선택해 주세요.');
    const [current]=await tx.select().from(contentRevisions).where(eq(contentRevisions.id,item.currentRevisionId));
    if(!familyCardCopySchema.safeParse(current.payload.cardCopy).success)throw new HttpError(422,'8장 원고를 저장한 뒤 선택해 주세요.');
    if(current.payload.rendererProvider==='builtin')return item;
    const {canvaExport:_oldExport,...payload}=current.payload;
    const revision=await createRevision(tx,{contentItemId:item.id,author:'operator',payload:{...payload,rendererProvider:'builtin'},note:'운영자가 스튜디오 자체 이미지로 전환'});
    const caption=payload.captionPackage as Record<string,unknown>|undefined;
    if(caption?.contentRevision===current.id)await tx.update(contentRevisions).set({payload:{...revision.payload,captionPackage:{...caption,contentRevision:revision.id}}}).where(eq(contentRevisions.id,revision.id));
    const [saved]=await tx.update(contentItems).set({version:item.version+1,updatedAt:new Date()}).where(eq(contentItems.id,item.id)).returning();
    await audit(tx as DB,{actor:a.actor,action:'renderer_select',entity:'content_item',entityId:item.id,channelId:a.channelId,detail:{rendererProvider:'builtin',revisionId:revision.id}});
    return saved;
  });
}
