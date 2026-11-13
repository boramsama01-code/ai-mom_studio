import {describe,it,expect} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import sharp from 'sharp';
import {buildNotionCanvaPptx,NOTION_CANVA_CATEGORY_COLORS,type NotionCanvaDocument} from '../server/services/notionCanva';
import {parseInteriorDialogue} from '../server/services/notionInteriorTemplates';
import {HIGH_SCOOP_TEMPLATE_KITS} from '../shared/highscoopTemplates';
import {notionDesignEditsSchema} from '../shared/notionStudio';
import {notionPlainCardCopy} from '../shared/notionStudioCopy';
import {validateNotionStudioDraft} from '../server/services/notionStudio';

const input=(page:NotionCanvaDocument['pages'][number]):NotionCanvaDocument=>({title:'현재 하이스쿱 내지',coverStyle:'A',category:'입시',pages:[{title:'표지',body:'기존 원고는 보존합니다.'},page]});
const slide=(bytes:Buffer,page=2)=>strFromU8(unzipSync(bytes)[`ppt/slides/slide${page}.xml`]);
const readable=(source:string)=>[...source.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match=>match[1]).join('').replace(/\s/g,'');
const photo=(id:string,bytes:Buffer)=>({id,bytes,mimeType:'image/png'});
const canvas=(width=120,height=160,alpha=1)=>sharp({create:{width,height,channels:4,background:{r:255,g:255,b:255,alpha}}}).png().toBuffer();

