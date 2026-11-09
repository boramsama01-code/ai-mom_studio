import {NotionAdmissionsLayoutError,type AdmissionsElement} from './notionAdmissionsLayout';
import {educationLogoKey,type EducationOfficeLogo} from './educationOfficeLogos';
export const LOGO_CALENDAR_KINDS=['시작','마감','사전','조건부'] as const;
export type LogoCalendarEvent={day:number;kind:typeof LOGO_CALENDAR_KINDS[number];region:string;logoKey:string};
export type LogoCalendar={intro:string;year:number;month:number;days:number;firstWeekday:number;weeks:number;events:LogoCalendarEvent[]};
const COLORS={시작:'#2563EB',마감:'#D83A30',사전:'#9B6200',조건부:'#666666'};
const FILLS={시작:'#EEF4FF',마감:'#FFF1ED',사전:'#FFF5D9',조건부:'#F2F2F2'};
const fail=(message:string):never=>{throw new NotionAdmissionsLayoutError(message);};
export function parseLogoCalendar(body:string,title:string,logos:readonly EducationOfficeLogo[]):LogoCalendar{
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean);let intro='';
 if(lines.length&&!lines[0].includes('|'))intro=lines.shift()!;
 const months=[...`${title}\n${intro}`.matchAll(/(\d{4})년\s*(\d{1,2})월/g)].map(m=>({year:Number(m[1]),month:Number(m[2])}));
 if(!months.length)fail('로고 달력 제목 또는 소제목에 연도와 월을 적어 주세요. 예: 2026년 11월');
 const {year,month}=months[0];
 if(year<1900||year>2199||month<1||month>12||months.some(m=>m.year!==year||m.month!==month))fail('로고 달력의 연도·월을 확인해 주세요.');
 if(!lines.length||lines.length>48)fail('로고 달력은 일정 1~48행으로 작성해 주세요. 한 행에는 교육청 한 곳만 적어 주세요.');
 const days=new Date(Date.UTC(year,month,0)).getUTCDate(),firstWeekday=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 const events=lines.map(line=>{
  const fields=line.split('|').map(s=>s.trim());
  if(fields.length!==3||fields.some(s=>!s))fail('로고 달력은 날짜 | 시작·마감·사전·조건부 | 시도 형식으로 작성해 주세요.');
  const [date,kind,region]=fields,match=/^(\d{1,2})\/(\d{1,2})$/.exec(date),day=Number(match?.[2]);
  if(!match||Number(match[1])!==month||day<1||day>days)fail('로고 달력에 해당 월의 실제 날짜를 적어 주세요.');
  if(!LOGO_CALENDAR_KINDS.includes(kind as typeof LOGO_CALENDAR_KINDS[number]))fail('일정 종류는 시작·마감·사전·조건부 중 하나로 적어 주세요.');
  return {day,kind:kind as LogoCalendarEvent['kind'],region,logoKey:educationLogoKey(region,logos)};
 });
 if(new Set(events.map(e=>`${e.day}|${e.kind}|${e.region}`)).size!==events.length)fail('로고 달력에 같은 일정이 중복되어 있습니다.');
 for(const day of new Set(events.map(e=>e.day)))if(events.filter(e=>e.day===day).length>6)fail(`${month}/${day}에 로고가 너무 많습니다. 날짜 범위별 달력으로 나눠 주세요. 누락하지 않았습니다.`);
 return {intro,year,month,days,firstWeekday,weeks:Math.ceil((firstWeekday+days)/7),events};
}
export function logoCalendarElements(model:LogoCalendar):AdmissionsElement[]{
 const out:AdmissionsElement[]=[],x=96,y=442,width=888,height=622,col=width/7;
 const rect=(name:string,left:number,top:number,w:number,h:number,fill:string,pill=false)=>out.push({kind:'rect',name,x:left,y:top,width:w,height:h,fill,pill});
 const text=(name:string,content:string,left:number,top:number,w:number,h:number,size:number,ink='#171717',bold=false,align:'l'|'ctr'='l')=>out.push({kind:'text',name,content,x:left,y:top,width:w,height:h,max:size,min:size,ink,bold,align,leading:1.1});
 const legend=[['마감','학생 접수 마감'],['시작','접수 시작'],['사전','사전 제출'],['조건부','조건부 추가']] as const;
 legend.forEach(([kind,label],i)=>{rect(`logo-calendar-legend-${i}-bar`,x+i*222,377,5,19,COLORS[kind]);text(`logo-calendar-legend-${i}`,label,x+i*222+13,374,205,25,20,COLORS[kind],true);});
 ['일','월','화','수','목','금','토'].forEach((label,i)=>text(`logo-calendar-weekday-${i}`,label,x+i*col,408,col,28,22,i===0?'#D83A30':i===6?'#2563EB':'#171717',true,'ctr'));
 const weekCounts=Array.from({length:model.weeks},(_,week)=>Math.max(0,...Array.from({length:7},(_,weekday)=>model.events.filter(e=>e.day===week*7+weekday-model.firstWeekday+1).length)));
 const minimums=weekCounts.map(count=>34+count*52),minimum=minimums.reduce((a,b)=>a+b,0);
 if(minimum>height)fail('로고와 지역명이 충분히 보이도록 달력을 기간별 두 장으로 나눠 주세요. 작은 로고로 축소하거나 일정을 빼지 않았습니다.');
 const extra=(height-minimum)/model.weeks,rows=minimums.map(min=>min+extra);let top=y;
 rect('logo-calendar-grid',x,y,width,height,'#DADADA');
 for(let week=0;week<model.weeks;week++){
  for(let weekday=0;weekday<7;weekday++){
   const cell=week*7+weekday,day=cell-model.firstWeekday+1,left=x+weekday*col,rowHeight=rows[week],valid=day>=1&&day<=model.days;
   rect(`logo-calendar-cell-${cell}`,left+.5,top+.5,col-1,rowHeight-1,valid?'#FFFFFF':'#F7F5F2');
   if(!valid)continue;
   text(`logo-calendar-day-${day}`,String(day),left+7,top+1,45,32,28,weekday===0?'#D83A30':weekday===6?'#2563EB':'#171717',true);
   const events=model.events.filter(e=>e.day===day);
   events.forEach((event,index)=>{
    const itemTop=top+34+index*52;
    rect(`logo-calendar-event-${day}-${index}-background`,left+5,itemTop,col-10,50,FILLS[event.kind]);
    rect(`logo-calendar-event-${day}-${index}-status`,left+5,itemTop,3,50,COLORS[event.kind]);
    out.push({kind:'image',name:`logo-calendar-event-${day}-${index}-logo`,mediaKey:event.logoKey,altText:`${event.region} 교육청 대표 로고 · ${model.month}/${day} ${event.kind}`,x:left+12,y:itemTop+2,width:col-24,height:24});
    text(`logo-calendar-event-${day}-${index}-region`,event.region,left+9,itemTop+27,col-18,22,20,COLORS[event.kind],true,'ctr');
   });
  }
  top+=rows[week];
 }
 return out;
}
