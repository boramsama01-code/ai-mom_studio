import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import sharp from 'sharp';
import type { DB } from '../server/db';
import { buildNotionCanvaPptx, decodeNotionCanvaPngExport, downloadNotionCanvaExport, getNotionCanvaExportJob, getNotionCanvaImportJob, getNotionCanvaPages, NOTION_CANVA_OUTRO, NOTION_CANVA_TEXT_SYNC, submitNotionCanvaExport, submitNotionCanvaImport, type NotionCanvaDocument } from '../server/services/notionCanva';

const db={} as DB;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const pending={job:{id:'job_1',status:'in_progress'}};
const document=(count=5,coverStyle:'A'|'B'|'C'='B'):NotionCanvaDocument=>({title:'영재교육 안내',coverStyle,category:'체험',pages:Array.from({length:count},(_,i)=>({title:i===0?'내 아이는\n영재일까요?':`${i+1}장 제목`,body:i===0?'아이의 호기심을 함께 살펴봐요.':`본문 ${i+1}. 내 아이에게 맞는 배움의 기회를 찾아보세요.`,...(i===0?{emphasis:'영재'}:{})}))});
const providerPages=(count:number)=>({items:Array.from({length:count},(_,i)=>({page_number:i+1,dimensions:{width:1080,height:1350}}))});
let smallPhoto:Buffer;
beforeEach(()=>{
  vi.stubEnv('CANVA_CLIENT_ID','isolated-client');vi.stubEnv('CANVA_CLIENT_SECRET','private-client-secret');
  vi.stubEnv('CANVA_ACCESS_TOKEN','private-access-token');vi.stubEnv('CANVA_REFRESH_TOKEN','private-refresh-token');
  vi.stubEnv('CANVA_TOKEN_EXPIRES_AT',String(Date.now()+3600000));
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unmocked external request prohibited');}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('native editable Notion manuscript PPTX',()=>{
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
  it('validates one through eleven output pages at exact dimensions and checks live count before exporting',async()=>{
    for(const count of [1,5,10,11]){
      const fetchImpl=vi.fn().mockResolvedValueOnce(response(providerPages(count))).mockResolvedValueOnce(response(pending));
      expect(await submitNotionCanvaExport(db,{designId:'design_1',pageCount:count},{fetchImpl})).toMatchObject({id:'job_1',status:'in_progress'});
      expect(fetchImpl.mock.calls[0][0]).toContain('offset=1&limit=12');
      const body=JSON.parse(fetchImpl.mock.calls[1][1].body);expect(body.format).toEqual({type:'png',pages:Array.from({length:count},(_,i)=>i+1),width:1080,height:1350,as_single_image:false});
    }
    const wrong=providerPages(5);wrong.items[0].dimensions.height=1080;
    const dup=providerPages(5);dup.items[2].page_number=2;
    for(const result of [providerPages(12),wrong,dup,{items:[]}]){
      const fetchImpl=vi.fn().mockResolvedValue(response(result));
      await expect(getNotionCanvaPages(db,'design_1',{fetchImpl})).rejects.toMatchObject({code:'invalid_response'});
    }
    const changed=vi.fn().mockResolvedValueOnce(response(providerPages(4)));
    await expect(submitNotionCanvaExport(db,{designId:'design_1',pageCount:5},{fetchImpl:changed})).rejects.toMatchObject({code:'invalid_request'});expect(changed).toHaveBeenCalledTimes(1);
  });
  it('supports PDF/PPTX exports without PNG-only options and accepts eleven bounded export URLs',async()=>{
    for(const format of ['pdf','pptx'] as const){const fetchImpl=vi.fn().mockResolvedValueOnce(response(providerPages(3))).mockResolvedValueOnce(response(pending));await submitNotionCanvaExport(db,{designId:'design_1',pageCount:3,format},{fetchImpl});expect(JSON.parse(fetchImpl.mock.calls[1][1].body).format).toEqual({type:format,pages:[1,2,3]});}
    const urls=Array.from({length:11},(_,i)=>`https://document-export.canva.com/export/${i+1}.png?signature=signed`);
    const fetchImpl=vi.fn().mockResolvedValueOnce(response({job:{id:'job_1',status:'success',urls}})).mockResolvedValueOnce(response({job:{id:'job_1',status:'success',urls:['https://www.canva.com/other']}}));
    expect((await getNotionCanvaExportJob(db,'job_1',{fetchImpl})).result?.urls).toHaveLength(11);
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
  it('checks eleven PNG pages in numeric order, exact size, count and zip paths',async()=>{
    const png=await sharp({create:{width:1080,height:1350,channels:3,background:'#FFFFFF'}}).png().toBuffer();
    const archive=zipSync(Object.fromEntries(Array.from({length:11},(_,i)=>[`${11-i}.png`,png])));
    expect(await decodeNotionCanvaPngExport([{name:'export.zip',bytes:Buffer.from(archive)}],11)).toHaveLength(11);
    expect(await decodeNotionCanvaPngExport([{name:'opaque.png',bytes:png,pageNumber:1}],1)).toHaveLength(1);
    await expect(decodeNotionCanvaPngExport([{name:'1.png',bytes:png}],5)).rejects.toThrow('이미지 수');
    await expect(decodeNotionCanvaPngExport([{name:'1.png',bytes:png},{name:'same.png',bytes:png,pageNumber:1}],2)).rejects.toThrow('순서');
    const wrong=await sharp({create:{width:1080,height:1080,channels:3,background:'#FFFFFF'}}).png().toBuffer();
    await expect(decodeNotionCanvaPngExport([{name:'1.png',bytes:wrong}],1)).rejects.toThrow('1080×1350');
    await expect(decodeNotionCanvaPngExport([{name:'x.zip',bytes:Buffer.from(zipSync({'../1.png':png}))}],1)).rejects.toMatchObject({code:'invalid_request'});
  });
});
