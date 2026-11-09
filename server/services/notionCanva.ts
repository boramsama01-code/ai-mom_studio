/** Generic Notion manuscript → editable Canva import, separate from fixed 8-page masters.
 * Official API reference, checked 2026-11-09:
 * https://www.canva.dev/docs/apps/rest-apis/reference/design-imports/
 * https://www.canva.dev/docs/apps/rest-apis/reference/design-imports/create-design-import-job/
 * https://www.canva.dev/docs/apps/rest-apis/reference/exports/create-design-export-job/
 * Get design returns metadata; get dataset describes autofill fields, not arbitrary copy.
 * This integration does NOT claim automatic extraction of edited Canva manuscript text.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import type { DB } from '../db';
import { accessToken, CANVA_API } from './canva';
import { CanvaRestError, type CanvaRestOptions, type CanvaRestJob } from './canvaRest';
import { loadReadingFont } from './readingCardFonts';
import { safeFetch } from './safeFetch';

export const NOTION_CANVA_GEOMETRY = { width: 1080, height: 1350, safe: { x: 96, y: 207, width: 888, height: 936 } } as const;
export const NOTION_CANVA_TEXT_SYNC = 'manual-confirmation-required' as const;
export const NOTION_CANVA_MAX_OUTPUT_PAGES = 11;
/** Added after every manuscript page; the source's final page is never replaced. */
export const NOTION_CANVA_OUTRO = {
  title: 'HighScoop 채널 소개',
  follow: 'Follow',
  handle: '@highscoop.official',
  introduction: '영재교육원 10년차 엄마가 떠먹여주는\n영재교육 꿀팁',
  action: '찾는 수고는 덜고, 알맹이만 떠먹여 드립니다.',
  altText: 'Follow HighScoop. @highscoop.official. 영재교육원 10년차 엄마가 떠먹여주는 영재교육 꿀팁. 찾는 수고는 덜고, 알맹이만 떠먹여 드립니다.'
} as const;
export const NOTION_CANVA_CATEGORY_COLORS: Record<string, string> = { 영재원: '#FF493B', 입시: '#72A7FF', 대회: '#BAA0FF', 체험: '#5ED7B5', 꿀팁: '#FFD166' };
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_EXPORT_BYTES = 80 * 1024 * 1024;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_TOTAL_BYTES = 60 * 1024 * 1024;
const EMU = 9525;
const RED = '#FF493B', INK = '#171717';
const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const copy = z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
const pageSchema = z.object({ title: copy.trim().min(1).max(300), body: copy.max(2400).optional(), bullets: z.array(copy.max(500)).max(12).optional(), imageId: z.string().min(1).max(200).optional(), emphasis: copy.max(100).optional() }).strict();
const documentSchema = z.object({ title: copy.trim().min(1).max(255), coverStyle: z.enum(['A','B','C']), category: copy.trim().max(24).optional(), categoryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), pages: z.array(pageSchema).min(2).max(10) }).strict();
export type NotionCanvaDocument = z.infer<typeof documentSchema>;
export type NotionCanvaPhoto = { id: string; name?: string; bytes: Buffer; mimeType: string };
export type NotionCanvaPptx = { bytes: Buffer; pageCount: number; sourcePageCount: number; width: 1080; height: 1350; warnings: string[] };
export type NotionCanvaImportedDesign = { designId: string; editUrl: string | null; viewUrl: string | null; pageCount: number | null };
export type NotionCanvaImportResult = { designs: NotionCanvaImportedDesign[] };
export type NotionCanvaExportResult = { urls: string[] };
export type NotionCanvaPage = { pageNumber: number; width: number; height: number };
export type NotionCanvaDownloadOptions = { fetcher?: typeof safeFetch; signal?: AbortSignal };

function invalid(message = '원고·사진 또는 Canva 요청 항목을 확인해 주세요.'): never { throw new CanvaRestError(message, 422, 'invalid_request'); }
function parse<T>(schema: z.ZodType<T>, value: unknown, input = false, submitted = false, jobId: string | null = null): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CanvaRestError(input ? 'Canva 요청 항목의 형식·길이를 확인해 주세요.' : 'Canva 응답 형식을 확인할 수 없습니다. 저장된 작업 ID로 결과를 확인해 주세요.', input ? 422 : 502, input ? 'invalid_request' : 'invalid_response', submitted, jobId);
  return result.data;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: string) => parse(idSchema, value, true);
const canvaLink = z.string().max(8192).refine(value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'canva.com' || u.hostname.endsWith('.canva.com')); } catch { return false; }
});
const exportLink = z.string().max(8192).refine(value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['document-export.canva.com', 'export-download.canva.com'].includes(u.hostname); } catch { return false; }
});

