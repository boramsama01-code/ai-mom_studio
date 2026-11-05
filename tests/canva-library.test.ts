import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import type { DB } from '../server/db';
import { CANVA_READING_TEXT_FIELDS } from '../shared/canvaEditorial';
import { canvaFolderDatasetErrors, canvaFolderTextErrors, canvaFolderTextFields, canvaLibraryPreviewGeometry, parseCanvaFolderId } from '../shared/canvaTemplateLibrary';
import { canvaLibraryDesignStatus, canvaLibraryFailure } from '../server/services/canvaTemplateLibrary';
import { decodeCanvaLibraryExport, downloadCanvaLibraryExport } from '../server/services/canvaLibraryAssets';
import { getCanvaFolder, listCanvaFolderDesigns, getCanvaLibraryPages, submitCanvaLibraryExport, getCanvaLibraryExportJob, CanvaRestError } from '../server/services/canvaRest';
import { CANVA_SCOPES } from '../server/services/canva';
import { familyDialogueCardFixture } from './fixtures/familyDialogueCard';
const dataset=()=>Object.fromEntries(CANVA_READING_TEXT_FIELDS.map(name=>[name,{type:'text'}]));
const pages=(width=1080,height=1350,count=8)=>Array.from({length:count},(_,index)=>({id:`page_${index+1}`,pageNumber:index+1,width,height}));
const db={} as DB;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{
  vi.stubEnv('CANVA_CLIENT_ID','isolated-client');vi.stubEnv('CANVA_CLIENT_SECRET','isolated-secret');vi.stubEnv('CANVA_ACCESS_TOKEN','isolated-token');vi.stubEnv('CANVA_REFRESH_TOKEN','isolated-refresh');vi.stubEnv('CANVA_TOKEN_EXPIRES_AT',String(Date.now()+3600000));
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unmocked external call prohibited');}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Canva native folder contract',()=>{
  it('accepts only actual Canva folder identifiers and HTTPS folder URLs',()=>{
    expect(parseCanvaFolderId('FAHZ9dTp-H8')).toBe('FAHZ9dTp-H8');
    expect(parseCanvaFolderId(' https://www.canva.com/folder/FAHZ9dTp-H8/ ')).toBe('FAHZ9dTp-H8');
    for(const value of ['http://canva.com/folder/FAHZ9dTp-H8','https://canva.com.evil.test/folder/FAHZ9dTp-H8','https://secret@canva.com/folder/FAHZ9dTp-H8','https://canva.com:8443/folder/FAHZ9dTp-H8','https://canva.com/design/Dabcdef/edit'])expect(parseCanvaFolderId(value)).toBeNull();
  });
  it('requires every article label, rejects unmapped text, and preserves optional picture labels',()=>{
    expect(canvaFolderDatasetErrors({...dataset(),PHOTO:{type:'image'}})).toEqual([]);
    expect(canvaFolderDatasetErrors({...dataset(),P01_HEADLINE:{type:'image'}})).toContain('P01_HEADLINE: 텍스트 필드 필요');
    expect(canvaFolderDatasetErrors({...dataset(),EXTRA_ARTICLE:{type:'text'}})).toContain('EXTRA_ARTICLE: 지원하지 않는 텍스트 필드');
    expect(canvaFolderDatasetErrors({...dataset(),CHART:{type:'chart'}})).toContain('CHART: 지원하지 않는 필드 유형');
  });
  it('fills article text without pictures, local geometry, or an unrelated default picture credit',()=>{
    const copy=familyDialogueCardFixture(),before=structuredClone(copy),fields=canvaFolderTextFields(copy);
    const cover=copy.pages.find(page=>page.id==='cover')!;
    expect(fields.P01_HEADLINE.text).toBe(cover.fields.headline);
    expect(Object.keys(fields)).toHaveLength(43);expect(fields.P01_IMAGE_CREDIT).toBeUndefined();
    expect(Object.values(fields).every(field=>field.type==='text')).toBe(true);expect(copy).toEqual(before);
    copy.pages[0].displayOverrides={imageCredit:'사진: 직접 확인한 출처'};
    expect(canvaFolderTextFields(copy).P01_IMAGE_CREDIT.text).toBe('사진: 직접 확인한 출처');
    copy.pages[1].displayOverrides={imageCredit:'존재하지 않는 출처 칸'};
    expect(canvaFolderTextErrors(copy,dataset()).some(error=>error.includes('표시 필드'))).toBe(true);
  });
  it('keeps nonstandard designs browsable but cannot create standard articles from them',()=>{
    expect(canvaLibraryDesignStatus(8,pages(),dataset()).status).toBe('ready');
    expect(canvaLibraryDesignStatus(8,pages(900,1200),dataset()).status).toBe('unsupported_pages');
    expect(canvaLibraryDesignStatus(1,pages(1080,1350,1),dataset()).status).toBe('unsupported_pages');
    expect(canvaLibraryDesignStatus(8,pages().map(page=>({...page,id:null})),dataset()).status).toBe('unavailable');
    expect(canvaLibraryDesignStatus(8,pages(),{}).status).toBe('needs_fields');
  });
  it('uses longer backoff for expired consent and quota while retaining a bounded public message',()=>{
    expect(canvaLibraryFailure(new CanvaRestError('다시 연결',403,'permission_denied',false,null,{reason:'missing_scope'}))).toMatchObject({reconnect:true,delay:900000});
    expect(canvaLibraryFailure(new CanvaRestError('한도',429,'rate_limited',false,null,{reason:'quota_exceeded'}))).toMatchObject({reconnect:false,delay:3600000});
    expect(canvaLibraryFailure(new Error('secret provider detail')).message).not.toContain('secret');
  });
  it('uses one export axis that bounds mixed page ratios without changing the original metadata',()=>{
    const source=[...pages(1080,1920,1),{id:'page_2',pageNumber:2,width:1920,height:1080}],original=structuredClone(source);
    const geometry=canvaLibraryPreviewGeometry(source)!;
    expect(Object.keys(geometry.format)).toHaveLength(1);
    expect(geometry.pages.every(page=>page.width<=540&&page.height<=720)).toBe(true);
    for(const [index,page] of geometry.pages.entries())expect(Math.abs(page.width*source[index].height/source[index].width-page.height)).toBeLessThanOrEqual(1);
    expect(source).toEqual(original);
    expect(canvaLibraryPreviewGeometry(pages(1080,1920,1))?.format).toEqual({height:720});
  });
  it('requires the requested Canva export axis to be at least 40 pixels',()=>{
    expect(canvaLibraryPreviewGeometry(pages(20,2000,1))?.format).toEqual({height:720});
    expect(canvaLibraryPreviewGeometry(pages(20,20,1))).toBeNull();
    expect(canvaLibraryPreviewGeometry([...pages(20,2000,1),{id:'page_2',pageNumber:2,width:2000,height:20}])).toBeNull();
  });
});
describe('Canva folder and preview REST boundary',()=>{
  it('asks for folder scope and follows an opaque continuation without interpreting it',async()=>{
    const fetchImpl=vi.fn().mockResolvedValueOnce(response({folder:{id:'FAfolder',name:'원본'}})).mockResolvedValueOnce(response({items:[{type:'design',design:{id:'Dsource',title:'원본',updated_at:123}}],continuation:'opaque/+='}));
    expect(CANVA_SCOPES).toContain('folder:read');expect(await getCanvaFolder(db,'FAfolder',{fetchImpl})).toEqual({id:'FAfolder',name:'원본'});
    expect(await listCanvaFolderDesigns(db,'FAfolder','opaque/+=',{fetchImpl})).toMatchObject({items:[{id:'Dsource',type:'design',updatedAt:123}],continuation:'opaque/+='});
    const url=new URL(fetchImpl.mock.calls[1][0]);expect(url.searchParams.get('continuation')).toBe('opaque/+=');expect(url.searchParams.get('item_types')).toBe('design,brand_template');
  });
  it('does not persist expiring thumbnails and keeps actual page ratios',async()=>{
    const fetchImpl=vi.fn().mockResolvedValue(response({items:[{id:'p1',page_number:1,dimensions:{width:900,height:1200},thumbnail:{url:'https://document-export.canva.com/expiring.png'}}]}));
    expect(await getCanvaLibraryPages(db,'Dsource',{fetchImpl})).toEqual([{id:'p1',pageNumber:1,width:900,height:1200,thumbnailUrl:null}]);
  });
  it('requests only one scaled axis, and keeps a returned job ID even if its result is malformed',async()=>{
    const fetchImpl=vi.fn().mockResolvedValue(response({job:{id:'job_1',status:'success',urls:['https://evil.test/output.png']}}));
    await expect(submitCanvaLibraryExport(db,'Dsource',pages(1080,1350,2),{fetchImpl})).rejects.toMatchObject({jobId:'job_1',outcomeUnknown:true});
    expect(fetchImpl).toHaveBeenCalledOnce();expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({design_id:'Dsource',format:{type:'png',width:540,as_single_image:false,pages:[1,2]}});
  });
  it('never retries an uncertain export and rejects foreign lookup results',async()=>{
    const fetchImpl=vi.fn().mockRejectedValue(new TypeError('network'));
    await expect(submitCanvaLibraryExport(db,'Dsource',pages(1080,1350,1),{fetchImpl})).rejects.toMatchObject({outcomeUnknown:true});expect(fetchImpl).toHaveBeenCalledOnce();
    fetchImpl.mockResolvedValue(response({job:{id:'different',status:'in_progress'}}));
    await expect(getCanvaLibraryExportJob(db,'job_1',{fetchImpl})).rejects.toMatchObject({code:'invalid_response',jobId:'job_1'});
  });
});
describe('cached Canva preview bytes',()=>{
  it.each([[900,1200,540,720],[1080,1350,540,675]])('validates Canva-scaled PNGs from a %i×%i source without changing their ratio',async(width,height,outWidth,outHeight)=>{
    const bytes=await sharp({create:{width:outWidth,height:outHeight,channels:3,background:'#ffcc33'}}).png().toBuffer();
    const [preview]=await decodeCanvaLibraryExport([{name:'opaque',bytes,pageNumber:1}],pages(width,height,1));
    expect(preview).toMatchObject({page:0,width:outWidth,height:outHeight,mime:'image/webp'});expect(preview.bytes.length).toBeLessThan(bytes.length);
  });
  it('requires explicit archive ordering and exact page geometry',async()=>{
    const bytes=await sharp({create:{width:90,height:120,channels:3,background:'#00aa77'}}).png().toBuffer();
    const archive=Buffer.from(zipSync({'opaque-a.png':bytes,'opaque-b.png':bytes}));
    await expect(decodeCanvaLibraryExport([{name:'pages.zip',bytes:archive}],pages(90,120,2))).rejects.toThrow('순서');
    await expect(decodeCanvaLibraryExport([{name:'1.png',bytes,pageNumber:1}],pages(100,120,1))).rejects.toThrow('크기');
  });
  it('rejects an original-size export before allocating its decoded pixels',async()=>{
    const bytes=await sharp({create:{width:1080,height:1350,channels:3,background:'#00aa77'}}).png().toBuffer();
    await expect(decodeCanvaLibraryExport([{name:'1.png',bytes,pageNumber:1}],pages(1080,1350,1))).rejects.toThrow();
  });
  it('rejects an archive entry above the preview byte cap before inflating it',async()=>{
    const archive=Buffer.from(zipSync({'1.png':new Uint8Array(2*1024*1024+1)}));
    await expect(decodeCanvaLibraryExport([{name:'pages.zip',bytes:archive}],pages(1080,1350,1))).rejects.toThrow('크기');
  });
  it('shares one 18-second budget across every download instead of resetting it per URL',async()=>{
    const bytes=await sharp({create:{width:90,height:120,channels:3,background:'#00aa77'}}).png().toBuffer();
    let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);const timeouts:number[]=[];
    const fetcher=vi.fn(async(url:string,options:any)=>{timeouts.push(options.timeoutMs);now+=10_000;return {body:bytes,finalUrl:url,status:200,contentType:'image/png'};});
    await expect(downloadCanvaLibraryExport(['https://export-download.canva.com/a.png','https://export-download.canva.com/b.png','https://export-download.canva.com/c.png'],pages(90,120,3),fetcher)).rejects.toMatchObject({extra:{code:'preview_download_retry'}});
    expect(timeouts).toEqual([18000,8000]);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('blocks foreign and credential-bearing download URLs before fetching',async()=>{
    const fetcher=vi.fn();
    for(const url of ['https://canva.com.evil.test/a.png','https://secret@canva.com/a.png','https://canva.com:8443/a.png','http://127.0.0.1/a.png'])await expect(downloadCanvaLibraryExport([url],pages(90,120,1),fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
