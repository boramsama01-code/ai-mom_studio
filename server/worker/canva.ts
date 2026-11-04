import type { DB } from '../db';
import { env } from '../env';
import { runCanvaJobs } from '../services/canvaEditorial';

let running:Promise<unknown>|null=null,timer:ReturnType<typeof setInterval>|null=null,stopping=false;
export function kickCanvaJobs(db:DB){
  if(stopping||running||!env.inlineWorker||env.canonicalRedirectUrl)return;
  running=runCanvaJobs(db,3).catch(()=>console.error('[Canva] 작업 처리 오류. 저장된 작업 상태에서 복구합니다.')).finally(()=>{running=null;});
}
export function startCanvaJobs(db:DB){
  if(stopping||timer||!env.inlineWorker||env.canonicalRedirectUrl)return;
  kickCanvaJobs(db);timer=setInterval(()=>kickCanvaJobs(db),5000);timer.unref();
}
export async function stopCanvaJobs(){stopping=true;if(timer)clearInterval(timer);timer=null;await running;}
