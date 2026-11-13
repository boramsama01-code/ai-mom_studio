import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {unzipSync,strFromU8} from 'fflate';
import {editorialTemplateOptions,editorialTemplateForKey,editorialBrandForChannel} from '../shared/editorialTemplates';
import {editorialTemplateCatalogOptions} from '../shared/templateCatalog';
import {buildNotionCanvaPptx} from '../server/services/notionCanva';
import {editorialSampleDocument,renderEditorialTemplateSample} from '../server/services/editorialTemplateSamples';
import {planCarousel,renderCarouselPage} from '../server/services/cardCarousel';
import {highScoopCardPageSvg} from '../server/services/highscoopCardBridge';
import {familyDialogueCardFixture} from './fixtures/familyDialogueCard';
import {defaultPageDesigns} from '../shared/familyDialogue';
import {editorialFamilyPageBody} from '../shared/editorialPageContent';
import {FAMILY_ENDING_ASSET_IDS} from '../shared/characterVariantAssets';
import {renderRegisteredFamilyEnding} from '../server/services/characterVariantAssets';

const channel={slug:'current-dialogue',name:'Alligodang'};
const model=(cardCopy:unknown,pageDesigns?:unknown)=>({kind:'current_dialogue',channelName:channel.name,channelSlug:channel.slug,accent:'#57C7E3',sourceOrg:'확인된 원문',checkedDate:'2026-11-13',payload:{title:'뉴스',cardCopy,...(pageDesigns?{pageDesigns}:{})}});
const photo=()=>sharp({create:{width:120,height:160,channels:3,background:'#5AC0C8'}}).jpeg().toBuffer();

