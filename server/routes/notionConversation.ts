import {Router,type Request,type Response,type NextFunction} from 'express';
import {notionConversationRequestSchema,notionProductionProfileRequestSchema} from '../../shared/notionConversation';
import {getDb} from '../db';
import {actorOf} from '../auth';
import {HttpError,intParam,parse} from './util';
import {generateNotionConversation,getNotionProductionProfile,saveNotionProductionProfile} from '../services/notionConversation';

/** Mounted alongside notionRoutes after operator authentication and CSRF middleware. */
export const notionConversationRoutes=Router();
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{
 res.set('Cache-Control','private, no-store');void fn(req,res).catch(error=>{if(error instanceof Error&&error.name==='AbortError')next(new HttpError(499,'요청을 중단했습니다. 기존 초안은 유지했습니다.'));else next(error);});
};
notionConversationRoutes.get('/notion/links/:id/production-profile',handle(async(req,res)=>res.json(await getNotionProductionProfile(getDb(),intParam(req.params.id)))));
notionConversationRoutes.put('/notion/links/:id/production-profile',handle(async(req,res)=>res.json(await saveNotionProductionProfile(getDb(),intParam(req.params.id),parse(notionProductionProfileRequestSchema,req.body),actorOf(req)))));
notionConversationRoutes.post('/notion/links/:id/conversation',handle(async(req,res)=>{
 const input=parse(notionConversationRequestSchema,req.body),controller=new AbortController();
 const abort=()=>controller.abort(),close=()=>{if(!res.writableEnded)abort();};
 req.once('aborted',abort);res.once('close',close);
 try{const result=await generateNotionConversation(getDb(),intParam(req.params.id),input,controller.signal,actorOf(req));if(!res.destroyed)res.json(result);}
 finally{req.off('aborted',abort);res.off('close',close);}
}));
