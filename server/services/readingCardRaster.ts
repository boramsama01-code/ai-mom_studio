import {fork} from 'node:child_process';
import {HttpError} from '../routes/util';

const MAX_PENDING_PAGES=4;
const PAGE_TIMEOUT_MS=30_000;
let pendingPages=0;
let activeWorkers=0,maxObservedWorkers=0;
let activeNativePid:number|null=null,maxObservedChildRssMiB=0,maxObservedProcessTreeMiB=0;
let activeBackgroundWork=0,maxObservedHeavyWork=0,deferredBackgroundWork=0;
let tail:Promise<void>=Promise.resolve();
export function readingRasterState(){return {pendingPages,activeWorkers,maxObservedWorkers,activeBackgroundWork,maxObservedHeavyWork,deferredBackgroundWork,admissionLimit:MAX_PENDING_PAGES,nativeBackend:'process',activeNativePid,maxObservedChildRssMiB,maxObservedProcessTreeMiB};}

/** Background image downloads/decoding use the same admission as native card
 * rasterization. Reserve synchronously, before allocating any input buffers.
 * Foreground callers already waiting take priority; background callers defer
 * their durable job instead of adding another large task to this queue. */
export async function tryBackgroundImageWork<T>(work:()=>Promise<T>):Promise<{accepted:false}|{accepted:true;value:T}>{
  if(pendingPages||activeBackgroundWork){deferredBackgroundWork++;return {accepted:false};}
  const previous=tail;
  let release!:()=>void;
  tail=new Promise<void>(resolve=>{release=resolve;});
  activeBackgroundWork++;
  maxObservedHeavyWork=Math.max(maxObservedHeavyWork,activeWorkers+activeBackgroundWork);
  await previous;
  try{return {accepted:true,value:await work()};}
  finally{activeBackgroundWork--;release();}
}

/** A single short-lived OS process owns native SVG/image allocations. Await
 * its close before releasing the gate so allocator arenas cannot accumulate
 * in the web process. The same admission bound and deadlines remain in force. */
export async function rasterizeReadingSvg(makeSvg:()=>Promise<string>|string):Promise<Buffer>{
  if(pendingPages>=MAX_PENDING_PAGES)throw new HttpError(503,'이미지 작업이 진행 중입니다. 원고는 유지했습니다. 잠시 후 미리보기를 다시 눌러 주세요.');
  const deadline=Date.now()+PAGE_TIMEOUT_MS;
  pendingPages++;
  const previous=tail;
  let release!:()=>void;
  tail=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try{
    if(Date.now()>=deadline)throw new HttpError(503,'이미지 작업 대기 시간이 초과되었습니다. 원고는 유지했습니다. 다시 미리보기를 만들어 주세요.');
    const svg=await makeSvg();
    if(Date.now()>=deadline)throw new HttpError(503,'이미지 준비 시간이 초과되었습니다. 원고는 유지했습니다. 다시 미리보기를 만들어 주세요.');
    return await rasterPage(svg,deadline-Date.now());
  }finally{pendingPages--;release();}
}

function rasterPage(svg:string,timeoutMs:number):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const child=fork(new URL('./readingCardRasterWorker.mjs',import.meta.url),[],{
      serialization:'advanced',execArgv:[],stdio:['ignore','ignore','ignore','ipc'],
      env:{...process.env,MALLOC_ARENA_MAX:'2'},
    });
    const closed=new Promise<void>(done=>child.once('close',()=>done()));
    activeWorkers++;activeNativePid=child.pid??null;
    maxObservedWorkers=Math.max(maxObservedWorkers,activeWorkers);
    maxObservedHeavyWork=Math.max(maxObservedHeavyWork,activeWorkers+activeBackgroundWork);
    let settled=false;
    const timer=setTimeout(()=>{void finish(new HttpError(503,'이미지 처리 시간이 초과되었습니다. 원고와 이전 결과는 유지했습니다. 다시 미리보기를 만들어 주세요.'));},timeoutMs);
    const finish=async(error?:Error,bytes?:Uint8Array)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      // This process only rasterizes trusted internal SVG; it owns no jobs,
      // database writes or provider requests. Reap it before the next admission.
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
      await closed;child.removeAllListeners();activeWorkers--;activeNativePid=null;
      if(error)reject(error);else resolve(Buffer.from(bytes!));
    };
    child.once('message',(message:{bytes?:Uint8Array;error?:string;peakRssKiB?:number})=>{
      if(typeof message.peakRssKiB==='number'&&Number.isFinite(message.peakRssKiB)&&message.peakRssKiB>0){
        const childMiB=message.peakRssKiB/1024;
        maxObservedChildRssMiB=Math.max(maxObservedChildRssMiB,childMiB);
        // Conservative: the child's historical peak plus the parent's RSS at
        // receipt can over-count shared pages, but never hides the child.
        maxObservedProcessTreeMiB=Math.max(maxObservedProcessTreeMiB,process.memoryUsage().rss/2**20+childMiB);
      }
      if(message.bytes instanceof Uint8Array)void finish(undefined,message.bytes);
      else void finish(new Error(message.error??'카드 이미지 처리 결과를 확인할 수 없습니다. 원고는 유지했습니다.'));
    });
    child.once('error',error=>{void finish(error);});
    child.once('close',code=>{if(!settled)void finish(new Error(`카드 이미지 처리기가 결과 없이 종료되었습니다 (${code}). 원고는 유지했습니다.`));});
    try{child.send({svg},error=>{if(error)void finish(error);});}catch(error){void finish(error as Error);}
  });
}
