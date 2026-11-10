import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import sharp from 'sharp';
import {buildNotionCanvaPptx,decodeNotionCanvaPngExport,NOTION_CANVA_MAX_OUTPUT_PAGES,type NotionCanvaDocument} from '../server/services/notionCanva';
import {parseAdmissionsCalendar,parseInstitutionSchedule} from '../server/services/notionAdmissionsLayout';

const calendarBody='2026년 11월 · 학생 신규/추가 접수\n11/10 | 시작 | 부산·전북\n11/10 | 마감 | 전남\n11/11 | 마감 | 서울·울산\n11/12 | 마감 | 충남·부산\n11/13 | 마감 | 대전·충북·전남·경북\n11/17 | 마감 | 전북';
const document=(infographic:'admissions_calendar'|'institution_schedule',body=calendarBody):NotionCanvaDocument=>({title:'전국 교육청 영재교육원',coverStyle:'A',category:'영재교육',pages:[{title:'일단 지원해보세요',body:'전국 교육청 영재교육원'},{title:infographic==='admissions_calendar'?'11월 지원 일정 캘린더':'기관별 지원 일정',body,infographic,footnote:'시간 미기재는 확인 필요 · 현재 학년과 내년도 과정 구분',sourceLabel:'2026.11.10 확인 · 학생 지원 기준'}]});
const shape=(source:string,name:string)=>{
 const xml=[...source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(m=>m[1].includes(`name="${name}"`))?.[1];expect(xml).toBeTruthy();
 const bounds=xml!.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
 return {xml:xml!,x:Number(bounds[1])/9525,y:Number(bounds[2])/9525,w:Number(bounds[3])/9525,h:Number(bounds[4])/9525};
};
const plain=(source:string)=>[...source.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join('').replace(/\s/g,'');
const slide=(bytes:Buffer,page=2)=>strFromU8(unzipSync(bytes)[`ppt/slides/slide${page}.xml`]);
const expandedX=(x:number)=>64+(x-96)*952/888,expandedY=(y:number)=>64+(y-207)*1222/936;
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Native diagrams must not contact an external service');})));
afterEach(()=>vi.unstubAllGlobals());

describe('bounded admissions diagram parsing',()=>{
 it('uses the actual year/month and Sunday-first weekday, including leap years',()=>{
  expect(parseAdmissionsCalendar(calendarBody,'11월 지원 일정')).toMatchObject({year:2026,month:11,days:30,firstWeekday:0,weeks:5});
  expect(parseAdmissionsCalendar('2028년 2월\n2/29 | 마감 | 서울','2월 일정')).toMatchObject({days:29,firstWeekday:2,weeks:5});
  expect(parseAdmissionsCalendar('2026년 8월\n8/31 | 마감 | 서울','8월 일정')).toMatchObject({days:31,firstWeekday:6,weeks:6});
 });
 it.each([
  ['2026년 2월\n2/29 | 마감 | 서울','실제 날짜'],
  ['2026년 11월\n12/1 | 마감 | 서울','실제 날짜'],
  ['2026년 11월\n11/31 | 마감 | 서울','실제 날짜'],
  ['2026년 11월\n11/10 | 추천 | 서울','시작 또는 마감'],
  ['2026년 11월\n11/10 | 마감','3개 항목'],
  ['2026년 11월\n11/10 | 마감 | ','빈칸'],
  ['2026년 11월\n설명 두 번째 줄\n11/10 | 마감 | 서울','맨 앞 한 줄'],
  ['11월 학생 지원\n11/10 | 마감 | 서울','연도와 월'],
  ['2026년 11월\n11/10 | 마감 | 서울\n11/10 | 마감 | 서울','중복'],
  ['2026년 11월\n11/10 | 시작 | 부산\n11/10 | 마감 | 서울\n11/10 | 마감 | 울산','최대 2개'],
 ])('rejects malformed calendar input without dropping rows: %s',(body,message)=>expect(()=>parseAdmissionsCalendar(body,'지원 달력')).toThrow(message));
 it('rejects conflicting month headings and excessive events',()=>{
  expect(()=>parseAdmissionsCalendar(calendarBody,'2027년 11월')).toThrow('서로 같은지');
  expect(()=>parseAdmissionsCalendar('2026년 11월\n'+Array.from({length:33},(_,i)=>`11/${i%30+1} | 마감 | 기관${i}`).join('\n'),'11월')).toThrow('1~32행');
 });
 it('preserves a shared deadline intro and independent institution names in two through four columns',()=>{
  for(const headers of ['교육지원청 부설 | 별도 교육원','기관 | 학생 지원 | 교사 추천','기관 | 학생 지원 | 교사 추천 | 확인 사항']){
   const count=headers.split('|').length,row=Array.from({length:count},(_,i)=>`원문 항목${i}`).join(' | '),model=parseInstitutionSchedule('학생 지원 ~11/11 · 교사 추천 ~11/12\n'+headers+'\n'+row);
   expect(model.intro).toBe('학생 지원 ~11/11 · 교사 추천 ~11/12');expect(model.rows[0]).toHaveLength(count);expect(model.rows[0].at(-1)).toBe(`원문 항목${count-1}`);
  }
  expect(()=>parseInstitutionSchedule('기관 | 학생 지원\n기관A | 11/13 | 확인 필요')).toThrow();
  expect(()=>parseInstitutionSchedule('기관 | 학생 지원\n'+Array.from({length:9},(_,i)=>`기관${i} | 11/13`).join('\n'))).toThrow('1~8행');
  expect(()=>parseInstitutionSchedule('기관 | 학생 지원\n--- | ---\n기관A | 11/13')).toThrow();
 });
});

describe('editable native calendar and institution tables',()=>{
 it('places November dates in real weekday cells and preserves every event in PPTX and identical SVG preview',async()=>{
  const input=document('admissions_calendar'),full=await buildNotionCanvaPptx(input,[],{previewPage:1}),fast=await buildNotionCanvaPptx(input,[],{previewPage:1,previewOnly:true}),source=slide(full.bytes);
  expect(full.pageCount).toBe(3);expect(fast.previewSvg).toBe(full.previewSvg);expect(fast.bytes.length).toBe(0);
  expect(shape(source,'calendar-day-1').x).toBeCloseTo(expandedX(104),3);expect(shape(source,'calendar-day-1').y).toBeCloseTo(expandedY(417),3);
  expect(shape(source,'calendar-day-10').x).toBeCloseTo(expandedX(96+2*888/7+8),3);expect(shape(source,'calendar-day-10').y).toBeCloseTo(expandedY(547),3);
  expect(shape(source,'calendar-day-30').x).toBeCloseTo(expandedX(96+888/7+8),3);expect(shape(source,'calendar-day-30').y).toBeCloseTo(expandedY(937),3);expect(source).not.toContain('name="calendar-day-31"');
  for(const text of ['2026년11월·학생신규/추가접수','부산·전북','전남','서울·울산','충남·부산','대전·충북·전남·경북','시간미기재는확인필요','현재학년과내년도과정구분','2026.11.10확인·학생지원기준'])expect(plain(source)).toContain(text);
  for(const name of ['calendar-event-10-0-description','calendar-event-10-1-description','calendar-event-13-0-description']){
   const text=shape(source,name);expect(Math.min(...[...text.xml.matchAll(/sz="(\d+)"/g)].map(m=>Number(m[1])))).toBeGreaterThanOrEqual(22*75);
  }
  expect(shape(source,'calendar-day-10').xml).toContain('sz="2250"');
  expect(shape(source,'calendar-event-10-0-label').xml).toContain('2563EB');expect(shape(source,'calendar-event-10-1-label').xml).toContain('D83A30');
  expect(full.previewSvg).toContain('calendar-event-10-1-description');expect(full.previewSvg!.replace(/\s/g,'')).toContain('aria-label="대전·충북·전남·경북"');
  for(const day of [10,13]){const value=shape(source,`calendar-event-${day}-0-description`).xml;const lines=[...value.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g)].map(m=>m[1]);expect(lines.every(line=>!line.startsWith('·')&&line!=='북')).toBe(true);}
  const {data,info}=await sharp(Buffer.from(full.previewSvg!)).raw().toBuffer({resolveWithObject:true});expect(info).toMatchObject({width:1080,height:1350});expect(data.length).toBeGreaterThan(0);
  for(const match of source.matchAll(/<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/g)){
   const [x,y,w,h]=match.slice(1).map(n=>Number(n)/9525);expect(x).toBeGreaterThanOrEqual(64-.001);expect(y).toBeGreaterThanOrEqual(64-.001);expect(x+w).toBeLessThanOrEqual(1016+.001);expect(y+h).toBeLessThanOrEqual(1286+.001);
  }
  expect(shape(source,'page-2-footer').y).toBeCloseTo(expandedY(1072),3);expect(shape(source,'calendar-cell-34').y+shape(source,'calendar-cell-34').h).toBeLessThan(shape(source,'page-2-footer').y);
 });
 it.each([2,3,4])('renders %i real editable table columns without losing notes or shared intro',async count=>{
  const headers=count===2?'교육지원청 부설 | 별도 교육원':count===3?'기관 | 학생 지원 | 교사 추천':'기관 | 학생 지원 | 교사 추천 | 확인 사항';
  const values=['동부·서부','11/11 18시','11/12','시각 확인 필요'].slice(0,count),body='학생 지원 기간 · 2026년 기준\n'+headers+'\n'+Array.from({length:7},(_,i)=>values.map((s,c)=>c===0?s+String(i+1):s).join(' | ')).join('\n');
  const result=await buildNotionCanvaPptx(document('institution_schedule',body),[],{previewPage:1}),source=slide(result.bytes);
  for(let row=1;row<=7;row++)for(let col=0;col<count;col++)expect(shape(source,`schedule-cell-${row}-${col}-text`).xml).toContain('sz="');
  expect(plain(source)).toContain('학생지원기간·2026년기준');expect(plain(source)).toContain('동부·서부7');expect(plain(source)).toContain('시간미기재는확인필요');
  for(const value of values.slice(1))expect(plain(source)).toContain(value.replace(/\s/g,''));
  expect(shape(source,`schedule-cell-7-${count-1}-text`).y+shape(source,`schedule-cell-7-${count-1}-text`).h).toBeLessThan(shape(source,'page-2-footer').y);
  expect(result.previewSvg).toContain(`schedule-cell-7-${count-1}-text`);
  expect(shape(source,'page-2-footer').y).toBeCloseTo(expandedY(1072),3);
 });
 it('keeps a one-row table compact with all notes directly below the table and no overlapping shapes',async()=>{
  const input=document('institution_schedule','기관 | 학생 지원 | 교사 추천\n울산 과학 | ~11/11 | ~11/13');
  const result=await buildNotionCanvaPptx(input,[],{previewPage:1}),source=slide(result.bytes),grid=shape(source,'schedule-grid'),row=shape(source,'schedule-cell-1-0-background'),footer=shape(source,'page-2-footer');
  expect(grid.y).toBeCloseTo(expandedY(450),3);expect(grid.h).toBeCloseTo(194*1222/936,3);expect(row.h).toBeCloseTo(143*1222/936,3);
  expect(footer.y).toBeCloseTo(grid.y+grid.h+8*1222/936,3);expect(footer.y+footer.h).toBeLessThanOrEqual(1286);
  for(let col=0;col<3;col++){const cell=shape(source,`schedule-cell-1-${col}-text`);expect(cell.y+cell.h).toBeLessThan(footer.y);}
  for(const value of ['울산과학','~11/11','~11/13','시간미기재는확인필요','현재학년과내년도과정구분','2026.11.10확인·학생지원기준'])expect(plain(source)).toContain(value);
  expect(result.previewSvg).toContain('schedule-cell-1-0-text');
 });
 it('rejects overflow, cover diagrams and photo/diagram collisions without truncating content',async()=>{
  const crowded=document('admissions_calendar','2026년 11월\n11/13 | 마감 | '+('확인할기관명'.repeat(35)));await expect(buildNotionCanvaPptx(crowded)).rejects.toThrow('문구를 자르지 않았습니다');
  const longTable=document('institution_schedule','기관 | 학생 지원\n'+('기관명이매우깁니다'.repeat(100))+' | 11/13');await expect(buildNotionCanvaPptx(longTable).then(()=>true)).rejects.toThrow('기관별 일정표 1행 1열');
  const cover=document('admissions_calendar');cover.pages[0].infographic='admissions_calendar';await expect(buildNotionCanvaPptx(cover)).rejects.toThrow('내지');
  const photo=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer();
  for(const type of ['admissions_calendar','institution_schedule'] as const){const input=document(type);input.pages[1].imageId='photo';await expect(buildNotionCanvaPptx(input,[{id:'photo',bytes:photo,mimeType:'image/png'}])).rejects.toThrow('사진');}
 });
 it('supports the bounded 20-core/28-output book, last-page preview and 12 original photo slots',async()=>{
  const input=document('admissions_calendar');input.pages=Array.from({length:20},(_,i)=>({title:`원고${i+1}`,body:'정확한 원고'}));input.sourceReferences=Array.from({length:24},(_,i)=>({title:`공식${i+1}`,url:`https://ged.kedi.re.kr/notice/${i}`}));input.teaser={title:'다음 편',body:'궁금한 점을 남겨주세요.'};
  expect(NOTION_CANVA_MAX_OUTPUT_PAGES).toBe(28);const deck=await buildNotionCanvaPptx(input,[],{previewPage:27});expect(deck.pageCount).toBe(28);expect(Object.keys(unzipSync(deck.bytes)).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(28);expect(deck.previewSvg).toContain('Follow');
  const invalid=structuredClone(input);invalid.pages.push({title:'초과',body:'초과'});await expect(buildNotionCanvaPptx(invalid)).rejects.toMatchObject({code:'invalid_request'});
  const photo=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer(),photos=Array.from({length:12},(_,i)=>({id:`photo${i}`,bytes:photo,mimeType:'image/png'}));
  const short=document('admissions_calendar');short.pages[0].imageId=photos[0].id;expect(unzipSync((await buildNotionCanvaPptx(short,photos)).bytes)['ppt/media/photo-12.png']).toBeTruthy();
  await expect(buildNotionCanvaPptx(short,[...photos,{id:'photo13',bytes:photo,mimeType:'image/png'}])).rejects.toThrow('최대 12개');await expect(decodeNotionCanvaPngExport([],29)).rejects.toMatchObject({code:'invalid_request'});
 });
});
