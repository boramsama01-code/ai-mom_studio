import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {Resvg} from '@resvg/resvg-js';
import {READING_CARD_PROFILES,READING_MAPPING_VERSION,readingProfileDesigns,type ReadingCardProfile,type ReadingElement} from '../shared/readingCardProfiles';
import {defaultPageDesigns} from '../shared/familyDialogue';
import {layoutReadingProfilePage,layoutReadingCard,readingGradientDefinition,renderReadingCard} from '../server/services/readingCard';
import {loadReadingFont,wrapReadingText,readingPathData} from '../server/services/readingCardFonts';
import {prepareReadingArtwork} from '../server/services/readingCardImages';
import {CardFontError,CardOverflowError} from '../server/services/card';
import {familyDialogueCardFixture} from './fixtures/familyDialogueCard';

type SourceText={kind:'text';field:string;copy:string;fontFamily:string;fontWeight:number;letterSpacing?:number};
type SourceLayout={id:string;pages:Array<{page:number;elements:Array<SourceText|({kind:'image'|'rect'}&Record<string,unknown>)>}>};
const sourceRoot=path.resolve('assets/cardnews14/layouts');
const sources=fs.readdirSync(sourceRoot).map(folder=>{
  const bytes=fs.readFileSync(path.join(sourceRoot,folder,'layout.json'));
  return {bytes,layout:JSON.parse(bytes.toString()) as SourceLayout};
});
const profiles=READING_CARD_PROFILES.filter(profile=>profile.sourceStyleId);
const sourceValues=(source:SourceLayout,page:number)=>Object.fromEntries(source.pages[page-1].elements.filter((element):element is SourceText=>element.kind==='text').map(element=>[element.field,element.copy]));
const raster=(svg:string)=>sharp(new Resvg(svg,{font:{loadSystemFonts:false}}).render().asPng());