async function boundedJson(response: Response, signal: AbortSignal, submitted: boolean): Promise<unknown> {
  const limit = 1024 * 1024;
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new CanvaRestError('Canva 응답이 저장 한도를 초과했습니다.', 502, 'invalid_response', submitted); }
  const reader = response.body?.getReader();
  if (!reader) throw new CanvaRestError('Canva 응답이 비어 있습니다.', 502, 'invalid_response', submitted);
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read(); signal.throwIfAborted(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new CanvaRestError('Canva 응답이 저장 한도를 초과했습니다.', 502, 'invalid_response', submitted); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new CanvaRestError('Canva 결과를 읽을 수 없습니다. 같은 생성 요청을 다시 보내지 않았습니다.', 502, 'invalid_response', submitted); }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Submit once and persist job.id. Unknown outcomes never trigger automatic POST retries. */
async function request(db: DB, endpoint: string, options: CanvaRestOptions, input?: { json?: unknown; bytes?: Buffer; title?: string }): Promise<unknown> {
  const submitted = input !== undefined;
  if (options.signal?.aborted) throw new CanvaRestError('Canva 요청을 취소했습니다.', undefined, 'cancelled');
  const fetchImpl = options.fetchImpl ?? fetch;
  let token: string;
  try { token = await accessToken(db, fetchImpl); }
  catch { throw new CanvaRestError('Canva 연결 정보를 확인할 수 없습니다. 계정을 다시 연결해 주세요.', 401, 'not_connected'); }
  const signal = AbortSignal.any([AbortSignal.timeout(input?.bytes ? 60_000 : 20_000), ...(options.signal ? [options.signal] : [])]);
  let sent = false;
  try {
    signal.throwIfAborted(); sent = true;
    const response = await fetchImpl(`${CANVA_API}${endpoint}`, {
      method: submitted ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { authorization: `Bearer ${token}`, ...(input?.bytes ? {
        'content-type': 'application/octet-stream',
        'import-metadata': JSON.stringify({ title_base64: Buffer.from([...input.title!].slice(0,50).join(''), 'utf8').toString('base64'), mime_type: PPTX_MIME }),
      } : input ? { 'content-type': 'application/json' } : {}) },
      ...(input?.bytes ? { body: input.bytes as unknown as BodyInit } : input ? { body: JSON.stringify(input.json) } : {})
    });
    if (!response.ok) {
      let failure: unknown; try { failure = await boundedJson(response, signal, false); } catch { /* Do not expose provider diagnostic bodies. */ }
      if (!submitted && response.status === 404 && endpoint.startsWith('/exports/') && object(failure) && failure.code === 'not_found' && failure.message === 'export job result has expired') throw new CanvaRestError('Canva 출력 파일의 보관 기간이 끝났습니다. 기존 디자인에서 다시 내보내 주세요.', 404, 'export_expired');
      const uncertain = response.status >= 500 || response.status === 408;
      const code = uncertain ? 'provider_unavailable' : response.status === 401 ? 'auth_required' : response.status === 403 ? 'permission_denied' : response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'invalid_request';
      const message = uncertain ? 'Canva가 처리 결과를 확인해 주지 못했습니다. 중복 생성을 피하려고 자동 재요청하지 않았습니다.' : response.status === 401 ? 'Canva 인증이 만료되었습니다. 계정을 다시 연결해 주세요.' : response.status === 403 ? 'Canva 연결 권한과 현재 계정·팀의 자료 접근 권한을 확인해 주세요.' : response.status === 429 ? 'Canva 호출 한도에 도달했습니다. 저장된 작업으로 잠시 후 다시 확인해 주세요.' : 'Canva가 요청을 거절했습니다. 연결 계정과 디자인·파일 항목을 확인해 주세요.';
      throw new CanvaRestError(message, response.status, code, submitted && uncertain);
    }
    return await boundedJson(response, signal, submitted);
  } catch (error) {
    if (error instanceof CanvaRestError) throw error;
    if (options.signal?.aborted) throw new CanvaRestError('Canva 대기를 중단했습니다. 저장된 작업 ID로 처리 결과를 확인해 주세요.', undefined, 'cancelled', submitted && sent);
    throw new CanvaRestError('Canva 응답을 받지 못했습니다. 결과가 미확정이므로 자동 재요청하지 않았습니다.', undefined, 'result_unknown', submitted && sent);
  }
}

