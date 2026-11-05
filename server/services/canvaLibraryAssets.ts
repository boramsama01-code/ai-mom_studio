import sharp from 'sharp';
import { unzipSync } from 'fflate';
import type { CanvaLibraryStoredPage } from '../../shared/schema';
import { HttpError } from '../routes/util';
import { safeFetch } from './safeFetch';
import { sha256 } from './text';

const MAX_PAGE_BYTES=15*1024*1024, MAX_TOTAL_BYTES=80*1024*1024;
type Download={name:string;bytes:Buffer;pageNumber?:number};
export type LibraryPreviewImage={page:number;bytes:Buffer;mime:string;width:number;height:number;sha256:string};
const invalid=()=>new HttpError(422,'Canva 미리보기의 파일·크기·페이지 순서를 확인할 수 없습니다. 마지막 정상 미리보기를 유지합니다.',{code:'preview_invalid'});

/** Decode only validated original page images, then cache small bytes at the same ratio. */
export async function decodeCanvaLibraryExport(downloads:Download[],pages:CanvaLibraryStoredPage[]):Promise<LibraryPreviewImage[]> {
  if(!pages.length||pages.length>20||pages.some((page,index)=>page.pageNumber!==index+1||!page.width||!page.height))throw invalid();
  let entries=downloads;
  if(downloads.length===1&&downloads[0].bytes.subarray(0,2).toString()==='PK'){
    let total=0,count=0,unsafe=false;
    const files=unzipSync(downloads[0].bytes,{filter:file=>{
      if(!file.name.toLowerCase().endsWith('.png'))return false;
      total+=file.originalSize;count++;
      if(file.originalSize>MAX_PAGE_BYTES||total>MAX_TOTAL_BYTES||count>pages.length||/(^|\/)\.\.(\/|$)/.test(file.name)){unsafe=true;return false;}
      return true;
    }});
    if(unsafe)throw invalid();
    entries=Object.entries(files).map(([name,bytes])=>({name,bytes:Buffer.from(bytes)}));
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
    total+=entry.bytes.length;if(entry.bytes.length>MAX_PAGE_BYTES||total>MAX_TOTAL_BYTES)throw invalid();
    const expected=pages[entry.page!-1],meta=await sharp(entry.bytes,{limitInputPixels:40_000_000,animated:true}).metadata();
    if(meta.format!=='png'||meta.width!==expected.width||meta.height!==expected.height||(meta.pages??1)!==1)throw invalid();
    const output=await sharp(entry.bytes,{limitInputPixels:40_000_000}).resize({width:540,height:720,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
    if(output.data.length>3*1024*1024)throw invalid();
    images.push({page:entry.page!-1,bytes:output.data,mime:'image/webp',width:output.info.width,height:output.info.height,sha256:sha256(output.data)});
  }
  return images;
}

export async function downloadCanvaLibraryExport(urls:string[],pages:CanvaLibraryStoredPage[],fetcher=safeFetch){
  if(urls.length!==1&&urls.length!==pages.length)throw invalid();
  const downloads:Download[]=[];let total=0;
  for(const [index,value] of urls.entries()){
    const url=new URL(value);
    if(url.protocol!=='https:'||url.port||url.username||url.password||!(url.hostname==='canva.com'||url.hostname.endsWith('.canva.com')))throw invalid();
    const response=await fetcher(value,{maxBytes:urls.length===1?MAX_TOTAL_BYTES:MAX_PAGE_BYTES,timeoutMs:20_000,accept:'image/png,application/zip',allowedHosts:[url.hostname]});
    total+=response.body.length;if(total>MAX_TOTAL_BYTES)throw invalid();
    downloads.push({name:url.pathname,bytes:response.body,...(urls.length===pages.length?{pageNumber:index+1}:{})});
  }
  return decodeCanvaLibraryExport(downloads,pages);
}
