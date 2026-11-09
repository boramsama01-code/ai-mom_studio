import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NotionAdmissionsLayoutError} from './notionAdmissionsLayout';
export type EducationOfficeLogo={key:string;name:string;regions:string[];sourceUrl:string;sourcePage:string;sha256:string;bytes:Buffer};
let stored:Promise<EducationOfficeLogo[]>|undefined;
export function loadEducationOfficeLogos():Promise<EducationOfficeLogo[]>{
 return stored??=fs.readFile(path.resolve(process.cwd(),'assets/branding/education-office-logos.json'),'utf8').then(text=>{
  const pack=JSON.parse(text) as {assets:Array<Omit<EducationOfficeLogo,'bytes'>&{base64:string}>};
  if(!Array.isArray(pack.assets)||pack.assets.length!==16)throw Error('교육청 로고 자료를 확인해 주세요.');
  return pack.assets.map(asset=>{
   const bytes=Buffer.from(asset.base64,'base64');
   if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('교육청 로고 원본을 확인해 주세요.');
   return {...asset,bytes};
  });
 });
}
export function educationLogoKey(label:string,logos:readonly EducationOfficeLogo[]):string{
 const region=label==='의정부'?'경기':label;
 const logo=logos.find(item=>item.regions.includes(region));
 if(!logo)throw new NotionAdmissionsLayoutError(`‘${label}’ 교육청 로고를 찾을 수 없습니다. 시도 약칭 또는 의정부로 입력해 주세요. 로고를 임의로 만들지 않았습니다.`);
 return logo.key;
}
