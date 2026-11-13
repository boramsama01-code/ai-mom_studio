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
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import type { DB } from '../db';
import { accessToken, CANVA_API } from './canva';
import { CanvaRestError, type CanvaRestOptions, type CanvaRestJob } from './canvaRest';
import { loadReadingFont } from './readingCardFonts';
import { safeFetch } from './safeFetch';
import { NOTION_SOURCE_REFERENCES_MAX, NOTION_SOURCE_REFERENCES_PER_PAGE, NOTION_MANUSCRIPT_MAX_PAGES, NOTION_MAX_OUTPUT_PAGES, notionSourceReferencePageCount } from '../../shared/notionSync';
import { admissionsCalendarElements, institutionScheduleElements, institutionScheduleGeometry, NotionAdmissionsLayoutError, parseAdmissionsCalendar, parseInstitutionSchedule } from './notionAdmissionsLayout';
import { admissionsGuideElements, parseAdmissionsGuide } from './notionAdmissionsGuide';
import { logoCalendarElements, parseLogoCalendar } from './notionLogoCalendar';
import { admissionsTimelineElements, parseAdmissionsTimeline } from './notionAdmissionsTimeline';
import { loadEducationOfficeLogos, type EducationOfficeLogo } from './educationOfficeLogos';
import {notionInteriorTemplates} from '../../shared/notionPageTemplates';
import {interiorTemplateElements} from './notionInteriorTemplates';
import {HIGH_SCOOP_TEMPLATE_KITS,highScoopTemplateForCategory} from '../../shared/highscoopTemplates';
import type {EditorialBrand} from '../../shared/editorialTemplates';

