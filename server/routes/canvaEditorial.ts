import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db';
import { canvaMasters,canvaRenderJobs,contentItems } from '../../shared/schema';
import { ah,HttpError,intParam,loadChannel,parse } from './util';
import { actorOf } from '../auth';
import { canvaConfigured,canvaConnected } from '../services/canva';
import { getCanvaCapabilities,CanvaRestError } from '../services/canvaRest';
import { registerCanvaMaster,canvaMasterDto,enqueueCanvaRender,canvaJobDto,acceptCanvaImport,cancelCanvaJob,resumeCanvaJob,selectLocalRenderer } from '../services/canvaEditorial';
import { kickCanvaJobs } from '../worker/canva';
import { reconcileCanvaJob } from '../services/canvaReconciliation';
import { canvaReconcileRequestSchema } from '../../shared/canvaReconciliation';
import type { CanvaConnectionStatus } from '../../shared/canvaCapabilities';

export const canvaEditorialRoutes=Router();
const route=(fn:Parameters<typeof ah>[0])=>ah(async(req,res,next)=>{try{return await fn(req,res,next);}catch(error){if(error instanceof CanvaRestError)throw new HttpError(error.outcomeUnknown?502:error.status===429?429:error.status&&error.status>=400&&error.status<500?422:502,error.message,{code:error.code,reason:error.reason,providerCode:error.providerCode,outcomeUnknown:error.outcomeUnknown});throw error;}});
const itemScope=async(cid:unknown,iid:unknown)=>{
  const channel=await loadChannel(cid),itemId=intParam(iid);
  const [item]=await getDb().select({id:contentItems.id}).from(contentItems).where(and(eq(contentItems.id,itemId),eq(contentItems.channelId,channel.id)));
  if(!item)throw new HttpError(404,'콘텐츠를 찾을 수 없습니다.');
  return {channel,itemId};
};

