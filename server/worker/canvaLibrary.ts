import type { DB } from '../db';
import { env } from '../env';
import { syncCanvaTemplateLibrary, runCanvaLibraryPreviewJobs } from '../services/canvaTemplateLibrary';

let sync:Promise<unknown>|null=null,preview:Promise<unknown>|null=null,timer:ReturnType<typeof setInterval>|null=null,stopping=false;
export function kickCanvaLibrary(db:DB){
  if(stopping||!env.inlineWorker||env.canonicalRedirectUrl)return;
  if(!sync)sync=syncCanvaTemplateLibrary(db).catch(()=>console.error('[Canva library] 폴더 상태 확인 실패. 저장된 상태에서 다시 확인합니다.')).finally(()=>{sync=null;});
  // Decode/export download is deliberately serial in each process to bound memory.
  if(!preview)preview=runCanvaLibraryPreviewJobs(db).catch(()=>console.error('[Canva library] 미리보기 처리 실패. 저장된 작업에서 복구합니다.')).finally(()=>{preview=null;});
}
export function startCanvaLibrary(db:DB){
  if(stopping||timer||!env.inlineWorker||env.canonicalRedirectUrl)return;
  kickCanvaLibrary(db);timer=setInterval(()=>kickCanvaLibrary(db),5000);timer.unref();
}
export async function stopCanvaLibrary(){stopping=true;if(timer)clearInterval(timer);timer=null;await Promise.allSettled([sync,preview]);}
