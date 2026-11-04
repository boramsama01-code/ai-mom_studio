import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {Resvg} from '@resvg/resvg-js';
import type {CardCopyV2,FamilyPage,PageDesign} from '../../shared/familyDialogue';
import {familyReadingTextValues,type FamilyDisplayContext} from '../../shared/familyDisplay';
import {readingProfileForTemplateKey,readingImageSlot,READING_PROFILE_LOGO_ID,type ReadingTextBox,type ReadingCardProfile,type ReadingElement} from '../../shared/readingCardProfiles';
import {CardOverflowError,loadFonts,wrapText} from './card';
import {prepareReadingArtwork} from './readingCardImages';
import {loadReadingFont,wrapReadingText} from './readingCardFonts';

export type ReadingTextRun=ReadingTextBox & {text:string;lines:string[];size:number;renderedLineHeight:number};
type Options={imageDataUrl?:string;profileDataUrl?:string;imageCredit?:string;images?:ReadonlyMap<string,string>};
const escaped=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const decimal=(value:number)=>String(Math.round(value*10000)/10000);
function verifiedPng(value:string):string {
  if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('서버에서 확인한 PNG 이미지만 사용할 수 있습니다.');
  return value;
}
function splitGradient(value:string):string[] {
  const parts:string[]=[];let level=0,start=0;
  for(let index=0;index<value.length;index++) {
    if(value[index]==='(')level++;else if(value[index]===')')level--;
    else if(value[index]===','&&level===0){parts.push(value.slice(start,index).trim());start=index+1;}
    if(level<0)throw new Error('등록된 그라데이션 형식을 확인해 주세요.');
  }
  if(level!==0)throw new Error('등록된 그라데이션 형식을 확인해 주세요.');
  parts.push(value.slice(start).trim());return parts;
}
function svgColor(value:string):{color:string;opacity:number} {
  if(value==='transparent')return {color:'#000000',opacity:0};
  if(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value))return {color:value,opacity:1};
  const match=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d*\.?\d+))?\s*\)$/.exec(value);
  if(!match||[match[1],match[2],match[3]].some(part=>Number(part)>255)||Number(match[4]??1)>1)throw new Error('등록된 스타일 색상을 확인해 주세요.');
  return {color:`rgb(${match[1]},${match[2]},${match[3]})`,opacity:Number(match[4]??1)};
}
type Rectangle=Extract<ReadingElement,{kind:'rect'}>;
/** Only the finite CSS gradient grammar present in the trusted, versioned
 * layouts is accepted. Never pass arbitrary CSS, SVG, or external paint URLs. */
