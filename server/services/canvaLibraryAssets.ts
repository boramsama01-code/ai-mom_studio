import sharp from 'sharp';
import { unzipSync } from 'fflate';
import type { CanvaLibraryStoredPage } from '../../shared/schema';
import { CANVA_LIBRARY_PREVIEW_MAX_WIDTH, CANVA_LIBRARY_PREVIEW_MAX_HEIGHT, CANVA_LIBRARY_PREVIEW_MAX_PIXELS, canvaLibraryPreviewGeometry } from '../../shared/canvaTemplateLibrary';
import { HttpError } from '../routes/util';
import { safeFetch, FetchFailure } from './safeFetch';
import { sha256 } from './text';

const MAX_PAGE_BYTES=2*1024*1024, MAX_TOTAL_BYTES=32*1024*1024, MAX_CACHED_PAGE_BYTES=1024*1024;
export const CANVA_LIBRARY_DOWNLOAD_BUDGET_MS=18_000;
type Download={name:string;bytes:Buffer;pageNumber?:number};
export type LibraryPreviewImage={page:number;bytes:Buffer;mime:string;width:number;height:number;sha256:string};
const invalid=()=>new HttpError(422,'Canva 미리보기의 파일·크기·페이지 순서를 확인할 수 없습니다. 마지막 정상 미리보기를 유지합니다.',{code:'preview_invalid'});
const retryDownload=()=>new HttpError(503,'Canva 미리보기 다운로드가 지연되어 현재 작업 ID로 잠시 후 다시 확인합니다. 마지막 정상 미리보기는 유지합니다.',{code:'preview_download_retry'});
function remainingBudget(deadline:number){const remaining=deadline-Date.now();if(remaining<=0)throw retryDownload();return remaining;}

/** Canva already scales PNGs at export. Reject original-sized/oversized files
 * before decoding pixels; metadata and cache keep the same source page ratio. */
export async function decodeCanvaLibraryExport(downloads:Download[],pages:CanvaLibraryStoredPage[],deadline=Date.now()+CANVA_LIBRARY_DOWNLOAD_BUDGET_MS):Promise<LibraryPreviewImage[]> {
  if(!pages.length||pages.length>20||pages.some((page,index)=>page.pageNumber!==index+1||!page.width||!page.height))throw invalid();
  const geometry=canvaLibraryPreviewGeometry(pages);if(!geometry)throw invalid();
  const totalLimit=Math.min(MAX_TOTAL_BYTES,pages.length*MAX_PAGE_BYTES);
  if(downloads.reduce((total,file)=>total+file.bytes.length,0)>totalLimit)throw invalid();
  remainingBudget(deadline);
  let entries=downloads;
  if(downloads.length===1&&downloads[0].bytes.subarray(0,2).toString()==='PK'){
    let total=0,count=0,unsafe=false;
    const files=unzipSync(downloads[0].bytes,{filter:file=>{
      if(!file.name.toLowerCase().endsWith('.png'))return false;
      total+=file.originalSize;count++;
      if(file.originalSize>MAX_PAGE_BYTES||total>totalLimit||count>pages.length||/(^|\/)\.\.(\/|$)/.test(file.name)){unsafe=true;return false;}
      return true;
    }});
    if(unsafe)throw invalid();
    // Keep a view of the bounded unzip buffer; a second full archive-sized
    // Buffer copy would needlessly double peak memory on the 512 MiB service.
    entries=Object.entries(files).map(([name,bytes])=>({name,bytes:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)}));
  }
  if(entries.length!==pages.length)throw invalid();
  const numbered=entries.map(entry=>{
    const basename=entry.name.split('/').at(-1)??'';
    const match=/^(?:page[-_ ]*)?0*([1-9]\d?)(?:[-_. ]|$)/i.exec(basename)??/[-_ ]0*([1-9]\d?)\.png$/i.exec(basename);
    return {...entry,page:entry.pageNumber??(match?Number(match[1]):pages.length===1?1:null)};
  });
  if(numbered.some(entry=>entry.page===null||entry.page<1||entry.page>pages.length)||new Set(numbered.map(entry=>entry.page)).size!==pages.length)throw invalid();
  numbered.sort((a,b)=>a.page!-b.page!);
  const images:LibraryPreviewImage[]=[];let total=0;
  for(const entry of numbered){
    remainingBudget(deadline);
    total+=entry.bytes.length;if(entry.bytes.length>MAX_PAGE_BYTES||total>totalLimit)throw invalid();
    const expected=geometry.pages[entry.page!-1],meta=await sharp(entry.bytes,{limitInputPixels:CANVA_LIBRARY_PREVIEW_MAX_PIXELS,animated:true}).metadata();
    // The requested axis is exact; Canva may round the other axis by one pixel.
    const widthTolerance=geometry.format.width===undefined?1:0,heightTolerance=geometry.format.height===undefined?1:0;
    if(meta.format!=='png'||!meta.width||!meta.height||meta.width>CANVA_LIBRARY_PREVIEW_MAX_WIDTH||meta.height>CANVA_LIBRARY_PREVIEW_MAX_HEIGHT
      ||Math.abs(meta.width-expected.width)>widthTolerance||Math.abs(meta.height-expected.height)>heightTolerance||(meta.pages??1)!==1)throw invalid();
    const output=await sharp(entry.bytes,{limitInputPixels:CANVA_LIBRARY_PREVIEW_MAX_PIXELS}).webp({quality:82}).toBuffer({resolveWithObject:true});
    if(output.data.length>MAX_CACHED_PAGE_BYTES)throw invalid();
    images.push({page:entry.page!-1,bytes:output.data,mime:'image/webp',width:output.info.width,height:output.info.height,sha256:sha256(output.data)});
  }
  remainingBudget(deadline);
  return images;
}

export async function downloadCanvaLibraryExport(urls:string[],pages:CanvaLibraryStoredPage[],fetcher=safeFetch){
  if((urls.length!==1&&urls.length!==pages.length)||!canvaLibraryPreviewGeometry(pages))throw invalid();
  const deadline=Date.now()+CANVA_LIBRARY_DOWNLOAD_BUDGET_MS,totalLimit=Math.min(MAX_TOTAL_BYTES,pages.length*MAX_PAGE_BYTES);
  const downloads:Download[]=[];let total=0;
  for(const [index,value] of urls.entries()){
    const url=new URL(value);
    if(url.protocol!=='https:'||url.port||url.username||url.password||!(url.hostname==='canva.com'||url.hostname.endsWith('.canva.com')))throw invalid();
    let response:Awaited<ReturnType<typeof safeFetch>>;
    try{response=await fetcher(value,{maxBytes:urls.length===1?totalLimit:MAX_PAGE_BYTES,timeoutMs:remainingBudget(deadline),accept:'image/png,application/zip',allowedHosts:[url.hostname]});}
    catch(error){if(error instanceof FetchFailure&&(['timeout','network'].includes(error.kind)||error.kind==='http'&&(error.status===429||(error.status??0)>=500)))throw retryDownload();throw error;}
    total+=response.body.length;if(total>totalLimit)throw invalid();
    downloads.push({name:url.pathname,bytes:response.body,...(urls.length===pages.length?{pageNumber:index+1}:{})});
  }
  return decodeCanvaLibraryExport(downloads,pages,deadline);
}
