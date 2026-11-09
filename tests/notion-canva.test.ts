import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import sharp from 'sharp';
import jsQR from 'jsqr';
import type { DB } from '../server/db';
import { buildNotionCanvaPptx, decodeNotionCanvaPngExport, downloadNotionCanvaExport, getNotionCanvaExportJob, getNotionCanvaImportJob, getNotionCanvaPages, NOTION_CANVA_OUTRO, NOTION_CANVA_SOURCE_TITLE, NOTION_CANVA_TEASER_COMMENT, NOTION_CANVA_TEXT_SYNC, submitNotionCanvaExport, submitNotionCanvaImport, type NotionCanvaDocument } from '../server/services/notionCanva';

const db={} as DB;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const pending={job:{id:'job_1',status:'in_progress'}};
const document=(count=5,coverStyle:'A'|'B'|'C'='B'):NotionCanvaDocument=>({title:'영재교육 안내',coverStyle,category:'체험',pages:Array.from({length:count},(_,i)=>({title:i===0?'내 아이는\n영재일까요?':`${i+1}장 제목`,body:i===0?'아이의 호기심을 함께 살펴봐요.':`본문 ${i+1}. 내 아이에게 맞는 배움의 기회를 찾아보세요.`,...(i===0?{emphasis:'영재'}:{})}))});
const providerPages=(count:number)=>({items:Array.from({length:count},(_,i)=>({page_number:i+1,dimensions:{width:1080,height:1350}}))});
const officialUrls=[
  'https://ged.kedi.re.kr/eduIns/eduInsSub/eduInsViewPop1.do?pop1=Y&orgId=10117174002&stndYear=2025',
  'https://www.sen.go.kr/www/office/symbol.jsp',
  'https://www.jnu.ac.kr/MainIntro/Symbol/jnuUI',
];
const longUrlPrefix='https://www.sen.go.kr/notice?document=';
const long252=longUrlPrefix+'a'.repeat(252-longUrlPrefix.length);
function nativeShape(source:string,name:string){
  const part=[...source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(match=>match[1].includes(`name="${name}"`))?.[1];expect(part).toBeTruthy();
  const bounds=part!.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
  return {xml:part!,x:Number(bounds[1])/9525,y:Number(bounds[2])/9525,w:Number(bounds[3])/9525,h:Number(bounds[4])/9525};
}
const nativePlain=(source:string)=>[...source.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match=>match[1]).join('').replaceAll(/\s/g,'');
/** Rasterize the actual native OOXML rectangles, then decode with an independent
 * QR reader. This checks the exported geometry, not the encoder's own matrix. */
function decodedNativeQr(source:string,number:number){
  const shapes=[...source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(match=>{
    const xml=match[1],name=xml.match(/name="([^"]+)"/)?.[1]??'',t=xml.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/);
    return {name,x:t?Number(t[1])/9525:0,y:t?Number(t[2])/9525:0,w:t?Number(t[3])/9525:0,h:t?Number(t[4])/9525:0};
  });
  const background=shapes.find(shape=>shape.name===`source-qr-${number}-background`)!;expect(background).toBeTruthy();
  const ink=shapes.filter(shape=>shape.name.startsWith(`source-qr-${number}-r`));expect(ink.length).toBeGreaterThan(100);
  const unit=ink[0].h,size=background.w;expect(unit).toBeGreaterThanOrEqual(4);expect(unit).toBe(Math.round(unit));expect(size).toBe(background.h);
  const rgba=new Uint8ClampedArray(size*size*4).fill(255);
  for(const block of ink){
    const x=block.x-background.x,y=block.y-background.y;
    for(const value of [x,y,block.w,block.h])expect(value).toBe(Math.round(value));
    expect(x).toBeGreaterThanOrEqual(4*unit);expect(y).toBeGreaterThanOrEqual(4*unit);
    expect(x+block.w).toBeLessThanOrEqual(size-4*unit);expect(y+block.h).toBeLessThanOrEqual(size-4*unit);
    for(let py=y;py<y+block.h;py++)for(let px=x;px<x+block.w;px++){const offset=(py*size+px)*4;rgba[offset]=0;rgba[offset+1]=0;rgba[offset+2]=0;}
  }
  expect(background.x).toBeGreaterThanOrEqual(96);expect(background.x+size).toBeLessThanOrEqual(984);
  expect(background.y).toBeGreaterThanOrEqual(207);expect(background.y+size).toBeLessThanOrEqual(1143);
  const result=jsQR(rgba,size,size,{inversionAttempts:'dontInvert'});expect(result).not.toBeNull();return {data:result!.data,unit,size};
}
let smallPhoto:Buffer;
beforeEach(()=>{
  vi.stubEnv('CANVA_CLIENT_ID','isolated-client');vi.stubEnv('CANVA_CLIENT_SECRET','private-client-secret');
  vi.stubEnv('CANVA_ACCESS_TOKEN','private-access-token');vi.stubEnv('CANVA_REFRESH_TOKEN','private-refresh-token');
  vi.stubEnv('CANVA_TOKEN_EXPIRES_AT',String(Date.now()+3600000));
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unmocked external request prohibited');}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('native editable Notion manuscript PPTX',()=>{
  it('previews the same native photo/fade layout locally and keeps the PPTX unchanged',async()=>{
    const input=document(2,'A');input.pages[0].imageId='original';
    const photo=await sharp({create:{width:1080,height:1350,channels:3,background:'#72A7FF'}}).png().toBuffer(),photos=[{id:'original',bytes:photo,mimeType:'image/png'}];
    const result=await buildNotionCanvaPptx(input,photos,{previewPage:0}),plain=await buildNotionCanvaPptx(input,photos);
    expect(result.previewSvg).toContain('data-name="photo-1"');expect(result.previewSvg).toContain('linearGradient');expect(result.previewSvg).toContain('data-name="cover-title"');expect(result.previewSvg).toContain('<path d=');
    expect(strFromU8(unzipSync(result.bytes)['ppt/slides/slide1.xml'])).toBe(strFromU8(unzipSync(plain.bytes)['ppt/slides/slide1.xml']));
    const {data,info}=await sharp(Buffer.from(result.previewSvg!)).removeAlpha().raw().toBuffer({resolveWithObject:true});expect(info).toMatchObject({width:1080,height:1350});
    const pixel=(x:number,y:number)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];expect(pixel(50,100)).toEqual([114,167,255]);expect(pixel(50,1200)).toEqual([0,0,0]);
  });
  it('renders the last grouped source QR as a scannable local preview with its real label and URL',async()=>{
    const input=document(2);input.sourceReferences=Array.from({length:9},(_,i)=>({title:`기관 ${i+1}`,url:`https://ged.kedi.re.kr/notice/${i+1}`}));
    const result=await buildNotionCanvaPptx(input,[],{previewPage:4});expect(result.previewSvg).toContain('source-qr-9-background');expect(result.previewSvg).not.toContain('source-qr-1-background');expect(result.previewSvg).toContain('aria-label="기관 9"');
    const {data,info}=await sharp(Buffer.from(result.previewSvg!)).ensureAlpha().raw().toBuffer({resolveWithObject:true});expect(jsQR(new Uint8ClampedArray(data),info.width,info.height,{inversionAttempts:'dontInvert'})?.data).toBe(input.sourceReferences[8].url);
    await expect(buildNotionCanvaPptx(input,[],{previewPage:6})).rejects.toThrow('미리볼 카드 번호');
  });
  it('previews only the selected page without creating a PPTX or laying out unrelated cards',async()=>{
    const input=document(5,'A');input.sourceReferences=Array.from({length:23},(_,i)=>({title:`기관 ${i+1}`,url:`https://ged.kedi.re.kr/notice/${i+1}`}));input.teaser={title:'연구계획서 다음 편',body:'댓글로 남겨주세요.'};
    input.pages[0].imageId='original';const photo=await sharp({create:{width:1080,height:1350,channels:3,background:'#72A7FF'}}).png().toBuffer(),photos=[{id:'original',bytes:photo,mimeType:'image/png'}];
    const full=await buildNotionCanvaPptx(input,photos,{previewPage:0}),fast=await buildNotionCanvaPptx(input,photos,{previewPage:0,previewOnly:true});expect(fast.pageCount).toBe(13);expect(fast.bytes.length).toBe(0);expect(fast.previewSvg).toBe(full.previewSvg);
    input.pages[1].body='의도적으로 다른 장의 본문을 넘칩니다. '.repeat(60);
    await expect(buildNotionCanvaPptx(input,photos)).rejects.toThrow('2장 본문');expect((await buildNotionCanvaPptx(input,photos,{previewPage:0,previewOnly:true})).previewSvg).toBe(full.previewSvg);
    const last=await buildNotionCanvaPptx(input,photos,{previewPage:10,previewOnly:true});expect(last.previewSvg).toContain('source-qr-23-background');expect(last.previewSvg).toContain('원문 21–23 / 23');expect(last.previewSvg).not.toContain('source-qr-1-background');
    const {data,info}=await sharp(Buffer.from(last.previewSvg!)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const bounds=last.previewSvg!.match(/data-name="source-qr-23-background"><rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/)!;expect(bounds).toBeTruthy();const [left,top,width,height]=bounds.slice(1).map(Number);
    const crop=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).extract({left,top,width,height}).raw().toBuffer();expect(jsQR(new Uint8ClampedArray(crop),width,height,{inversionAttempts:'dontInvert'})?.data).toBe(input.sourceReferences[22].url);
    await expect(buildNotionCanvaPptx(input,photos,{previewOnly:true})).rejects.toThrow('미리볼 카드 번호');
  });
  it('keeps Korean copy as native text, preserves the supplied logo bytes and safe foreground geometry',async()=>{
    const input=document();input.pages[1].body='첫 문장 & <중요>\n둘째 문장';input.pages[1].bullets=['확인할 내용'];
    const result=await buildNotionCanvaPptx(input);
    const archive=unzipSync(result.bytes);
    expect(result).toMatchObject({pageCount:6,sourcePageCount:5,width:1080,height:1350,warnings:[]});
    expect(Object.keys(archive).filter(key=>/^ppt\/slides\/slide\d+\.xml$/.test(key))).toHaveLength(6);
    const cover=strFromU8(archive['ppt/slides/slide1.xml']);
    const interior=strFromU8(archive['ppt/slides/slide2.xml']);
    expect(cover).toContain('<a:t xml:space="preserve">영재</a:t>');
    expect(cover).toContain('srgbClr val="FF493B"');
    expect(cover).toContain('typeface="Noto Sans KR"');
    expect(cover).toContain('<p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"');
    expect(cover).not.toContain('cover-category');
    expect(interior).toContain('첫 문장 &amp; &lt;중요&gt;');expect(interior).toContain('둘째 문장');expect(interior).toContain('• 확인할 내용');
    expect(strFromU8(archive['ppt/presentation.xml'])).toContain('cx="10287000" cy="12858750"');
    expect(Buffer.from(archive['ppt/media/logo-color.png'])).toEqual(await fs.readFile(path.resolve('assets/branding/highscoop-magazine-color.png')));
    // All text boxes and logo pictures stay inside the approved square/profile-safe inset.
    for(let i=1;i<=6;i++){
      const source=strFromU8(archive[`ppt/slides/slide${i}.xml`]);
      for(const match of source.matchAll(/<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/g)){
        const [x,y,w,h]=match.slice(1).map(Number);
        expect(x).toBeGreaterThanOrEqual(96*9525);expect(y).toBeGreaterThanOrEqual(207*9525);
        expect(x+w).toBeLessThanOrEqual(984*9525+1);expect(y+h).toBeLessThanOrEqual(1143*9525+1);
      }
    }
    expect(NOTION_CANVA_TEXT_SYNC).toBe('manual-confirmation-required');
  });
  it('preserves two to ten manuscript pages and appends one fixed CTA without replacing the last source page',async()=>{
    expect((await buildNotionCanvaPptx(document(2))).pageCount).toBe(3);
    const full=await buildNotionCanvaPptx(document(10));expect(full.pageCount).toBe(11);expect(full.sourcePageCount).toBe(10);
    const files=unzipSync(full.bytes),lastSource=strFromU8(files['ppt/slides/slide10.xml']),outro=strFromU8(files['ppt/slides/slide11.xml']);
    expect(lastSource).toContain('10장 제목');expect(lastSource).toContain('본문 10.');
    for(const text of [NOTION_CANVA_OUTRO.follow,NOTION_CANVA_OUTRO.handle,...NOTION_CANVA_OUTRO.introduction.split('\n'),NOTION_CANVA_OUTRO.action])expect(outro).toContain(text);
    expect(outro).toContain('name="outro-red-pill"');expect(outro).toContain('prst="roundRect"');expect(outro).toContain('srgbClr val="FF493B"');
    await expect(buildNotionCanvaPptx(document(1))).rejects.toMatchObject({code:'invalid_request'});
    await expect(buildNotionCanvaPptx(document(11))).rejects.toMatchObject({code:'invalid_request'});
    const input=document(2);input.pages[1].body='한글 원고가 너무 길면 문장을 자르지 않습니다. '.repeat(45);
    await expect(buildNotionCanvaPptx(input)).rejects.toThrow('원고를 자르지 않았습니다');
  });
  it('uses separate native photos and a native fade for A, and requires a real photo for C',async()=>{
    smallPhoto??=await sharp({create:{width:600,height:400,channels:3,background:'#72A7FF'}}).png().toBuffer();
    const input=document(2,'A');
    const fallback=await buildNotionCanvaPptx(input);
    expect(fallback.warnings[0]).toContain('검정 정보형');
    input.pages[0].imageId='photo_1';input.pages[1].imageId='photo_1';
    const photos=[{id:'photo_1',bytes:smallPhoto,mimeType:'image/png'}];
    const result=await buildNotionCanvaPptx(input,photos);const archive=unzipSync(result.bytes);
    const cover=strFromU8(archive['ppt/slides/slide1.xml']);
    expect(cover).toContain('<a:gradFill');expect(cover).toContain('<a:alpha val="0"');expect(cover).toContain('name="cover-title"');expect(cover).toContain('<p:pic>');
    expect(Buffer.from(archive['ppt/media/photo-1.png'])).toEqual(smallPhoto);
    const c=document(2,'C');await expect(buildNotionCanvaPptx(c)).rejects.toThrow('실제 사진');
    c.pages[0].imageId='photo_1';expect((await buildNotionCanvaPptx(c,photos)).warnings).toEqual([]);
    c.pages[0].imageId='missing';await expect(buildNotionCanvaPptx(c,photos)).rejects.toThrow('사진을 찾을 수 없습니다');
    await expect(buildNotionCanvaPptx(input,[{id:'photo_1',bytes:Buffer.from('not a picture'),mimeType:'image/png'}])).rejects.toMatchObject({code:'invalid_request'});
  });
  it('normalizes EXIF-only rotation in the embedded photo while preserving the Studio source bytes',async()=>{
    const source=await sharp({create:{width:120,height:80,channels:3,background:'#FFD166'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const before=Buffer.from(source),input=document(2,'C');input.pages[0].imageId='rotated';
    const built=await buildNotionCanvaPptx(input,[{id:'rotated',bytes:source,mimeType:'image/jpeg'}]);
    const archive=unzipSync(built.bytes),embedded=Buffer.from(archive['ppt/media/photo-1.png']);
    const meta=await sharp(embedded).metadata();expect(meta).toMatchObject({width:80,height:120,format:'png'});
    expect(source).toEqual(before);expect(built.warnings[0]).toContain('Studio 원본은 보존');
  });
  it('creates native lower-half markers only for an explicitly requested interior phrase',async()=>{
    const input=document(2);input.pages[1]={title:'아이의 호기심을 살펴봐요',body:'호기심은 일상 속 질문에서 시작합니다.',emphasis:'호기심'};
    const marked=unzipSync((await buildNotionCanvaPptx(input)).bytes);const source=strFromU8(marked['ppt/slides/slide2.xml']);
    expect(source).toContain('page-2-title-explicit-marker');expect(source).toContain('page-2-body-explicit-marker');expect(source).toContain('<a:alpha val="35000"/>');
    expect(source.indexOf('page-2-body-explicit-marker')).toBeLessThan(source.indexOf('name="page-2-body"'));
    delete input.pages[1].emphasis;delete input.pages[0].emphasis;
    const plain=unzipSync((await buildNotionCanvaPptx(input)).bytes);expect(strFromU8(plain['ppt/slides/slide2.xml'])).not.toContain('explicit-marker');
    expect(strFromU8(plain['ppt/slides/slide1.xml'])).not.toContain('srgbClr val="FF493B"/></a:solidFill><a:latin');
  });
  it('keeps three-line Notion cover subtitles and dense four-line 120-character subtitles intact in A and C',async()=>{
    smallPhoto??=await sharp({create:{width:600,height:400,channels:3,background:'#72A7FF'}}).png().toBuffer();
    const photo={id:'cover_photo',bytes:smallPhoto,mimeType:'image/png'};
    const denseThree=(count:number)=>{const n=count-2,a=Math.floor(n/3),b=Math.floor((n-a)/2);return ['원'.repeat(a),'고'.repeat(b),'문'.repeat(n-a-b)].join('\n');};
    const denseFour=['가'.repeat(29),'나'.repeat(29),'다'.repeat(29),'라'.repeat(30)].join('\n');
    expect(denseFour.length).toBe(120);
    const captions=['2027학년도 서울 중등 영재교육원\n강남서초 사례\n2026년 기준',...([58,68,64].map(count=>{const value=denseThree(count);expect(value.length).toBe(count);return value;})),denseFour];
    const shape=(source:string,name:string)=>{
      const part=[...source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].find(match=>match[1].includes(`name="${name}"`))?.[1];expect(part).toBeTruthy();
      const bounds=part!.match(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
      return {part:part!,x:Number(bounds[1])/9525,y:Number(bounds[2])/9525,w:Number(bounds[3])/9525,h:Number(bounds[4])/9525};
    };
    for(const style of ['A','C'] as const){
      for(const caption of captions){
        const input=document(2,style);input.pages[0]={title:'원서만 쓰면 끝? 전형료 납부까지 확인하세요',body:caption,imageId:photo.id};
        const built=await buildNotionCanvaPptx(input,[photo]);expect(built.pageCount).toBe(3);
        const source=strFromU8(unzipSync(built.bytes)['ppt/slides/slide1.xml']),title=shape(source,'cover-title'),sub=shape(source,'cover-caption');
        expect([...sub.part.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match=>match[1])).toEqual(caption.split('\n'));
        expect(sub.h).toBeGreaterThan(style==='A'?55:36);expect(sub.h).toBeLessThanOrEqual(128);
        expect(title.y+title.h).toBeLessThanOrEqual(sub.y-(style==='A'?14:6)+.001);
        expect(sub.y+sub.h).toBeLessThanOrEqual(style==='A'?1072:1082);
        expect(source).toContain(`y="${(style==='A'?1078:1091)*9525}"`);
        if(style==='A'){expect(title.y).toBe(730);expect(title.h).toBeLessThan(268);}
        else{expect(title.y).toBeLessThan(845);expect(title.h).toBe(195);}
      }
      const short=document(2,style);short.pages[0]={title:'짧은 표지',body:'한 줄 설명',imageId:photo.id};
      const source=strFromU8(unzipSync((await buildNotionCanvaPptx(short,[photo])).bytes)['ppt/slides/slide1.xml']),sub=shape(source,'cover-caption'),title=shape(source,'cover-title');
      expect(sub).toMatchObject({y:style==='A'?1012:1046,h:style==='A'?55:36});
      expect(title).toMatchObject({y:style==='A'?730:845,h:style==='A'?268:195});
    }
  });
  it('preserves separate footnotes and source labels with dedicated safe areas on A/B/C covers and photo/text interiors',async()=>{
    smallPhoto??=await sharp({create:{width:600,height:400,channels:3,background:'#72A7FF'}}).png().toBuffer();
    const photo={id:'cover_photo',bytes:smallPhoto,mimeType:'image/png'};
    const footnote='2026.11.09 기준 · 2027학년도 · 확인된 기관 사례 · 변경 공고 우선',sourceLabel='각 기관 공식 모집요강·GED';
    const caption='2027학년도 · 초등·중등 · 11월 9일 기준\n\n학생 접수 중인 곳부터\n추천·선교육이 진행 중인 곳까지.\n기관명과 접수 단계를 구분해 한눈에 확인하세요.';
    for(const style of ['A','B','C']as const){
      const input=document(3,style);input.pages[0]={title:'11월 전국 영재교육원 모집 일정 안내',body:caption,footnote,sourceLabel,imageId:style==='B'?undefined:photo.id};
      input.pages[1]={title:'본문과 각주를 구분해요',body:'원본 본문은 그대로 유지합니다.',footnote,sourceLabel};
      input.pages[2]={title:'사진 원본을 보존해요',body:'별도 사진과 편집 가능한 원고입니다.',footnote,sourceLabel,imageId:photo.id};
      const built=await buildNotionCanvaPptx(input,[photo]),files=unzipSync(built.bytes);expect(built).toMatchObject({pageCount:4,sourcePageCount:3});
      const cover=strFromU8(files['ppt/slides/slide1.xml']),title=nativeShape(cover,style==='B'?'cover-question':'cover-title'),sub=nativeShape(cover,'cover-caption'),note=nativeShape(cover,'cover-footer');
      expect(nativePlain(sub.xml)).toBe(caption.replaceAll(/\s/g,''));expect(nativePlain(note.xml)).toBe((footnote+sourceLabel).replaceAll(/\s/g,''));
      expect(title.y+title.h).toBeLessThanOrEqual(sub.y-6);expect(sub.y+sub.h).toBeLessThan(note.y);
      expect(note.y+note.h).toBeLessThanOrEqual(style==='B'?1143:1078);expect(note.xml).toContain('typeface="Noto Sans KR"');
      for(const i of [2,3]){
        const source=strFromU8(files[`ppt/slides/slide${i}.xml`]),body=nativeShape(source,`page-${i}-body`),footer=nativeShape(source,`page-${i}-footer`);
        expect(nativePlain(footer.xml)).toBe((footnote+sourceLabel).replaceAll(/\s/g,''));expect(body.y+body.h).toBeLessThan(footer.y);expect(footer.y+footer.h).toBeLessThan(1078);
      }
    }
    const overfull=document(2);overfull.pages[0].footnote='각주 첫째 줄\n둘째 줄\n셋째 줄';await expect(buildNotionCanvaPptx(overfull)).rejects.toThrow('표지 각주·출처');
    const interiorOverfull=document(2);interiorOverfull.pages[1].footnote='첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄';await expect(buildNotionCanvaPptx(interiorOverfull)).rejects.toThrow('2장 각주·출처');
  });
  it('adds an opt-in native four-step infographic without altering five institutions, dates, notes or source page count',async()=>{
    const body='11월 추천 기간을 신규 접수로 오해하지 마세요\n\n강릉교육지원청 부설영재교육원｜학교 추천 11/9~13\n제주융합과학연구원·제주과학고 영재교육원｜학교 제출 11/9~13\n대구과학영재교육원｜교사 추천 ~11/10 · 학교 추천 11/11~18\n인천교육청 과학영재교육원(중등)｜학교 추천 ~11/16 16시\n창원(창원)교육지원청 영재교육원｜교사 추천서 11/13~17 18시';
    const input=document(2);input.pages[1]={title:'학생 접수는 끝, 추천 단계는 진행',body,footnote:'2026.11.09 기준 · 2027학년도 · 확인된 기관 사례 · 변경 공고 우선',sourceLabel:'각 기관 공식 모집요강·GED',infographic:'application_steps'};
    const built=await buildNotionCanvaPptx(input),files=unzipSync(built.bytes),source=strFromU8(files['ppt/slides/slide2.xml']);
    expect(built).toMatchObject({sourcePageCount:2,pageCount:3});expect(nativePlain(nativeShape(source,'page-2-body').xml)).toBe(body.replaceAll(/\s/g,''));
    for(const [i,label]of ['학생 접수','교사 추천','학교 제출','평가'].entries()){
      const shape=nativeShape(source,`application-step-${i+1}`),text=nativeShape(source,`application-step-${i+1}-label`);
      expect(nativePlain(text.xml)).toBe(label.replaceAll(/\s/g,''));expect(shape.x).toBeGreaterThanOrEqual(96);expect(shape.x+shape.w).toBeLessThanOrEqual(984);
      expect(shape.xml).toContain(i===1||i===2?'val="FF493B"':'val="B8B8B8"');
    }
    expect(source).toContain('일반적인 흐름 · 기관별 절차·명칭은 원문 확인');expect(source).not.toContain('완료');expect(source).not.toContain('<p:pic><p:nvPicPr><p:cNvPr id="2" name="photo');
    const title=nativeShape(source,'page-2-title'),content=nativeShape(source,'page-2-body'),note=nativeShape(source,'page-2-footer');
    expect(title.y+title.h).toBeLessThan(485);expect(content.y).toBe(650);expect(content.y+content.h).toBeLessThan(note.y);expect(note.y+note.h).toBeLessThan(1078);
    smallPhoto??=await sharp({create:{width:600,height:400,channels:3,background:'#72A7FF'}}).png().toBuffer();
    input.pages[1].imageId='photo_1';await expect(buildNotionCanvaPptx(input,[{id:'photo_1',bytes:smallPhoto,mimeType:'image/png'}])).rejects.toThrow('도식과 사진');
    delete input.pages[1].imageId;input.pages[0].infographic='application_steps';await expect(buildNotionCanvaPptx(input)).rejects.toThrow('내지에만');
    delete input.pages[0].infographic;input.pages[1].body=body.repeat(4);await expect(buildNotionCanvaPptx(input)).rejects.toThrow('2장 본문');
  });
  it('round-trips official URLs through the actual native QR shapes for one, two, three and four sources',async()=>{
    expect(long252.length).toBe(252);
    const urls=[...officialUrls,long252];
    for(const count of [1,2,3,4]){
      const input=document(2);input.sourceReferences=urls.slice(0,count).map((url,i)=>({title:`공식 안내 ${i+1}`,url}));
      const result=await buildNotionCanvaPptx(input),files=unzipSync(result.bytes);expect(result).toMatchObject({sourcePageCount:2,pageCount:4});
      const source=strFromU8(files['ppt/slides/slide3.xml']);expect(source).toContain(NOTION_CANVA_SOURCE_TITLE);
      expect(Object.keys(files).filter(file=>file.startsWith('ppt/media/'))).toHaveLength(2);
      for(let i=0;i<count;i++)expect(decodedNativeQr(source,i+1).data).toBe(urls[i]);
      expect(strFromU8(files['ppt/slides/slide4.xml'])).toContain(NOTION_CANVA_OUTRO.handle);
    }
  });
  it('keeps source manuscript -> QR -> exact teaser -> Follow order at the thirteen-page maximum',async()=>{
    const input=document(10);input.sourceReferences=officialUrls.map((url,i)=>({title:`공식 원문 제목 ${i+1}`,url}));
    input.teaser={title:'3일만에 쓰는 영재교육원 연구계획서',body:'주제 선정부터 초안 정리까지\n\n주제는 어떻게 정하고, 어디까지 써야 할까요?\n준비하면서 궁금한 점을 댓글로 남겨주세요.\n다음 편을 준비할 때 함께 살펴볼게요.\n\n연구계획서 제출 여부와 양식은 지원 기관·과정의 모집요강을 확인하세요.\n\nHighScoop · spacepenguin.co'};
    const built=await buildNotionCanvaPptx(input),files=unzipSync(built.bytes);expect(built).toMatchObject({sourcePageCount:10,pageCount:13});
    expect(strFromU8(files['ppt/slides/slide10.xml'])).toContain('10장 제목');
    expect(strFromU8(files['ppt/slides/slide11.xml'])).toContain(NOTION_CANVA_SOURCE_TITLE);
    const teaser=strFromU8(files['ppt/slides/slide12.xml']),plain=[...teaser.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join('').replaceAll(/\s/g,'');
    expect(plain).toContain(input.teaser.title.replaceAll(/\s/g,''));expect(plain).toContain(input.teaser.body.replaceAll(/\s/g,''));
    const teaserBody=nativeShape(teaser,'teaser-body'),teaserTitle=nativeShape(teaser,'teaser-title');expect(teaserBody.y).toBeGreaterThan(teaserTitle.y+teaserTitle.h);expect(teaserBody.y+teaserBody.h).toBeLessThan(974);
    expect(teaser).toContain(NOTION_CANVA_TEASER_COMMENT);expect(teaser).toContain('teaser-comment-pill');
    expect(strFromU8(files['ppt/slides/slide13.xml'])).toContain(NOTION_CANVA_OUTRO.action);
    const onlyTeaser=document(2);onlyTeaser.teaser=input.teaser;expect((await buildNotionCanvaPptx(onlyTeaser)).pageCount).toBe(4);
    const legacy=document(2);legacy.sourceReferences=[];expect((await buildNotionCanvaPptx(legacy)).pageCount).toBe(3);
  });
  it('keeps 23 direct institutional QRs in order across six safe source pages before teaser and Follow',async()=>{
    const input=document(5),references=Array.from({length:23},(_,i)=>({title:`기관 ${i+1} 공식 모집 공고`,url:`https://ged.kedi.re.kr/inno/slctNotiInnoPop.do?stndYear=2027&seq=${26000+i}`}));
    input.sourceReferences=references;input.sourceCard={title:'기관별 원문 공고',body:'기관명을 확인하고 해당 QR을 스캔하세요.',footnote:'2026.11.09 기준 · 변경 공고 우선'};
    input.teaser={title:'3일 만에 쓰는 연구계획서',body:'궁금한 점을 댓글로 남겨주세요.'};
    const result=await buildNotionCanvaPptx(input),files=unzipSync(result.bytes),decoded:string[]=[];expect(result).toMatchObject({sourcePageCount:5,pageCount:13});
    for(let group=0;group<6;group++){
      const source=strFromU8(files[`ppt/slides/slide${6+group}.xml`]),chunk=references.slice(group*4,group*4+4);
      expect([...source.matchAll(/name="source-qr-\d+-background"/g)]).toHaveLength(chunk.length);
      expect(nativePlain(nativeShape(source,'sources-heading').xml)).toBe(input.sourceCard.title.replaceAll(/\s/g,''));
      expect(nativePlain(nativeShape(source,'sources-range').xml)).toBe(`원문${String(group*4+1).padStart(2,'0')}–${String(group*4+chunk.length).padStart(2,'0')}/23`);
      for(const [i,reference]of chunk.entries()){
        const number=group*4+i+1;expect(nativePlain(nativeShape(source,`source-${number}-title`).xml)).toBe(reference.title.replaceAll(/\s/g,''));decoded.push(decodedNativeQr(source,number).data);
      }
      const last=group*4+chunk.length,qrBounds=nativeShape(source,`source-qr-${last}-background`),footer=nativeShape(source,'sources-footer');expect(qrBounds.y+qrBounds.h).toBeLessThan(footer.y);
    }
    expect(decoded).toEqual(references.map(ref=>ref.url));expect(new Set(decoded).size).toBe(23);
    expect(strFromU8(files['ppt/slides/slide12.xml'])).toContain(NOTION_CANVA_TEASER_COMMENT);expect(strFromU8(files['ppt/slides/slide13.xml'])).toContain(NOTION_CANVA_OUTRO.handle);
  });
  it('keeps the original QR card title, description and footnote alongside one or two scannable official QRs',async()=>{
    const sourceCard={title:'원문에서 마지막으로 확인하세요',body:'GED → 선발공고 → 2027학년도 → 기관 검색\n\nQR로 GED 모집공고를 열어보세요.\n기관명·지원 학년·서류·시험·정정 공고를 확인하세요.\n기관별 원문 QR과 초등·중등 비교표는 노션 전국 안내에 모았습니다.',footnote:'2026.11.09 기준 · 2027학년도 · 확인된 기관 사례 · 변경 공고 우선'};
    for(const count of [1,2]){
      const input=document(2);input.sourceReferences=officialUrls.slice(0,count).map((url,i)=>({title:`공식 기관 ${i+1}`,url}));input.sourceCard=sourceCard;
      const built=await buildNotionCanvaPptx(input),source=strFromU8(unzipSync(built.bytes)['ppt/slides/slide3.xml']);
      expect(built).toMatchObject({pageCount:4,sourcePageCount:2});
      for(const [name,copy]of [['sources-heading',sourceCard.title],['sources-body',sourceCard.body],['sources-footer',sourceCard.footnote]])expect(nativePlain(nativeShape(source,name).xml)).toBe(copy.replaceAll(/\s/g,''));
      expect(nativeShape(source,'sources-body').y+nativeShape(source,'sources-body').h).toBeLessThan(535);
      expect(nativeShape(source,'sources-footer').y).toBeGreaterThan(985);
      for(let i=0;i<count;i++)expect(decodedNativeQr(source,i+1).data).toBe(officialUrls[i]);
      expect(source).not.toContain('name="sources-guide"');
    }
    const noUrl=document(2);noUrl.sourceCard=sourceCard;await expect(buildNotionCanvaPptx(noUrl)).rejects.toThrow('공식 원문 주소');
    const dense=document(2);dense.sourceCard=sourceCard;dense.sourceReferences=officialUrls.map(url=>({title:'공식 원문',url}));await expect(buildNotionCanvaPptx(dense)).rejects.toThrow('원문 확인 설명');
    dense.sourceCard={title:'공식 원문',body:'각 기관 공고를 확인하세요.',footnote:'공식 공고 우선'};
    const source=strFromU8(unzipSync((await buildNotionCanvaPptx(dense)).bytes)['ppt/slides/slide3.xml']);for(let i=0;i<3;i++)expect(decodedNativeQr(source,i+1).data).toBe(officialUrls[i]);
  });
  it('rejects unsafe source URLs, too many sources, unreadably dense QRs and overflowing source titles without losing copy',async()=>{
    for(const url of ['http://www.sen.go.kr/','javascript:alert(1)','https://user:password@ged.kedi.re.kr/','https://127.0.0.1/','https://localhost/','https://ged.kedi.re.kr:8443/','https://www.sen.go.kr/a\u0000b']){
      const input=document(2);input.sourceReferences=[{title:'공식 안내',url}];await expect(buildNotionCanvaPptx(input)).rejects.toMatchObject({code:'invalid_request'});
    }
    const excess=document(2);excess.sourceReferences=Array.from({length:25},(_,i)=>({title:'공식 안내',url:`https://ged.kedi.re.kr/notice/${i}`}));await expect(buildNotionCanvaPptx(excess)).rejects.toMatchObject({code:'invalid_request'});
    const duplicate=document(2);duplicate.sourceReferences=[{title:'공식 안내',url:officialUrls[0]},{title:'다른 이름으로 중복',url:officialUrls[0]}];await expect(buildNotionCanvaPptx(duplicate)).rejects.toMatchObject({code:'invalid_request'});
    const overflowing=document(10);overflowing.sourceReferences=Array.from({length:5},(_,i)=>({title:'공식 안내',url:`https://ged.kedi.re.kr/notice/${i}`}));overflowing.teaser={title:'다음 편',body:'다음 편을 확인하세요.'};await expect(buildNotionCanvaPptx(overflowing)).rejects.toThrow('13장 이내');
    const dense=document(2);dense.sourceReferences=Array.from({length:4},(_,i)=>({title:'공식 안내',url:longUrlPrefix+'a'.repeat(1100)+i}));await expect(buildNotionCanvaPptx(dense)).rejects.toThrow('QR을 충분히 크게');
    const longTitle=document(2);longTitle.sourceReferences=Array.from({length:4},(_,i)=>({title:'공식원문제목'.repeat(20),url:officialUrls[i%3]+i}));await expect(buildNotionCanvaPptx(longTitle)).rejects.toThrow('원고를 자르지 않았습니다');
  });
});

describe('generic Canva import and export boundary',()=>{
  it('submits PPTX bytes once with documented Import-Metadata and persists an import job identity',async()=>{
    const built=await buildNotionCanvaPptx(document(2));
    const fetchImpl=vi.fn().mockResolvedValueOnce(response(pending));
    const title='한글 제목 '.repeat(12);
    expect(await submitNotionCanvaImport(db,{title,bytes:built.bytes},{fetchImpl})).toEqual({id:'job_1',status:'in_progress'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url,request]=fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.canva.com/rest/v1/imports');expect(request.method).toBe('POST');expect(request.redirect).toBe('error');expect(request.body).toBe(built.bytes);
    expect(request.headers['content-type']).toBe('application/octet-stream');
    const meta=JSON.parse(request.headers['import-metadata']);expect(meta.mime_type).toContain('presentationml.presentation');
    expect([...Buffer.from(meta.title_base64,'base64').toString('utf8')]).toHaveLength(50);
    expect(Buffer.from(meta.title_base64,'base64').toString('utf8')).toBe([...title].slice(0,50).join(''));
  });
  it('validates import result IDs and trusted links, and distinguishes terminal failure from uncertain POST results',async()=>{
    const fetchImpl=vi.fn().mockResolvedValueOnce(response({job:{id:'job_1',status:'success',result:{designs:[{id:'design_1',page_count:5,urls:{edit_url:'https://www.canva.com/design/design_1/edit'}}]}}}))
      .mockResolvedValueOnce(response({job:{id:'job_1',status:'failed',error:{message:'private-access-token'}}}))
      .mockResolvedValueOnce(response({job:{id:'wrong',status:'in_progress'}}))
      .mockResolvedValueOnce(response({job:{id:'job_1',status:'success',result:{designs:[{id:'design_1',url:'https://canva.com.attacker.test/edit'}]}}}));
    expect(await getNotionCanvaImportJob(db,'job_1',{fetchImpl})).toMatchObject({result:{designs:[{designId:'design_1',pageCount:5,editUrl:'https://www.canva.com/design/design_1/edit'}]}});
    expect(await getNotionCanvaImportJob(db,'job_1',{fetchImpl})).toEqual({id:'job_1',status:'failed',errorCode:'job_failed'});
    await expect(getNotionCanvaImportJob(db,'job_1',{fetchImpl})).rejects.toMatchObject({code:'invalid_response',jobId:'job_1'});
    await expect(getNotionCanvaImportJob(db,'job_1',{fetchImpl})).rejects.toMatchObject({code:'invalid_response'});
    const built=await buildNotionCanvaPptx(document(2));
    const failedPost=vi.fn().mockResolvedValue(response({message:'private-client-secret'},503));
    await expect(submitNotionCanvaImport(db,{title:'원고',bytes:built.bytes},{fetchImpl:failedPost})).rejects.toMatchObject({code:'provider_unavailable',outcomeUnknown:true});
    expect(failedPost).toHaveBeenCalledTimes(1);
    const network=vi.fn().mockRejectedValue(new Error('private-access-token'));
    await expect(submitNotionCanvaImport(db,{title:'원고',bytes:built.bytes},{fetchImpl:network})).rejects.toMatchObject({code:'result_unknown',outcomeUnknown:true});expect(network).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid files and cancellation before any external call',async()=>{
    const fetchImpl=vi.fn();await expect(submitNotionCanvaImport(db,{title:'원고',bytes:Buffer.from('x')},{fetchImpl})).rejects.toMatchObject({code:'invalid_request'});
    const controller=new AbortController();controller.abort();
    await expect(getNotionCanvaImportJob(db,'job_1',{fetchImpl,signal:controller.signal})).rejects.toMatchObject({code:'cancelled',outcomeUnknown:false});
    await expect(getNotionCanvaImportJob(db,'job/escape',{fetchImpl})).rejects.toMatchObject({code:'invalid_request'});expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('validates one through thirteen output pages at exact dimensions and checks live count before exporting',async()=>{
    for(const count of [1,5,10,11,13]){
      const fetchImpl=vi.fn().mockResolvedValueOnce(response(providerPages(count))).mockResolvedValueOnce(response(pending));
      expect(await submitNotionCanvaExport(db,{designId:'design_1',pageCount:count},{fetchImpl})).toMatchObject({id:'job_1',status:'in_progress'});
      expect(fetchImpl.mock.calls[0][0]).toContain('offset=1&limit=14');
      const body=JSON.parse(fetchImpl.mock.calls[1][1].body);expect(body.format).toEqual({type:'png',pages:Array.from({length:count},(_,i)=>i+1),width:1080,height:1350,as_single_image:false});
    }
    const wrong=providerPages(5);wrong.items[0].dimensions.height=1080;
    const dup=providerPages(5);dup.items[2].page_number=2;
    for(const result of [providerPages(14),wrong,dup,{items:[]}]){
      const fetchImpl=vi.fn().mockResolvedValue(response(result));
      await expect(getNotionCanvaPages(db,'design_1',{fetchImpl})).rejects.toMatchObject({code:'invalid_response'});
    }
    const changed=vi.fn().mockResolvedValueOnce(response(providerPages(4)));
    await expect(submitNotionCanvaExport(db,{designId:'design_1',pageCount:5},{fetchImpl:changed})).rejects.toMatchObject({code:'invalid_request'});expect(changed).toHaveBeenCalledTimes(1);
  });
  it('supports PDF/PPTX exports without PNG-only options and accepts thirteen bounded export URLs',async()=>{
    for(const format of ['pdf','pptx'] as const){const fetchImpl=vi.fn().mockResolvedValueOnce(response(providerPages(3))).mockResolvedValueOnce(response(pending));await submitNotionCanvaExport(db,{designId:'design_1',pageCount:3,format},{fetchImpl});expect(JSON.parse(fetchImpl.mock.calls[1][1].body).format).toEqual({type:format,pages:[1,2,3]});}
    const urls=Array.from({length:13},(_,i)=>`https://document-export.canva.com/export/${i+1}.png?signature=signed`);
    const fetchImpl=vi.fn().mockResolvedValueOnce(response({job:{id:'job_1',status:'success',urls}})).mockResolvedValueOnce(response({job:{id:'job_1',status:'success',urls:['https://www.canva.com/other']}}));
    expect((await getNotionCanvaExportJob(db,'job_1',{fetchImpl})).result?.urls).toHaveLength(13);
    await expect(getNotionCanvaExportJob(db,'job_1',{fetchImpl})).rejects.toMatchObject({code:'invalid_response'});
  });
});

describe('Canva export download and PNG validation',()=>{
  it('downloads only exact Canva export hosts, bounds bytes and forbids redirects to other hosts',async()=>{
    const url='https://export-download.canva.com/export/file.zip?signature=opaque';
    const fetcher=vi.fn().mockResolvedValue({finalUrl:url,status:200,contentType:'application/zip',body:Buffer.from('data')});
    expect(await downloadNotionCanvaExport(url,{fetcher})).toEqual(Buffer.from('data'));
    expect(fetcher.mock.calls[0][1]).toMatchObject({maxBytes:80*1024*1024,maxRedirects:3,allowedHosts:['export-download.canva.com']});
    for(const bad of ['https://export-download.canva.com.attacker.test/file','https://www.canva.com/design/1','https://user:password@document-export.canva.com/file','http://document-export.canva.com/file'])await expect(downloadNotionCanvaExport(bad,{fetcher})).rejects.toMatchObject({code:'invalid_request'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce({finalUrl:'https://attacker.test/file',status:200,body:Buffer.from('data')});
    await expect(downloadNotionCanvaExport(url,{fetcher})).rejects.toMatchObject({code:'invalid_request'});
  });
  it('checks thirteen PNG pages in numeric order, exact size, count and zip paths',async()=>{
    const png=await sharp({create:{width:1080,height:1350,channels:3,background:'#FFFFFF'}}).png().toBuffer();
    const archive=zipSync(Object.fromEntries(Array.from({length:13},(_,i)=>[`${13-i}.png`,png])));
    expect(await decodeNotionCanvaPngExport([{name:'export.zip',bytes:Buffer.from(archive)}],13)).toHaveLength(13);
    expect(await decodeNotionCanvaPngExport([{name:'opaque.png',bytes:png,pageNumber:1}],1)).toHaveLength(1);
    await expect(decodeNotionCanvaPngExport([{name:'1.png',bytes:png}],5)).rejects.toThrow('이미지 수');
    await expect(decodeNotionCanvaPngExport([{name:'1.png',bytes:png},{name:'same.png',bytes:png,pageNumber:1}],2)).rejects.toThrow('순서');
    const wrong=await sharp({create:{width:1080,height:1080,channels:3,background:'#FFFFFF'}}).png().toBuffer();
    await expect(decodeNotionCanvaPngExport([{name:'1.png',bytes:wrong}],1)).rejects.toThrow('1080×1350');
    await expect(decodeNotionCanvaPngExport([{name:'x.zip',bytes:Buffer.from(zipSync({'../1.png':png}))}],1)).rejects.toMatchObject({code:'invalid_request'});
  });
});