function jobHeader(value: unknown, submitted: boolean, expectedId?: string) {
  const raw = object(value) && object(value.job) ? value.job : null;
  const id = idSchema.safeParse(raw?.id);
  const header = parse(z.object({ id: idSchema, status: z.enum(['in_progress','success','failed']) }), raw, false, submitted, id.success ? id.data : null);
  if (expectedId && header.id !== expectedId) throw new CanvaRestError('요청한 Canva 작업과 응답 ID가 다릅니다.', 502, 'invalid_response', false, expectedId);
  return { raw: raw!, header };
}
function importJob(value: unknown, submitted: boolean, expectedId?: string): CanvaRestJob<NotionCanvaImportResult> {
  const {raw,header} = jobHeader(value,submitted,expectedId);
  if (header.status !== 'success') return header.status === 'failed' ? {...header,errorCode:'job_failed'} : header;
  const designSchema = z.object({ id:idSchema, urls:z.object({edit_url:canvaLink.optional(),view_url:canvaLink.optional()}).optional(),url:canvaLink.optional(),page_count:z.number().int().min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES).optional() });
  const result = parse(z.object({designs:z.array(designSchema).min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES)}),raw.result,false,submitted,header.id);
  return {...header,result:{designs:result.designs.map(d=>({designId:d.id,editUrl:d.urls?.edit_url??d.url??null,viewUrl:d.urls?.view_url??null,pageCount:d.page_count??null}))}};
}
function exportJob(value: unknown, submitted: boolean, expectedId?: string): CanvaRestJob<NotionCanvaExportResult> {
  const {raw,header} = jobHeader(value,submitted,expectedId);
  if (header.status !== 'success') return header.status === 'failed' ? {...header,errorCode:'job_failed'} : header;
  return {...header,result:{urls:parse(z.array(exportLink).min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES),raw.urls,false,submitted,header.id)}};
}

