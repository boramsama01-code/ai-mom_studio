import {NotionAdmissionsLayoutError,type AdmissionsElement} from './notionAdmissionsLayout';

export const ADMISSIONS_TIMELINE_MAX_ROWS=10;
export const ADMISSIONS_TIMELINE_BOUNDS={x:64,y:336,width:952,bottom:1196} as const;
export const ADMISSIONS_TIMELINE_KINDS=['학생 접수','추가 모집','사전 제출','연계 접수'] as const;
type TimelineKind=typeof ADMISSIONS_TIMELINE_KINDS[number];
type TimelineDate={source:string;day:number;instant:number;label:string};
export type AdmissionsTimelineRow={region?:string;label:string;kind:TimelineKind;start:TimelineDate;end:TimelineDate};
export type AdmissionsTimeline={intro:string;rows:AdmissionsTimelineRow[];firstDay:number;lastDay:number};
const DAY=86400000;
const fail=(message:string):never=>{throw new NotionAdmissionsLayoutError(message);};
const COLORS:Record<TimelineKind,string>={'학생 접수':'#2563EB','추가 모집':'#D83A30','사전 제출':'#9B6200','연계 접수':'#7855A5'};
function parseDate(source:string,end:boolean):TimelineDate{
 const match=/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(source);
 if(!match)fail('기간표 날짜는 YYYY-MM-DD 또는 YYYY-MM-DD HH:mm으로 적어 주세요. 미확인 시작일을 임의로 채우지 마세요.');
 const [,ys,ms,ds,hs,mins]=match!,year=Number(ys),month=Number(ms),date=Number(ds),hour=Number(hs??0),minute=Number(mins??0);
 const day=Date.UTC(year,month-1,date),check=new Date(day);
 if(year<1900||year>2199||check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==date||minute>59||hour>24||hour===24&&(!end||minute!==0))fail('기간표의 실제 날짜와 시각을 확인해 주세요. 24:00은 마감일에만 쓸 수 있습니다.');
 return {source,day,instant:day+(hour*60+minute)*60000,label:`${month}/${date}${hs===undefined?'':` ${hs}:${mins}`}`};
}
/** Each row is one real interval. Never infer a missing endpoint or merge rows. */
export function parseAdmissionsTimeline(body:string):AdmissionsTimeline{
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean);let intro='';
 if(lines.length&&!lines[0].includes('|'))intro=lines.shift()!;
 const header=lines.shift()?.split('|').map(s=>s.trim());
 const regional=header?.join('|')==='지역|기관·과정|시작일|마감일|구분';
 if(!regional&&header?.join('|')!=='기관·과정|시작일|마감일|구분')fail('기간표 머리글은 기관·과정 | 시작일 | 마감일 | 구분으로 입력해 주세요. 지역 셀을 병합하려면 앞에 지역 열을 추가하세요.');
 if(!lines.length||lines.length>ADMISSIONS_TIMELINE_MAX_ROWS)fail(`모집 기간표는 실제 기간 1~${ADMISSIONS_TIMELINE_MAX_ROWS}행으로 나눠 주세요. 서로 다른 기간은 별도 행으로 적어 주세요.`);
 const rows=lines.map(line=>{
  const cells=line.split('|').map(s=>s.trim());if(cells.length!==(regional?5:4)||cells.some((s,i)=>!s&&!(regional&&i===1)))fail('기간표는 기관·과정 | 시작일 | 마감일 | 구분 4개 항목으로 작성해 주세요. 지역 열이 있으면 기관·과정만 비워 둘 수 있습니다.');
  const region=regional?cells.shift():undefined;
  const [label,startSource,endSource,kind]=cells;
  if(!ADMISSIONS_TIMELINE_KINDS.includes(kind as TimelineKind))fail('기간표 구분은 학생 접수·추가 모집·사전 제출·연계 접수 중 하나로 적어 주세요.');
  const start=parseDate(startSource,false),end=parseDate(endSource,true);
  if(end.day<start.day||end.day===start.day&&startSource.includes(' ')&&endSource.includes(' ')&&end.instant<start.instant)fail('기간표 마감일은 시작일보다 빠를 수 없습니다.');
  return {...(region?{region}:{}),label,kind:kind as TimelineKind,start,end};
 });
 if(new Set(rows.map(row=>`${row.region??''}|${row.label}|${row.start.source}|${row.end.source}|${row.kind}`)).size!==rows.length)fail('기간표에 같은 기관·과정과 기간이 중복되어 있습니다.');
 const firstDay=Math.min(...rows.map(row=>row.start.day)),lastDay=Math.max(...rows.map(row=>row.end.day));
 if(lastDay-firstDay>366*DAY)fail('기간표는 1년 이내 실제 일정으로 나눠 주세요. 먼 기간을 하나의 막대로 합치지 마세요.');
 return {intro,rows,firstDay,lastDay};
}
/** Full-page interior coordinates. Bars show date positions; clock labels stay explicit. */
export function admissionsTimelineElements(model:AdmissionsTimeline,measure:(text:string,size:number,bold:boolean)=>number=(value,size)=>value.length*size*.65):AdmissionsElement[]{
 const out:AdmissionsElement[]=[],{x,y,width,bottom}=ADMISSIONS_TIMELINE_BOUNDS,labelWidth=260,header=64,rowHeight=Math.min(128,(bottom-y-header)/model.rows.length);
 const axisLeft=x+labelWidth+32,axisRight=x+width-42,span=Math.max(DAY,model.lastDay-model.firstDay),at=(day:number)=>axisLeft+(day-model.firstDay)/span*(axisRight-axisLeft);
 const rect=(name:string,left:number,top:number,w:number,h:number,fill:string,pill=false)=>out.push({kind:'rect',name,x:left,y:top,width:w,height:h,fill,pill});
 const text=(name:string,content:string,left:number,top:number,w:number,h:number,size:number,min=size,ink='#171717',bold=false)=>out.push({kind:'text',name,content,x:left,y:top,width:w,height:h,max:size,min,ink,bold,align:'ctr',verticalAlign:'middle',leading:1.2});
 const kinds=[...new Set(model.rows.map(row=>row.kind))];
 kinds.forEach((kind,i)=>{const left=x+i*238;rect(`timeline-legend-${i}-bar`,left,302,24,8,COLORS[kind],true);text(`timeline-legend-${i}`,kind,left+30,291,200,30,22,20,COLORS[kind],true);});
 rect('timeline-grid',x,y,width,header+rowHeight*model.rows.length,'#DADADA');
 rect('timeline-header-label-background',x+.5,y+.5,labelWidth-1,header-1,'#F0EEEA');
 rect('timeline-header-dates-background',x+labelWidth+.5,y+.5,width-labelWidth-1,header-1,'#F0EEEA');
 const regional=model.rows.some(row=>row.region),regionWidth=86;
 if(regional){rect('timeline-header-region-background',x+.5,y+.5,regionWidth-1,header-1,'#F0EEEA');text('timeline-header-region','지역',x+8,y+8,regionWidth-16,header-16,26,24,'#171717',true);text('timeline-header-label','기관·과정',x+regionWidth+8,y+8,labelWidth-regionWidth-16,header-16,26,24,'#171717',true);}
 else text('timeline-header-label','지역·기관',x+8,y+8,labelWidth-16,header-16,26,24,'#171717',true);
 const days=Math.round((model.lastDay-model.firstDay)/DAY),tickCount=Math.min(6,days+1);
 const ticks=Array.from({length:tickCount},(_,i)=>model.firstDay+Math.round(i*days/Math.max(1,tickCount-1))*DAY);
 ticks.forEach((day,i)=>{const date=new Date(day),left=at(day);text(`timeline-tick-${i}`,`${date.getUTCMonth()+1}/${date.getUTCDate()}`,left-40,y+12,80,40,21,19,'#555555',true);});
 // Merge only adjacent matching regions; individual periods always keep a row.
 const groups=new Map<number,{end:number;region:string;split:boolean}>();
 for(let i=0;i<model.rows.length;){const region=model.rows[i].region??model.rows[i].label;let end=i+1;while(end<model.rows.length&&(model.rows[end].region??model.rows[end].label)===region)end++;groups.set(i,{end,region,split:regional&&model.rows.slice(i,end).some(row=>!!row.label)});i=end;}
 model.rows.forEach((row,index)=>{
  const top=y+header+index*rowHeight,fill=index%2?'#FAF9F7':'#FFFFFF',ink=COLORS[row.kind];
  rect(`timeline-row-${index}-dates-background`,x+labelWidth+.5,top+.5,width-labelWidth-1,rowHeight-1,fill);
  for(const [i,day]of ticks.entries())rect(`timeline-row-${index}-tick-${i}`,at(day)-.5,top+1,1,rowHeight-2,'#ECEBE7');
  const group=groups.get(index),owner=[...groups.entries()].find(([start,g])=>start<=index&&g.end>index)![1];
  if(group){const mergedHeight=(group.end-index)*rowHeight,mergedWidth=group.split?regionWidth:labelWidth;rect(`timeline-row-${index}-region-background`,x+.5,top+.5,mergedWidth-1,mergedHeight-1,'#F8F7F4');text(`timeline-row-${index}-region`,group.region,x+8,top+8,mergedWidth-16,mergedHeight-16,28,22,'#171717',true);}
  if(owner.split){rect(`timeline-row-${index}-label-background`,x+regionWidth+.5,top+.5,labelWidth-regionWidth-1,rowHeight-1,fill);text(`timeline-row-${index}-label`,row.label,x+regionWidth+8,top+8,labelWidth-regionWidth-16,rowHeight-16,28,22,'#171717',true);}
  const left=at(row.start.day),right=at(row.end.day),barWidth=Math.max(6,right-left),barY=top+rowHeight*.28;
  rect(`timeline-row-${index}-bar`,left-(right===left?3:0),barY,barWidth,18,ink,true);
  const dates=`${row.start.label} → ${row.end.label}`,dateWidth=Math.min(width-labelWidth-16,Math.max(140,Math.ceil(measure(dates,24,true)+16)));
  const dateLeft=Math.max(x+labelWidth+8,Math.min(x+width-8-dateWidth,left+barWidth/2-dateWidth/2));
  text(`timeline-row-${index}-dates`,dates,dateLeft,top+rowHeight*.54,dateWidth,rowHeight*.38,24,20,ink,true);
 });
 return out;
}
