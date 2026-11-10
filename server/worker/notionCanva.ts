/** Durable editable Canva handoff for saved Notion-linked Studio cards. */
import {randomUUID} from 'node:crypto';
import {and,asc,eq,sql} from 'drizzle-orm';
import type {DB} from '../db';
import {channels,contentItems,notionSyncLinks} from '../../shared/schema';
import type {NotionCanvaAutoSaveStored} from '../../shared/notionStudio';
import {studioKey} from '../../shared/channelKeys';
import {env} from '../env';
import {getSetting} from '../seed';
import {canvaConnected} from '../services/canva';
import {CanvaRestError,getCanvaPrincipal} from '../services/canvaRest';
import {HttpError} from '../routes/util';
import {loadNotionStudioState} from '../services/notionStudio';
import {createNotionStudioCanva,currentNotionCanvaSource,pollNotionStudioCanva} from '../services/notionStudioCanva';
import {queuedNotionCanvaAutoSave} from '../services/notionCanvaAutoSave';

const accepted=(phase:string)=>phase==='importing'||phase==='exporting';
const ready=(s:State)=>['ready','complete'].includes(s.link.canva.phase)&&!!s.link.canva.designId&&currentNotionCanvaSource(s);
const LEASE_MS=120_000;
type State=Awaited<ReturnType<typeof loadNotionStudioState>>;
async function claim(db:DB,id:number){
 return db.transaction(async raw=>{const tx=raw as unknown as DB,initial=await loadNotionStudioState(tx,id);
  // Match every other source/Canva writer's item -> link lock ordering.
  await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,initial.item.id)).for('update');
  await tx.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');
  const s=await loadNotionStudioState(tx,id),a=s.link.canvaAutoSave;
  const [channel]=await tx.select().from(channels).where(eq(channels.id,s.link.channelId));
  if(!channel?.active||studioKey(channel.slug)!=='highscoop')return null;
  if(a.phase==='failed'||a.phase==='blocked'||a.leaseToken&&Date.parse(a.leaseUntil??'')>Date.now())return null;
  if(s.link.operationToken&&s.link.operationUntil&&s.link.operationUntil>new Date())return null;
  if(!accepted(s.link.canva.phase)&&(!a.enabled||!['queued','processing'].includes(a.phase)||Date.parse(a.notBefore??'')>Date.now()))return null;
  const automatic:NotionCanvaAutoSaveStored={...a,phase:'processing',requestId:a.requestId??randomUUID(),leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+LEASE_MS).toISOString()};
  await tx.update(notionSyncLinks).set({canvaAutoSave:automatic}).where(eq(notionSyncLinks.id,id));
  return {...s,automatic};
 });
}
async function updateOwned(db:DB,s:NonNullable<Awaited<ReturnType<typeof claim>>>,value:NotionCanvaAutoSaveStored){
 const rows=await db.update(notionSyncLinks).set({canvaAutoSave:value}).where(and(eq(notionSyncLinks.id,s.link.id),sql`${notionSyncLinks.canvaAutoSave}->>'requestId' = ${s.automatic.requestId!}`,sql`${notionSyncLinks.canvaAutoSave}->>'leaseToken' = ${s.automatic.leaseToken!}`)).returning({id:notionSyncLinks.id});
 return rows.length>0;
}
function cleared(value:NotionCanvaAutoSaveStored,phase:NotionCanvaAutoSaveStored['phase'],error:string|null=null){return {...value,phase,error,leaseToken:undefined,leaseUntil:undefined};}
function settled(s:State,a:NotionCanvaAutoSaveStored):NotionCanvaAutoSaveStored{
 const v=s.link.canva;
 if(v.phase==='result_unknown')return cleared(a,'blocked',v.error??'이미 접수한 Canva 작업의 결과가 미확정입니다. 기존 작업 결과를 먼저 확인해 주세요.');
 if(v.phase==='failed'){
  // A rejected old export must not discard a newer queued cover/photo/source.
  if(a.enabled&&v.sourceRevisionId&&(v.currentSource===false||v.sourceRevisionId!==s.revision.id||v.sourceVersion!==s.item.version))return queuedNotionCanvaAutoSave(a,s.revision.id,s.item.version);
  return cleared(a,'failed',v.error??'Canva 저장을 완료하지 못했습니다. 다시 저장을 눌러 재시도하세요.');
 }
 if(accepted(v.phase))return cleared(a,'processing');
 if(!a.enabled||ready(s))return cleared(a,'idle');
 return queuedNotionCanvaAutoSave(a,s.revision.id,s.item.version);
}
/** One bounded sweep. Provider POSTs are never retried after an uncertain outcome. */
export async function saveNotionCanvaOnce(db:DB,options:{limit?:number;maxMs?:number;shouldStop?:()=>boolean}={}){
 const result={checked:0,submitted:0,polled:0,failed:0,blocked:0};
 if(await getSetting(db,'global_stop',false))return result;
 const deadline=Date.now()+(options.maxMs??120_000);
 const rows=await db.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(sql`
  exists (select 1 from channels c where c.id=${notionSyncLinks.channelId} and c.active=true and c.slug in ('opportunities','highscoop','highway'))
  and not exists (select 1 from studio_cards sc where sc.source_item_id=${notionSyncLinks.contentItemId} and sc.trashed_at is not null)
  and (${notionSyncLinks.canvaAutoSave}->>'phase' in ('queued','processing')
   or (${notionSyncLinks.canva}->>'phase' in ('importing','exporting') and ${notionSyncLinks.canvaAutoSave}->>'phase' not in ('failed','blocked')))
 `).orderBy(asc(notionSyncLinks.updatedAt),asc(notionSyncLinks.id)).limit(options.limit??10);
 for(const row of rows){
  if(Date.now()>=deadline||options.shouldStop?.()||await getSetting(db,'global_stop',false))break;
  let s:Awaited<ReturnType<typeof claim>>=null;
  try{
   s=await claim(db,row.id);if(!s)continue;result.checked++;
   if(s.link.canva.phase==='result_unknown'){await updateOwned(db,s,cleared(s.automatic,'blocked','이미 접수한 Canva 작업의 결과가 미확정입니다. 기존 작업 결과를 먼저 확인해 주세요.'));result.blocked++;continue;}
   if(ready(s)){await updateOwned(db,s,cleared(s.automatic,'idle'));continue;}
   if(!canvaConnected())throw new CanvaRestError('Canva 계정을 연결하면 저장한 원고를 편집 가능한 디자인으로 만들 수 있습니다.',401,'not_connected');
   const principal=await getCanvaPrincipal(db),key=`${principal.teamId}:${principal.userId}`;
   if(s.automatic.principal&&s.automatic.principal!==key)throw new CanvaRestError('Canva 연결 계정이 바뀌어 자동 저장을 멈췄습니다. 대상 계정을 확인한 뒤 자동 저장을 다시 켜 주세요.',409,'permission_denied');
   s.automatic={...s.automatic,principal:key};if(!await updateOwned(db,s,s.automatic))continue;
   if(options.shouldStop?.()||await getSetting(db,'global_stop',false)){await updateOwned(db,s,cleared(s.automatic,'queued'));break;}
   if(accepted(s.link.canva.phase)){await pollNotionStudioCanva(db,row.id);result.polled++;}
   else{
    await createNotionStudioCanva(db,row.id,{version:s.link.version,itemVersion:s.item.version},'notion-canva-auto-save',{automatic:true,autoRequestId:s.automatic.requestId,autoLeaseToken:s.automatic.leaseToken,expectedPrincipal:key});result.submitted++;
   }
   const fresh=await loadNotionStudioState(db,row.id);await updateOwned(db,s,settled(fresh,s.automatic));
  }catch(error){
   if(!s)continue; // A trashed or unavailable source is never sent to Canva.
   const fresh=await loadNotionStudioState(db,row.id).catch(()=>null);
   if(error instanceof HttpError&&error.status===409&&fresh&&fresh.link.canva.phase!=='result_unknown'){
    await updateOwned(db,s,settled(fresh,s.automatic));continue;
   }
   const receipt=!!fresh&&accepted(fresh.link.canva.phase)&&!!(fresh.link.canva.phase==='importing'?fresh.link.canva.jobId:fresh.link.canva.exportJobId);
   const unknown=fresh?.link.canva.phase==='result_unknown'||error instanceof CanvaRestError&&error.outcomeUnknown&&!receipt;
   const authentication=error instanceof CanvaRestError&&['not_connected','auth_required','permission_denied'].includes(error.code);
   const blocked=unknown||authentication;
   const message=error instanceof Error?error.message.slice(0,600):'Canva 자동 저장을 완료하지 못했습니다.';
   // A received receipt is polled on the next sweep; never submit another POST.
   const retryRead=!(error instanceof CanvaRestError)||['provider_unavailable','rate_limited','cancelled','result_unknown'].includes(error.code)||!accepted(s.link.canva.phase)&&error.outcomeUnknown;
   if(receipt&&!authentication&&retryRead)await updateOwned(db,s,cleared(s.automatic,'processing',message));
   else await updateOwned(db,s,cleared(s.automatic,blocked?'blocked':'failed',message));
   if(blocked)result.blocked++;else result.failed++;
  }
 }
 return result;
}
let timer:ReturnType<typeof setInterval>|null=null,running:Promise<unknown>|null=null,stopping=false;
export function kickNotionCanvaSave(db:DB){
 if(stopping||running||!env.inlineWorker||env.canonicalRedirectUrl)return;
 running=saveNotionCanvaOnce(db,{limit:2,shouldStop:()=>stopping}).catch(()=>console.error('[Canva 자동 저장] 저장된 작업에서 상태를 다시 확인합니다.')).finally(()=>{running=null;});
}
export function startNotionCanvaSave(db:DB){if(stopping||timer||!env.inlineWorker||env.canonicalRedirectUrl)return;kickNotionCanvaSave(db);timer=setInterval(()=>kickNotionCanvaSave(db),5000);timer.unref();}
export async function stopNotionCanvaSave(){stopping=true;if(timer)clearInterval(timer);timer=null;await Promise.allSettled([running]);}