describe('current shared editorial templates',()=>{
 it('offers exactly six current choices for every brand with channel categories and readable historical aliases',()=>{
  expect(editorialTemplateOptions(channel).map(item=>item.category)).toEqual(['과학','사회','정치','예술','여행','최신이슈']);
  for(const slug of ['opportunities','current-dialogue','science-dialogue','penguin','fryday','my-custom-brand']){
   const choices=editorialTemplateCatalogOptions({slug,name:slug});
   expect(choices).toHaveLength(6);expect(choices.every(item=>item.pageCount===11&&!!editorialTemplateForKey(item.key))).toBe(true);
   expect(choices.some(item=>item.key.startsWith('set:')||item.key.startsWith('cardnews14-'))).toBe(false);
  }
  expect(editorialTemplateForKey('highscoop:conversation')?.colorId).toBe('yellow');
  expect(editorialTemplateOptions({slug:'my-custom-brand',name:'내 채널',categories:['새 소식']})[0].category).toBe('새 소식');
  const manual={version:1,templateKey:'editorial:red',cover:{title:'제목',subtitle:''},pages:[{id:'body-1',title:'본문',subtitle:'',body:'원고'}]};
  expect(planCarousel({...model(manual),channelCategories:['사용자가 정한 분류']},{layout:'magazine'}).highscoop?.document.category).toBe('사용자가 정한 분류');
 });
 it('uses the approved Alligodang logo and account in native slides, without any HighScoop identity',async()=>{
  const document=editorialSampleDocument(channel,'editorial:cyan');
  const source=await photo(),result=await buildNotionCanvaPptx(document,[{id:'sample',bytes:source,mimeType:'image/jpeg'}],{brand:editorialBrandForChannel(channel)});
  const archive=unzipSync(result.bytes);
  expect(result.pageCount).toBe(11);
  expect(Buffer.from(archive['ppt/media/logo-color.png'])).toEqual(await fs.readFile('assets/branding/allligodang-bw.png'));
  const slides=Array.from({length:11},(_,i)=>strFromU8(archive[`ppt/slides/slide${i+1}.xml`])).join('\n');
  expect(slides).toContain('@alligodang.official');expect(slides).not.toMatch(/HighScoop|highscoop\.official|하이스쿱/);
  expect(strFromU8(archive['ppt/slides/slide11.xml'])).toContain('name="outro-search"');
  const preview=await renderEditorialTemplateSample(channel,'editorial:cyan',10);
  expect(await sharp(preview).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});
 });
 it('renders a channel name when no registered logo or account exists',async()=>{
  const custom={slug:'custom-channel',name:'우리의 새 채널'},document=editorialSampleDocument(custom,'editorial:mint');
  const result=await buildNotionCanvaPptx(document,[{id:'sample',bytes:await photo(),mimeType:'image/jpeg'}],{brand:editorialBrandForChannel(custom),previewPage:10,previewOnly:true});
  expect(result.previewSvg).toContain('aria-label="우리의 새 채널"');
  expect(result.previewSvg).not.toMatch(/highscoop|HighScoop|하이스쿱/);
 });
 it('keeps all eight V2 slots, semantic fields, evidence links, display edits and selected page photos',async()=>{
  const copy=familyDialogueCardFixture();copy.templateKey='editorial:cyan';copy.pages[1].displayOverrides={kicker:'내가 고친 꼬리말',sourceCredit:'사용자 출처 메모'};
  const designs=defaultPageDesigns();designs.news_summary.background={...designs.news_summary.background,kind:'image',assetId:42};
  const original=structuredClone(copy),originalDesigns=structuredClone(designs),plan=planCarousel(model(copy,designs),{layout:'magazine',highscoopTemplateKey:copy.templateKey});
  expect(plan.count).toBe(8);expect(plan.family?.copy).toEqual(copy);expect(plan.family?.designs).toEqual(designs);
  for(const [index,page]of copy.pages.entries())expect(plan.highscoop!.document.pages[index].body).toContain(editorialFamilyPageBody(page));
  const pixels=await photo(),images=Object.assign(new Map([[42,pixels]]),{credits:new Map([[42,'직접 등록 이미지']])});
  const svg=await highScoopCardPageSvg(plan.highscoop!,1,null,'',images);
  expect(svg).toContain('data-name="photo-1"');expect(svg).toContain('사용자 출처 메모');expect(svg).toContain('내가 고친 꼬리말');
  for(const fact of copy.pages[1].id==='news_summary'?copy.pages[1].fields.facts:[])expect(svg).toContain(fact);
  expect(await sharp(await renderCarouselPage(plan,1,{layout:'magazine'},null,'',images)).metadata()).toMatchObject({width:1080,height:1350});
  expect(copy).toEqual(original);expect(designs).toEqual(originalDesigns);
 });
 it('applies explicit V1 interior layouts and keeps artwork references instead of silently dropping them',async()=>{
  const copy={version:1,templateKey:'editorial:blue',cover:{title:'확인할 내용',subtitle:'짧은 설명'},pages:[{id:'body-1',title:'두 관점',subtitle:'비교해요',body:'첫 관점\n---\n둘째 관점',interiorTemplate:'two_columns',emphasis:'첫 관점',footnote:'사용자 각주'}]};
  const plan=planCarousel(model(copy),{layout:'magazine'}),svg=await highScoopCardPageSvg(plan.highscoop!,1,null,'');
  expect(svg).toContain('interior-column-left');expect(svg).toContain('사용자 각주');expect(plan.copy).toEqual(copy);
  const incompatible={...copy,pages:[{...copy.pages[0],background:{assetId:42}}]},bad=planCarousel(model(incompatible),{layout:'magazine'});
  await expect(highScoopCardPageSvg(bad.highscoop!,1,null,'',new Map([[42,await photo()]]))).rejects.toThrow('사진을 함께 넣을 수 없습니다');
  expect(bad.copy?.pages[0].background?.assetId).toBe(42);
 });
 it('honors V2 photo treatments, approved closing profiles and full-image endings',async()=>{
  const copy=familyDialogueCardFixture();copy.templateKey='editorial:purple';const designs=defaultPageDesigns();
  designs.news_summary.background={...designs.news_summary.background,kind:'image',assetId:77,fit:'contain',brightness:50,focalX:0,focalY:100,overlay:100,color:'#234567'};
  const pixels=await photo(),source=Buffer.from(pixels),images=new Map([[77,pixels]]),plan=planCarousel(model(copy,designs),{layout:'magazine'});
  const svg=await highScoopCardPageSvg(plan.highscoop!,1,null,'',images),encoded=svg.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)![1];
  const painted=Buffer.from(encoded,'base64');expect(await sharp(painted).metadata()).toMatchObject({width:440,height:776});
  const rgb=await sharp(painted).extract({left:220,top:388,width:1,height:1}).removeAlpha().raw().toBuffer();
  expect([...rgb].every((value,index)=>Math.abs(value-[35,69,103][index])<=2)).toBe(true);expect(pixels).toEqual(source);
  const closing=await highScoopCardPageSvg(plan.highscoop!,7,null,'');expect(closing).toContain('data-name="photo-1"');expect(closing).toContain('@test_allligodang');
  designs.outro.outroPresentation={mode:'full_image',assetId:FAMILY_ENDING_ASSET_IDS[0]};
  const full=planCarousel(model(copy,designs),{layout:'magazine'});
  expect(await renderCarouselPage(full,7,{layout:'magazine'},null,'')).toEqual(await renderRegisteredFamilyEnding(FAMILY_ENDING_ASSET_IDS[0]));
 });
});