describe('cardnews14 fixed source geometry and text',()=>{
  it('adds separate identities for all 14 styles and preserves all 112 ordered pages, 644 fields, and 89 image slots',()=>{
    expect(profiles).toHaveLength(14);expect(READING_CARD_PROFILES.filter(profile=>!profile.sourceStyleId).map(profile=>profile.id)).toEqual(['reading-ink-lime-v1','reading-cobalt-paper-v1']);
    expect(profiles.reduce((sum,profile)=>sum+profile.images.length,0)).toBe(89);
    expect(profiles.reduce((sum,profile)=>sum+profile.pages.reduce((count,page)=>count+page.textBoxes.length,0),0)).toBe(644);
    for(const profile of profiles){
      const source=sources.find(item=>item.layout.id===profile.sourceStyleId)!;
      expect(profile.pages).toHaveLength(8);
      expect(profile.sourceLayoutSha256).toBe(createHash('sha256').update(source.bytes).digest('hex'));
      expect(profile.mappingVersion).toBe(READING_MAPPING_VERSION);
      expect(profile.templateVersion).toBe(`${profile.id}-20261104${profile.sourceStyleId==='amber-cream'?'-r2':''}-crop-safe-20261105`);
      for(const [index,page] of profile.pages.entries())expect(page.elements?.map(element=>element.kind)).toEqual(source.layout.pages[index].elements.map(element=>element.kind));
    }
  });
  for(const profile of profiles)it(`${profile.sourceStyleId}: measures the actual eight source pages without deleting text or shrinking type`,()=>{
    const source=sources.find(item=>item.layout.id===profile.sourceStyleId)!.layout;
    for(const page of profile.pages){
      const values=sourceValues(source,page.page),before=JSON.stringify(values),result=layoutReadingProfilePage(profile,page.page,values);
      const preflight=layoutReadingProfilePage(profile,page.page,values,{measureOnly:true});
      expect(preflight.textRuns).toEqual(result.textRuns);
      expect(preflight.svg).not.toContain('<path');
      expect(result.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(result.textRuns.map(run=>run.field)).toEqual(page.textBoxes.filter(box=>values[box.field]).map(box=>box.field));
      for(const run of result.textRuns){
        expect(run.lines.join('').replace(/\s/gu,'')).toBe(run.text.replace(/\s/gu,''));
        expect(run.size).toBe(run.fontSize);expect(run.lines.length).toBeLessThanOrEqual(run.maxLines);
        if(run.fontFamily==='Noto Sans KR')expect(run.effectiveFontWeight).toBe(run.fontWeight>=600?700:400);
      }
      expect(JSON.stringify(values)).toBe(before);
    }
  });
  it('blocks a long manual field with its page and field while preserving the exact manual text and empty labels',()=>{
    const profile=profiles[0],source=sources.find(item=>item.layout.id===profile.sourceStyleId)!.layout;
    const values={...sourceValues(source,1),P01_HEADLINE:'수정한 긴 제목\n'.repeat(20),P01_TOPIC_TAG:''};
    const before=JSON.stringify(values);
    expect(()=>layoutReadingProfilePage(profile,1,values)).toThrow(CardOverflowError);
    try{layoutReadingProfilePage(profile,1,values);}catch(error){expect(error).toMatchObject({field:'P01_HEADLINE'});expect((error as Error).message).toContain('1페이지');}
    expect(JSON.stringify(values)).toBe(before);
    const blank=layoutReadingProfilePage(profile,1,{...sourceValues(source,1),P01_TOPIC_TAG:''});
    expect(blank.textRuns.some(run=>run.field==='P01_TOPIC_TAG')).toBe(false);
  });
  it('preserves intentional blank lines and negative tracking when measuring Korean and mixed Latin text',()=>{
    const font=loadReadingFont('Noto Sans KR',700);
    expect(wrapReadingText(font,'첫 문단\n\n둘째 문단',40,900)).toEqual(['첫 문단','','둘째 문단']);
    expect(font.measure('AI와 사람',80,-4)).toBeLessThan(font.measure('AI와 사람',80));
    const regular=loadReadingFont('Noto Sans KR',400),serif=loadReadingFont('Noto Serif KR',800);
    expect(font.path('한글 AI',0,100,80)).not.toBe(regular.path('한글 AI',0,100,80));
    expect(serif.path('한글 AI',0,100,80)).not.toBe(font.path('한글 AI',0,100,80));
    // Another face's variable lookup cannot alter subsequent measurements.
    const width=regular.measure('가나다 ABC',52);font.path('가나다 ABC',0,100,52);
    expect(regular.measure('가나다 ABC',52)).toBe(width);
    expect(()=>loadReadingFont('Pretendard',700)).toThrow(CardFontError);
  });
  it('does not turn finite floating point residues into invalid SVG path coordinates',()=>{
    expect(readingPathData([{type:'M',x:464.00000000000006,y:673.92},{type:'L',x:0.00000000000001,y:670},{type:'Z'}])).toBe('M464 673.92L0 670Z');
    expect(()=>readingPathData([{type:'M',x:NaN,y:0}])).toThrow(CardFontError);
    for(const size of [32,40,42,112,116])expect(loadReadingFont('Noto Sans KR',700).path('진짜 실력은? AI · 생각의 기준',72,700,size)).not.toMatch(/NaN|Infinity/);
  });
  it('renders the standard Studio field mapping through a new profile without modifying the copy',async()=>{
    const profile=profiles[0],copy=familyDialogueCardFixture();copy.templateKey=profile.id;
    const page=copy.pages[0];if(page.id!=='cover')throw new Error('cover');
    page.fields.headline='AI와 사람의 실력';page.displayOverrides={kicker:'',imageCredit:'',pageNumber:''};
    const before=JSON.stringify(copy),design=readingProfileDesigns(profile,defaultPageDesigns()).cover;
    const png=await sharp({create:{width:300,height:500,channels:3,background:'#385544'}}).png().toBuffer();
    const output=await renderReadingCard(copy,page,design,{},png);
    expect(await sharp(output).metadata()).toMatchObject({width:1080,height:1350,channels:3,format:'jpeg'});
    expect(layoutReadingCard(copy,page).textRuns.map(run=>run.field)).toEqual(['P01_HEADLINE','P01_SUBTITLE']);
    expect(JSON.stringify(copy)).toBe(before);
  });
});

describe('registered artwork treatment and exact layer order',()=>{
  it('uses one PNG crop for local preview and Canva, including explicit monochrome and rounded transparency',async()=>{
    const photo=await sharp({create:{width:90,height:70,channels:3,background:'#E1266C'}}).png().toBuffer(),design=defaultPageDesigns().cover;
    design.background.overlay=0;
    const slot={width:64.4,height:63.6,radius:32,treatment:{tone:'monochrome' as const}};
    const output=await prepareReadingArtwork(photo,design,slot,'#102D49');
    const {data,info}=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect(info).toMatchObject({width:64,height:64,channels:4});
    const centre=(32*64+32)*4;
    expect(data[centre]).toBe(data[centre+1]);expect(data[centre]).toBe(data[centre+2]);
    expect(data[3]).toBe(0);expect(data[centre+3]).toBe(255);
    const color=await prepareReadingArtwork(photo,design,{...slot,treatment:{tone:'color'}},'#102D49');
    expect(output.equals(color)).toBe(false);
    expect(output.equals(await prepareReadingArtwork(photo,design,slot,'#102D49'))).toBe(true);
  });
  it('retains user focal position rather than overwriting it with a template default',async()=>{
    const photo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100" height="100" fill="#f00"/><rect x="100" width="100" height="100" fill="#00f"/></svg>')).png().toBuffer();
    const design=defaultPageDesigns().cover;
    const sample=async(focalX:number)=>{
      const output=await prepareReadingArtwork(photo,{...design,background:{...design.background,focalX}}, {width:80,height:80},'#102D49');
      return sharp(output).extract({left:35,top:35,width:1,height:1}).removeAlpha().raw().toBuffer();
    };
    const left=await sample(0),right=await sample(100);expect(left[0]).toBeGreaterThan(left[2]);expect(right[2]).toBeGreaterThan(right[0]);
  });
  it('composites interleaved image and shapes in source order, not by element type',async()=>{
    const image=await sharp({create:{width:200,height:200,channels:3,background:'#0000FF'}}).png().toBuffer();
    const elements:ReadingElement[]=[{kind:'rect',x:0,y:0,width:200,height:200,fill:'#FF0000'},{kind:'image',field:'P01_COVER_IMAGE',pageId:'cover',x:0,y:0,width:200,height:200},{kind:'rect',x:100,y:0,width:100,height:200,fill:'#00FF00'}];
    const profile:ReadingCardProfile={...profiles[0],pages:[{page:1,background:'#FFFFFF',shapes:[],textBoxes:[],imageBoxes:[],elements}]};
    const {svg}=layoutReadingProfilePage(profile,1,{}, {imageDataUrl:`data:image/png;base64,${image.toString('base64')}`});
    const pixels=await raster(svg).removeAlpha().raw().toBuffer();
    const pixel=(x:number)=>Array.from(pixels.subarray((100*1080+x)*3,(100*1080+x)*3+3));
    expect(pixel(50)).toEqual([0,0,255]);expect(pixel(150)).toEqual([0,255,0]);
    expect(()=>layoutReadingProfilePage(profile,1,{}, {imageDataUrl:'https://invalid.example/photo.png'})).toThrow('PNG');
  });
  it('renders directional gradients, tilted shapes, opacity, oblique text and offset shadows from actual registered properties',()=>{
    const gradients=new Set<string>();
    for(const profile of profiles)for(const page of profile.pages)for(const element of page.elements??[])if(element.kind==='rect'&&element.fill.startsWith('linear-gradient'))gradients.add(element.fill);
    expect(gradients.size).toBe(33);
    for(const gradient of gradients)expect(readingGradientDefinition(gradient,{x:0,y:0,width:1080,height:1350},'reading-gradient-0')).toContain('gradientUnits="userSpaceOnUse"');
    expect(readingGradientDefinition('linear-gradient(90deg,#000,#fff)',{x:0,y:0,width:100,height:200},'reading-gradient-0')).toContain('x1="0" y1="100" x2="100" y2="100"');
    expect(()=>readingGradientDefinition('linear-gradient(90deg,url(https://invalid.example),#fff)',{x:0,y:0,width:100,height:200},'reading-gradient-0')).toThrow();
    const ekiden=profiles.find(profile=>profile.sourceStyleId==='ekiden-pack')!,bang=profiles.find(profile=>profile.sourceStyleId==='bang-bang')!;
    const es=sources.find(item=>item.layout.id===ekiden.sourceStyleId)!.layout,bs=sources.find(item=>item.layout.id===bang.sourceStyleId)!.layout;
    const e=layoutReadingProfilePage(ekiden,1,sourceValues(es,1)).svg,b=layoutReadingProfilePage(bang,1,sourceValues(bs,1)).svg;
    expect(e).toContain('skewX(-12)');expect(e).toMatch(/rotate\(-[3458] /);expect(b).toContain('translate(8 8)');
  });
});