function assertPptx(bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_EXPORT_BYTES || bytes.subarray(0,2).toString() !== 'PK') invalid('Canva로 보낼 PPTX 파일의 형식과 80MB 한도를 확인해 주세요.');
  let total = 0, count = 0, slides = 0, unsafe = false;
  try {
    const files = unzipSync(bytes, {filter:file=>{
      total += file.originalSize; count++;
      if (/^ppt\/slides\/slide\d+\.xml$/.test(file.name)) slides++;
      if (total>MAX_EXPORT_BYTES || count>2000 || /(^|\/)\.\.(\/|$)/.test(file.name)) {unsafe=true;return false;}
      return ['[Content_Types].xml','ppt/presentation.xml'].includes(file.name) && file.originalSize < 1024*1024;
    }});
    const presentation = files['ppt/presentation.xml'] ? Buffer.from(files['ppt/presentation.xml']).toString('utf8') : '';
    if (unsafe || !files['[Content_Types].xml'] || slides<1 || slides>NOTION_CANVA_MAX_OUTPUT_PAGES || !new RegExp(`<p:sldSz\\b[^>]*cx="${1080*EMU}"[^>]*cy="${1350*EMU}"`).test(presentation)) invalid('PPTX가 1080×1350 크기의 1~11장 문서인지 확인해 주세요.');
  } catch (error) { if(error instanceof CanvaRestError)throw error; invalid('PPTX 파일 구조를 읽을 수 없습니다. 원고에서 다시 만들어 주세요.'); }
}
export async function submitNotionCanvaImport(db: DB, input: {title:string;bytes:Buffer}, options: CanvaRestOptions = {}) {
  parse(copy.trim().min(1).max(255),input.title,true); assertPptx(input.bytes);
  return importJob(await request(db,'/imports',options,input),true);
}
export async function getNotionCanvaImportJob(db: DB, jobId: string, options: CanvaRestOptions = {}) {
  return importJob(await request(db,`/imports/${validId(jobId)}`,options),false,jobId);
}
/** Request one extra page to reject designs over eleven pages, without any eight-page gate. */
export async function getNotionCanvaPages(db: DB, designId: string, options: CanvaRestOptions = {}): Promise<NotionCanvaPage[]> {
  const page = z.object({page_number:z.number().int().min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES+1),dimensions:z.object({width:z.number().finite().positive(),height:z.number().finite().positive()})});
  const result = parse(z.object({items:z.array(page).min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES)}),await request(db,`/designs/${validId(designId)}/pages?offset=1&limit=${NOTION_CANVA_MAX_OUTPUT_PAGES+1}`,options));
  if(result.items.some((p,i)=>p.page_number!==i+1||p.dimensions.width!==1080||p.dimensions.height!==1350)) throw new CanvaRestError('Canva 디자인의 페이지 순서 또는 1080×1350 크기를 확인해 주세요.',422,'invalid_response');
  return result.items.map(p=>({pageNumber:p.page_number,width:p.dimensions.width,height:p.dimensions.height}));
}
export async function submitNotionCanvaExport(db: DB, input: {designId:string;pageCount:number;format?:'png'|'pdf'|'pptx'}, options: CanvaRestOptions = {}) {
  const parsed = parse(z.object({designId:idSchema,pageCount:z.number().int().min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES),format:z.enum(['png','pdf','pptx']).default('png')}).strict(),input,true);
  const actual = await getNotionCanvaPages(db,parsed.designId,options);
  if(actual.length!==parsed.pageCount) invalid('Canva의 현재 페이지 수가 저장한 원고와 다릅니다. 디자인을 다시 확인해 주세요.');
  const format = {type:parsed.format,pages:actual.map(p=>p.pageNumber),...(parsed.format==='png'?{width:1080,height:1350,as_single_image:false}:{})};
  return exportJob(await request(db,'/exports',options,{json:{design_id:parsed.designId,format}}),true);
}
export async function getNotionCanvaExportJob(db: DB, jobId: string, options: CanvaRestOptions = {}) {
  return exportJob(await request(db,`/exports/${validId(jobId)}`,options),false,jobId);
}
export async function downloadNotionCanvaExport(value: string, options: NotionCanvaDownloadOptions = {}): Promise<Buffer> {
  const url = new URL(parse(exportLink,value,true));
  if(options.signal?.aborted)throw new CanvaRestError('Canva 파일 다운로드를 취소했습니다.',undefined,'cancelled');
  try {
    const response = await (options.fetcher??safeFetch)(url.href,{maxBytes:MAX_EXPORT_BYTES,timeoutMs:30_000,maxRedirects:3,allowedHosts:[url.hostname],accept:'image/png,application/zip,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation'});
    if(options.signal?.aborted)throw new CanvaRestError('Canva 파일 다운로드를 취소했습니다.',undefined,'cancelled');
    if(!Buffer.isBuffer(response.body)||response.body.length===0||response.body.length>MAX_EXPORT_BYTES||!exportLink.safeParse(response.finalUrl).success||new URL(response.finalUrl).hostname!==url.hostname)invalid('Canva 출력 파일의 주소와 크기를 확인할 수 없습니다.');
    return response.body;
  } catch(error) {
    if(error instanceof CanvaRestError)throw error;
    throw new CanvaRestError('Canva 출력 파일을 받지 못했습니다. 저장된 내보내기 작업으로 다시 확인해 주세요.',502,'provider_unavailable');
  }
}
export async function decodeNotionCanvaPngExport(downloads:Array<{name:string;bytes:Buffer;pageNumber?:number}>, pageCount:number):Promise<Buffer[]> {
  parse(z.number().int().min(1).max(NOTION_CANVA_MAX_OUTPUT_PAGES),pageCount,true);
  if(!downloads.length||downloads.length>NOTION_CANVA_MAX_OUTPUT_PAGES||downloads.some(d=>!Buffer.isBuffer(d.bytes))||downloads.reduce((n,d)=>n+d.bytes.length,0)>MAX_EXPORT_BYTES)invalid('Canva PNG 출력 파일의 크기를 확인해 주세요.');
  let entries=downloads;
  if(downloads.length===1&&downloads[0].bytes.subarray(0,2).toString()==='PK') {
    let total=0,count=0,unsafe=false;
    try {
      const files=unzipSync(downloads[0].bytes,{filter:file=>{
        if(!file.name.toLowerCase().endsWith('.png'))return false;
        total+=file.originalSize;count++;
        if(file.originalSize>15*1024*1024||total>MAX_EXPORT_BYTES||count>pageCount||/(^|\/)\.\.(\/|$)/.test(file.name)){unsafe=true;return false;}return true;
      }});
      if(unsafe)invalid('Canva PNG 압축 파일이 안전 한도를 초과했습니다.');
      entries=Object.entries(files).map(([name,bytes])=>({name,bytes:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)}));
    } catch(error){if(error instanceof CanvaRestError)throw error;invalid('Canva PNG 압축 파일을 읽을 수 없습니다.');}
  }
  if(entries.length!==pageCount)invalid('Canva 출력 이미지 수가 원고 페이지 수와 다릅니다. 기존 이미지는 유지합니다.');
  const numbered=entries.map(entry=>{
    const base=entry.name.split('/').at(-1)??'';
    const match=/^(?:page[-_ ]*)?0*([1-9]\d?)(?:[-_. ]|$)/i.exec(base)??/[-_ ]0*([1-9]\d?)\.png$/i.exec(base);
    return {...entry,page:entry.pageNumber??(match?Number(match[1]):pageCount===1?1:0)};
  });
  if(numbered.some(e=>!Number.isInteger(e.page)||e.page<1||e.page>pageCount)||new Set(numbered.map(e=>e.page)).size!==pageCount)invalid('Canva PNG 페이지 순서를 확인할 수 없습니다.');
  numbered.sort((a,b)=>a.page-b.page);
  for(const entry of numbered){
    if(entry.bytes.length>15*1024*1024)invalid('Canva PNG 한 장이 저장 한도를 초과했습니다.');
    let meta:Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try{meta=await sharp(entry.bytes,{limitInputPixels:1080*1350,animated:true}).metadata();}catch{invalid('Canva PNG 파일을 읽을 수 없습니다.');}
    if(meta.format!=='png'||meta.width!==1080||meta.height!==1350||(meta.pages??1)!==1)invalid('Canva PNG가 1080×1350의 단일 이미지인지 확인해 주세요.');
  }
  return numbered.map(e=>e.bytes);
}

