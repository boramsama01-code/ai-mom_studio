import type {NotionInteriorTemplate} from '../../shared/notionPageTemplates';
import {institutionScheduleElements,NotionAdmissionsLayoutError,parseInstitutionSchedule,type AdmissionsElement} from './notionAdmissionsLayout';
import {admissionsTimelineElements,parseAdmissionsTimeline} from './notionAdmissionsTimeline';

const fail=(message:string):never=>{throw new NotionAdmissionsLayoutError(message);};
const nonempty=(value:string,message:string)=>value.trim()?value:fail(message);
const lines=(body:string)=>body.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean);
export function parseInteriorColumns(body:string):[string,string]{
 const parts=body.replace(/\r\n?/g,'\n').split('\n---\n');
 if(parts.length!==2||parts.some(part=>!part.trim()))fail('2단 텍스트의 왼쪽·오른쪽 내용을 각각 입력해 주세요. 원고를 자르지 않았습니다.');
 return parts as [string,string];
}
export function parseInteriorProcess(body:string):Array<{label:string;description:string}>{
 const source=lines(body);
 if(source.shift()?.split('|').map(value=>value.trim()).join('|')!=='단계|내용')fail('단계도의 단계·내용을 입력해 주세요.');
 if(source.length<2||source.length>5)fail('단계도는 실제 단계 2~5개로 나누어 주세요.');
 return source.map(line=>{const cells=line.split('|').map(value=>value.trim());if(cells.length!==2||cells.some(value=>!value))fail('각 단계의 이름과 설명을 빈칸 없이 입력해 주세요.');return {label:cells[0],description:cells[1]};});
}
export function parseInteriorBars(body:string):Array<{label:string;source:string;value:number}>{
 const source=lines(body);
 if(source.shift()?.split('|').map(value=>value.trim()).join('|')!=='항목|값')fail('막대그래프의 항목과 값을 입력해 주세요.');
 if(!source.length||source.length>8)fail('막대그래프는 실제 수치 1~8개로 나누어 주세요.');
 return source.map(line=>{
  const cells=line.split('|').map(value=>value.trim());
  if(cells.length!==2||!cells[0]||!/^\d+(?:\.\d+)?$/.test(cells[1])||!Number.isFinite(Number(cells[1])))fail('그래프 값은 단위나 쉼표 없이 0 이상의 실제 숫자로 입력해 주세요.');
  return {label:cells[0],source:cells[1],value:Number(cells[1])};
 });
}
export function validateInteriorTemplateBody(template:NotionInteriorTemplate,body:string):void{
 if(template==='text'||template==='image_text')nonempty(body,'본문을 입력해 주세요.');
 else if(template==='two_columns')parseInteriorColumns(body);
 else if(template==='table')parseInstitutionSchedule(body);
 else if(template==='timeline')parseAdmissionsTimeline(body);
 else if(template==='process')parseInteriorProcess(body);
 else parseInteriorBars(body);
}
/** Native, source-driven elements. No model call, inferred value, or copy truncation. */
export function interiorTemplateElements(template:NotionInteriorTemplate,body:string,accent:string,measure:(text:string,size:number,bold:boolean)=>number):{intro:string;elements:AdmissionsElement[]}{
 const out:AdmissionsElement[]=[];
 const rect=(name:string,x:number,y:number,width:number,height:number,fill:string,pill=false)=>out.push({kind:'rect',name,x,y,width,height,fill,pill});
 const text=(name:string,content:string,x:number,y:number,width:number,height:number,max=36,min=26,bold=false,align:'l'|'ctr'='l',ink='#171717',middle=false)=>out.push({kind:'text',name,content,x,y,width,height,max,min,bold,align,ink,verticalAlign:middle?'middle':'top',leading:1.25});
 if(template==='text'||template==='image_text'){
  nonempty(body,'본문을 입력해 주세요.');
  text('interior-body',body,template==='image_text'?552:64,336,template==='image_text'?464:952,860,template==='image_text'?36:40,template==='image_text'?26:28);
 }else if(template==='two_columns'){
  const [left,right]=parseInteriorColumns(body);
  rect('interior-column-divider',539,336,2,860,'#E1DFDC');
  text('interior-column-left',left,64,336,444,860,36,26);
  text('interior-column-right',right,572,336,444,860,36,26);
 }else if(template==='table'){
  const model=parseInstitutionSchedule(body),scaleX=952/888,scaleY=860/614;
  return {intro:model.intro,elements:institutionScheduleElements(model).map(element=>({...element,x:64+(element.x-96)*scaleX,y:336+(element.y-450)*scaleY,width:element.width*scaleX,height:element.height*scaleY}))};
 }else if(template==='timeline'){
  const model=parseAdmissionsTimeline(body);return {intro:model.intro,elements:admissionsTimelineElements(model,measure)};
 }else if(template==='process'){
  const steps=parseInteriorProcess(body),gap=16,height=(860-gap*(steps.length-1))/steps.length;
  steps.forEach((step,index)=>{
   const top=336+index*(height+gap);
   rect(`interior-step-${index}-background`,64,top,952,height,index%2?'#FAF9F7':'#F4F2EE');
   rect(`interior-step-${index}-accent`,64,top,6,height,accent);
   text(`interior-step-${index}-number`,String(index+1).padStart(2,'0'),82,top+16,52,height-32,24,20,true,'ctr',accent,true);
   text(`interior-step-${index}-label`,step.label,152,top+16,232,height-32,32,24,true,'l','#171717',true);
   text(`interior-step-${index}-description`,step.description,416,top+16,576,height-32,30,22,false,'l','#171717',true);
  });
 }else{
  const rows=parseInteriorBars(body),height=Math.min(128,860/rows.length),maximum=Math.max(...rows.map(row=>row.value));
  rows.forEach((row,index)=>{
   const top=336+index*height;
   text(`interior-chart-${index}-label`,row.label,64,top+8,208,height-16,28,22,true,'ctr','#171717',true);
   rect(`interior-chart-${index}-track`,296,top+height*.4,556,28,'#F0EEEA',true);
   if(row.value>0&&maximum>0)rect(`interior-chart-${index}-bar`,296,top+height*.4,Math.max(1,556*(row.value/maximum)),28,accent,true);
   text(`interior-chart-${index}-value`,row.source,872,top+8,144,height-16,30,22,true,'ctr','#171717',true);
  });
 }
 return {intro:'',elements:out};
}
