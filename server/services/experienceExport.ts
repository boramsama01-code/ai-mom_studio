import sharp, { type OverlayOptions } from "sharp";
import { Resvg } from "@resvg/resvg-js";
import type { Font } from "opentype.js";
import { loadFonts, wrapText } from "./card";
import type { StudioContent, StudioExportCheck } from "../../shared/studio";
import { HttpError } from "../routes/util";

type TextLayout={lines:string[];size:number;leading:number;fits:boolean};
function fit(font:Font,text:string,width:number,height:number,max:number,min:number):TextLayout {
 for(let size=max;size>=min;size-=2){const lines=wrapText(font,text,size,width),leading=Math.ceil(size*1.42);if(lines.length*leading<=height)return {lines,size,leading,fits:true};}
 const lines=wrapText(font,text,min,width);return {lines,size:min,leading:Math.ceil(min*1.42),fits:false};
}
function geometry(content:StudioContent,index:number){const e=content.experience!;const fonts=loadFonts();const cover=index===0;const p=e.pages[index-1];return {
 title:fit(fonts.bold,cover?content.title:p?.title??"",920,cover?220:140,cover?82:54,cover?48:36),
 body:fit(fonts.regular,cover?[e.event,e.place,e.date].filter(Boolean).join(" · "):p?.body??"",920,cover?100:230,cover?30:38,cover?24:28),
 source:fit(fonts.regular,content.sourceLabel,920,50,22,18)};}
export function checkExperienceExport(content:StudioContent):StudioExportCheck {
 const e=content.experience!;const result:StudioExportCheck={errors:[],warnings:[],pageCount:e.pages.length+1};
 if(e.pages.length<2)result.errors.push({field:"experience.pages",message:"본문을 두 장 이상 구성해 주세요. AI 초안을 만들거나 페이지를 추가할 수 있습니다."});
 if(!e.coverId)result.errors.push({field:"experience.coverId",message:"후기 표지에 쓸 사진이나 영상 대표 장면을 선택해 주세요."});
 for(let i=0;i<=e.pages.length;i++){const g=geometry(content,i),field=i?`experience.pages.${i-1}`:"title";
  if(!g.title.fits||!g.body.fits)result.errors.push({field,message:`${i?`${i+1}페이지`:"표지"} 글이 길어 출력 영역을 넘습니다. 문구를 줄여 주세요.`});
  if(i&&!e.pages[i-1].body.trim()&&!e.pages[i-1].mediaId)result.errors.push({field,message:`${i+1}페이지에 사진이나 본문을 넣어 주세요.`});
  if(!g.source.fits)result.errors.push({field:"sourceLabel",message:"출처 표기를 짧게 적어 주세요."});
 }
 const text=[content.title,content.sourceLabel,e.event,e.place,...e.pages.flatMap(p=>[p.title,p.body])].join("");
 const unsupported=[...new Set(Array.from(text))].filter(c=>c.trim()&&loadFonts().regular.charToGlyph(c).index===0);
 if(unsupported.length)result.errors.push({field:"text",message:`출력 글꼴이 지원하지 않는 기호를 글자로 바꿔 주세요: ${unsupported.slice(0,6).join(" ")}`});
 return result;
}
export function createExperienceRenderer(content:StudioContent,version:number,brand:string,accent:string,images:Map<number,Buffer>){
 const e=content.experience!,check=checkExperienceExport(content);if(check.errors.length)throw new HttpError(400,check.errors[0].message,{errors:check.errors});
 const f=loadFonts();
 const text=(font:Font,layout:TextLayout,x:number,y:number,color:string)=>layout.lines.map((line,i)=>`<path d="${font.getPath(line,x,y+i*layout.leading,layout.size).toPathData(2)}" fill="${color}"/>`).join("");
 const page=async(index:number)=>{
  if(!Number.isInteger(index)||index<0||index>=check.pageCount)throw new HttpError(400,"내보낼 페이지를 확인하세요.");
  const cover=index===0,p=e.pages[index-1],id=cover?e.coverId:p.mediaId,photo=id?images.get(id):undefined;
  if(id&&!photo)throw new HttpError(400,"영상의 대표 장면이 없습니다. 사진·영상 단계에서 장면 사진을 추가해 주세요.");
  const immersive=e.layout==="photo"&&cover;
  const bg=immersive?"#202321":"#f7f6f2",ink=immersive?"#ffffff":"#222721",muted=immersive?"#e4e5df":"#62685e";
  const overlays:OverlayOptions[]=[];
  if(photo){const width=immersive?1080:960,height=immersive?1350:690;overlays.push({input:await sharp(photo).resize(width,height,{fit:immersive?"cover":p?.fit??"contain",background:bg}).png().toBuffer(),left:immersive?0:60,top:immersive?0:148});}
  const g=geometry(content,index);let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">`;
  if(immersive)svg+='<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".40"/><stop offset=".37" stop-color="#000" stop-opacity=".04"/><stop offset=".64" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity=".92"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#shade)"/>';
  else svg+=`<rect width="64" height="5" x="80" y="100" fill="${accent}"/>`;
  svg+=text(f.semibold,fit(f.semibold,brand,730,45,27,20),80,72,ink);
  svg+=text(f.regular,fit(f.regular,`${String(index+1).padStart(2,"0")} / ${String(check.pageCount).padStart(2,"0")}`,180,45,24,22),880,72,muted);
  if(cover){
   svg+=text(f.semibold,fit(f.semibold,"직접 다녀온 기록",920,45,25,25),80,immersive?845:850,immersive?"#ffffff":accent);
   svg+=text(f.bold,g.title,80,immersive?930:930,ink);
   const y=(immersive?930:930)+(g.title.lines.length-1)*g.title.leading+65;
   svg+=text(f.regular,g.body,80,y,muted);
  }else{
   const y=photo?925:330;
   svg+=text(f.bold,g.title,80,y,ink);
   svg+=text(f.regular,g.body,80,y+(g.title.lines.length-1)*g.title.leading+70,ink);
  }
  svg+=`<line x1="80" x2="1000" y1="1275" y2="1275" stroke="${muted}" opacity=".3"/>`;
  svg+=text(f.regular,content.sourceLabel?g.source:fit(f.regular,[e.place,e.date].filter(Boolean).join(" · ")||brand,920,50,22,18),80,1310,muted)+"</svg>";
  overlays.push({input:new Resvg(svg,{font:{loadSystemFonts:false}}).render().asPng(),left:0,top:0});
  return sharp({create:{width:1080,height:1350,channels:3,background:bg}}).composite(overlays).png().toBuffer();
 };
 return {content,version,pageCount:check.pageCount,page};
}