// Native OOXML primitives: text remains <a:t>, photos are separate <p:pic> elements.
const xml = (value:string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const emu = (value:number) => Math.round(value*EMU);
const color = (value:string) => value.slice(1).toUpperCase();
const namespaces = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const transform = (x:number,y:number,w:number,h:number) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
const rel = (id:string,type:string,target:string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xml(target)}"/>`;
const rels = (content:string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
type Media = {file:string;bytes:Buffer;width:number;height:number;extension:'png'|'jpeg';normalized?:boolean};
function wrap(text:string,size:number,width:number,bold:boolean):string[] {
  const font=loadReadingFont('Noto Sans KR',bold?700:400);
  const lines:string[]=[];
  for(const paragraph of text.replaceAll('\r\n','\n').replaceAll('\r','\n').split('\n')) {
    if(!paragraph){lines.push('');continue;}
    let line='';
    for(const letter of paragraph){
      if(font.measure(line+letter,size)<=width){line+=letter;continue;}
      if(!line)invalid('원고의 글자가 텍스트 폭보다 큽니다.');
      const space=line.lastIndexOf(' ');
      if(space>line.length/2){lines.push(line.slice(0,space));line=line.slice(space+1)+letter;}
      else{lines.push(line);line=letter===' '?'':letter;}
    }
    if(line)lines.push(line);
  }
  return lines;
}
function fit(text:string,width:number,height:number,max:number,min:number,bold:boolean,label:string) {
  for(let size=max;size>=min;size-=2){const lines=wrap(text,size,width,bold);const lineHeight=size*1.3;if(lines.length*lineHeight<=height)return {lines,size,lineHeight};}
  const page=/^page-(\d+)-(title|body)$/.exec(label);
  const location=label==='cover-title'||label==='cover-question'?'표지 제목':label==='cover-caption'?'표지 설명':page?`${page[1]}장 ${page[2]==='title'?'제목':'본문'}`:'입력한';
  invalid(`${location} 원고가 페이지에 너무 깁니다. 문장을 줄이거나 장을 나눠 주세요. 원고를 자르지 않았습니다.`);
}
function box(id:number,name:string,text:string,x:number,y:number,w:number,h:number,max:number,min:number,ink:string,bold=false,accent?:{phrase:string;color:string},align:'l'|'ctr'='l') {
  const fitted=fit(text,w,h,max,min,bold,name);
  const run=(value:string,c:string)=>`<a:r><a:rPr lang="ko-KR" sz="${Math.round(fitted.size*75)}" b="${bold?1:0}" dirty="0"><a:solidFill><a:srgbClr val="${color(c)}"/></a:solidFill><a:latin typeface="Noto Sans KR"/><a:ea typeface="Noto Sans KR"/><a:cs typeface="Noto Sans KR"/></a:rPr><a:t xml:space="preserve">${xml(value)}</a:t></a:r>`;
  const paragraphs=fitted.lines.map(line=>{
    const at=accent?.phrase?line.indexOf(accent.phrase):-1;
    const runs=at>=0?run(line.slice(0,at),ink)+run(accent!.phrase,accent!.color)+run(line.slice(at+accent!.phrase.length),ink):run(line,ink);
    return `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPts val="${Math.round(fitted.lineHeight*75)}"/></a:lnSpc><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${runs}<a:endParaRPr lang="ko-KR" sz="${Math.round(fitted.size*75)}"/></a:p>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
function rectangle(id:number,name:string,x:number,y:number,w:number,h:number,fill:string,gradient=false,pill=false,alpha=100000) {
  const paint=gradient?'<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:gs><a:gs pos="50000"><a:srgbClr val="000000"><a:alpha val="74000"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="000000"><a:alpha val="100000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>':`<a:solidFill><a:srgbClr val="${color(fill)}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="${pill?'roundRect':'rect'}"><a:avLst>${pill?'<a:gd name="adj" fmla="val 50000"/>':''}</a:avLst></a:prstGeom>${paint}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}
function picture(id:number,name:string,relationship:string,media:Media,x:number,y:number,w:number,h:number,mode:'cover'|'contain'='cover') {
  let crop='';
  if(mode==='contain') {const ratio=Math.min(w/media.width,h/media.height);const iw=media.width*ratio,ih=media.height*ratio;x+=(w-iw)/2;y+=(h-ih)/2;w=iw;h=ih;}
  else {const src=media.width/media.height,dst=w/h;if(src>dst){const c=Math.round((1-dst/src)*50000);crop=`<a:srcRect l="${c}" r="${c}"/>`;}else{const c=Math.round((1-src/dst)*50000);crop=`<a:srcRect t="${c}" b="${c}"/>`;}}
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationship}"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
async function readMedia(bytes:Buffer,file:string):Promise<Media> {
  let meta:Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try{meta=await sharp(bytes,{limitInputPixels:40_000_000,animated:true}).metadata();}catch{invalid('사진 파일을 읽을 수 없습니다. 지원하는 사진 형식을 확인해 주세요.');}
  if(!meta.width||!meta.height||(meta.pages??1)!==1||!['png','jpeg','webp','gif','avif','heif'].includes(meta.format??''))invalid('사진은 움직이지 않는 단일 이미지여야 합니다.');
  if(!['png','jpeg'].includes(meta.format!)||(meta.orientation??1)!==1){
    // PPTX cannot reliably embed WebP/HEIF or EXIF-only orientation. The source
    // bytes remain in Studio; only the embedded copy gets a compatible encoding.
    try{const output=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().png().toBuffer({resolveWithObject:true});if(output.data.length>MAX_PHOTO_BYTES)invalid('사진의 PPTX 호환본이 20MB 한도를 초과합니다.');return {file,bytes:output.data,width:output.info.width,height:output.info.height,extension:'png',normalized:true};}
    catch(error){if(error instanceof CanvaRestError)throw error;invalid('사진의 방향·형식을 PPTX 호환본으로 만들 수 없습니다.');}
  }
  return {file,bytes,width:meta.width,height:meta.height,extension:meta.format as 'png'|'jpeg'};
}

/** No remote calls. Every visible manuscript character is a native text run.
 * Keep all 2–10 manuscript pages in order, then append the fixed brand CTA.
 * Overflow is a validation error, never truncation or an unreadably small font.
 */
export async function buildNotionCanvaPptx(value:NotionCanvaDocument, photos:NotionCanvaPhoto[]=[]):Promise<NotionCanvaPptx> {
  const document=parse(documentSchema,value,true);
  if(!Array.isArray(photos)||photos.length>10||new Set(photos.map(p=>p.id)).size!==photos.length||photos.some(p=>!idSchema.safeParse(p.id).success||!Buffer.isBuffer(p.bytes)||!p.bytes.length||p.bytes.length>MAX_PHOTO_BYTES||!['image/png','image/jpeg','image/webp','image/gif','image/avif','image/heif','image/heic'].includes(p.mimeType))||photos.reduce((n,p)=>n+p.bytes.length,0)>MAX_PHOTO_TOTAL_BYTES)invalid('사진은 서로 다른 ID의 단일 이미지 최대 10개, 개별 20MB·전체 60MB 이하여야 합니다.');
  const warnings:string[]=[];
  const media=new Map<string,Media>();
  let embeddedPhotoBytes=0;
  for(const [index,photo] of photos.entries()){
    const item=await readMedia(photo.bytes,`photo-${index+1}`);embeddedPhotoBytes+=item.bytes.length;
    if(embeddedPhotoBytes>MAX_PHOTO_TOTAL_BYTES)invalid('사진의 PPTX 호환본 합계가 60MB를 초과합니다.');
    media.set(photo.id,item);if(item.normalized)warnings.push(`${index+1}번 사진의 형식·방향을 PPTX 호환 PNG로 정리했습니다. Studio 원본은 보존됩니다.`);
  }
  for(const page of document.pages)if(page.imageId&&!media.has(page.imageId))invalid('원고에서 지정한 사진을 찾을 수 없습니다. 사진을 다시 연결해 주세요.');
  const coverPhoto=document.pages[0].imageId?media.get(document.pages[0].imageId):undefined;
  if(document.coverStyle==='C'&&!coverPhoto)invalid('C 표지에는 실제 사진이 필요합니다. 표지 사진을 선택해 주세요.');
  if(document.coverStyle==='A'&&!coverPhoto)warnings.push('표지 사진이 없어 A 표지를 검정 정보형으로 만들었습니다.');
  if(document.coverStyle==='B'&&coverPhoto)warnings.push('B는 질문 타이포 표지이므로 표지 사진은 표시하지 않습니다. 원본 사진은 Studio에 보존됩니다.');
  const logo=await readMedia(await fs.readFile(path.resolve(process.cwd(),'assets/branding/highscoop-magazine-color.png')),'logo-color');
  const darkLogo=await readMedia(await fs.readFile(path.resolve(process.cwd(),'assets/branding/highscoop-magazine-dark.png')),'logo-dark');
  const allMedia=[logo,darkLogo,...media.values()];
  const fileFor=(item:Media)=>`${item.file}.${item.extension}`;
  const files:Record<string,Uint8Array>={};
  const put=(name:string,contents:string)=>{files[name]=strToU8(contents);};
  allMedia.forEach(item=>{files[`ppt/media/${fileFor(item)}`]=item.bytes;});
  const accent=document.categoryColor??NOTION_CANVA_CATEGORY_COLORS[document.category??'']??RED;
  const renderedPages:NotionCanvaDocument['pages']=[...document.pages,{title:NOTION_CANVA_OUTRO.title}];
  for(const [index,page] of renderedPages.entries()) {
    let nextId=2;const shapes:string[]=[];let relationships=rel('rIdLayout','slideLayout','../slideLayouts/slideLayout1.xml');let imageIndex=0;
    const image=(item:Media,x:number,y:number,w:number,h:number,mode:'cover'|'contain'='cover')=>{const rid=`rIdImage${++imageIndex}`;relationships+=rel(rid,'image',`../media/${fileFor(item)}`);shapes.push(picture(nextId++,item.file,rid,item,x,y,w,h,mode));};
    const text=(name:string,content:string,x:number,y:number,w:number,h:number,max:number,min:number,ink=INK,bold=false,emphasis?:string,align:'l'|'ctr'='l')=>{
      if(!content)return;
      const interior=index>0&&index<document.pages.length;
      if(interior&&emphasis){
        const fitted=fit(content,w,h,max,min,bold,name),font=loadReadingFont('Noto Sans KR',bold?700:400);
        for(const [lineIndex,line]of fitted.lines.entries()){
          let at=line.indexOf(emphasis),occurrence=0;
          while(at>=0){
            shapes.push(rectangle(nextId++,`${name}-explicit-marker-${lineIndex}-${occurrence++}`,x+font.measure(line.slice(0,at),fitted.size),y+lineIndex*fitted.lineHeight+fitted.size*.7,font.measure(emphasis,fitted.size),fitted.size*.38,accent,false,false,35000));
            at=line.indexOf(emphasis,at+emphasis.length);
          }
        }
      }
      shapes.push(box(nextId++,name,content,x,y,w,h,max,min,ink,bold,!interior&&emphasis?{phrase:emphasis,color:document.coverStyle==='B'?RED:accent}:undefined,align));
    };
    const rect=(name:string,x:number,y:number,w:number,h:number,fill:string,gradient=false,pill=false)=>shapes.push(rectangle(nextId++,name,x,y,w,h,fill,gradient,pill));
    const body=[page.body,...(page.bullets??[]).map(b=>`• ${b}`)].filter(Boolean).join('\n\n');
    let background='#FFFFFF';
    if(index===document.pages.length){
      background='#FFF8F0';
      text('outro-follow',NOTION_CANVA_OUTRO.follow,96,245,888,104,76,64,INK,true,undefined,'ctr');
      image(logo,108,370,864,292,'contain');
      text('outro-handle',NOTION_CANVA_OUTRO.handle,96,728,888,68,42,36,INK,true,undefined,'ctr');
      text('outro-introduction',NOTION_CANVA_OUTRO.introduction,96,818,888,110,36,30,INK,false,undefined,'ctr');
      rect('outro-red-pill',108,1010,864,78,RED,false,true);
      text('outro-action',NOTION_CANVA_OUTRO.action,132,1027,816,44,28,24,'#FFFFFF',true,undefined,'ctr');
    }else if(index===0) {
      if(document.coverStyle==='A') {
        background='#000000';if(coverPhoto)image(coverPhoto,0,0,1080,1350);rect('bottom-black-fade',0,300,1080,778,'#000000',true);rect('bottom-black-base',0,1078,1080,272,'#000000');
        if(document.category){rect('category-color',96,640,64,6,accent);text('cover-category',document.category,96,662,888,48,28,24,accent,true);}
        text('cover-title',page.title,96,730,888,268,72,48,'#FFFFFF',true,page.emphasis);
        text('cover-caption',body,96,1012,888,55,28,24,'#FFFFFF');image(darkLogo,96,1078,190,64,'contain');
      } else if(document.coverStyle==='B') {
        image(logo,96,207,270,92,'contain');rect('brand-accent',96,423,64,8,RED);
        text('cover-question',page.title,96,490,888,440,88,56,INK,true,page.emphasis);
        text('cover-caption',body,96,963,888,128,34,28,INK);
      } else {
        image(coverPhoto!,0,0,1080,740);rect('caption-background',0,740,1080,610,'#FFFFFF');
        if(document.category)text('cover-category',document.category,96,775,888,48,28,24,accent,true);
        text('cover-title',page.title,96,845,888,195,68,46,INK,true,page.emphasis);
        text('cover-caption',body,96,1046,888,36,26,24,INK);image(logo,96,1091,150,50,'contain');
      }
    } else {
      if(document.category)text('page-category',document.category,96,207,888,44,26,22,INK,true);
      rect('section-accent',96,273,64,7,accent);
      text(`page-${index+1}-title`,page.title,96,315,888,200,58,40,INK,true,page.emphasis);
      const photo=page.imageId?media.get(page.imageId):undefined;
      if(photo){image(photo,96,550,390,500);text(`page-${index+1}-body`,body,530,550,454,504,36,28,INK,false,page.emphasis);}
      else text(`page-${index+1}-body`,body,96,550,888,504,40,28,INK,false,page.emphasis);
      image(logo,96,1078,190,64,'contain');
      text('page-number',`${String(index+1).padStart(2,'0')} / ${String(renderedPages.length).padStart(2,'0')}`,840,1101,144,40,22,20,'#555555');
    }
    put(`ppt/slides/slide${index+1}.xml`,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${namespaces}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color(background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    put(`ppt/slides/_rels/slide${index+1}.xml.rels`,rels(relationships));
  }
  const count=renderedPages.length;
  const slides=Array.from({length:count},(_,i)=>`<p:sldId id="${256+i}" r:id="rIdSlide${i+1}"/>`).join('');
  put('ppt/presentation.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>${slides}</p:sldIdLst><p:sldSz cx="${1080*EMU}" cy="${1350*EMU}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  put('ppt/_rels/presentation.xml.rels',rels(rel('rIdMaster','slideMaster','slideMasters/slideMaster1.xml')+Array.from({length:count},(_,i)=>rel(`rIdSlide${i+1}`,'slide',`slides/slide${i+1}.xml`)).join('')));
  put('ppt/slideMasters/slideMaster1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${namespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels(rel('rIdLayout','slideLayout','../slideLayouts/slideLayout1.xml')+rel('rIdTheme','theme','../theme/theme1.xml')));
  put('ppt/slideLayouts/slideLayout1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels(rel('rIdMaster','slideMaster','../slideMasters/slideMaster1.xml')));
  const solid=(c:string)=>`<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`;
  put('ppt/theme/theme1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="HighScoop"><a:themeElements><a:clrScheme name="HighScoop"><a:dk1><a:srgbClr val="171717"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="555555"/></a:dk2><a:lt2><a:srgbClr val="F7F5F2"/></a:lt2>${['FF493B','72A7FF','BAA0FF','5ED7B5','FFD166','171717'].map((c,i)=>`<a:accent${i+1}><a:srgbClr val="${c}"/></a:accent${i+1}>`).join('')}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Noto Sans KR"><a:majorFont><a:latin typeface="Noto Sans KR"/><a:ea typeface="Noto Sans KR"/><a:cs typeface="Noto Sans KR"/></a:majorFont><a:minorFont><a:latin typeface="Noto Sans KR"/><a:ea typeface="Noto Sans KR"/><a:cs typeface="Noto Sans KR"/></a:minorFont></a:fontScheme><a:fmtScheme name="HighScoop"><a:fillStyleLst>${solid('FFFFFF').repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[9525,19050,28575].map(w=>`<a:ln w="${w}">${solid('171717')}<a:prstDash val="solid"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid('FFFFFF').repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  put('_rels/.rels',rels(rel('rId1','officeDocument','ppt/presentation.xml')));
  const overrides=[['/ppt/presentation.xml','presentationml.presentation.main'],['/ppt/slideMasters/slideMaster1.xml','presentationml.slideMaster'],['/ppt/slideLayouts/slideLayout1.xml','presentationml.slideLayout'],['/ppt/theme/theme1.xml','theme'],...Array.from({length:count},(_,i)=>[`/ppt/slides/slide${i+1}.xml`,'presentationml.slide'])].map(([file,type])=>`<Override PartName="${file}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('');
  put('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides}</Types>`);
  const bytes=Buffer.from(zipSync(files,{level:6}));assertPptx(bytes);
  return {bytes,pageCount:count,sourcePageCount:document.pages.length,width:1080,height:1350,warnings};
}
