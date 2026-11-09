import {and,asc,eq,isNull,lt,or,sql} from 'drizzle-orm';
import type {DB} from '../db';
import {notionSyncLinks} from '../../shared/schema';
import {notionSyncChange} from '../../shared/notionStudioCopy';
import {notionConfigured,fetchNotionDocument} from '../services/notionClient';
import {loadNotionStudioState,notionCopyHash,pullNotionStudio,pushNotionStudio} from '../services/notionStudio';
import {env} from '../env';
import {getSetting} from '../seed';

let timer:ReturnType<typeof setInterval>|null=null,running:Promise<unknown>|null=null,stopping=false;
/** Only drafts explicitly linked by an operator participate. Never generates, approves or publishes. */
export async function syncNotionOnce(db:DB,opts:{maxMs?:number;limit?:number;shouldStop?:()=>boolean}={}){
 const result={checked:0,pulled:0,pushed:0,conflicts:0,failed:0};
 if(!notionConfigured()||await getSetting(db,'global_stop',false))return result;
 const deadline=Date.now()+(opts.maxMs??120_000),due=new Date(Date.now()-240_000);
 // Filter blocked links before the limit so long-running Canva jobs cannot starve other drafts.
 const rows=await db.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(and(
  eq(notionSyncLinks.autoSync,true),or(isNull(notionSyncLinks.lastCheckedAt),lt(notionSyncLinks.lastCheckedAt,due)),
  sql`coalesce(${notionSyncLinks.canva}->>'phase','idle') not in ('importing','exporting','result_unknown')`,
  or(isNull(notionSyncLinks.operationToken),isNull(notionSyncLinks.operationUntil),lt(notionSyncLinks.operationUntil,new Date())),
 )).orderBy(sql`${notionSyncLinks.lastCheckedAt} asc nulls first`,asc(notionSyncLinks.id)).limit(opts.limit??20);
 for(const row of rows){
  if(Date.now()>=deadline||opts.shouldStop?.()||await getSetting(db,'global_stop',false))break;
  let expectedVersion:number|undefined;
  try{
   const s=await loadNotionStudioState(db,row.id);expectedVersion=s.link.version;
   if(!s.link.autoSync||['importing','exporting','result_unknown'].includes(s.link.canva.phase)||(s.link.operationToken&&s.link.operationUntil&&s.link.operationUntil>new Date()))continue;
   const fresh=await fetchNotionDocument(s.link.notionPageId),change=notionSyncChange(fresh.sourceHash!==s.link.sourceHash,notionCopyHash(s.copy)!==s.link.baseCopyHash);
   result.checked++;
   const input={version:s.link.version,itemVersion:s.item.version,expectedSourceHash:fresh.sourceHash,resolveConflict:false};
   if(change==='conflict'){
    result.conflicts++;
    await db.update(notionSyncLinks).set({lastCheckedAt:new Date(),lastError:'노션과 스튜디오 원고가 모두 바뀌어 자동 동기화를 멈췄습니다. 두 원고를 비교해 적용할 내용을 선택하세요.'}).where(and(eq(notionSyncLinks.id,row.id),eq(notionSyncLinks.version,s.link.version)));
    continue;
   }
   if(change==='notion_changed'){await pullNotionStudio(db,row.id,input,'notion-auto-sync');result.pulled++;}
   else if(change==='studio_changed'){await pushNotionStudio(db,row.id,input,'notion-auto-sync');result.pushed++;}
   // A successful sync increments its version. Avoid clearing errors from a later operator action.
   await db.update(notionSyncLinks).set({lastCheckedAt:new Date(),lastError:null}).where(and(eq(notionSyncLinks.id,row.id),eq(notionSyncLinks.version,s.link.version+(change==='unchanged'?0:1))));
  }catch(e){
   result.failed++;
   await db.update(notionSyncLinks).set({lastCheckedAt:new Date(),lastError:`자동 동기화 확인 필요: ${(e as Error).message.slice(0,400)}`}).where(and(eq(notionSyncLinks.id,row.id),...(expectedVersion!==undefined?[eq(notionSyncLinks.version,expectedVersion)]:[])));
  }
 }
 return result;
}
function kick(db:DB){
 if(stopping||running||!notionConfigured())return;
 running=syncNotionOnce(db,{shouldStop:()=>stopping}).catch(()=>console.error('[Notion] 자동 동기화 상태 확인에 실패했습니다. 원고 비교에서 확인하세요.')).finally(()=>{running=null;});
}
export function startNotionSync(db:DB){
 if(stopping||timer||!env.inlineWorker||env.canonicalRedirectUrl)return;
 kick(db);timer=setInterval(()=>kick(db),60_000);timer.unref();
}
export async function stopNotionSync(){stopping=true;if(timer)clearInterval(timer);timer=null;await Promise.allSettled([running]);}