describe('current six-kit native layouts',()=>{
 it('uses one continuous cover fade with an opaque footer tail, without an internal Canva shape seam',async()=>{
  const doc=input({title:'본문',body:'내용',interiorTemplate:'text'});doc.pages[0].imageId='white-photo';
  const photos=[photo('white-photo',await canvas())],full=await buildNotionCanvaPptx(doc,photos,{previewPage:0}),fast=await buildNotionCanvaPptx(doc,photos,{previewPage:0,previewOnly:true}),source=slide(full.bytes,1);
  expect(fast.previewSvg).toBe(full.previewSvg);expect(source).not.toContain('bottom-black-base');expect([...source.matchAll(/<a:gradFill/g)]).toHaveLength(1);
  const fade=[...source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(match=>match[1].includes('name="bottom-black-fade"'))![1];
  expect(fade).toContain(`<a:off x="0" y="${300*9525}"/><a:ext cx="${1080*9525}" cy="${1050*9525}"/>`);
  const nativeStops=[...fade.matchAll(/<a:gs pos="(\d+)"><a:srgbClr val="000000"><a:alpha val="(\d+)"/g)].map(match=>({position:Number(match[1]),alpha:Number(match[2])}));
  const previewStops=[...full.previewSvg!.matchAll(/<stop offset="([\d.]+)" stop-color="#000000" stop-opacity="([\d.]+)"/g)].map(match=>({position:Math.round(Number(match[1])*100000),alpha:Math.round(Number(match[2])*100000)}));
  expect(nativeStops).toEqual(previewStops);expect(nativeStops.slice(-2)).toEqual([{position:74095,alpha:100000},{position:100000,alpha:100000}]);
  // Check the old 1078px join and the lower tail on a white photograph.
  // A native two-shape boundary no longer exists, and SVG stays pure black.
  const pixels=await sharp(Buffer.from(full.previewSvg!)).extract({left:540,top:1078,width:1,height:272}).removeAlpha().raw().toBuffer();
  expect(Math.max(...pixels)).toBe(0);
 });
 it('keeps document pixels and transparent marks as separate aligned image layers in both outputs',async()=>{
  const original=await canvas(),overlay=await sharp(Buffer.from('<svg width="120" height="160"><ellipse cx="60" cy="44" rx="45" ry="15" fill="none" stroke="red" stroke-width="3"/></svg>')).png().toBuffer();
  const doc=input({title:'원본 문서를 크게',interiorTemplate:'document_excerpt',body:'',imageId:'original',overlayImageId:'marks'}),photos=[photo('original',original),photo('marks',overlay)];
  const full=await buildNotionCanvaPptx(doc,photos,{previewPage:1}),fast=await buildNotionCanvaPptx(doc,photos,{previewPage:1,previewOnly:true});
  expect(fast.previewSvg).toBe(full.previewSvg);
  const archive=unzipSync(full.bytes);expect(Buffer.from(archive['ppt/media/photo-1.png'])).toEqual(original);expect(Buffer.from(archive['ppt/media/photo-2.png'])).toEqual(overlay);
  const images=[...slide(full.bytes).matchAll(/<p:pic>([\s\S]*?)<\/p:pic>/g)].filter(match=>match[1].includes('photo-'));
  expect(images).toHaveLength(2);const bounds=images.map(match=>match[1].match(/<a:xfrm>([\s\S]*?)<\/a:xfrm>/)![1]);expect(bounds[0]).toBe(bounds[1]);
  expect(fast.previewSvg).toContain('width="952"');
 });
 it('rejects opaque, missing or differently proportioned marks without changing the source image',async()=>{
  const source=await canvas(),page={title:'문서',interiorTemplate:'document_excerpt' as const,imageId:'source',overlayImageId:'overlay'};
  await expect(buildNotionCanvaPptx(input(page),[photo('source',source),photo('overlay',await canvas())])).rejects.toThrow('투명한 PNG');
  await expect(buildNotionCanvaPptx(input(page),[photo('source',source),photo('overlay',await canvas(160,120,0))])).rejects.toThrow('같은 가로세로 비율');
  await expect(buildNotionCanvaPptx(input(page),[photo('source',source)])).rejects.toThrow('함께 선택');
 });
 it('renders editable messages with optional two-column photo and validates all actual dialogue rows',async()=>{
  const body='화자|내용\n엄마|게임 만드는 게 그렇게 재밌어?\n아이|내 규칙으로 친구들이 노는 게 재밌어요.\n엄마|네 세계로 초대하는 거구나ㅎㅎ';
  const doc=input({title:'게임으로 시작한 수다',body,interiorTemplate:'dialogue'}),full=await buildNotionCanvaPptx(doc,[],{previewPage:1}),fast=await buildNotionCanvaPptx(doc,[],{previewPage:1,previewOnly:true});
  expect(fast.previewSvg).toBe(full.previewSvg);expect(readable(slide(full.bytes))).toContain('내규칙으로친구들이노는게재밌어요.');expect(slide(full.bytes)).toContain('interior-dialogue-0-bubble');expect(slide(full.bytes)).toContain('prst="roundRect"');
  doc.pages[1].imageId='game';const split=await buildNotionCanvaPptx(doc,[photo('game',await canvas())]);expect(slide(split.bytes)).toContain('<p:pic>');
  expect(parseInteriorDialogue(body)).toHaveLength(3);for(const bad of ['화자|내용\n엄마|한 개','화자|내용\n엄마|\n아이|답',`화자|내용\n${'아이|대화\n'.repeat(7)}`])expect(()=>parseInteriorDialogue(bad)).toThrow();
 });
 it('uses exactly the current six category colors, blue admissions and a fully rounded editable search CTA',async()=>{
  expect(NOTION_CANVA_CATEGORY_COLORS).toEqual(Object.fromEntries(HIGH_SCOOP_TEMPLATE_KITS.map(kit=>[kit.category,kit.color])));expect(NOTION_CANVA_CATEGORY_COLORS['입시']).toBe('#72A7FF');
  const full=await buildNotionCanvaPptx(input({title:'본문',body:'내용',interiorTemplate:'text'}));const outro=slide(full.bytes,3);
  expect(outro).toContain('name="outro-search"');expect(outro).toContain('fmla="val 50000"');expect(outro).toContain('@highscoop.official');expect(outro).toContain('srgbClr val="72A7FF"');
  const noOutro=await buildNotionCanvaPptx(input({title:'본문',body:'내용',interiorTemplate:'text'}),[],{includeOutro:false});expect(noOutro.pageCount).toBe(2);expect(slide(noOutro.bytes)).not.toContain('outro-search');
 });
 it('round-trips link-owned asset IDs and permits a captionless capture without relaxing the generic copy schema',()=>{
  expect(notionDesignEditsSchema.parse({emphasisByPage:{},templateByPage:{h2:'document_excerpt'},photoByPage:{h2:11},overlayByPage:{h2:12}}).overlayByPage).toEqual({h2:12});
  expect(notionPlainCardCopy({version:1,templateKey:'highscoop:admissions',cover:{title:'표지',subtitle:''},pages:[{id:'body-1',title:'문서',subtitle:'',body:''}]}).pages[0].body).toBe('');
 });
 it('allows six-kit changes only on HighScoop links and rejects foreign or inappropriate overlay selections',()=>{
  const copy=notionPlainCardCopy({version:1,templateKey:'builtin:classic',cover:{title:'표지',subtitle:''},pages:[{id:'body-1',title:'문서',subtitle:'',body:''}]}),draft={...copy,templateKey:'highscoop:admissions'};
  const state={copy,canvaAutoSaveSupported:true,link:{photoOrder:[11,12],sourceSnapshot:{coverTitle:'표지',pages:[{index:1,title:'표지',body:'',headingBlockId:'h1'},{index:2,title:'문서',body:'',headingBlockId:'h2'}]}}} as unknown as Parameters<typeof validateNotionStudioDraft>[0];
  const edits={emphasisByPage:{},templateByPage:{h2:'document_excerpt' as const},photoByPage:{h2:11},overlayByPage:{h2:12}};
  expect(validateNotionStudioDraft(state,draft,edits).templateKey).toBe('highscoop:admissions');
  expect(()=>validateNotionStudioDraft({...state,canvaAutoSaveSupported:false},draft,edits)).toThrow('하이스쿱 마스터');
  expect(()=>validateNotionStudioDraft(state,draft,{...edits,overlayByPage:{h2:999}})).toThrow('현재 원고에 없습니다');
  expect(()=>validateNotionStudioDraft(state,draft,{...edits,templateByPage:{h2:'text'}})).toThrow('표시 PNG');
 });
});
