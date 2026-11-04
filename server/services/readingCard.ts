import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {Resvg} from '@resvg/resvg-js';
import type {CardCopyV2,FamilyPage,PageDesign} from '../../shared/familyDialogue';
import {familyReadingTextValues,type FamilyDisplayContext} from '../../shared/familyDisplay';
import {readingProfileForTemplateKey,readingImageSlot,READING_PROFILE_LOGO_ID,type ReadingTextBox} from '../../shared/readingCardProfiles';
import {CardOverflowError,loadFonts,wrapText} from './card';
import {prepareReadingArtwork} from './readingCardImages';

export type ReadingTextRun=ReadingTextBox & {text:string;lines:string[];size:number;renderedLineHeight:number};
type Options={imageDataUrl?:string;profileDataUrl?:string;imageCredit?:string};
const escaped=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/** The same 46 values, fixed rectangles, and image ratios used by Autofill. */
export function layoutReadingCard(copy:CardCopyV2,page:FamilyPage,context:FamilyDisplayContext={},options:Options={}) {
  const profile=readingProfileForTemplateKey(copy.templateKey);
  if(!profile) throw new Error('읽는 카드뉴스 스타일을 확인해 주세요.');
  const layout=profile.pages[page.page-1], fonts=loadFonts(), textRuns:ReadingTextRun[]=[];
  const values=familyReadingTextValues(copy,context,{[page.id]:{imageCredit:options.imageCredit??context.imageCredit??''}});
  const elements=[`<rect width="1080" height="1350" fill="${layout.background}"/>`];
  for(const shape of layout.shapes) elements.push(shape.type==='rect'
    ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill}"${shape.stroke?` stroke="${shape.stroke}" stroke-width="${shape.strokeWidth??1}"`:''}/>`
    : `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"/>`);
  for(const slot of layout.imageBoxes) {
    const data=slot.kind==='profile'?options.profileDataUrl:options.imageDataUrl;
    if(data) {
      if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error('서버에서 확인한 PNG 이미지만 사용할 수 있습니다.');
      elements.push(`<image x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" preserveAspectRatio="xMidYMid meet" href="${data}"/>`);
    }
  }
  for(const box of layout.textBoxes) {
    const value=values[box.field]??'';
    if(!value) continue;
    const font=fonts[box.fontWeight>=700?'bold':box.fontWeight>=500?'semibold':'regular'];
    const lines=wrapText(font,value,box.fontSize,box.width),lineHeight=box.fontSize*box.lineHeight;
    if(lines.length>box.maxLines||lines.length*lineHeight>box.height||lines.some(line=>font.getAdvanceWidth(line,box.fontSize,{kerning:true})>box.width+.01)) throw new CardOverflowError(box.field,`${page.page}페이지 ${box.field}의 문구가 정해진 영역을 넘습니다. 글자 크기를 자동으로 줄이거나 내용을 자르지 않았습니다. 문구 또는 줄바꿈을 조정해 주세요.`);
    lines.forEach((line,index)=>{
      const width=font.getAdvanceWidth(line,box.fontSize,{kerning:true}),x=box.align==='right'?box.x+box.width-width:box.align==='center'?box.x+(box.width-width)/2:box.x;
      elements.push(`<path d="${font.getPath(line,x,box.y+box.fontSize*.94+index*lineHeight,box.fontSize).toPathData(2)}" fill="${box.color}"/>`);
    });
    textRuns.push({...box,text:value,lines,size:box.fontSize,renderedLineHeight:lineHeight});
  }
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><title>${escaped(profile.label+' · '+page.page)}</title>${elements.join('')}</svg>`,textRuns};
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
