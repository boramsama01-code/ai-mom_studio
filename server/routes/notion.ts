import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {and,eq} from 'drizzle-orm';
import {notionDocumentQuerySchema} from '../../shared/notionSync';
import {notionCoverStyles,notionImportRequestSchema,notionPullRequestSchema,notionPushRequestSchema} from '../../shared/notionStudio';
import {notionSyncPhotos} from '../../shared/schema';
import {getDb} from '../db';
import {actorOf} from '../auth';
import {HttpError,intParam,parse} from './util';
import {getNotionConnectionStatus,queryNotionDocuments,fetchNotionDocument,NotionSyncError} from '../services/notionClient';
import {CanvaRestError} from '../services/canvaRest';
import {importNotionStudio,listNotionStudioLinks,notionStudioDetail,notionStudioLinkForItem,pullNotionStudio,pushNotionStudio,setNotionStudioStyle} from '../services/notionStudio';
import {createNotionStudioCanva,exportNotionStudioCanva,pollNotionStudioCanva,downloadNotionStudioOutput} from '../services/notionStudioCanva';

export const notionRoutes=Router();
// This router is installed after operator authentication and the existing CSRF guard.
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{
 res.set('Cache-Control','private, no-store');
 void fn(req,res).catch(async error=>{
  let e=error;
  if(e instanceof NotionSyncError)e=new HttpError(e.status,e.message,{code:e.code,...(e.details?{details:e.details}:{})});
  else if(e instanceof CanvaRestError)e=new HttpError(e.status&&e.status>=400&&e.status<600?e.status:502,e.message,{code:e.code,outcomeUnknown:e.outcomeUnknown});
  if(e instanceof HttpError&&e.status===409&&req.params.id){
   try{e.extra={...e.extra,detail:await notionStudioDetail(getDb(),intParam(req.params.id),true)};}catch{/* Keep the original conflict if the source is temporarily unavailable. */}
  }
  next(e);
 });
};
const version=z.number().int().positive();
const canvaRequest=z.object({version,itemVersion:version}).strict();
const exportRequest=canvaRequest.extend({confirmed:z.literal(true)}).strict();
const settings=z.object({version,coverStyle:z.enum(notionCoverStyles).optional(),autoSync:z.boolean().optional()}).strict().refine(v=>v.coverStyle!==undefined||v.autoSync!==undefined,'변경할 설정을 선택하세요.');
notionRoutes.get('/notion/status',handle(async(_req,res)=>res.json(getNotionConnectionStatus())));
notionRoutes.get('/notion/documents',handle(async(req,res)=>res.json(await queryNotionDocuments(parse(notionDocumentQuerySchema,req.query)))));
notionRoutes.get('/notion/documents/:pageId',handle(async(req,res)=>res.json(await fetchNotionDocument(String(req.params.pageId)))));
notionRoutes.post('/notion/import',handle(async(req,res)=>res.json(await importNotionStudio(getDb(),parse(notionImportRequestSchema,req.body),actorOf(req)))));
notionRoutes.get('/notion/links',handle(async(_req,res)=>res.json(await listNotionStudioLinks(getDb()))));
notionRoutes.get('/notion/items/:itemId/link',handle(async(req,res)=>res.json(await notionStudioLinkForItem(getDb(),intParam(req.params.itemId)))));
notionRoutes.get('/notion/links/:id',handle(async(req,res)=>{
 const id=intParam(req.params.id);await pollNotionStudioCanva(getDb(),id);
 return res.json(await notionStudioDetail(getDb(),id,req.query.refresh==='1'));
}));
notionRoutes.patch('/notion/links/:id',handle(async(req,res)=>res.json(await setNotionStudioStyle(getDb(),intParam(req.params.id),parse(settings,req.body)))));
notionRoutes.post('/notion/links/:id/pull',handle(async(req,res)=>res.json(await pullNotionStudio(getDb(),intParam(req.params.id),parse(notionPullRequestSchema,req.body),actorOf(req)))));
notionRoutes.post('/notion/links/:id/push',handle(async(req,res)=>res.json(await pushNotionStudio(getDb(),intParam(req.params.id),parse(notionPushRequestSchema,req.body),actorOf(req)))));
notionRoutes.post('/notion/links/:id/canva',handle(async(req,res)=>res.json(await createNotionStudioCanva(getDb(),intParam(req.params.id),parse(canvaRequest,req.body),actorOf(req)))));
notionRoutes.post('/notion/links/:id/canva/export',handle(async(req,res)=>res.json(await exportNotionStudioCanva(getDb(),intParam(req.params.id),parse(exportRequest,req.body),actorOf(req)))));
notionRoutes.get('/notion/links/:id/photos/:photoId',handle(async(req,res)=>{
 const [photo]=await getDb().select().from(notionSyncPhotos).where(and(eq(notionSyncPhotos.linkId,intParam(req.params.id)),eq(notionSyncPhotos.id,intParam(req.params.photoId))));
 if(!photo)throw new HttpError(404,'사진을 찾을 수 없습니다.');
 res.set('X-Content-Type-Options','nosniff').type(photo.mimeType).send(photo.bytes);
}));
notionRoutes.get('/notion/links/:id/output.zip',handle(async(req,res)=>res.type('application/zip').set('Content-Disposition','attachment; filename="HighScoop_Canva.zip"').send(await downloadNotionStudioOutput(getDb(),intParam(req.params.id)))));
