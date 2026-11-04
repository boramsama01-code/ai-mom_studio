import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import type { DB } from '../db';
import { HttpError } from '../routes/util';
import { loadCardPageArtworkAsset } from './cardPageArtwork';
import { safeFetch } from './safeFetch';
import { sha256 } from './text';
import type { CardCopyV2, PageDesigns } from '../../shared/familyDialogue';
import { FAMILY_PAGE_COLORS } from '../../shared/familyDialogueTheme';
import { CANVA_APPROVED_PARENT_LOGO, CANVA_PAGE_IDS } from '../../shared/canvaEditorial';

export function canonicalJson(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const canvaInputHash=(value:unknown)=>sha256(canonicalJson(value));

/** Text remains in Canva. Only the selected photograph/background is prepared here. */
export async function prepareCanvaImages(db:DB,a:{itemId:number;channelId:number;copy:CardCopyV2;pageDesigns:PageDesigns}) {
  const images:Array<{field:string;bytes:Buffer;hash:string}>=[];
  for(const [index,id] of CANVA_PAGE_IDS.entries()){
    if(id==='outro') continue;
    const design=a.pageDesigns[id],bg=design.background;
    if(design.alignment!=='center') throw new HttpError(422,'등록된 Canva 마스터는 중앙 정렬입니다. 중앙 정렬을 선택하거나 자체 이미지로 만들어 주세요.');
    // The approved reading-news cover is full bleed, like the body background
    // frames. Cropping, focal point and overlay therefore survive Autofill.
    const width=1080,height=1350;
    const color=bg.color ?? FAMILY_PAGE_COLORS[id];
    let bytes:Buffer;
    if(bg.kind==='image'){
      const image=await loadCardPageArtworkAsset(db,a.itemId,a.channelId,bg.assetId!);
      const rotated=await sharp(image.bytes,{limitInputPixels:40_000_000}).rotate().toBuffer();
      const meta=await sharp(rotated).metadata();
      if(!meta.width || !meta.height) throw new HttpError(422,'배경 이미지 크기를 확인할 수 없습니다.');
      if(bg.fit==='cover'){
        const scale=Math.max(width/meta.width,height/meta.height),rw=Math.max(width,Math.round(meta.width*scale)),rh=Math.max(height,Math.round(meta.height*scale));
        const left=Math.round((rw-width)*bg.focalX/100),top=Math.round((rh-height)*bg.focalY/100);
        bytes=await sharp(rotated).resize(rw,rh).extract({left,top,width,height}).modulate({brightness:Math.max(.01,bg.brightness/100)}).png().toBuffer();
      }else bytes=await sharp(rotated).resize(width,height,{fit:'contain',background:color}).modulate({brightness:Math.max(.01,bg.brightness/100)}).png().toBuffer();
      if(bg.overlay>0){
        const overlay=await sharp({create:{width,height,channels:4,background:{...hexRgb(color),alpha:bg.overlay/100}}}).png().toBuffer();
        bytes=await sharp(bytes).composite([{input:overlay}]).png().toBuffer();
      }
    }else bytes=await sharp({create:{width,height,channels:3,background:color}}).png().toBuffer();
    images.push({field:index===0?'P01_IMAGE':`P0${index+1}_BACKGROUND`,bytes,hash:sha256(bytes)});
  }
  const outro=a.copy.pages.find(p=>p.id==='outro')!;
  if(outro.fields.logoAssetId!==CANVA_APPROVED_PARENT_LOGO) throw new HttpError(422,'닫는 표지에 승인된 우주펭귄상회 로고를 선택해 주세요. 임의 로고로 바꾸지 않았습니다.');
  const logo=await fs.readFile(path.resolve(process.cwd(),'assets/branding/space-penguin-company.png'));
  images.push({field:'P08_LOGO',bytes:logo,hash:sha256(logo)});
  return images;
}
function hexRgb(hex:string){return{r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)}}

const MAX_PAGE_BYTES=15*1024*1024,MAX_EXPORT_BYTES=80*1024*1024;
const pageNumber=(name:string):number|null=>{
  const base=name.split('/').at(-1)?.replace(/\?.*$/,'') ?? '';
  const m=/^(?:page[-_ ]*)?0*([1-8])(?:[-_. ]|$)/i.exec(base) ?? /[-_ ]0*([1-8])\.png$/i.exec(base);
  return m?Number(m[1]):null;
};

