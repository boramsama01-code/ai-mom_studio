import {createHash} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import sharp from 'sharp';
import {buildNotionCanvaPptx,type NotionCanvaDocument} from '../server/services/notionCanva';
import {admissionsTimelineElements,parseAdmissionsTimeline} from '../server/services/notionAdmissionsTimeline';

const body='2027학년도 모집 · 실제 지원일은 2026년\n기관·과정 | 시작일 | 마감일 | 구분\n서울 신규 | 2026-11-04 | 2026-11-11 18:00 | 학생 접수\n서울 별도 과정 | 2026-11-20 | 2026-11-23 | 연계 접수\n의정부 | 2026-11-30 | 2026-12-04 | 학생 접수';
const input=(content=body):NotionCanvaDocument=>({title:'실제 지원 기간',coverStyle:'A',category:'영재교육',pages:[{title:'표지 유지',body:'원본 표지'},{title:'남은 학생 지원 일정\n실제 기간별로 확인',infographic:'admissions_timeline',body:content,footnote:'날짜 단위 막대 · 시각 미기재를 24시로 가정하지 않음',sourceLabel:'기관별 공식 원문'}]});
const source=(bytes:Buffer,page=2)=>strFromU8(unzipSync(bytes)[`ppt/slides/slide${page}.xml`]);
function shape(xml:string,name:string){const part=[...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(m=>m[1].includes(`name="${name}"`))?.[1];expect(part).toBeTruthy();const m=part!.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;const [x,y,w,h]=m.slice(1).map(v=>Number(v)/9525);return {xml:part!,x,y,w,h};}
const plain=(xml:string)=>[...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join('').replace(/\s/g,'');
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Timeline rendering must be local');})));
afterEach(()=>vi.unstubAllGlobals());

describe('actual admissions periods',()=>{
 it('preserves separate intervals and exact source clocks without guessing missing times',()=>{
  const m=parseAdmissionsTimeline(body);expect(m.rows).toHaveLength(3);expect(m.rows[0].end.source).toBe('2026-11-11 18:00');expect(m.rows[2].end.label).toBe('12/4');expect(m.rows[2].end.label).not.toContain('24');
  const e=admissionsTimelineElements(m),bars=e.filter(e=>e.kind==='rect'&&e.name.endsWith('-bar')&&e.name.startsWith('timeline-row'));
  expect(bars).toHaveLength(3);expect(bars[0].x+bars[0].width).toBeLessThan(bars[1].x);expect(bars[1].x+bars[1].width).toBeLessThan(bars[2].x);
  const ratio=(m.rows[0].end.day-m.rows[0].start.day)/(m.lastDay-m.firstDay);expect(bars[0].width).toBeCloseTo((974-356)*ratio,6);
  expect(parseAdmissionsTimeline('기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 | 2026-11-12 24:00 | 학생 접수').rows[0].end.label).toBe('11/12 24:00');
 });
 it.each([
  ['기관 | 시작일 | 마감일 | 구분\n기관 | 2026-11-01 | 2026-11-02 | 학생 접수','머리글'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 미확인 | 2026-11-02 | 학생 접수','YYYY-MM-DD'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-02-29 | 2026-03-01 | 학생 접수','실제 날짜'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 | 2026-11-02 | 학생 접수','빠를 수'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 19:00 | 2026-11-03 18:00 | 학생 접수','빠를 수'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 24:00 | 2026-11-04 | 학생 접수','24:00'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 | 2026-11-04 24:01 | 학생 접수','24:00'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 | 2026-11-04 | 교사 추천','구분은'],
  ['기관·과정 | 시작일 | 마감일 | 구분\n기관 | 2026-11-03 | 2026-11-04 | 학생 접수 | 비고','4개 항목'],
 ])('rejects inaccurate or ambiguous interval input: %s',(value,message)=>expect(()=>parseAdmissionsTimeline(value)).toThrow(message));
 it('rejects duplicate periods and eleven rows while keeping ten separate real intervals',()=>{
  const row='기관 | 2026-11-03 | 2026-11-04 | 학생 접수',header='기관·과정 | 시작일 | 마감일 | 구분\n';expect(()=>parseAdmissionsTimeline(header+row+'\n'+row)).toThrow('중복');
  expect(parseAdmissionsTimeline(header+Array.from({length:10},(_,i)=>row.replace('기관',`기관${i}`)).join('\n')).rows).toHaveLength(10);
  expect(()=>parseAdmissionsTimeline(header+Array.from({length:11},(_,i)=>row.replace('기관',`기관${i}`)).join('\n'))).toThrow('1~10행');
 });
 it('renders all periods as editable shapes with exact full/selected SVG parity and the full interior bounds',async()=>{
  const full=await buildNotionCanvaPptx(input(),[],{previewPage:1}),fast=await buildNotionCanvaPptx(input(),[],{previewPage:1,previewOnly:true}),xml=source(full.bytes);
  expect(fast.previewSvg).toBe(full.previewSvg);expect(fast.bytes.length).toBe(0);expect(full.pageCount).toBe(3);
  for(const row of parseAdmissionsTimeline(body).rows)for(const value of [row.label,row.start.label,row.end.label,row.kind])expect(plain(xml)).toContain(value.replace(/\s/g,''));
  expect(plain(xml)).not.toContain('11/4→11/23');expect(xml.match(/name="timeline-row-\d+-bar"/g)).toHaveLength(3);
  for(const m of xml.matchAll(/<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/g)){const [x,y,w,h]=m.slice(1).map(v=>Number(v)/9525);expect(x).toBeGreaterThanOrEqual(63.999);expect(y).toBeGreaterThanOrEqual(63.999);expect(x+w).toBeLessThanOrEqual(1016.001);expect(y+h).toBeLessThanOrEqual(1286.001);}
  expect(await sharp(Buffer.from(full.previewSvg!)).metadata()).toMatchObject({width:1080,height:1350});
 });
 it('centres one- and two-line schedule cells from the exact fitted block, in both axes',async()=>{
  const d=input();d.pages[1]={title:'표 전체 공간과 중앙 정렬',infographic:'institution_schedule',body:'기관 | 학생 지원\n기관명 첫 줄\n오류 | 11/13'};
  d.pages[1].body='기관 | 학생 지원\n긴기관명을확인해보세요그리고한줄더읽어요 | 11/13\n기관B | 11/14';
  const built=await buildNotionCanvaPptx(d,[],{previewPage:1}),xml=source(built.bytes),grid=shape(xml,'schedule-grid');expect(grid.x).toBe(64);expect(grid.w).toBe(952);
  for(let row=0;row<=2;row++)for(let col=0;col<2;col++){
   const bg=shape(xml,`schedule-cell-${row}-${col}-background`),text=shape(xml,`schedule-cell-${row}-${col}-text`);expect(text.xml).toContain('algn="ctr"');expect(text.x+text.w/2).toBeCloseTo(bg.x+bg.w/2,3);expect(text.y+text.h/2).toBeCloseTo(bg.y+bg.h/2,3);
   const lineCount=[...text.xml.matchAll(/<a:p>/g)].length,lineHeight=Number(text.xml.match(/<a:spcPts val="(\d+)"/)![1])/75;expect(text.h).toBeCloseTo(lineCount*lineHeight,3);
  }
  expect(plain(xml)).toContain('긴기관명을확인해보세요그리고한줄더읽어요');
 });
 it('keeps existing A/B/C cover XML byte-identical while enlarging interiors',async()=>{
  // Hashes captured independently from origin/main 4a9feba before the geometry change.
  const hashes={A:'e0d2086b30b9272c903b41bbf81d7b865754357bcd9c7b493a12df01c8d3db49',B:'c30c03c7f317dfdc775e3a62ee0c07ba1d7ebc443fc6e430ed5d2482fc327852',C:'01f5166ec9293403127cfd911c5191bcf148d52136859c812e0a4bee000eaf12'};
  const photos=[{id:'original',bytes:await sharp({create:{width:24,height:36,channels:3,background:'#88aacc'}}).png().toBuffer(),mimeType:'image/png'}];
  for(const coverStyle of ['A','B','C'] as const){const d:NotionCanvaDocument={title:'표지 불변 검증',coverStyle,category:'영재교육',pages:[{title:'표지 좌표는 그대로',body:'원본 표지 문구',imageId:'original',footnote:'표지 각주',sourceLabel:'공식 원문',emphasis:'그대로'},{title:'내지 변경',body:'표지만 기존 형식을 유지합니다.'}]};const xml=source((await buildNotionCanvaPptx(d,photos)).bytes,1);expect(createHash('sha256').update(xml).digest('hex')).toBe(hashes[coverStyle]);}
 });
});