export function readingGradientDefinition(fill:string,box:Pick<Rectangle,'x'|'y'|'width'|'height'>,id:string):string {
  const match=/^linear-gradient\((.*)\)$/.exec(fill);
  if(!match||!/^reading-gradient-\d+$/.test(id))throw new Error('등록된 그라데이션을 확인해 주세요.');
  const parts=splitGradient(match[1]),angle=/^(-?\d+(?:\.\d+)?)deg$/.exec(parts.shift()??'');
  if(!angle||parts.length<2||parts.length>8)throw new Error('등록된 그라데이션 각도와 단계를 확인해 주세요.');
  const stops=parts.map(part=>{
    const found=/^(#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgba?\([^()]+\))(?:\s+(\d+(?:\.\d+)?)%)?$/i.exec(part);
    if(!found)throw new Error('등록된 그라데이션 색상을 확인해 주세요.');
    const offset=found[2]===undefined?null:Number(found[2])/100;
    if(offset!==null&&(offset<0||offset>1))throw new Error('등록된 그라데이션 위치를 확인해 주세요.');
    return {...svgColor(found[1]),offset};
  });
  stops[0].offset??=0;stops[stops.length-1].offset??=1;
  let previous=0;
  for(let index=1;index<stops.length;index++)if(stops[index].offset!==null){
    const end=Math.max(stops[previous].offset!,stops[index].offset!);stops[index].offset=end;
    for(let middle=previous+1;middle<index;middle++)stops[middle].offset=stops[previous].offset!+(end-stops[previous].offset!)*(middle-previous)/(index-previous);
    previous=index;
  }
  // CSS 0° points upward and 90° rightward. Project all four box corners onto
  // that direction; this preserves non-square 1080 × 1350 overlay geometry.
  const radians=Number(angle[1])*Math.PI/180,dx=Math.sin(radians),dy=-Math.cos(radians);
  const half=(Math.abs(box.width*dx)+Math.abs(box.height*dy))/2,cx=box.x+box.width/2,cy=box.y+box.height/2;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${decimal(cx-dx*half)}" y1="${decimal(cy-dy*half)}" x2="${decimal(cx+dx*half)}" y2="${decimal(cy+dy*half)}">${stops.map(stop=>`<stop offset="${decimal(stop.offset!)}" stop-color="${stop.color}" stop-opacity="${decimal(stop.opacity)}"/>`).join('')}</linearGradient>`;
}
function overflow(page:number,box:ReadingTextBox):never {
  throw new CardOverflowError(box.field,`${page}페이지 ${box.field}의 문구가 정해진 영역을 넘습니다. 글자 크기를 자동으로 줄이거나 내용을 자르지 않았습니다. 문구 또는 줄바꿈을 조정해 주세요.`);
}
function orderedLayout(profile:ReadingCardProfile,pageNumber:number,values:Readonly<Record<string,string>>,options:Options) {
  const layout=profile.pages[pageNumber-1],textRuns:ReadingTextRun[]=[],definitions:string[]=[];
  const elements=[`<rect width="1080" height="1350" fill="${escaped(layout.background)}"/>`];
  for(const [index,element] of layout.elements!.entries()) {
    if(element.kind==='rect') {
      const id=`reading-gradient-${index}`,gradient=element.fill.startsWith('linear-gradient(');
      const color=gradient?{color:`url(#${id})`,opacity:1}:svgColor(element.fill);
      if(gradient)definitions.push(readingGradientDefinition(element.fill,element,id));
      const rotation=element.rotation?` transform="rotate(${element.rotation} ${element.x+element.width/2} ${element.y+element.height/2})"`:'';
      const radius=Math.min(element.radius??0,element.width/2,element.height/2);
      elements.push(`<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${color.color}" fill-opacity="${color.opacity}" opacity="${element.opacity??1}"${element.stroke?` stroke="${escaped(element.stroke)}" stroke-width="${element.strokeWidth??1}"`:''}${rotation}/>`);
      continue;
    }
    if(element.kind==='image') {
      const data=options.images?.get(element.field)??(element.pageId==='outro'?options.profileDataUrl:options.imageDataUrl);
      if(data) {
        const clip=`reading-image-clip-${index}`;
        if(element.radius)definitions.push(`<clipPath id="${clip}"><rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${Math.min(element.radius,element.width/2,element.height/2)}"/></clipPath>`);
        const rotation=element.rotation?` transform="rotate(${element.rotation} ${element.x+element.width/2} ${element.y+element.height/2})"`:'';
        // Artwork bytes already contain crop/tone/rounding; no second crop or
        // colour operation here. A profile image retains its intrinsic ratio.
        elements.push(`<image data-field="${escaped(element.field)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" preserveAspectRatio="${element.pageId==='outro'?'xMidYMid meet':'none'}" opacity="${element.opacity??1}" href="${verifiedPng(data)}"${element.radius?` clip-path="url(#${clip})"`:''}${rotation}/>`);
      }
      continue;
    }
    const box=element,value=values[box.field]??'';
    if(!value)continue;
    const font=loadReadingFont(box.fontFamily,box.effectiveFontWeight??box.fontWeight),spacing=box.letterSpacing??0;
    const lines=wrapReadingText(font,value,box.fontSize,box.width,spacing),lineHeight=box.fontSize*box.lineHeight;
    if(lines.length>box.maxLines||lines.length*lineHeight>box.height+.01||lines.some(line=>font.measure(line,box.fontSize,spacing)>box.width+.01))overflow(pageNumber,box);
    const paths:string[]=[];
    lines.forEach((line,lineIndex)=>{
      if(!line)return;
      const width=font.measure(line,box.fontSize,spacing),x=box.align==='right'?box.x+box.width-width:box.align==='center'?box.x+(box.width-width)/2:box.x;
      const baseline=box.y+font.baseline(box.fontSize,lineHeight)+lineIndex*lineHeight;
      const pathData=font.path(line,x,baseline,box.fontSize,spacing);
      // The supplied Noto KR family has no italic file. Apply the source's
      // synthetic oblique explicitly; never silently render it upright.
      const italic=box.fontStyle==='italic'?` transform="translate(${decimal(baseline*Math.tan(12*Math.PI/180))} 0) skewX(-12)"`:'';
      paths.push(`<path d="${pathData}"${italic}/>`);
    });
    let shadow='';
    if(box.shadow) {
      const match=/^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+0(?:px)?\s+(#[0-9a-f]{6})$/i.exec(box.shadow);
      if(!match)throw new Error('등록된 글자 그림자 형식을 확인해 주세요.');
      shadow=`<g transform="translate(${match[1]} ${match[2]})" fill="${match[3]}">${paths.join('')}</g>`;
    }
    elements.push(`<g data-field="${escaped(box.field)}" opacity="${box.opacity??1}">${shadow}<g fill="${escaped(box.color)}">${paths.join('')}</g></g>`);
    textRuns.push({...box,text:value,lines,size:box.fontSize,renderedLineHeight:lineHeight});
  }
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><title>${escaped(profile.label+' · '+pageNumber)}</title><defs>${definitions.join('')}</defs>${elements.join('')}</svg>`,textRuns};
}

/** The same 46 values, fixed rectangles, and image ratios used by Autofill. */
export function layoutReadingCard(copy:CardCopyV2,page:FamilyPage,context:FamilyDisplayContext={},options:Options={}) {
  const profile=readingProfileForTemplateKey(copy.templateKey);
  if(!profile) throw new Error('읽는 카드뉴스 스타일을 확인해 주세요.');
  const values=familyReadingTextValues(copy,context,{[page.id]:{imageCredit:options.imageCredit??context.imageCredit??''}});
  return layoutReadingProfilePage(profile,page.page,values,options);
}

/** Registered geometry plus canonical field values, also used by offline QA.
 * This function does not fetch URLs or accept runtime templates from a model. */
export function layoutReadingProfilePage(profile:ReadingCardProfile,pageNumber:number,values:Readonly<Record<string,string>>,options:Options={}) {
  const layout=profile.pages[pageNumber-1];
  if(!layout)throw new Error('카드뉴스 페이지 번호를 확인해 주세요.');
  if(layout.elements)return orderedLayout(profile,pageNumber,values,options);
  // The two original reading profiles intentionally keep their existing font,
  // line wrapping, and compositing order. New IDs do not reinterpret old work.
  const fonts=loadFonts(), textRuns:ReadingTextRun[]=[];
  const elements=[`<rect width="1080" height="1350" fill="${layout.background}"/>`];
  for(const shape of layout.shapes) elements.push(shape.type==='rect'
    ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill}"${shape.stroke?` stroke="${shape.stroke}" stroke-width="${shape.strokeWidth??1}"`:''}/>`
    : `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"/>`);
  for(const slot of layout.imageBoxes) {
    const data=slot.kind==='profile'?options.profileDataUrl:options.imageDataUrl;
    if(data) {
      elements.push(`<image x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" preserveAspectRatio="xMidYMid meet" href="${verifiedPng(data)}"/>`);
    }
  }
  for(const box of layout.textBoxes) {
    const value=values[box.field]??'';
    if(!value) continue;
    const font=fonts[box.fontWeight>=700?'bold':box.fontWeight>=500?'semibold':'regular'];
    const lines=wrapText(font,value,box.fontSize,box.width),lineHeight=box.fontSize*box.lineHeight;
    if(lines.length>box.maxLines||lines.length*lineHeight>box.height||lines.some(line=>font.getAdvanceWidth(line,box.fontSize,{kerning:true})>box.width+.01)) overflow(pageNumber,box);
    lines.forEach((line,index)=>{
      const width=font.getAdvanceWidth(line,box.fontSize,{kerning:true}),x=box.align==='right'?box.x+box.width-width:box.align==='center'?box.x+(box.width-width)/2:box.x;
      elements.push(`<path d="${font.getPath(line,x,box.y+box.fontSize*.94+index*lineHeight,box.fontSize).toPathData(2)}" fill="${box.color}"/>`);
    });
    textRuns.push({...box,text:value,lines,size:box.fontSize,renderedLineHeight:lineHeight});
  }
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><title>${escaped(profile.label+' · '+pageNumber)}</title>${elements.join('')}</svg>`,textRuns};
}

let profileLogo:{hash:string;data:string}|undefined;
export function approvedReadingProfileLogo(copy:CardCopyV2):string {
  const profile=readingProfileForTemplateKey(copy.templateKey),outro=copy.pages.find(page=>page.id==='outro');
  if(!profile||!outro||outro.id!=='outro'||outro.fields.logoAssetId!==READING_PROFILE_LOGO_ID) throw new Error('이 스타일의 승인된 ALL 프로필을 선택해 주세요.');
  if(profileLogo?.hash===profile.profileImageSha256) return profileLogo.data;
  const bytes=fs.readFileSync(path.resolve(process.cwd(),profile.profileImagePath));
  if(createHash('sha256').update(bytes).digest('hex')!==profile.profileImageSha256) throw new Error('승인된 ALL 프로필 이미지가 변경됐습니다. 원본을 확인해 주세요.');
  profileLogo={hash:profile.profileImageSha256,data:`data:image/png;base64,${bytes.toString('base64')}`};return profileLogo.data;
}
export async function renderReadingCard(copy:CardCopyV2,page:FamilyPage,design:PageDesign,context:FamilyDisplayContext={},image:Buffer|null=null,imageCredit='') {
  const profile=readingProfileForTemplateKey(copy.templateKey)!;
  const slot=readingImageSlot(profile,page.id);
  const bytes=slot?.kind==='artwork'?await prepareReadingArtwork(image,design,slot,profile.pages[page.page-1].background):null;
  const {svg}=layoutReadingCard(copy,page,context,{imageDataUrl:bytes?`data:image/png;base64,${bytes.toString('base64')}`:undefined,imageCredit,profileDataUrl:page.id==='outro'?approvedReadingProfileLogo(copy):undefined});
  return sharp(new Resvg(svg,{font:{loadSystemFonts:false}}).render().asPng()).flatten({background:'#ffffff'}).toColorspace('srgb').removeAlpha().jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
}
export function readingPageText(copy:CardCopyV2,page:FamilyPage,context:FamilyDisplayContext={}):string[] {
  const profile=readingProfileForTemplateKey(copy.templateKey)!;
  const values=familyReadingTextValues(copy,context);
  return profile.pages[page.page-1].textBoxes.map(box=>values[box.field]).filter(Boolean);
}