export const NOTION_CANVA_GEOMETRY = { width: 1080, height: 1350, safe: { x: 96, y: 207, width: 888, height: 936 } } as const;
/** Covers retain the original safe area; every interior uses this larger frame. */
export const NOTION_CANVA_INTERIOR_GEOMETRY = {x:64,y:64,width:952,height:1222} as const;
export const NOTION_CANVA_TEXT_SYNC = 'manual-confirmation-required' as const;
export const NOTION_CANVA_MAX_OUTPUT_PAGES = NOTION_MAX_OUTPUT_PAGES;
export const NOTION_CANVA_SOURCE_TITLE = '원문 공고 확인';
export const NOTION_CANVA_SOURCE_GUIDE = 'QR을 스캔해 공식 공고를 확인하세요.';
export const NOTION_CANVA_TEASER_LABEL = '다음 편';
export const NOTION_CANVA_TEASER_COMMENT = '궁금한 점은 댓글로 남겨 주세요';
/** Added after every manuscript page; the source's final page is never replaced. */
export const NOTION_CANVA_OUTRO = {
  title: 'HighScoop 채널 소개',
  follow: '아이의 관심에서 다음 도전까지',
  handle: '@highscoop.official',
  introduction: '아이의 호기심을 놓치지 않고,\n함께 도전할 기회를 찾아봅니다.',
  action: '다음 이야기도 궁금하다면, 하이스쿱을 찾아주세요.',
  altText: 'HighScoop. 아이의 관심에서 다음 도전까지. @highscoop.official 검색창. 아이의 호기심을 놓치지 않고 함께 도전할 기회를 찾아봅니다.'
} as const;
export const NOTION_CANVA_CATEGORY_COLORS: Record<string, string> = Object.fromEntries(HIGH_SCOOP_TEMPLATE_KITS.map(kit=>[kit.category,kit.color]));
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_EXPORT_BYTES = 80 * 1024 * 1024;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_TOTAL_BYTES = 60 * 1024 * 1024;
const EMU = 9525;
const RED = '#FF493B', INK = '#171717';
const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const copy = z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
const pageSchema = z.object({ interiorTemplate:z.enum(notionInteriorTemplates).optional(),interiorSubtitle:copy.max(500).optional(),title: copy.trim().min(1).max(300), body: copy.max(2400).optional(), bullets: z.array(copy.max(500)).max(12).optional(), imageId: z.string().min(1).max(200).optional(), overlayImageId:z.string().min(1).max(200).optional(), emphasis: copy.max(100).optional(), footnote: copy.max(1000).optional(), sourceLabel: copy.max(300).optional(), infographic: z.enum(['application_steps','admissions_calendar','institution_schedule','admissions_logo_calendar','admissions_guide','admissions_timeline']).optional() }).strict();
const sourceUrl = z.string().trim().min(1).max(2048).refine(value=>{
  try{
    const url=new URL(value),host=url.hostname.toLowerCase();
    return !/\s|[\u0000-\u001f\u007f]/.test(value)&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port
      &&/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)&&!/^\d+(?:\.\d+){3}$/.test(host)
      &&!/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host);
  }catch{return false;}
});
const sourceReferenceSchema=z.object({title:copy.trim().min(1).max(160),url:sourceUrl}).strict();
const sourceCardSchema=z.object({title:copy.trim().min(1).max(300),body:copy.max(1200),footnote:copy.max(1000).optional()}).strict();
const teaserSchema=z.object({title:copy.trim().min(1).max(200),body:copy.trim().min(1).max(500)}).strict();
const documentSchema = z.object({ title: copy.trim().min(1).max(255), coverStyle: z.enum(['A','B','C']), category: copy.trim().max(24).optional(), categoryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), pages: z.array(pageSchema).min(2).max(NOTION_MANUSCRIPT_MAX_PAGES), sourceReferences:z.array(sourceReferenceSchema).max(NOTION_SOURCE_REFERENCES_MAX).refine(refs=>new Set(refs.map(ref=>ref.url)).size===refs.length).optional(),sourceCard:sourceCardSchema.optional(),teaser:teaserSchema.optional() }).strict();
export type NotionCanvaDocument = z.infer<typeof documentSchema>;
export type NotionCanvaSourceReference = z.infer<typeof sourceReferenceSchema>;
export type NotionCanvaPhoto = { id: string; name?: string; bytes: Buffer; mimeType: string };
export type NotionCanvaPptx = { bytes: Buffer; pageCount: number; sourcePageCount: number; width: 1080; height: 1350; warnings: string[]; previewSvg?: string };
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
    if (unsafe || !files['[Content_Types].xml'] || slides<1 || slides>NOTION_CANVA_MAX_OUTPUT_PAGES || !new RegExp(`<p:sldSz\\b[^>]*cx="${1080*EMU}"[^>]*cy="${1350*EMU}"`).test(presentation)) invalid(`PPTX가 1080×1350 크기의 1~${NOTION_CANVA_MAX_OUTPUT_PAGES}장 문서인지 확인해 주세요.`);
  } catch (error) { if(error instanceof CanvaRestError)throw error; invalid('PPTX 파일 구조를 읽을 수 없습니다. 원고에서 다시 만들어 주세요.'); }
}
export async function submitNotionCanvaImport(db: DB, input: {title:string;bytes:Buffer}, options: CanvaRestOptions = {}) {
  parse(copy.trim().min(1).max(255),input.title,true); assertPptx(input.bytes);
  return importJob(await request(db,'/imports',options,input),true);
}
export async function getNotionCanvaImportJob(db: DB, jobId: string, options: CanvaRestOptions = {}) {
  return importJob(await request(db,`/imports/${validId(jobId)}`,options),false,jobId);
}
/** Request one extra page to reject designs over thirteen pages, without any eight-page gate. */
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
// Canva imports this exact family alias; layout and SVG keep the bundled KR face.
const CANVA_PPTX_FONT = 'Noto Sans Kr';
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
function fit(text:string,width:number,height:number,max:number,min:number,bold:boolean,label:string,leading=1.3) {
  for(let size=max;size>=min;size-=2){const lines=wrap(text,size,width,bold);const lineHeight=size*leading;if(lines.length*lineHeight<=height)return {lines,size,lineHeight};}
  const page=/^page-(\d+)-(title|body|footer)$/.exec(label);
  const location=label==='cover-title'||label==='cover-question'?'표지 제목':label==='cover-caption'?'표지 설명':label==='cover-footer'?'표지 각주·출처':/^source-\d+-title$/.test(label)||label==='sources-heading'?'원문 제목':label==='sources-body'?'원문 확인 설명':label==='sources-footer'?'원문 확인 각주':label==='teaser-title'?'다음 편 제목':label==='teaser-body'?'다음 편 설명':page?`${page[1]}장 ${page[2]==='title'?'제목':page[2]==='footer'?'각주·출처':'본문'}`:'입력한';
  const schedule=/^schedule-cell-(\d+)-(\d+)-text$/.exec(label);
  invalid(`${schedule?`기관별 일정표 ${Number(schedule[1])===0?'머리글':`${schedule[1]}행`} ${Number(schedule[2])+1}열`:location} 원고가 페이지에 너무 깁니다. 문장을 줄이거나 장을 나눠 주세요. 원고를 자르지 않았습니다.`);
}
function box(id:number,name:string,text:string,x:number,y:number,w:number,h:number,max:number,min:number,ink:string,bold=false,accent?:{phrase:string;color:string},align:'l'|'ctr'='l',leading=1.3,layout?:ReturnType<typeof fit>) {
  const fitted=layout??fit(text,w,h,max,min,bold,name,leading);
  const run=(value:string,c:string)=>`<a:r><a:rPr lang="ko-KR" sz="${Math.round(fitted.size*75)}" b="${bold?1:0}" dirty="0"><a:solidFill><a:srgbClr val="${color(c)}"/></a:solidFill><a:latin typeface="${CANVA_PPTX_FONT}"/><a:ea typeface="${CANVA_PPTX_FONT}"/><a:cs typeface="${CANVA_PPTX_FONT}"/></a:rPr><a:t xml:space="preserve">${xml(value)}</a:t></a:r>`;
  const paragraphs=fitted.lines.map(line=>{
    const at=accent?.phrase?line.indexOf(accent.phrase):-1;
    const runs=at>=0?run(line.slice(0,at),ink)+run(accent!.phrase,accent!.color)+run(line.slice(at+accent!.phrase.length),ink):run(line,ink);
    return `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPts val="${Math.round(fitted.lineHeight*75)}"/></a:lnSpc><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${runs}<a:endParaRPr lang="ko-KR" sz="${Math.round(fitted.size*75)}"/></a:p>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
function cornerRadius(w:number,h:number,pill:boolean,radius?:number){return Math.min(Math.min(w,h)/2,Math.max(0,radius??(pill?Math.min(w,h)/2:0)));}
// One full-height fade avoids a visible antialiased join when Canva imports
// adjacent gradient/solid rectangles. Keep the original y300..1078 curve,
// then continue with opaque black through the bottom edge of the cover.
const COVER_FADE_STOPS=[{position:0,alpha:0},{position:37048,alpha:74000},{position:74095,alpha:100000},{position:100000,alpha:100000}] as const;
function rectangle(id:number,name:string,x:number,y:number,w:number,h:number,fill:string,gradient=false,pill=false,alpha=100000,radius?:number) {
  const paint=gradient?`<a:gradFill rotWithShape="1"><a:gsLst>${COVER_FADE_STOPS.map(stop=>`<a:gs pos="${stop.position}"><a:srgbClr val="000000"><a:alpha val="${stop.alpha}"/></a:srgbClr></a:gs>`).join('')}</a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>`:`<a:solidFill><a:srgbClr val="${color(fill)}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  const rounded=cornerRadius(w,h,pill,radius),adjustment=Math.round(rounded/Math.min(w,h)*100000);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="${rounded?'roundRect':'rect'}"><a:avLst>${rounded?`<a:gd name="adj" fmla="val ${adjustment}"/>`:''}</a:avLst></a:prstGeom>${paint}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}
function outlinedRectangle(id:number,name:string,x:number,y:number,w:number,h:number,fill:string,stroke:string,radius=Math.min(w,h)*.12) {
  const adjustment=Math.round(cornerRadius(w,h,false,radius)/Math.min(w,h)*100000);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adjustment}"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="${color(fill)}"/></a:solidFill><a:ln w="${emu(1.5)}"><a:solidFill><a:srgbClr val="${color(stroke)}"/></a:solidFill></a:ln></p:spPr></p:sp>`;
}
function stepArrow(id:number,name:string,x:number,y:number,w:number,h:number) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="chevron"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="888888"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
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
 * Keep all validated manuscript pages, optional references and teaser, then the brand CTA.
 * Overflow is a validation error, never truncation or an unreadably small font.
 */
export type NativeEditorialOptions={previewPage?:number;previewOnly?:boolean;allowMissingPhotos?:boolean;includeOutro?:boolean;brand?:EditorialBrand;soft?:string;pageAlignments?:Array<'left'|'center'>};
export async function buildNotionCanvaPptx(value:NotionCanvaDocument, photos:NotionCanvaPhoto[]=[], options:NativeEditorialOptions={}):Promise<NotionCanvaPptx> {
  const document=parse(documentSchema,value,true);
  const includeOutro=options.includeOutro!==false;
  if(options.previewOnly&&options.previewPage===undefined)invalid('미리볼 카드 번호를 확인해 주세요.');
  const references=document.sourceReferences??[],referencePageCount=notionSourceReferencePageCount(references);
  if(document.pages.length+referencePageCount+(document.teaser?1:0)+(includeOutro?1:0)>NOTION_CANVA_MAX_OUTPUT_PAGES)invalid(`원고·기관별 원문 QR·예고·채널 소개를 합쳐 ${NOTION_CANVA_MAX_OUTPUT_PAGES}장 이내로 나눠 주세요. 원문 주소를 누락하지 않았습니다.`);
  if(!Array.isArray(photos)||photos.length>12||new Set(photos.map(p=>p.id)).size!==photos.length||photos.some(p=>!idSchema.safeParse(p.id).success||!Buffer.isBuffer(p.bytes)||!p.bytes.length||p.bytes.length>MAX_PHOTO_BYTES||!['image/png','image/jpeg','image/webp','image/gif','image/avif','image/heif','image/heic'].includes(p.mimeType))||photos.reduce((n,p)=>n+p.bytes.length,0)>MAX_PHOTO_TOTAL_BYTES)invalid('사진은 서로 다른 ID의 단일 이미지 최대 12개, 개별 20MB·전체 60MB 이하여야 합니다.');
  const warnings:string[]=[];
  // Missing-photo placeholders belong to an interactive SVG preview only.
  // A production PPTX import keeps the same strict actual-photo requirement.
  const allowMissingPhotos=options.previewOnly===true&&options.allowMissingPhotos===true;
  const inspecting=(index:number)=>!options.previewOnly||options.previewPage===index;
  const media=new Map<string,Media>();
  let embeddedPhotoBytes=0;
  for(const [index,photo] of photos.entries()){
    const item=await readMedia(photo.bytes,`photo-${index+1}`);embeddedPhotoBytes+=item.bytes.length;
    if(embeddedPhotoBytes>MAX_PHOTO_TOTAL_BYTES)invalid('사진의 PPTX 호환본 합계가 60MB를 초과합니다.');
    media.set(photo.id,item);if(item.normalized)warnings.push(`${index+1}번 사진의 형식·방향을 PPTX 호환 PNG로 정리했습니다. Studio 원본은 보존됩니다.`);
  }
  for(const [index,page]of document.pages.entries())if(inspecting(index)){
    if(page.imageId&&!media.has(page.imageId))invalid('원고에서 지정한 사진을 찾을 수 없습니다. 사진을 다시 연결해 주세요.');
    if(page.overlayImageId){
      const overlay=media.get(page.overlayImageId),original=page.imageId?media.get(page.imageId):undefined;
      if(!overlay||!original)invalid('표시 PNG와 원본 캡처를 이 페이지에서 함께 선택해 주세요.');
      if(!['image_text','document_excerpt'].includes(page.interiorTemplate??''))invalid('표시 PNG는 사진 + 글 또는 문서 캡처 내지에서 사용해 주세요.');
      const supplied=photos.find(photo=>photo.id===page.overlayImageId);
      if(supplied?.mimeType!=='image/png'||(await sharp(supplied.bytes).metadata()).format!=='png'||overlay.extension!=='png'||(await sharp(overlay.bytes).stats()).isOpaque)invalid('표시 레이어는 배경이 투명한 PNG여야 합니다. 원본 이미지는 그대로 보존됩니다.');
      if(Math.abs((overlay.width/overlay.height)/(original.width/original.height)-1)>.005)invalid('표시 PNG는 원본 캡처와 같은 가로세로 비율로 저장해 주세요.');
    }
  }
  for(const [index,page]of document.pages.entries()){
    if(index===0&&page.interiorTemplate)invalid('내지 템플릿은 표지 다음 페이지에서 선택해 주세요.');
    if(!inspecting(index))continue;
    if(page.interiorTemplate){
      if(!allowMissingPhotos&&['image_text','document_excerpt'].includes(page.interiorTemplate)&&!page.imageId)invalid(`${index+1}장 ${page.interiorTemplate==='document_excerpt'?'문서 캡처':'사진 + 글'}에 사용할 이미지를 선택해 주세요.`);
      if(!['image_text','document_excerpt','dialogue'].includes(page.interiorTemplate)&&page.imageId)invalid(`${index+1}장 선택한 내지에는 사진을 함께 넣을 수 없습니다. 사진 + 글·문서 캡처·메신저 대화를 선택해 주세요.`);
    }
  }
  for(const [index,page]of document.pages.entries())if(inspecting(index)&&page.infographic&&!page.interiorTemplate){
    const label=page.infographic==='application_steps'?'접수 단계 도식':page.infographic==='admissions_calendar'||page.infographic==='admissions_logo_calendar'?'모집 달력':page.infographic==='admissions_timeline'?'모집 기간표':page.infographic==='admissions_guide'?'모집 안내':'기관별 일정표';
    if(index===0)invalid(`${label}은 표지가 아닌 내지에만 사용할 수 있습니다.`);
    if(page.imageId)invalid(`${label}과 사진을 같은 장에 함께 배치할 수 없습니다. 사진을 보존하려면 별도 장으로 나눠 주세요.`);
  }
  const coverPhoto=document.pages[0].imageId?media.get(document.pages[0].imageId):undefined;
  if(inspecting(0)&&document.coverStyle==='C'&&!coverPhoto)invalid('C 표지에는 실제 사진이 필요합니다. 표지 사진을 선택해 주세요.');
  if(inspecting(0)&&document.coverStyle==='A'&&!coverPhoto)warnings.push('표지 사진이 없어 A 표지를 검정 정보형으로 만들었습니다.');
  if(inspecting(0)&&document.coverStyle==='B'&&coverPhoto)warnings.push('B는 질문 타이포 표지이므로 표지 사진은 표시하지 않습니다. 원본 사진은 Studio에 보존됩니다.');
  const brand=options.brand;
  const outro=brand?{title:`${brand.name} 채널 소개`,follow:brand.follow,handle:brand.handle??brand.name,introduction:brand.introduction,action:brand.action}:NOTION_CANVA_OUTRO;
  const readBrand=async(file:string|undefined,id:string)=>{
    if(!file)return undefined;
    try{return await readMedia(await fs.readFile(path.resolve(process.cwd(),file)),id);}
    catch(error){if(!brand||brand.id==='highscoop')throw error;return undefined;}
  };
  const logo=await readBrand(brand?brand.logoPath:'assets/branding/highscoop-magazine-color.png','logo-color');
  const darkLogo=brand&&!brand.darkLogoPath?logo?await readMedia(await sharp(logo.bytes).negate({alpha:false}).png().toBuffer(),'logo-dark'):undefined:await readBrand(brand?brand.darkLogoPath:'assets/branding/highscoop-magazine-dark.png','logo-dark');
  let educationLogos:EducationOfficeLogo[]=[];const educationMedia=new Map<string,Media>();
  const logoPages=document.pages.filter((page,index)=>!page.interiorTemplate&&page.infographic==='admissions_logo_calendar'&&(!options.previewOnly||options.previewPage===index));
  if(logoPages.length){
    educationLogos=await loadEducationOfficeLogos();
    const keys=new Set<string>();
    for(const page of logoPages){
      try{for(const event of parseLogoCalendar(page.body??'',page.title,educationLogos).events)keys.add(event.logoKey);}
      catch(error){if(error instanceof NotionAdmissionsLayoutError)invalid(error.message);throw error;}
    }
    for(const key of keys){const asset=educationLogos.find(item=>item.key===key)!;educationMedia.set(key,await readMedia(asset.bytes,`education-${key}`));}
  }
  const allMedia=[logo,darkLogo,...media.values(),...educationMedia.values()].filter((item):item is Media=>!!item);
  const fileFor=(item:Media)=>`${item.file}.${item.extension}`;
  const files:Record<string,Uint8Array>={};
  const put=(name:string,contents:string)=>{if(!options.previewOnly)files[name]=strToU8(contents);};
  if(!options.previewOnly)allMedia.forEach(item=>{files[`ppt/media/${fileFor(item)}`]=item.bytes;});
  const accent=document.categoryColor??NOTION_CANVA_CATEGORY_COLORS[document.category??'']??RED;
  if(document.sourceCard&&!references.length)invalid('원문 확인 문구를 보존하려면 최소 한 개의 공식 원문 주소가 필요합니다.');
  const referencesIndex=references.length?document.pages.length:-1;
  const teaserIndex=document.teaser?document.pages.length+referencePageCount:-1;
  const renderedPages:NotionCanvaDocument['pages']=[...document.pages,...Array.from({length:referencePageCount},()=>({title:NOTION_CANVA_SOURCE_TITLE})),...(document.teaser?[{title:document.teaser.title,body:document.teaser.body}]:[]),...(includeOutro?[{title:outro.title}]:[])];
  const followIndex=includeOutro?renderedPages.length-1:-1;
  if(options.previewPage!==undefined&&(!Number.isInteger(options.previewPage)||options.previewPage<0||options.previewPage>=renderedPages.length))invalid('미리볼 카드 번호를 확인해 주세요.');
  let previewSvg:string|undefined;
  for(const [index,page] of renderedPages.entries()) {
    if(options.previewOnly&&index!==options.previewPage)continue;
    // Fitting a whole deck synchronously can starve health checks on small CPUs.
    // Keep the native output unchanged while admitting pending I/O between pages.
    await yieldToEventLoop();
    // Legacy layouts share one coordinate expansion; timeline artwork is already
    // authored directly in the full interior frame. Cover coordinates never move.
    const expand=index>0&&index!==followIndex&&!page.interiorTemplate&&page.infographic!=='admissions_timeline';
    const coordinates=(x:number,y:number,w:number,h:number)=>expand?{
      x:64+(x-96)*952/888,y:64+(y-207)*1222/936,w:w*952/888,h:h*1222/936,
    }:{x,y,w,h};
    let nextId=2;const shapes:string[]=[];let relationships=rel('rIdLayout','slideLayout','../slideLayouts/slideLayout1.xml');let imageIndex=0;
    const previewShapes:string[]=[],previewing=options.previewPage===index;
    const visual=(name:string,markup:string)=>{if(previewing)previewShapes.push(`<g data-name="${xml(name)}">${markup}</g>`);};
    const image=(item:Media|undefined,x:number,y:number,w:number,h:number,mode:'cover'|'contain'='cover',altText?:string)=>{if(!item){if(brand)text('brand-name',brand.name,x,y,w,h,Math.min(48,h*.72),14,index===0&&document.coverStyle==='A'?'#FFFFFF':INK,true);return;}({x,y,w,h}=coordinates(x,y,w,h));if(!options.previewOnly){const rid=`rIdImage${++imageIndex}`;relationships+=rel(rid,'image',`../media/${fileFor(item)}`);shapes.push(picture(nextId++,altText??item.file,rid,item,x,y,w,h,mode));}if(previewing)visual(item.file,`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden"${altText?` aria-label="${xml(altText)}"`:''}><image width="${w}" height="${h}" preserveAspectRatio="xMidYMid ${mode==='contain'?'meet':'slice'}" href="data:image/${item.extension};base64,${item.bytes.toString('base64')}"/></svg>`);};
    const rawRect=(name:string,x:number,y:number,w:number,h:number,fill:string,gradient=false,pill=false,alpha=100000,radius?:number)=>{
      if(!options.previewOnly)shapes.push(rectangle(nextId++,name,x,y,w,h,fill,gradient,pill,alpha,radius));
      visual(name,`${gradient?`<defs><linearGradient id="bottom-fade" x1="0" y1="0" x2="0" y2="1">${COVER_FADE_STOPS.map(stop=>`<stop offset="${stop.position/100000}" stop-color="#000000" stop-opacity="${stop.alpha/100000}"/>`).join('')}</linearGradient></defs>`:''}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${cornerRadius(w,h,pill,radius)}" fill="${gradient?'url(#bottom-fade)':fill}" fill-opacity="${alpha/100000}"/>`);
    };
    const rect=(name:string,x:number,y:number,w:number,h:number,fill:string,gradient=false,pill=false,alpha=100000,radius?:number)=>{const b=coordinates(x,y,w,h);rawRect(name,b.x,b.y,b.w,b.h,fill,gradient,pill,alpha,radius);};
    const text=(name:string,content:string,x:number,y:number,w:number,h:number,max:number,min:number,ink=INK,bold=false,emphasis?:string,align:'l'|'ctr'='l',leading=1.3,verticalAlign:'top'|'middle'='top')=>{
      if(!content)return;
      ({x,y,w,h}=coordinates(x,y,w,h));
      // Centre the actual fitted line block, not a guessed font-size offset.
      // Both editable OOXML and SVG receive this exact same fitted result.
      const centered=verticalAlign==='middle'?fit(content,w,h,max,min,bold,name,leading):undefined;
      if(centered){const used=centered.lines.length*centered.lineHeight;y+=(h-used)/2;h=used;}
      const interior=index>0&&index<document.pages.length;
      if(interior&&emphasis){
        const fitted=centered??fit(content,w,h,max,min,bold,name,leading),font=loadReadingFont('Noto Sans KR',bold?700:400);
        for(const [lineIndex,line]of fitted.lines.entries()){
          const lineX=x+(align==='ctr'?(w-font.measure(line,fitted.size))/2:0);
          let at=line.indexOf(emphasis),occurrence=0;
          while(at>=0){
            rawRect(`${name}-explicit-marker-${lineIndex}-${occurrence++}`,lineX+font.measure(line.slice(0,at),fitted.size),y+lineIndex*fitted.lineHeight+fitted.size*.7,font.measure(emphasis,fitted.size),fitted.size*.38,accent,false,false,35000);
            at=line.indexOf(emphasis,at+emphasis.length);
          }
        }
      }
      if(!options.previewOnly)shapes.push(box(nextId++,name,content,x,y,w,h,max,min,ink,bold,!interior&&emphasis?{phrase:emphasis,color:document.coverStyle==='B'?RED:accent}:undefined,align,leading,centered));
      if(previewing){
        const fitted=centered??fit(content,w,h,max,min,bold,name,leading),font=loadReadingFont('Noto Sans KR',bold?700:400);
        const lines=fitted.lines.map((line,lineIndex)=>{
          let left=x+(align==='ctr'?(w-font.measure(line,fitted.size))/2:0);
          const at=!interior&&emphasis?line.indexOf(emphasis):-1;
          const parts=at>=0?[{text:line.slice(0,at),ink},{text:emphasis!,ink:document.coverStyle==='B'?RED:accent},{text:line.slice(at+emphasis!.length),ink}]:[{text:line,ink}];
          return parts.map(part=>{const outline=font.path(part.text,left,y+lineIndex*fitted.lineHeight+font.baseline(fitted.size,fitted.lineHeight),fitted.size);left+=font.measure(part.text,fitted.size);return `<path d="${outline}" fill="${part.ink}"/>`;}).join('');
        }).join('');
        visual(name,`<g aria-label="${xml(content)}">${lines}</g>`);
      }
    };
    /** Native vector modules, merged only along each row. Four-module quiet zone,
     * integer placement and >=4px modules survive 1080px export without blur.
     * No URL fetch, redirect, shortener, remote QR service or AI image is involved.
     */
    const qr=(number:number,url:string,x:number,y:number,available:number)=>{
      let code:ReturnType<typeof QRCode.create>;
      try{code=QRCode.create(url,{errorCorrectionLevel:'M'});}catch{invalid('원문 주소의 QR을 만들 수 없습니다. 공식 공고의 직접 주소를 확인해 주세요.');}
      const frame=coordinates(x,y,available,available);
      const quiet=4,modules=code.modules.size,total=modules+quiet*2,unit=Math.floor(Math.min(frame.w,frame.h)/total);
      if(unit<4)invalid('원문 주소가 길어 QR을 충분히 크게 표시할 수 없습니다. 더 짧은 공식 원문 주소를 사용하거나 원문 개수를 줄여 주세요.');
      const extent=total*unit,left=Math.round(frame.x+(frame.w-extent)/2),top=Math.round(frame.y+(frame.h-extent)/2);
      rawRect(`source-qr-${number}-background`,left,top,extent,extent,'#FFFFFF');
      for(let row=0;row<modules;row++){
        let col=0;
        while(col<modules){
          if(!code.modules.data[row*modules+col]){col++;continue;}
          const start=col;while(col<modules&&code.modules.data[row*modules+col])col++;
          rawRect(`source-qr-${number}-r${row}-c${start}`,left+(start+quiet)*unit,top+(row+quiet)*unit,(col-start)*unit,unit,'#000000');
        }
      }
    };
    const body=[page.body,...(page.bullets??[]).map(b=>`• ${b}`)].filter(Boolean).join('\n\n');
    // Approved cover labels are filled rounded badges above the headline,
    // with separate native text so they remain editable after Canva import.
    const categoryBadge=(y:number,style:'A'|'C')=>{
      if(!document.category)return;
      const height=style==='A'?60:50,fontSize=style==='A'?36:30,radius=style==='A'?10:8;
      const width=Math.min(888,Math.max(style==='A'?160:130,Math.ceil(loadReadingFont('Noto Sans KR',700).measure(document.category,fontSize))+52));
      rect('cover-category-badge',96,y,width,height,accent,false,false,100000,radius);
      text('cover-category',document.category,122,y,width-52,height,fontSize,24,'#181818',true,undefined,'ctr',1.2,'middle');
    };
    // Metadata stays distinct from editorial copy. Every supplied note/source is
    // visible native text; an overfull footer fails instead of being discarded.
    const footer=[page.footnote,page.sourceLabel].filter(value=>value?.trim()).join('\n');
    let background='#FFFFFF';
    if(index===followIndex){
      background='#FFF9F2';
      image(logo,110,112,860,290,'contain');
      text('outro-follow',outro.follow,80,474,920,116,44,40,INK,true,undefined,'ctr');
      text('outro-introduction',outro.introduction,80,669,920,140,32,28,INK,false,undefined,'ctr');
      if(!options.previewOnly)shapes.push(outlinedRectangle(nextId++,'outro-search',200,1084,680,76,'#FFFFFF',INK,38));
      visual('outro-search','<rect x="200" y="1084" width="680" height="76" rx="38" fill="#FFFFFF" stroke="#181818" stroke-width="2"/>');
      text('outro-handle',outro.handle,226,1094,628,54,34,30,INK,true,undefined,'ctr',1.2,'middle');
      rect('outro-red-pill',64,1209,952,65,accent,false,true);
      text('outro-action',outro.action,88,1219,904,45,28,24,INK,true,undefined,'ctr',1.2,'middle');
    }else if(referencesIndex>=0&&index>=referencesIndex&&index<referencesIndex+referencePageCount){
      const referenceOffset=(index-referencesIndex)*NOTION_SOURCE_REFERENCES_PER_PAGE;
      const pageReferences=references.slice(referenceOffset,referenceOffset+NOTION_SOURCE_REFERENCES_PER_PAGE);
      const sourceCard=document.sourceCard;
      if(sourceCard){
        const compact=pageReferences.length>2;
        text('sources-heading',sourceCard.title,96,207,888,compact?64:100,48,compact?30:36,RED,true);
        text('sources-body',sourceCard.body,96,compact?285:325,888,compact?75:190,compact?24:28,compact?18:22,INK);
      }else{
        text('sources-heading',NOTION_CANVA_SOURCE_TITLE,96,207,888,64,48,40,RED,true);
        text('sources-guide',NOTION_CANVA_SOURCE_GUIDE,96,280,888,34,24,22,INK);
      }
      for(const [i,reference]of pageReferences.entries()){
        const number=referenceOffset+i+1;
        if(sourceCard&&pageReferences.length<=2){
          const single=pageReferences.length===1,left=single?96:96+i*468;
          text(`source-${number}-title`,reference.title,left,535,single?888:420,64,30,22,INK,true,undefined,'ctr');
          qr(number,reference.url,single?350:left+20,605,380);
        }else if(sourceCard){
          const left=pageReferences.length===3&&i===2?330:96+(i%2)*468,top=365+Math.floor(i/2)*340;
          text(`source-${number}-title`,reference.title,left,top,420,60,24,18,INK,true,undefined,'ctr');
          qr(number,reference.url,left+85,top+68,250);
        }else if(pageReferences.length===1){
          text(`source-${number}-title`,reference.title,96,365,888,120,40,26,INK,true,undefined,'ctr');
          qr(number,reference.url,300,515,480);
        }else if(pageReferences.length===2){
          const left=96+i*468;
          text(`source-${number}-title`,reference.title,left,365,420,150,32,22,INK,true,undefined,'ctr');
          qr(number,reference.url,left+10,535,400);
        }else{
          const left=pageReferences.length===3&&i===2?330:96+(i%2)*468,top=320+Math.floor(i/2)*380;
          text(`source-${number}-title`,reference.title,left,top,420,78,26,20,INK,true,undefined,'ctr');
          qr(number,reference.url,left+64,top+84,292);
        }
      }
      if(sourceCard)text('sources-footer',sourceCard.footnote??'',96,pageReferences.length>2?1040:1005,888,pageReferences.length>2?38:64,20,16,'#555555');
      image(logo,96,1091,150,50,'contain');
      if(referencePageCount>1)text('sources-range',`원문 ${String(referenceOffset+1).padStart(2,'0')}–${String(referenceOffset+pageReferences.length).padStart(2,'0')} / ${references.length}`,330,1101,450,40,20,18,'#555555');
      text('page-number',`${String(index+1).padStart(2,'0')} / ${String(renderedPages.length).padStart(2,'0')}`,840,1101,144,40,22,20,'#555555');
    }else if(index===teaserIndex){
      const teaserFit=fit(document.teaser!.body,888,360,36,24,false,'teaser-body');
      const teaserBodyHeight=Math.max(280,Math.ceil(teaserFit.lines.length*teaserFit.lineHeight));
      const teaserBodyY=950-teaserBodyHeight;
      text('teaser-label',NOTION_CANVA_TEASER_LABEL,96,207,888,56,36,30,RED,true);
      rect('teaser-accent',96,293,64,7,RED);
      text('teaser-title',document.teaser!.title,96,365,888,Math.min(280,teaserBodyY-25-365),72,48,INK,true);
      text('teaser-body',document.teaser!.body,96,teaserBodyY,888,teaserBodyHeight,36,24,INK);
      rect('teaser-comment-pill',108,974,864,78,RED,false,true);
      text('teaser-comment',NOTION_CANVA_TEASER_COMMENT,132,991,816,44,28,24,'#FFFFFF',true,undefined,'ctr');
      image(logo,96,1078,190,64,'contain');
      text('page-number',`${String(index+1).padStart(2,'0')} / ${String(renderedPages.length).padStart(2,'0')}`,840,1101,144,40,22,20,'#555555');
    }else if(index===0) {
      if(document.coverStyle==='A') {
        const captionFit=body?fit(body,888,footer?200:128,28,24,false,'cover-caption'):undefined;
        const captionHeight=Math.max(55,Math.ceil(captionFit?captionFit.lines.length*captionFit.lineHeight:0));
        const captionY=footer?980-captionHeight:captionHeight>55?1072-captionHeight:1012;
        const titleY=footer?650:730;
        const titleHeight=footer||captionHeight>55?Math.min(268,captionY-14-titleY):268;
        background='#000000';if(coverPhoto)image(coverPhoto,0,0,1080,1350);rect('bottom-black-fade',0,300,1080,1050,'#000000',true);
        categoryBadge(footer?560:640,'A');
        text('cover-title',page.title,96,titleY,888,titleHeight,72,48,'#FFFFFF',true,page.emphasis);
        text('cover-caption',body,96,captionY,888,captionHeight,28,24,'#FFFFFF');image(darkLogo,96,1078,190,64,'contain');
        text('cover-footer',footer,96,996,888,76,20,16,'#E5E5E5');
      } else if(document.coverStyle==='B') {
        const captionFit=footer&&body?fit(body,888,200,34,24,false,'cover-caption'):undefined;
        const captionHeight=Math.max(128,Math.ceil(captionFit?captionFit.lines.length*captionFit.lineHeight:0));
        const captionY=1091-captionHeight;
        image(logo,96,207,270,92,'contain');rect('brand-accent',96,423,64,8,RED);
        text('cover-question',page.title,96,490,888,footer?Math.min(440,captionY-14-490):440,88,56,INK,true,page.emphasis);
        text('cover-caption',body,96,captionY,888,captionHeight,34,footer?24:28,INK);
        text('cover-footer',footer,96,1098,888,44,18,16,'#555555');
      } else {
        const captionFit=body?fit(body,888,footer?200:128,26,24,false,'cover-caption'):undefined;
        const extra=Math.max(0,Math.ceil(captionFit?captionFit.lines.length*captionFit.lineHeight:0)-36)+(footer?80:0);
        image(coverPhoto!,0,0,1080,740-extra);rect('caption-background',0,740-extra,1080,610+extra,'#FFFFFF');
        categoryBadge(775-extra,'C');
        text('cover-title',page.title,96,845-extra,888,195,68,46,INK,true,page.emphasis);
        text('cover-caption',body,96,1046-extra,888,36+extra-(footer?80:0),26,24,INK);image(logo,96,1091,150,50,'contain');
        text('cover-footer',footer,96,1014,888,64,20,16,'#555555');
      }
    } else if(page.interiorTemplate){
      let model:ReturnType<typeof interiorTemplateElements>;
      try{model=interiorTemplateElements(page.interiorTemplate,body,accent,(value,size,bold)=>loadReadingFont('Noto Sans KR',bold?700:400).measure(value,size),{hasImage:!!page.imageId,soft:options.soft??highScoopTemplateForCategory(document.category)?.soft});}
      catch(error){if(error instanceof NotionAdmissionsLayoutError)invalid(`${index+1}장 ${error.message}`);throw error;}
      const subtitle=[page.interiorSubtitle,model.intro].filter(Boolean).join(' · ');
      // Reserve the fitted notes before placing artwork. A multi-line source
      // footer must not be squeezed into the one-line template's fixed space.
      const footerFit=footer?fit(footer,952,200,20,16,false,`page-${index+1}-footer`):undefined;
      const footerHeight=Math.max(70,Math.ceil(footerFit?footerFit.lines.length*footerFit.lineHeight:0));
      const contentStart=420,footerY=1286-footerHeight,contentBottom=Math.min(1196,footerY-20),contentHeight=contentBottom-contentStart,contentScale=contentHeight/860;
      image(logo,64,64,214,72,'contain');
      if(document.category)text('page-category',document.category,64,154,470,32,22,20,INK,true);
      text('page-number',`${String(index+1).padStart(2,'0')} / ${String(renderedPages.length).padStart(2,'0')}`,660,64,150,32,20,20,'#555555');
      rect('section-accent',64,196,64,5,accent);
      text(`page-${index+1}-title`,page.title,64,220,952,112,46,40,INK,true,page.emphasis,'l',1.2);
      text('interior-subtitle',subtitle,64,344,952,page.interiorTemplate==='timeline'?36:64,26,20,INK,false,page.emphasis,'l',1.2);
      if(['image_text','document_excerpt','dialogue'].includes(page.interiorTemplate)){
        const actualPhoto=page.imageId?media.get(page.imageId):undefined;
        const fullWidth=page.interiorTemplate==='document_excerpt',imageWidth=fullWidth?952:440,imageHeight=fullWidth&&body.trim()?contentHeight-132:contentHeight;
        if(actualPhoto){
          image(actualPhoto,64,contentStart,imageWidth,imageHeight,'contain');
          const overlay=page.overlayImageId?media.get(page.overlayImageId):undefined;
          if(overlay)image(overlay,64,contentStart,imageWidth,imageHeight,'contain');
        }else if(allowMissingPhotos&&page.interiorTemplate!=='dialogue'){
          rect('interior-photo-pending',64,contentStart,imageWidth,imageHeight,'#EEECE7');
          text('interior-photo-pending-label','사진 추가 대기',88,contentStart+(imageHeight-50)/2,imageWidth-48,50,30,26,'#77736D',false,undefined,'ctr',1.2,'middle');
          warnings.push(`${index+1}장 사진 추가 대기: 실제 사진을 선택한 뒤 Canva에 저장하세요.`);
        }
      }
      for(const [elementIndex,original]of model.elements.entries()){
        if(elementIndex>0&&elementIndex%16===0)await yieldToEventLoop();
        const element=original.y>=336?{...original,y:contentStart+(original.y-336)*contentScale,height:original.height*contentScale}:original;
        if(element.kind==='rect')rect(element.name,element.x,element.y,element.width,element.height,element.fill,false,element.pill,100000,element.name.endsWith('-bubble')?18:undefined);
        else if(element.kind==='text')text(element.name,element.content,element.x,element.y,element.width,element.height,element.max,element.min,element.ink,element.bold,page.emphasis,options.pageAlignments?.[index]==='center'&&/^interior-(?:body|column-)/.test(element.name)?'ctr':element.align,element.leading,element.verticalAlign);
      }
      text(`page-${index+1}-footer`,footer,64,footerY,952,footerHeight,20,16,'#555555');
    } else {
     if(page.infographic==='admissions_calendar'||page.infographic==='institution_schedule'||page.infographic==='admissions_logo_calendar'||page.infographic==='admissions_guide'||page.infographic==='admissions_timeline'){
      const calendar=page.infographic==='admissions_calendar'||page.infographic==='admissions_logo_calendar',guide=page.infographic==='admissions_guide',timeline=page.infographic==='admissions_timeline';
      let elements:ReturnType<typeof admissionsCalendarElements>,intro:string,footerY=1072;
      try{
       if(timeline){const model=parseAdmissionsTimeline(body);intro=model.intro;elements=admissionsTimelineElements(model,(value,size,bold)=>loadReadingFont('Noto Sans KR',bold?700:400).measure(value,size));footerY=1216;}
       else if(page.infographic==='admissions_logo_calendar'){const model=parseLogoCalendar(body,page.title,educationLogos);intro=model.intro;elements=logoCalendarElements(model);}
       else if(page.infographic==='admissions_calendar'){const model=parseAdmissionsCalendar(body,page.title);intro=model.intro;elements=admissionsCalendarElements(model,wrap);}
       else if(guide){const model=parseAdmissionsGuide(body);intro=model.intro;elements=admissionsGuideElements(model,accent);}
       else{const model=parseInstitutionSchedule(body);intro=model.intro;elements=institutionScheduleElements(model);footerY=institutionScheduleGeometry(model).footerY;}
      }catch(error){if(error instanceof NotionAdmissionsLayoutError)invalid(`${index+1}장 ${error.message}`);throw error;}
      if(wrap(page.title,40,952,true).length>(calendar?1:2))invalid(`${index+1}장 ${calendar?'달력 제목은 한 줄':'일정표 제목은 두 줄 이내'}로 줄여 주세요. 제목을 자르지 않았습니다.`);
      if(intro&&wrap(intro,24,952,false).length>1)invalid(`${index+1}장 도식 소제목은 한 줄로 줄이고 날짜 기준·주의사항은 각주에 적어 주세요. 문구를 자르지 않았습니다.`);
      if(document.category)text('page-category',document.category,timeline?64:96,timeline?64:207,470,32,22,20,INK,true);
      text('page-number',`${String(index+1).padStart(2,'0')} / ${String(renderedPages.length).padStart(2,'0')}`,timeline?660:625,timeline?64:207,150,32,20,20,'#555555');
      image(logo,timeline?826:794,timeline?64:207,190,40,'contain');rect('section-accent',timeline?64:96,timeline?104:247,64,5,accent);
      text(`page-${index+1}-title`,page.title,timeline?64:96,timeline?122:266,timeline?952:888,timeline?112:calendar?60:guide?100:120,46,40,INK,true,page.emphasis,'l',1.2);
      text(timeline?'timeline-intro':calendar?'calendar-intro':guide?'guide-intro':'schedule-intro',intro,timeline?64:96,timeline?244:calendar?334:guide?370:400,timeline?952:888,36,26,24,INK,false,page.emphasis,'l',1.2);
      for(const [elementIndex,element] of elements.entries()){
       if(elementIndex>0&&elementIndex%16===0)await yieldToEventLoop();
       if(element.kind==='rect')rect(element.name,element.x,element.y,element.width,element.height,element.fill,false,element.pill);
       else if(element.kind==='image'){const item=educationMedia.get(element.mediaKey);if(!item)invalid('교육청 로고를 불러오지 못했습니다.');image(item,element.x,element.y,element.width,element.height,'contain',element.altText);}
       else text(element.name,element.content,element.x,element.y,element.width,element.height,element.max,element.min,element.ink,element.bold,page.emphasis,element.align,element.leading,element.verticalAlign);
      }
      text(`page-${index+1}-footer`,footer,timeline?64:96,footerY,timeline?952:888,70,20,16,'#555555');
     }else{
      if(document.category)text('page-category',document.category,96,207,888,44,26,22,INK,true);
      rect('section-accent',96,273,64,7,accent);
      text(`page-${index+1}-title`,page.title,96,315,888,page.infographic?135:200,58,40,INK,true,page.emphasis);
      const photo=page.imageId?media.get(page.imageId):undefined;
      if(page.infographic){
        // A semantic sequence only: no ticks, completion state or inferred dates.
        const labels=['학생 접수','교사 추천','학교 제출','평가'];
        for(const [step,label]of labels.entries()){
          const left=96+step*232,highlight=step===1||step===2;
          const b=coordinates(left,485,192,115);
          if(!options.previewOnly)shapes.push(outlinedRectangle(nextId++,`application-step-${step+1}`,b.x,b.y,b.w,b.h,highlight?'#FFF0ED':'#FFFFFF',highlight?RED:'#B8B8B8'));
          visual(`application-step-${step+1}`,`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${highlight?'#FFF0ED':'#FFFFFF'}" stroke="${highlight?RED:'#B8B8B8'}" stroke-width="1.5"/>`);
          text(`application-step-${step+1}-number`,String(step+1).padStart(2,'0'),left+18,499,156,26,20,18,highlight?RED:'#666666',true);
          text(`application-step-${step+1}-label`,label,left+18,538,156,38,28,24,highlight?RED:'#666666',true);
          if(step<3){const arrow=coordinates(left+202,525,20,32);if(!options.previewOnly)shapes.push(stepArrow(nextId++,`application-step-${step+1}-arrow`,arrow.x,arrow.y,arrow.w,arrow.h));visual(`application-step-${step+1}-arrow`,`<svg x="${arrow.x}" y="${arrow.y}" width="${arrow.w}" height="${arrow.h}" viewBox="0 0 20 32"><path d="M0 0l10 16-10 16h10l10-16-10-16Z" fill="#888888"/></svg>`);}
        }
        text('application-step-guide','일반적인 흐름 · 기관별 절차·명칭은 원문 확인',96,613,888,26,18,18,'#666666');
        text(`page-${index+1}-body`,body,96,650,888,315,28,22,INK,false,page.emphasis);
      }else if(photo){image(photo,96,550,390,footer?420:500);text(`page-${index+1}-body`,body,530,550,454,footer?420:504,36,28,INK,false,page.emphasis);}
      else text(`page-${index+1}-body`,body,96,550,888,footer?420:504,40,28,INK,false,page.emphasis);
      text(`page-${index+1}-footer`,footer,96,980,888,78,20,16,'#555555');
      image(logo,96,1078,190,64,'contain');
      text('page-number',`${String(index+1).padStart(2,'0')} / ${String(renderedPages.length).padStart(2,'0')}`,840,1101,144,40,22,20,'#555555');
     }
    }
    if(previewing)previewSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${background}"/>${previewShapes.join('')}</svg>`;
    if(options.previewOnly)continue;
    put(`ppt/slides/slide${index+1}.xml`,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${namespaces}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color(background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    put(`ppt/slides/_rels/slide${index+1}.xml.rels`,rels(relationships));
  }
  const count=renderedPages.length;
  // Interactive preview needs one SVG only: no other slides, OOXML or ZIP.
  if(options.previewOnly)return {bytes:Buffer.alloc(0),pageCount:count,sourcePageCount:document.pages.length,width:1080,height:1350,warnings,previewSvg};
  const slides=Array.from({length:count},(_,i)=>`<p:sldId id="${256+i}" r:id="rIdSlide${i+1}"/>`).join('');
  put('ppt/presentation.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>${slides}</p:sldIdLst><p:sldSz cx="${1080*EMU}" cy="${1350*EMU}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  put('ppt/_rels/presentation.xml.rels',rels(rel('rIdMaster','slideMaster','slideMasters/slideMaster1.xml')+Array.from({length:count},(_,i)=>rel(`rIdSlide${i+1}`,'slide',`slides/slide${i+1}.xml`)).join('')));
  put('ppt/slideMasters/slideMaster1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${namespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels(rel('rIdLayout','slideLayout','../slideLayouts/slideLayout1.xml')+rel('rIdTheme','theme','../theme/theme1.xml')));
  put('ppt/slideLayouts/slideLayout1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels(rel('rIdMaster','slideMaster','../slideMasters/slideMaster1.xml')));
  const solid=(c:string)=>`<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`;
  put('ppt/theme/theme1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="HighScoop"><a:themeElements><a:clrScheme name="HighScoop"><a:dk1><a:srgbClr val="171717"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="555555"/></a:dk2><a:lt2><a:srgbClr val="F7F5F2"/></a:lt2>${['FF493B','72A7FF','BAA0FF','5ED7B5','FFD166','171717'].map((c,i)=>`<a:accent${i+1}><a:srgbClr val="${c}"/></a:accent${i+1}>`).join('')}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="${CANVA_PPTX_FONT}"><a:majorFont><a:latin typeface="${CANVA_PPTX_FONT}"/><a:ea typeface="${CANVA_PPTX_FONT}"/><a:cs typeface="${CANVA_PPTX_FONT}"/></a:majorFont><a:minorFont><a:latin typeface="${CANVA_PPTX_FONT}"/><a:ea typeface="${CANVA_PPTX_FONT}"/><a:cs typeface="${CANVA_PPTX_FONT}"/></a:minorFont></a:fontScheme><a:fmtScheme name="HighScoop"><a:fillStyleLst>${solid('FFFFFF').repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[9525,19050,28575].map(w=>`<a:ln w="${w}">${solid('171717')}<a:prstDash val="solid"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid('FFFFFF').repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  put('_rels/.rels',rels(rel('rId1','officeDocument','ppt/presentation.xml')));
  const overrides=[['/ppt/presentation.xml','presentationml.presentation.main'],['/ppt/slideMasters/slideMaster1.xml','presentationml.slideMaster'],['/ppt/slideLayouts/slideLayout1.xml','presentationml.slideLayout'],['/ppt/theme/theme1.xml','theme'],...Array.from({length:count},(_,i)=>[`/ppt/slides/slide${i+1}.xml`,'presentationml.slide'])].map(([file,type])=>`<Override PartName="${file}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('');
  put('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides}</Types>`);
  await yieldToEventLoop();
  const bytes=Buffer.from(zipSync(files,{level:6}));assertPptx(bytes);
  return {bytes,pageCount:count,sourcePageCount:document.pages.length,width:1080,height:1350,warnings,...(previewSvg?{previewSvg}:{})};
}
