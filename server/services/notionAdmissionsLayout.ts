export class NotionAdmissionsLayoutError extends Error {}
export type AdmissionsEvent={day:number;kind:'시작'|'마감';description:string};
export type AdmissionsCalendar={intro:string;year:number;month:number;days:number;firstWeekday:number;weeks:number;events:AdmissionsEvent[]};
export type InstitutionSchedule={intro:string;headers:string[];rows:string[][]};
export type AdmissionsElement=
 | {kind:'rect';name:string;x:number;y:number;width:number;height:number;fill:string;pill?:boolean}
 | {kind:'image';name:string;mediaKey:string;altText:string;x:number;y:number;width:number;height:number}
 | {kind:'text';name:string;content:string;x:number;y:number;width:number;height:number;max:number;min:number;ink:string;bold?:boolean;align?:'l'|'ctr';verticalAlign?:'top'|'middle';leading?:number};
type Wrap=(text:string,size:number,width:number,bold:boolean)=>string[];
// Keep region tokens intact and retain every separator on the preceding line.
function regionLines(value:string,size:number,width:number,wrap:Wrap):string|null{
 if(!value.includes('·'))return value;
 const parts=value.split('·').map(part=>part.trim()),lines:string[]=[];let current='';
 for(const [i,part]of parts.entries()){
  const token=part+(i<parts.length-1?'·':'');
  if(wrap(token,size,width,false).length>1)return null;
  if(current&&wrap(current+token,size,width,false).length>1){lines.push(current);current=token;}else current+=token;
 }
 if(current)lines.push(current);
 return lines.join('\n');
}
const fail=(message:string):never=>{throw new NotionAdmissionsLayoutError(message);};
const START='#2563EB',END='#D83A30',INK='#171717';
export const ADMISSIONS_CALENDAR_MAX_EVENTS=32;
export const INSTITUTION_SCHEDULE_MAX_ROWS=8;
export const ADMISSIONS_GRID={x:96,y:414,width:888,height:650} as const;
function sourceLines(body:string){
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean);
 let intro='';
 if(lines.length&&!lines[0].includes('|'))intro=lines.shift()!;
 if(lines.some(line=>!line.includes('|')))fail('도식 소제목은 맨 앞 한 줄로 작성하고, 나머지는 |로 나눈 행으로 입력해 주세요. 문구를 생략하지 않았습니다.');
 return {intro,lines};
}
function cells(line:string,count=3):string[]{
 const parts=line.split('|').map(s=>s.trim());
 if(parts.length<2||parts.length>4||count&&parts.length!==count||parts.some(s=>!s)||parts.every(s=>/^:?-+:?$/.test(s)))fail(count===3?'각 행을 빈칸 없이 3개 항목으로 작성해 주세요. 예: 날짜 | 시작 또는 마감 | 시도':`일정표는 머리글과 같은 ${count||'2~4'}개 열로, 각 항목을 빈칸 없이 작성해 주세요.`);
 return parts;
}
export function parseAdmissionsCalendar(body:string,title:string):AdmissionsCalendar{
 const {intro,lines}=sourceLines(body);
 const months=[...`${title}\n${intro}`.matchAll(/(\d{4})년\s*(\d{1,2})월/g)].map(m=>({year:Number(m[1]),month:Number(m[2])}));
 if(!months.length)fail('달력 제목 또는 소제목에 연도와 월을 적어 주세요. 예: 2026년 11월 · 학생 지원');
 const {year,month}=months[0];
 if(year<1900||year>2199||month<1||month>12||months.some(m=>m.year!==year||m.month!==month))fail('달력의 연도·월이 올바르고 제목과 소제목이 서로 같은지 확인해 주세요.');
 if(!lines.length||lines.length>ADMISSIONS_CALENDAR_MAX_EVENTS)fail(`모집 달력은 일정 1~${ADMISSIONS_CALENDAR_MAX_EVENTS}행으로 작성해 주세요. 많은 일정은 기관별 표로 나눠 주세요.`);
 const days=new Date(Date.UTC(year,month,0)).getUTCDate(),firstWeekday=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 const events=lines.map(line=>{
  const [date,kind,description]=cells(line),match=/^(\d{1,2})\/(\d{1,2})$/.exec(date),dateMonth=Number(match?.[1]),day=Number(match?.[2]);
  if(!match||dateMonth!==month||day<1||day>days)fail('달력 날짜는 해당 월의 실제 날짜로 적어 주세요. 예: 11/10');
  if(kind!=='시작'&&kind!=='마감')fail('달력 일정 종류는 시작 또는 마감으로 적어 주세요. 예: 11/10 | 시작 | 부산·전북');
  return {day,kind,description} as AdmissionsEvent;
 });
 for(const day of new Set(events.map(e=>e.day)))if(events.filter(e=>e.day===day).length>2)fail(`${month}/${day} 일정은 한 칸에 최대 2개까지 표시할 수 있습니다. 시도 약칭으로 묶고 기관 상세는 다음 표로 나눠 주세요.`);
 if(new Set(events.map(e=>`${e.day}|${e.kind}|${e.description}`)).size!==events.length)fail('달력에 같은 일정이 중복되어 있습니다. 날짜·종류·기관 문구를 확인해 주세요.');
 return {intro,year,month,days,firstWeekday,weeks:Math.ceil((firstWeekday+days)/7),events};
}
export function parseInstitutionSchedule(body:string):InstitutionSchedule{
 const {intro,lines}=sourceLines(body);
 if(lines.length<2||lines.length>INSTITUTION_SCHEDULE_MAX_ROWS+1)fail(`기관별 일정표는 머리글 다음에 기관 1~${INSTITUTION_SCHEDULE_MAX_ROWS}행을 입력해 주세요. 긴 표는 여러 장으로 나눠 주세요.`);
 const headers=cells(lines[0],0);
 return {intro,headers,rows:lines.slice(1).map(line=>cells(line,headers.length))};
}
export function admissionsCalendarElements(model:AdmissionsCalendar,wrap:Wrap):AdmissionsElement[]{
 const out:AdmissionsElement[]=[],{x,y,width,height}=ADMISSIONS_GRID,col=width/7,row=height/model.weeks;
 const rect=(name:string,left:number,top:number,w:number,h:number,fill:string,pill=false)=>out.push({kind:'rect',name,x:left,y:top,width:w,height:h,fill,pill});
 const text=(name:string,content:string,left:number,top:number,w:number,h:number,size:number,ink=INK,bold=false,align:'l'|'ctr'='l',leading=1.2)=>out.push({kind:'text',name,content,x:left,y:top,width:w,height:h,max:size,min:size,ink,bold,align,leading});
 ['일','월','화','수','목','금','토'].forEach((label,i)=>text(`calendar-weekday-${i}`,label,x+i*col,375,col,32,24,i===0?END:i===6?START:INK,true,'ctr'));
 rect('calendar-grid',x,y,width,height,'#DADADA');
 for(let cell=0;cell<model.weeks*7;cell++){
  const day=cell-model.firstWeekday+1,left=x+(cell%7)*col,top=y+Math.floor(cell/7)*row;
  const valid=day>=1&&day<=model.days,events=valid?model.events.filter(e=>e.day===day):[];
  rect(`calendar-cell-${cell}`,left+.5,top+.5,col-1,row-1,valid?(events.length===1?(events[0].kind==='시작'?'#F0F6FF':'#FFF3F0'):'#FFFFFF'):'#F7F5F2');
  if(!valid)continue;
  text(`calendar-day-${day}`,String(day),left+8,top+3,44,40,30,cell%7===0?END:cell%7===6?START:INK,true);
  if(!events.length)continue;
  if(events.length===1){
   const event=events[0],ink=event.kind==='시작'?START:END;
   rect(`calendar-event-${day}-0-tag-background`,left+col-56,top+11,48,25,event.kind==='시작'?'#DFEBFF':'#FFE0DA',true);
   text(`calendar-event-${day}-0-label`,event.kind,left+col-54,top+12,44,23,18,ink,true,'ctr');
   const available=row-51;
   let size=26,description=regionLines(event.description,size,col-16,wrap);
   while(size>=22&&(!description||wrap(description,size,col-16,false).length*size*1.2>available)){size-=2;description=regionLines(event.description,size,col-16,wrap);}
   if(size<22)fail(`${model.month}/${day} 달력 문구가 깁니다. 시도 약칭만 남기고 기관 상세는 다음 표로 나눠 주세요. 문구를 자르지 않았습니다.`);
   text(`calendar-event-${day}-0-description`,description!,left+8,top+47,col-16,available,size,ink);
  }else{
   const available=row-45,descriptionWidth=col-50;
   let size=26,descriptions=events.map(event=>regionLines(event.description,size,descriptionWidth,wrap));
   const required=()=>descriptions.some(d=>!d)?Infinity:descriptions.reduce((n,description)=>n+wrap(description!,size,descriptionWidth,false).length*size*1.2,0)+2;
   while(size>=22&&required()>available){size-=2;descriptions=events.map(event=>regionLines(event.description,size,descriptionWidth,wrap));}
   if(size<22)fail(`${model.month}/${day} 달력 문구가 한 칸에 많습니다. 시도 약칭으로 줄이거나 일정을 나눠 주세요. 문구를 자르지 않았습니다.`);
   let offset=43;
   events.forEach((event,i)=>{
    const ink=event.kind==='시작'?START:END,h=wrap(descriptions[i]!,size,descriptionWidth,false).length*size*1.2;
    text(`calendar-event-${day}-${i}-label`,event.kind,left+6,top+offset+2,36,24,18,ink,true);
    text(`calendar-event-${day}-${i}-description`,descriptions[i]!,left+44,top+offset,descriptionWidth,h,size,ink);
    offset+=h+2;
   });
  }
 }
 return out;
}
export function institutionScheduleGeometry(model:InstitutionSchedule){
 const x=96,y=450,headerHeight=50,rowHeight=Math.min(144,(1064-y-headerHeight)/model.rows.length),height=headerHeight+rowHeight*model.rows.length;
 return {x,y,headerHeight,rowHeight,height,footerY:y+height+8};
}
export function institutionScheduleElements(model:InstitutionSchedule):AdmissionsElement[]{
 const out:AdmissionsElement[]=[],{x,y,headerHeight,rowHeight,height}=institutionScheduleGeometry(model),widths=model.headers.length===2?[444,444]:model.headers.length===3?[360,264,264]:[300,196,196,196];
 const addRow=(values:string[],rowIndex:number,top:number,height:number,header=false)=>{
  let left=x;
  values.forEach((content,col)=>{
   let cellHeight=height;
   if(!header&&col===0&&model.headers[0]==='지역'&&content){
    if(rowIndex>1&&model.rows[rowIndex-2][0]===content){left+=widths[col];return;}
    let end=rowIndex;
    while(end<model.rows.length&&model.rows[end][0]===content)end++;
    cellHeight=height*(end-rowIndex+1);
   }
   out.push({kind:'rect',name:`schedule-cell-${rowIndex}-${col}-background`,x:left+.5,y:top+.5,width:widths[col]-1,height:cellHeight-1,fill:header?'#F0EEEA':rowIndex%2?'#FFFFFF':'#FAF9F7'});
   out.push({kind:'text',name:`schedule-cell-${rowIndex}-${col}-text`,content,x:left+12,y:top+8,width:widths[col]-24,height:cellHeight-16,max:header?26:28,min:26,ink:INK,bold:header||col===0,align:'ctr',verticalAlign:'middle',leading:1.2});
   left+=widths[col];
  });
 };
 out.push({kind:'rect',name:'schedule-grid',x,y,width:888,height,fill:'#DADADA'});
 addRow(model.headers,0,y,headerHeight,true);
 model.rows.forEach((values,index)=>addRow(values,index+1,y+headerHeight+index*rowHeight,rowHeight));
 return out;
}
