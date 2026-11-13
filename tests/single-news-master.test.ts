import {describe,it,expect} from 'vitest';
import {editorialTemplateOptions,editorialTemplateForChannel} from '../shared/editorialTemplates';
import {HIGH_SCOOP_TEMPLATE_KITS} from '../shared/highscoopTemplates';
import {planCarousel} from '../server/services/cardCarousel';
import {highScoopCardPageSvg} from '../server/services/highscoopCardBridge';
import {familyDialogueCardFixture} from './fixtures/familyDialogueCard';
import {defaultPageDesigns} from '../shared/familyDialogue';

const input=(copy:unknown)=>({kind:'current_dialogue',channelName:'Alligodang',channelSlug:'current-dialogue',channelCategories:['과학','사회','정치'],accent:'#285FAD',sourceOrg:'확인한 원문',checkedDate:'2026-11-13',payload:{cardCopy:copy}});
describe('one public News master',()=>{
 it('shares the HighScoop news color and all interiors without removing its other categories',()=>{
  expect(editorialTemplateOptions({slug:'news',categories:['과학','사회','정치']}).map(kit=>({key:kit.key,category:kit.category,color:kit.color}))).toEqual([{key:'editorial:cyan',category:'뉴스',color:'#57C7E3'}]);
  const high=editorialTemplateOptions({slug:'opportunities'});
  expect(high).toHaveLength(6);expect(high.map(kit=>kit.category)).toEqual(HIGH_SCOOP_TEMPLATE_KITS.map(kit=>kit.category));
  expect(high[5].color).toBe(editorialTemplateOptions({slug:'news'})[0].color);
 });
 it.each(['editorial:red','editorial:blue','editorial:purple'])('keeps a saved %s manuscript readable using the single News presentation',async templateKey=>{
  const copy={version:1,templateKey,cover:{title:'보관한 제목',subtitle:'원래 설명'},pages:[{id:'body-1',title:'보관한 내지',subtitle:'',body:'사실과 원문은 유지합니다.',sourceIds:[17]}]},before=structuredClone(copy);
  const plan=planCarousel(input(copy),{layout:'magazine'});
  expect(plan.highscoop?.document).toMatchObject({category:'뉴스',categoryColor:'#57C7E3'});
  expect(plan.copy).toEqual(before);expect(plan.count).toBe(2);
  const svg=await highScoopCardPageSvg(plan.highscoop!,0,null,'');
  expect(svg).toContain('aria-label="뉴스"');expect(svg).toContain('fill="#57C7E3"');expect(copy).toEqual(before);
 });
 it('keeps the eight-page fields and evidence independent of the News tag',()=>{
  const copy=familyDialogueCardFixture();copy.templateKey='editorial:blue';const before=structuredClone(copy),designs=defaultPageDesigns();
  const plan=planCarousel({...input(copy),payload:{cardCopy:copy,pageDesigns:designs}},{layout:'magazine'});
  expect(plan.count).toBe(8);expect(plan.family?.copy).toEqual(before);expect(plan.highscoop?.document.category).toBe('뉴스');
  expect(editorialTemplateForChannel({slug:'fryday'},'editorial:blue')?.colorId).toBe('blue');
 });
});