/** Use documented API page order, or explicit archive page numbers; never guess opaque filenames. */
export async function decodeCanvaExport(downloads:Array<{name:string;bytes:Buffer;pageNumber?:number}>):Promise<Buffer[]> {
  let entries=downloads;
  if(downloads.length===1 && downloads[0].bytes.subarray(0,2).toString()==='PK'){
    let total=0,count=0,unsafe=false;
    const files=unzipSync(downloads[0].bytes,{filter:file=>{
      if(!file.name.toLowerCase().endsWith('.png')) return false;
      total+=file.originalSize;count++;
      if(file.originalSize>MAX_PAGE_BYTES || total>MAX_EXPORT_BYTES || count>8 || /(^|\/)\.\.(\/|$)/.test(file.name)){unsafe=true;return false;}
      return true;
    }});
    if(unsafe) throw new HttpError(422,'Canva 내보내기 파일 크기 또는 구성이 안전 한도를 초과했습니다.');
    entries=Object.entries(files).map(([name,bytes])=>({name,bytes:Buffer.from(bytes)}));
  }
  if(entries.length!==8) throw new HttpError(422,`Canva에서 8장 대신 ${entries.length}개 파일을 받았습니다. 기존 이미지는 유지합니다.`);
  const numbered=entries.map(e=>({...e,page:e.pageNumber ?? pageNumber(e.name)}));
  if(numbered.some(e=>e.page===null||!Number.isInteger(e.page)||e.page!<1||e.page!>8) || new Set(numbered.map(e=>e.page)).size!==8) throw new HttpError(422,'Canva 출력의 페이지 순서를 확인할 수 없습니다. 순서를 추측해 저장하지 않았습니다.');
  numbered.sort((a,b)=>a.page!-b.page!);
  const output:Buffer[]=[];let totalBytes=0;
  for(const entry of numbered){
    if(entry.bytes.length>MAX_PAGE_BYTES) throw new HttpError(422,'Canva 페이지 파일이 15MB를 초과합니다.');
    totalBytes+=entry.bytes.length;if(totalBytes>MAX_EXPORT_BYTES)throw new HttpError(422,'Canva 전체 출력이 80MB를 초과합니다.');
    const metadata=await sharp(entry.bytes,{limitInputPixels:1_458_000,animated:true}).metadata();
    if(metadata.format!=='png' || metadata.width!==1080 || metadata.height!==1350 || (metadata.pages ?? 1)!==1) throw new HttpError(422,`${entry.page}장의 실제 PNG 크기가 1080×1350이 아닙니다.`);
    output.push(entry.bytes);
  }
  return output;
}

export async function downloadCanvaExport(urls:string[],fetcher= safeFetch){
  if(urls.length!==1 && urls.length!==8) throw new HttpError(422,'Canva 내보내기 응답의 파일 개수를 확인할 수 없습니다.');
  const downloads:Array<{name:string;bytes:Buffer;pageNumber?:number}>=[];let totalBytes=0;
  for(const [index,url] of urls.entries()){
    const u=new URL(url);
    if(u.protocol!=='https:' || u.username || u.password || !(u.hostname==='canva.com'||u.hostname.endsWith('.canva.com'))) throw new HttpError(422,'Canva 출력 주소를 확인할 수 없습니다.');
    const r=await fetcher(url,{maxBytes:urls.length===1?MAX_EXPORT_BYTES:MAX_PAGE_BYTES,timeoutMs:20_000,accept:'image/png,application/zip',allowedHosts:[u.hostname]});
    totalBytes+=r.body.length;if(totalBytes>MAX_EXPORT_BYTES)throw new HttpError(422,'Canva 전체 출력이 80MB를 초과합니다.');
    // Canva's GET /exports response explicitly orders URLs by page. URL paths
    // are opaque signed download addresses, not a page-number contract.
    downloads.push({name:u.pathname,bytes:r.body,...(urls.length===8?{pageNumber:index+1}:{})});
  }
  return decodeCanvaExport(downloads);
}

/** Instagram accepts JPEG. Keep the 8 original PNGs and make this derivative only once. */
export async function publicationJpegs(pngs:Buffer[]){
  const images:Buffer[]=[];
  for(const png of pngs) images.push(await sharp(png).flatten({background:'#ffffff'}).toColorspace('srgb').jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer());
  return images;
}
