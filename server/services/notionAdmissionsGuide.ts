import type { AdmissionsElement } from './notionAdmissionsLayout';
import { NotionAdmissionsLayoutError } from './notionAdmissionsLayout';

export type AdmissionsGuide={intro:string;courseMode:'fields'|'institutions';courses:string[][];steps:string[][];documents:string[][]};
const fail=(message:string):never=>{throw new NotionAdmissionsLayoutError(message);};
const HEADINGS=['[모집]','[전형]','[서류]'] as const;
const DOCUMENT_STATES=['공통','조건부','없음명시','미확인','선택'] as const;
export function parseAdmissionsGuide(body:string):AdmissionsGuide{
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean);
 let intro='';if(lines.length&&!lines[0].startsWith('[')&&!lines[0].includes('|'))intro=lines.shift()!;
 const sections:string[][][]=[[],[],[]];let section=-1,courseMode:AdmissionsGuide['courseMode']='fields';
 for(const line of lines){
  const heading=line==='[기관별 모집]'?0:HEADINGS.indexOf(line as typeof HEADINGS[number]);
  if(heading>=0){if(heading!==section+1)fail('지원 안내는 [모집] 또는 [기관별 모집] → [전형] → [서류] 순서로 한 번씩 입력해 주세요.');if(line==='[기관별 모집]')courseMode='institutions';section=heading;continue;}
  if(section<0||line.startsWith('['))fail('지원 안내에 [모집], [전형], [서류] 제목을 모두 넣어 주세요. 문구를 생략하지 않았습니다.');
  const cells=line.split('|').map(s=>s.trim()),count=section===2?2:3;
  if(cells.length!==count||cells.some(s=>!s))fail(`${HEADINGS[section]} 항목은 빈칸 없이 ${count}개 열로 입력해 주세요.`);
  if(section===2&&!DOCUMENT_STATES.includes(cells[0] as typeof DOCUMENT_STATES[number]))fail('서류 상태는 공통·조건부·없음명시·미확인·선택 중 하나로 적어 주세요. 미기재를 불필요로 판단하지 마세요.');
  sections[section].push(cells);
 }
 const [courses,steps,documents]=sections;
 if(courses.length<1||courses.length>6)fail('모집분야·현재 학년은 1~6행으로 나눠 주세요. 다른 지원 조건은 보충 장으로 분리해 주세요.');
 if(steps.length<2||steps.length>5)fail('전형 과정은 실제 원문에 있는 2~5단계로 작성해 주세요. 날짜가 다른 과정은 별도 장으로 나눠 주세요.');
 if(documents.length<1||documents.length>3||section!==2)fail('제출물은 [서류] 아래 1~3행으로 작성하고, 조건부 제출은 적용 대상을 함께 적어 주세요.');
 return {intro,courseMode,courses,steps,documents};
}

/** Every cell is native text; text fitting is shared by SVG and editable PPTX. */
export function admissionsGuideElements(model:AdmissionsGuide,accent:string):AdmissionsElement[]{
 const out:AdmissionsElement[]=[],x=96,w=888;
 const rect=(name:string,left:number,top:number,width:number,height:number,fill:string,pill=false)=>out.push({kind:'rect',name,x:left,y:top,width,height,fill,pill});
 const text=(name:string,content:string,left:number,top:number,width:number,height:number,max:number,min=max,bold=false,ink='#171717',align:'l'|'ctr'='l')=>out.push({kind:'text',name,content,x:left,y:top,width,height,max,min,ink,bold,align,leading:1.15});
 text('guide-courses-label','모집분야 · 지원 현재 학년',x,410,w,28,22,22,true);
 const widths=model.courseMode==='institutions'?[260,270,358]:[230,190,468],top=448,header=38,rowHeight=Math.min(86,256/model.courses.length);
 rect('guide-courses-grid',x,top,w,header+model.courses.length*rowHeight,'#DADADA');
 const row=(cells:string[],index:number,y:number,height:number,isHeader=false)=>{
  let left=x;cells.forEach((cell,col)=>{rect(`guide-course-${index}-${col}-background`,left+.5,y+.5,widths[col]-1,height-1,isHeader?'#F0EEEA':index%2?'#FFFFFF':'#FAF9F7');out.push({kind:'text',name:`guide-course-${index}-${col}`,content:cell,x:left+10,y:y+4,width:widths[col]-20,height:height-8,max:isHeader?22:26,min:isHeader?22:model.courseMode==='institutions'?22:24,bold:isHeader||col===0,ink:'#171717',align:'ctr',verticalAlign:'middle',leading:1.15});left+=widths[col];});
 };
 row(model.courseMode==='institutions'?['기관·과정','분야 · 현재 학년','제출 단계별 기한']:['분야','현재 학년','대상 기관·과정'],0,top,header,true);
 model.courses.forEach((cells,i)=>row(cells,i+1,top+header+i*rowHeight,rowHeight));
 text('guide-steps-label','전형 과정 · 각 단계의 마감',x,748,w,28,22,22,true);
 const gap=10,stepWidth=(w-gap*(model.steps.length-1))/model.steps.length;
 model.steps.forEach(([label,date,description],index)=>{
  const left=x+index*(stepWidth+gap);
  rect(`guide-step-${index+1}-card`,left,786,stepWidth,142,'#F6F5F1');
  text(`guide-step-${index+1}-number`,String(index+1).padStart(2,'0'),left+10,790,stepWidth-20,22,18,18,true,accent);
  text(`guide-step-${index+1}-label`,label,left+10,813,stepWidth-20,27,24,22,true);
  text(`guide-step-${index+1}-date`,date,left+10,843,stepWidth-20,28,24,22,true,accent);
  text(`guide-step-${index+1}-description`,description,left+10,874,stepWidth-20,48,22,20);
  if(index<model.steps.length-1)rect(`guide-step-${index+1}-connector`,left+stepWidth,850,gap,2,'#B4B0A9');
 });
 text('guide-documents-label','제출물 · 적용 대상과 기한',x,943,w,28,22,22,true);
 const colors:Record<string,string>={공통:'#E7F3EA',조건부:'#FFF0C2',없음명시:'#E7F3EA',미확인:'#EEEEEE',선택:'#E9F0FA'};
 model.documents.forEach(([state,description],index)=>{
  const y=976+index*28;
  rect(`guide-document-${index+1}-badge`,x,y+1,92,25,colors[state],true);
  text(`guide-document-${index+1}-state`,state,x+4,y+1,84,25,20,20,true,'#171717','ctr');
  text(`guide-document-${index+1}-description`,description,x+104,y,w-104,27,23,21);
 });
 return out;
}
