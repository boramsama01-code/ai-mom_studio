import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import sharp from 'sharp';
import {buildNotionCanvaPptx,type NotionCanvaDocument} from '../server/services/notionCanva';
import type {NotionInteriorTemplate} from '../shared/notionPageTemplates';
import {interiorTemplateElements,parseInteriorBars,parseInteriorProcess,validateInteriorTemplateBody} from '../server/services/notionInteriorTemplates';

const cases:Array<[NotionInteriorTemplate,string,string[]]>=[
 ['text','본문의 첫 문단\n\n줄 바꿈을 보존하는 둘째 문단',['본문의첫문단','줄바꿈을보존하는둘째문단']],
 ['two_columns','왼쪽 제목\n왼쪽 내용 전체\n---\n오른쪽 제목\n오른쪽 내용 전체',['왼쪽내용전체','오른쪽내용전체']],
 ['image_text','선택한 사진의 원래 설명입니다.',['선택한사진의원래설명입니다.']],
 ['table','지역 | 마감일 | 기관\n충남 | 11/11 | 기관A\n충남 | 11/12 | 기관B',['충남','11/11','기관A','11/12','기관B']],
 ['process','단계 | 내용\n원고 준비 | 자료의 원문을 확인합니다.\n교정 | 날짜와 출처를 다시 읽습니다.',['원고준비','자료의원문을확인합니다.','교정','날짜와출처를다시읽습니다.']],
 ['timeline','지역 | 기관·과정 | 시작일 | 마감일 | 구분\n서울 | | 2026-11-04 | 2026-11-11 18:00 | 학생 접수\n대전 | 과정A | 2026-11-09 | 2026-11-20 | 학생 접수',['서울','대전','과정A','11/4→11/1118:00','11/9→11/20']],
 ['bar_chart','항목 | 값\n수학 | 32.5\n과학 | 0',['수학','32.5','과학','0']],
];
const input=(template:NotionInteriorTemplate,body:string):NotionCanvaDocument=>({title:'내지 선택 검증',coverStyle:'A',category:'꿀팁',pages:[{title:'표지 유지',body:'기존 표지 설명'},{title:'직접 선택한 내지',body,interiorTemplate:template,interiorSubtitle:'원래 소제목',footnote:'* 대상자별 기한은 원문 확인',sourceLabel:'공식 공고',emphasis:'원문',...(template==='image_text'?{imageId:'picked'}:{})}]});
const xml=(bytes:Buffer,page=2)=>strFromU8(unzipSync(bytes)[`ppt/slides/slide${page}.xml`]);
const plain=(source:string)=>[...source.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join('').replace(/\s/g,'');
function shape(source:string,name:string){
 const part=[...source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(m=>m[1].includes(`name="${name}"`))?.[1];expect(part).toBeTruthy();
 const m=part!.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;const [x,y,w,h]=m.slice(1).map(v=>Number(v)/9525);return {source:part!,x,y,w,h};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Interior choice must not call a model or provider');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe('page-specific native interior templates',()=>{
 it.each(cases)('keeps all %s content editable with identical selected/full previews',async(template,body,expected)=>{
  const photos=template==='image_text'?[{id:'picked',bytes:await sharp({create:{width:30,height:40,channels:3,background:'#72A7FF'}}).png().toBuffer(),mimeType:'image/png'}]:[];
  const d=input(template,body),full=await buildNotionCanvaPptx(d,photos,{previewPage:1}),fast=await buildNotionCanvaPptx(d,photos,{previewPage:1,previewOnly:true}),source=xml(full.bytes),copy=plain(source);
  expect(full.pageCount).toBe(3);expect(fast.previewSvg).toBe(full.previewSvg);expect(fast.bytes).toHaveLength(0);
  for(const value of [...expected,'직접선택한내지','원래소제목','대상자별기한은원문확인','공식공고'])expect(copy).toContain(value);
  expect(source).toContain('<a:t');expect(source).not.toContain('name="application-step-');
  for(const m of source.matchAll(/<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/g)){const [x,y,w,h]=m.slice(1).map(v=>Number(v)/9525);expect(x).toBeGreaterThanOrEqual(63.999);expect(y).toBeGreaterThanOrEqual(63.999);expect(x+w).toBeLessThanOrEqual(1016.001);expect(y+h).toBeLessThanOrEqual(1286.001);}
  if(template==='image_text'){expect(source).toContain('<p:pic>');expect(shape(source,'interior-body').x).toBe(552);}
  if(template==='table'){
   expect([...copy.matchAll(/충남/g)]).toHaveLength(1);
   const background=shape(source,'schedule-cell-1-0-background'),label=shape(source,'schedule-cell-1-0-text');expect(label.source).toContain('algn="ctr"');expect(label.y+label.h/2).toBeCloseTo(background.y+background.h/2,3);
  }
  if(template==='timeline')expect(copy).not.toContain('24:00');
  if(template==='process'){expect(copy).not.toContain('학생접수');expect(copy).not.toContain('교사추천');}
 });
 it.each([
  ['two_columns','왼쪽만 있음'],['two_columns','왼쪽\n---\n'],['table','원문을 표로 자동 치환하지 않음'],
  ['process','단계 | 내용\n접수 | 한 단계'],['process','단계 | 내용\n접수 |\n확인 | 설명'],
  ['bar_chart','항목 | 값\n수학 | -1'],['bar_chart','항목 | 값\n수학 | 2,000'],['bar_chart','항목 | 값\n수학 | 미확인'],
  ['timeline','기관·과정 | 시작일 | 마감일 | 구분\n기관 | 미확인 | 2026-11-11 | 학생 접수'],['text',''],
 ] as Array<[NotionInteriorTemplate,string]>)('rejects unsupported %s content without generating replacement copy',async(template,body)=>{
  expect(()=>validateInteriorTemplateBody(template,body)).toThrow();
  await expect(buildNotionCanvaPptx(input(template,body),[],{previewPage:1,previewOnly:true})).rejects.toMatchObject({status:422});
 });
 it('validates source values and permits all-zero graphs without invented scale or invalid geometry',()=>{
  expect(parseInteriorProcess('단계 | 내용\n준비 | 원문 조사\n배포 | 직접 업로드')).toEqual([{label:'준비',description:'원문 조사'},{label:'배포',description:'직접 업로드'}]);
  expect(parseInteriorBars('항목 | 값\nA | 0\nB | 0')).toEqual([{label:'A',source:'0',value:0},{label:'B',source:'0',value:0}]);
  const model=interiorTemplateElements('bar_chart','항목 | 값\nA | 0\nB | 0','#FF493B',(text,size)=>text.length*size);
  expect(model.elements.some(e=>e.name.endsWith('-bar'))).toBe(false);for(const e of model.elements)for(const n of [e.x,e.y,e.width,e.height])expect(Number.isFinite(n)).toBe(true);
 });
 it('requires a selected photo and rejects interior overrides on the cover',async()=>{
  const image=input('image_text','원래 설명');delete image.pages[1].imageId;await expect(buildNotionCanvaPptx(image)).rejects.toMatchObject({status:422});
  const cover=input('text','원래 설명');cover.pages[0].interiorTemplate='text';await expect(buildNotionCanvaPptx(cover)).rejects.toMatchObject({status:422});
 });
 it('lets explicit text supersede an old infographic while preserving the cover XML',async()=>{
  const before:NotionCanvaDocument={title:'기존 카드',coverStyle:'A',pages:[{title:'표지 원문',body:'부제 유지'},{title:'기존 도식',body:'본문 그대로',infographic:'application_steps'}]};
  const original=await buildNotionCanvaPptx(before),after=structuredClone(before);after.pages[1].interiorTemplate='text';
  const selected=await buildNotionCanvaPptx(after,[],{previewPage:1});expect(xml(selected.bytes,1)).toBe(xml(original.bytes,1));
  expect(plain(xml(selected.bytes))).toContain('본문그대로');expect(xml(selected.bytes)).not.toContain('application-step-');expect(xml(original.bytes)).toContain('application-step-');
 });
});
