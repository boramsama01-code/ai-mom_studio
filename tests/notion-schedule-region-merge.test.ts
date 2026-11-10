import {describe,expect,it} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import {institutionScheduleElements,parseInstitutionSchedule,type InstitutionSchedule} from '../server/services/notionAdmissionsLayout';
import {buildNotionCanvaPptx} from '../server/services/notionCanva';

const body='추가로 확인할 학생 GED 지원 마감\n지역 | 마감일 | 해당 기관\n전남 | 11/10 | 보성\n전남 | 11/11 | 완도\n전남 | 11/13 | 목포·영암\n경북 | 11/11 | 칠곡\n경북 | 11/12 | 안동**\n경북 | 11/13 | 김천·문경·영양* 등\n경북 | 11/15 | 구미';
const shape=(xml:string,name:string)=>{
 const source=[...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(m=>m[1].includes(`name="${name}"`))?.[1];
 expect(source).toBeTruthy();
 const bounds=source!.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
 const [x,y,w,h]=bounds.slice(1).map(Number);
 return {source:source!,x,y,w,h};
};

describe('regional deadline table cell merging',()=>{
 it('merges adjacent nonempty regions only and leaves other columns and separate groups intact',()=>{
  const model:InstitutionSchedule={intro:'',headers:['지역','마감일'],rows:[['충남','11/10'],['충남','11/11'],['서울','11/12'],['충남','11/13'],['','11/14'],['','11/15']]};
  const cells=institutionScheduleElements(model).filter(e=>e.kind==='text');
  expect(cells.filter(e=>/^schedule-cell-\d+-0-text$/.test(e.name)).map(e=>e.content)).toEqual(['지역','충남','서울','충남','','']);
  expect(cells.filter(e=>/^schedule-cell-[1-6]-1-text$/.test(e.name)).map(e=>e.content)).toEqual(model.rows.map(row=>row[1]));
  const normal=institutionScheduleElements({...model,headers:['기관','마감일']}).filter(e=>e.kind==='text');
  expect(normal.filter(e=>/^schedule-cell-[1-6]-0-text$/.test(e.name))).toHaveLength(6);
 });
 it('keeps a singleton region at one row and an all-identical region in one full-height cell',()=>{
  const single=parseInstitutionSchedule('지역 | 마감일\n충남 | 11/10'),repeated=parseInstitutionSchedule('지역 | 마감일\n충남 | 11/10\n충남 | 11/11\n충남 | 11/12');
  const one=institutionScheduleElements(single).filter(e=>e.kind==='rect'&&e.name==='schedule-cell-1-0-background')[0];
  const all=institutionScheduleElements(repeated).filter(e=>e.kind==='rect'&&e.name==='schedule-cell-1-0-background')[0];
  expect(one.height).toBe(143);expect(all.height).toBe(3*144-1);
  expect(institutionScheduleElements(repeated).filter(e=>e.kind==='text'&&e.content==='충남')).toHaveLength(1);
 });
 it('exports one centered region label per merged block in PPTX and SVG while preserving all dates, institutions and footnotes',async()=>{
  const result=await buildNotionCanvaPptx({title:'지원 일정',category:'영재교육',coverStyle:'A',pages:[{title:'지원해보세요',body:'전국 지원 안내'},{title:'이 지역은 마감일을\n먼저 확인하세요',body,infographic:'institution_schedule',footnote:'* 영양: GED 지원 전에 희망서 제출.\n** 안동: 정원이 미달된 과정만 추가접수.'}]},[],{previewPage:1});
  const xml=strFromU8(unzipSync(result.bytes)['ppt/slides/slide2.xml']);
  const plain=[...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join('').replace(/\s/g,'');
  expect([...plain.matchAll(/전남/g)]).toHaveLength(1);expect([...plain.matchAll(/경북/g)]).toHaveLength(1);
  for(const [start,end] of [[1,3],[4,7]]){
   const region=shape(xml,`schedule-cell-${start}-0-background`),label=shape(xml,`schedule-cell-${start}-0-text`),first=shape(xml,`schedule-cell-${start}-1-background`),last=shape(xml,`schedule-cell-${end}-1-background`);
   expect(region.y).toBe(first.y);expect(region.y+region.h).toBe(last.y+last.h);
   expect(label.x+label.w/2).toBeCloseTo(region.x+region.w/2,-1);expect(label.y+label.h/2).toBeCloseTo(region.y+region.h/2,-1);
   expect(label.source).toContain('algn="ctr"');
   for(let row=start+1;row<=end;row++){expect(xml).not.toContain(`name="schedule-cell-${row}-0-background"`);expect(xml).not.toContain(`name="schedule-cell-${row}-0-text"`);}
   expect(result.previewSvg).toContain(`schedule-cell-${start}-0-text`);
  }
  for(const [index,row] of parseInstitutionSchedule(body).rows.entries())for(let col=1;col<row.length;col++){expect(plain).toContain(row[col].replace(/\s/g,''));expect(shape(xml,`schedule-cell-${index+1}-${col}-text`).source).toContain('algn="ctr"');}
  expect(plain).toContain('GED지원전에희망서제출');expect(plain).toContain('정원이미달된과정만추가접수');
 });
});