canvaEditorialRoutes.get('/canva/editorial/status',route(async(_req,res)=>{
  const configured=canvaConfigured(),connected=canvaConnected();
  const base:CanvaConnectionStatus={configured,connected,autofill:false,capabilities:[],capabilityStatus:'unknown',reason:null,message:null,providerCode:null,checkedAt:null};
  if(!configured||!connected)return res.json({...base,reason:'not_connected',message:'Canva 계정을 연결한 뒤 자동 채우기 기능을 확인해 주세요.'});
  try {
    const result=await getCanvaCapabilities(getDb()),autofill=result.capabilities.includes('autofill');
    return res.json({...base,autofill,capabilities:result.capabilities,capabilityStatus:autofill?'available':'unavailable',reason:autofill?null:'capability_missing',message:autofill?null:'현재 연결한 Canva 계정·팀에는 자동 채우기 기능이 없습니다. 기능이 포함된 플랜과 연결한 계정·팀을 확인해 주세요.',checkedAt:new Date().toISOString()});
  } catch(error) {
    if(!(error instanceof CanvaRestError))throw error;
    return res.json({...base,reason:error.reason,message:error.message,providerCode:error.providerCode,checkedAt:new Date().toISOString()});
  }
}));
canvaEditorialRoutes.get('/channels/:cid/canva/masters',route(async(req,res)=>{
  const channel=await loadChannel(req.params.cid);
  const rows=await getDb().select().from(canvaMasters).where(eq(canvaMasters.channelId,channel.id)).orderBy(desc(canvaMasters.id));
  res.json({items:rows.map(canvaMasterDto)});
}));
canvaEditorialRoutes.post('/channels/:cid/canva/masters',route(async(req,res)=>{
  const channel=await loadChannel(req.params.cid);
  const body=parse(z.object({sourceId:z.string().regex(/^D[A-Za-z0-9_-]{3,199}$/),conceptMode:z.enum(['value_definition','scientific_explanation']),hasExternalActivity:z.boolean(),templateVersion:z.string().trim().min(1).max(80)}).strict(),req.body);
  const master=await registerCanvaMaster(getDb(),{channelId:channel.id,actor:actorOf(req),...body});
  res.status(201).json(canvaMasterDto(master));
}));
canvaEditorialRoutes.get('/channels/:cid/items/:id/canva/jobs',route(async(req,res)=>{
  const {channel,itemId}=await itemScope(req.params.cid,req.params.id);
  const rows=await getDb().select().from(canvaRenderJobs).where(and(eq(canvaRenderJobs.channelId,channel.id),eq(canvaRenderJobs.contentItemId,itemId))).orderBy(desc(canvaRenderJobs.id)).limit(20);
  res.json({items:rows.map(canvaJobDto)});
}));
canvaEditorialRoutes.post('/channels/:cid/items/:id/canva/jobs',route(async(req,res)=>{
  const {channel,itemId}=await itemScope(req.params.cid,req.params.id);
  const body=parse(z.object({version:z.number().int().positive(),requestId:z.string().uuid(),masterId:z.number().int().positive().optional(),importFromJobId:z.number().int().positive().optional(),libraryDesignId:z.string().regex(/^D[A-Za-z0-9_-]{3,199}$/).optional(),expectedLibraryUpdatedAt:z.number().int().nonnegative().optional()}).strict().refine(value=>!(value.libraryDesignId&&(value.masterId||value.importFromJobId))&&!(value.expectedLibraryUpdatedAt!==undefined&&!value.libraryDesignId),{message:'Canva 폴더 원본 선택은 기존 마스터 선택·가져오기와 함께 요청할 수 없습니다.'}),req.body);
  const job=await enqueueCanvaRender(getDb(),{channelId:channel.id,itemId,actor:actorOf(req),...body});
  kickCanvaJobs(getDb());res.status(202).json(canvaJobDto(job));
}));
canvaEditorialRoutes.post('/channels/:cid/items/:id/canva/jobs/:jobId/accept',route(async(req,res)=>{
  const {channel,itemId}=await itemScope(req.params.cid,req.params.id);
  const body=parse(z.object({version:z.number().int().positive(),textConfirmedUnchanged:z.literal(true)}).strict(),req.body);
  await acceptCanvaImport(getDb(),{channelId:channel.id,itemId,jobId:intParam(req.params.jobId),actor:actorOf(req),...body});res.json({ok:true});
}));
canvaEditorialRoutes.post('/channels/:cid/items/:id/canva/jobs/:jobId/reconcile',route(async(req,res)=>{
  const {channel,itemId}=await itemScope(req.params.cid,req.params.id);
  const body=parse(canvaReconcileRequestSchema,req.body);
  const job=await reconcileCanvaJob(getDb(),{channelId:channel.id,itemId,jobId:intParam(req.params.jobId),actor:actorOf(req),...body});
  kickCanvaJobs(getDb());res.status(202).json(canvaJobDto(job));
}));
for(const action of ['resume','cancel'] as const)canvaEditorialRoutes.post(`/channels/:cid/items/:id/canva/jobs/:jobId/${action}`,route(async(req,res)=>{
  const {channel,itemId}=await itemScope(req.params.cid,req.params.id);
  const options=action==='resume'?parse(z.union([
    z.object({}).strict(),
    z.object({action:z.literal('reexport'),expectedExportJobId:z.string().min(1).max(200)}).strict(),
  ]),req.body??{}):{};
  const job=action==='resume'
    ?await resumeCanvaJob(getDb(),channel.id,itemId,intParam(req.params.jobId),options)
    :await cancelCanvaJob(getDb(),channel.id,itemId,intParam(req.params.jobId));
  if(action==='resume')kickCanvaJobs(getDb());res.json(canvaJobDto(job));
}));

canvaEditorialRoutes.post('/channels/:cid/items/:id/canva/use-local',route(async(req,res)=>{
  const {channel,itemId}=await itemScope(req.params.cid,req.params.id);
  const body=parse(z.object({version:z.number().int().positive()}).strict(),req.body);
  const item=await selectLocalRenderer(getDb(),{channelId:channel.id,itemId,version:body.version,actor:actorOf(req)});
  res.json({version:item.version,revisionId:item.currentRevisionId});
}));
