import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import sharp from 'sharp';
import {buildNotionCanvaPptx,type NotionCanvaDocument} from '../server/services/notionCanva';
import {loadEducationOfficeLogos,educationLogoKey} from '../server/services/educationOfficeLogos';
import {parseLogoCalendar} from '../server/services/notionLogoCalendar';
import {parseAdmissionsGuide} from '../server/services/notionAdmissionsGuide';

const calendar='2026년 11월 · 학생 지원 기준\n11/10 | 시작 | 부산\n11/10 | 시작 | 전북\n11/10 | 사전 | 경북\n11/10 | 마감 | 전남\n11/11 | 마감 | 서울\n11/11 | 마감 | 울산\n11/11 | 마감 | 전남\n11/11 | 마감 | 경북\n11/12 | 마감 | 부산\n11/12 | 마감 | 충남\n11/12 | 마감 | 전남\n11/12 | 마감 | 경북\n11/13 | 마감 | 대전\n11/13 | 마감 | 충북\n11/13 | 마감 | 전남\n11/13 | 마감 | 경북\n11/19 | 조건부 | 경북\n11/20 | 마감 | 대전\n11/20 | 마감 | 충북\n11/20 | 마감 | 경북\n11/30 | 시작 | 의정부';
const guide='2026년 현재 학년 · 일반과 조건부 제출 구분\n[모집]\n수학·과학 | 초6·중1 | 원문에 명시된 과정만\n정보 | 중1 | 조건부 지원 경로\n[전형]\n학생 지원 | ~11/11 18시 | GED 지원서\n교사 GED추천 | ~11/12 | 별도 추천서와 구분\n학교 추천 | 기관별 확인 | 해당 증빙 제출\n검사·면접 | 12/5 | 과정별 방법 확인\n발표 | 2027/2/11 | 확정 공고 확인\n[서류]\n공통 | GED 온라인 지원서\n조건부 | 연구계획서: 해당 경로만 · 출력 2부\n미확인 | 별도 추천서: 주요강 미기재 · 기관 확인';
const document=(type:'admissions_logo_calendar'|'admissions_guide',body=type==='admissions_guide'?guide:calendar):NotionCanvaDocument=>({title:'지원 안내 검증',coverStyle:'A',category:'영재교육',pages:[{title:'일단 지원해보세요',body:'원문 기준 지원 안내'},{title:type==='admissions_guide'?'서울 지원 안내\n모집분야와 전형':'11월 지원 일정 캘린더',infographic:type,body,footnote:'조건부 서류의 적용 대상·마감은 기관별 확인',sourceLabel:'기관 공식 모집요강 · 2026.11.10'}]});
const xml=(bytes:Buffer,index=2)=>strFromU8(unzipSync(bytes)[`ppt/slides/slide${index}.xml`]);
const plain=(source:string)=>[...source.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join('').replace(/\s/g,'');
const bounds=(source:string)=>[...source.matchAll(/<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/g)].map(m=>{const [x,y,w,h]=m.slice(1).map(n=>Number(n)/9525);return {x,y,w,h};});
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No external requests for built-in diagrams');})));
afterEach(()=>vi.unstubAllGlobals());

describe('official education-office logos and actual date cells',()=>{
 it('loads original verified PNG identities with current regional aliases',async()=>{
  const logos=await loadEducationOfficeLogos();expect(logos).toHaveLength(16);expect(logos.flatMap(x=>x.regions)).toHaveLength(17);
  expect(educationLogoKey('의정부',logos)).toBe('gyeonggi');expect(educationLogoKey('전남',logos)).toBe(educationLogoKey('광주',logos));
  for(const logo of logos){expect(logo.sourceUrl).toMatch(/^https:\/\//);expect(await sharp(logo.bytes).metadata()).toMatchObject({format:'png'});}
  expect(()=>educationLogoKey('없는교육청',logos)).toThrow('임의로 만들지');
 });
 it('keeps each institution status separate and rejects duplicate/invalid dates and aliases',async()=>{
  const logos=await loadEducationOfficeLogos(),model=parseLogoCalendar(calendar,'11월',logos);
  expect(model).toMatchObject({year:2026,month:11,firstWeekday:0,days:30,weeks:5});expect(model.events.filter(e=>e.day===10)).toHaveLength(4);
  expect(model.events.find(e=>e.day===30)).toMatchObject({kind:'시작',region:'의정부',logoKey:'gyeonggi'});
  for(const bad of ['2026년 11월\n11/31 | 마감 | 서울','2026년 11월\n12/1 | 마감 | 서울','2026년 11월\n11/11 | 교사 | 서울','2026년 11월\n11/11 | 마감 | 서울·울산','2026년 11월\n11/11 | 마감 | 서울\n11/11 | 마감 | 서울'])expect(()=>parseLogoCalendar(bad,'11월',logos)).toThrow();
 });
 it('embeds real reused logos in editable PPTX, matches the fast SVG and keeps every event inside the safe bounds',async()=>{
  const input=document('admissions_logo_calendar'),full=await buildNotionCanvaPptx(input,[],{previewPage:1}),fast=await buildNotionCanvaPptx(input,[],{previewPage:1,previewOnly:true});
  expect(fast.previewSvg).toBe(full.previewSvg);expect(fast.bytes.length).toBe(0);
  const files=unzipSync(full.bytes),source=xml(full.bytes),media=Object.keys(files).filter(n=>n.startsWith('ppt/media/education-'));
  expect(media).toHaveLength(10);expect(source.match(/교육청 대표 로고/g)).toHaveLength(parseLogoCalendar(calendar,'11월',await loadEducationOfficeLogos()).events.length);
  expect(source).toContain('11/10 사전');expect(source).toContain('11/19 조건부');expect(source).toContain('11/30 시작');
  for(const b of bounds(source)){expect(b.x).toBeGreaterThanOrEqual(63.999);expect(b.y).toBeGreaterThanOrEqual(63.999);expect(b.x+b.w).toBeLessThanOrEqual(1016.001);expect(b.y+b.h).toBeLessThanOrEqual(1286.001);}
  expect(await sharp(Buffer.from(full.previewSvg!)).metadata()).toMatchObject({width:1080,height:1350});
 });
});

describe('eligibility, actual stages and scoped documents',()=>{
 it('preserves fields, current grades, actual date stages and the unknown/conditional distinction',async()=>{
  const parsed=parseAdmissionsGuide(guide);expect(parsed.courses).toHaveLength(2);expect(parsed.steps).toHaveLength(5);expect(parsed.documents.map(x=>x[0])).toEqual(['공통','조건부','미확인']);
  const input=document('admissions_guide'),full=await buildNotionCanvaPptx(input,[],{previewPage:1}),fast=await buildNotionCanvaPptx(input,[],{previewPage:1,previewOnly:true}),source=xml(full.bytes);
  expect(fast.previewSvg).toBe(full.previewSvg);
  for(const value of [...parsed.courses.flat(),...parsed.steps.flat(),...parsed.documents.flat(),input.pages[1].footnote!,input.pages[1].sourceLabel!])expect(plain(source)).toContain(value.replace(/\s/g,''));
  expect(source).not.toContain('영재성검사');expect(source).toContain('기관별 확인');
  for(const b of bounds(source)){expect(b.x).toBeGreaterThanOrEqual(63.999);expect(b.y).toBeGreaterThanOrEqual(63.999);expect(b.x+b.w).toBeLessThanOrEqual(1016.001);expect(b.y+b.h).toBeLessThanOrEqual(1286.001);}
 });
 it('supports institution comparison rows without implying shared deadlines',async()=>{
  const body=guide.replace('[모집]\n수학·과학 | 초6·중1 | 원문에 명시된 과정만\n정보 | 중1 | 조건부 지원 경로','[기관별 모집]\n기관A | 수학·과학 / 초4·5 | 학생 ~11/13 · 교사 ~11/20\n기관B | 정보 / 중1 | 학생 ~11/17 · 교사 ~11/23');
  expect(parseAdmissionsGuide(body).courseMode).toBe('institutions');
  const result=await buildNotionCanvaPptx(document('admissions_guide',body));expect(plain(xml(result.bytes))).toContain('학생~11/13·교사~11/20');expect(plain(xml(result.bytes))).toContain('학생~11/17·교사~11/23');
 });
 it.each([
  guide.replace('[모집]','[잘못된 제목]'),guide.replace('[전형]','[서류]'),guide.replace('미확인 |','불필요 |'),guide.replace('공통 | GED 온라인 지원서','공통 |'),guide.replace('[전형]','정보 | 중2 | 추가 과정\n'.repeat(6)+'[전형]'),guide.replace('[서류]','추가 단계 | 별도 날짜 | 별도 준비\n[서류]')
 ])('rejects malformed or overfull guide rows without inferring or discarding conditions',body=>expect(()=>parseAdmissionsGuide(body)).toThrow());
 it('fails long visible text rather than truncating it and previews only the selected diagram body',async()=>{
  await expect(buildNotionCanvaPptx(document('admissions_guide',guide.replace('원문에 명시된 과정만','매우긴기관명'.repeat(60))))).rejects.toThrow();
  const input=document('admissions_guide');input.pages.push({title:'2026년 11월',body:'잘못 입력된 달력',infographic:'admissions_logo_calendar'});
  await expect(buildNotionCanvaPptx(input,[],{previewPage:1,previewOnly:true})).resolves.toMatchObject({pageCount:4});await expect(buildNotionCanvaPptx(input)).rejects.toThrow();
 });
});
