import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {studioContentSchema} from '../shared/studio';
import {creativeProfileFor} from '../shared/creativeProfile';
import {studioCurrentDocument} from '../server/services/studioCurrentKit';
import {createStudioRenderer} from '../server/services/studioExport';

const content = () => studioContentSchema.parse({title:'보이저가 보내온 이야기',channel:'news',format:'카드뉴스',exportDesign:'editorial:cyan',sourceLabel:'원고와 출처 보존',panels:Array.from({length:4},(_,i)=>({scene:'원본 장면',dialogue:`${i+1}번째 본문을 그대로 유지합니다.`,imageId:null}))});

describe('common kit in the four-panel workspace',()=>{
 it('shares current defaults without invalidating saved legacy designs',()=>{
  expect(creativeProfileFor({slug:'current-dialogue'}).defaultTemplate).toBe('editorial:red');
  expect(creativeProfileFor({slug:'opportunities'}).defaultTemplate).toBe('highscoop:gifted');
  expect(studioContentSchema.parse({...content(),exportDesign:'set:n03'}).exportDesign).toBe('set:n03');
 });
 it('preserves every panel, source and channel brand in the native document',()=>{
  const source=content(),before=JSON.stringify(source),out=studioCurrentDocument(source,'Alligodang');
  expect(out.document.pages).toHaveLength(5);
  expect(out.document.pages.slice(1).map(p=>p.body)).toEqual(source.panels.map(p=>p.dialogue));
  expect(out.document.pages.every(p=>p.sourceLabel===source.sourceLabel)).toBe(true);
  expect(out.brand.name).toBe('Alligodang');
  expect(out.brand.logoPath).toContain('allligodang');
  expect(out.brand.handle).not.toContain('highscoop');
  expect(JSON.stringify(source)).toBe(before);
 });
 it('renders current cover, body and channel-native closing card',async()=>{
  const source=content(),output=createStudioRenderer(source,2,'Alligodang','#285FAD');
  expect(output.pageCount).toBe(6);
  for(const page of [0,1,5]){
   const image=await sharp(await output.page(page)).metadata();
   expect([image.width,image.height,image.format]).toEqual([1080,1350,'png']);
  }
  await expect(output.page(6)).rejects.toThrow('페이지');
 });
 it('does not silently omit a missing saved image',async()=>{
  const source=content();source.panels[0].imageId=23;
  const output=createStudioRenderer(source,1,'Alligodang','#285FAD');
  await expect(output.page(0)).rejects.toThrow('그림을 찾을 수 없습니다');
 });
});
