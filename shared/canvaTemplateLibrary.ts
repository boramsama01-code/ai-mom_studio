import { z } from 'zod';
import { CANVA_READING_TEXT_FIELDS, canvaReadingTextFields, type CanvaDataset, type CanvaTextOptions } from './canvaEditorial';
import type { CardCopyV2 } from './familyDialogue';
import { familyDisplayDescriptors } from './familyDisplay';

export const CANVA_LIBRARY_DEFAULT_FOLDER_ID = 'FAHZ9dTp-H8';
export const CANVA_LIBRARY_SYNC_INTERVAL_SECONDS = 120;
export const CANVA_LIBRARY_MAPPING_VERSION = 'canva-folder-reading8/v1';
export const CANVA_LIBRARY_MAX_PREVIEW_PAGES = 20;
export const CANVA_LIBRARY_PREVIEW_MAX_WIDTH = 540;
export const CANVA_LIBRARY_PREVIEW_MAX_HEIGHT = 720;
export const CANVA_LIBRARY_PREVIEW_MAX_PIXELS = CANVA_LIBRARY_PREVIEW_MAX_WIDTH * CANVA_LIBRARY_PREVIEW_MAX_HEIGHT;
const CANVA_PREVIEW_MIN_EXPORT_AXIS = 40;

/** A single requested axis preserves Canva's own page ratio. Pick a size that
 * fits every page, including a design with different page dimensions. The
 * original dimensions remain in the catalog and native-production snapshot. */
export function canvaLibraryPreviewGeometry<T extends {width:number|null;height:number|null}>(pages:T[]):{format:{width:number;height?:never}|{height:number;width?:never};pages:Array<T&{width:number;height:number}>}|null {
  if(!pages.length||pages.length>CANVA_LIBRARY_MAX_PREVIEW_PAGES||pages.some(page=>!page.width||!page.height||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0))return null;
  const width=Math.floor(Math.min(CANVA_LIBRARY_PREVIEW_MAX_WIDTH,...pages.map(page=>Math.min(page.width!,CANVA_LIBRARY_PREVIEW_MAX_HEIGHT*page.width!/page.height!))));
  const height=Math.floor(Math.min(CANVA_LIBRARY_PREVIEW_MAX_HEIGHT,...pages.map(page=>Math.min(page.height!,CANVA_LIBRARY_PREVIEW_MAX_WIDTH*page.height!/page.width!))));
  const byWidth=width>=CANVA_PREVIEW_MIN_EXPORT_AXIS?pages.map(page=>({...page,width,height:Math.max(1,Math.round(page.height!*width/page.width!))})):null;
  const byHeight=height>=CANVA_PREVIEW_MIN_EXPORT_AXIS?pages.map(page=>({...page,width:Math.max(1,Math.round(page.width!*height/page.height!)),height})):null;
  if(!byWidth&&!byHeight)return null;
  const area=(sizes:typeof byWidth)=>sizes?.reduce((sum,page)=>sum+page.width*page.height,0)??0;
  const useHeight=!!byHeight&&(!byWidth||area(byHeight)>area(byWidth)||area(byHeight)===area(byWidth)&&width<CANVA_LIBRARY_PREVIEW_MAX_WIDTH&&height===CANVA_LIBRARY_PREVIEW_MAX_HEIGHT);
  const result=useHeight?{format:{height},pages:byHeight!}:{format:{width},pages:byWidth!};
  return result.pages.some(page=>page.width>CANVA_LIBRARY_PREVIEW_MAX_WIDTH||page.height>CANVA_LIBRARY_PREVIEW_MAX_HEIGHT)?null:result;
}

const nullableText = z.string().nullable();
export const canvaLibraryPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(500),
  width: z.number().positive().nullable(),
  height: z.number().positive().nullable(),
  previewUrl: nullableText,
});
export const canvaLibraryItemSchema = z.object({
  id: z.string(), key: z.string(), designId: z.string(), title: z.string(),
  sourceType: z.enum(['design', 'brand_template']),
  pageCount: z.number().int().nonnegative().nullable(),
  updatedAt: z.number().int().nonnegative().nullable(), syncedAt: nullableText,
  editUrl: nullableText, thumbnailUrl: nullableText,
  pages: z.array(canvaLibraryPageSchema),
  status: z.enum(['ready', 'needs_fields', 'unsupported_pages', 'unavailable', 'missing']),
  reason: nullableText, canCreate: z.boolean(),
  previewStatus: z.enum(['pending', 'ready', 'stale', 'failed', 'unavailable']),
});
export const canvaTemplateLibraryStateSchema = z.object({
  configured: z.boolean(), connected: z.boolean(), autofill: z.boolean(),
  folderId: z.string(), folderName: nullableText, folderUrl: z.string(),
  enabled: z.boolean(), syncIntervalSeconds: z.literal(CANVA_LIBRARY_SYNC_INTERVAL_SECONDS),
  lastSyncedAt: nullableText,
  syncStatus: z.enum(['not_configured', 'not_connected', 'needs_reconnect', 'syncing', 'ready', 'disabled', 'error']),
  errorCode: nullableText, message: nullableText,
  items: z.array(canvaLibraryItemSchema),
});
export type CanvaLibraryPage = z.infer<typeof canvaLibraryPageSchema>;
export type CanvaLibraryItem = z.infer<typeof canvaLibraryItemSchema>;
export type CanvaTemplateLibraryState = z.infer<typeof canvaTemplateLibraryStateSchema>;

/** A folder-design selection is independent of the local authoring layout. */
export const canvaFolderSnapshotSchema = z.object({
  designId: z.string().regex(/^D[A-Za-z0-9_-]{3,199}$/),
  sourceUpdatedAt: z.string().regex(/^\d+$/),
  datasetHash: z.string().regex(/^[a-f0-9]{64}$/),
  pageIds: z.array(z.string().min(1).max(200)).length(8),
  title: z.string().max(1000),
  imagePolicy: z.literal('preserve_canva'),
}).strict();
export type CanvaFolderSnapshot = z.infer<typeof canvaFolderSnapshotSchema>;

/** Never infer which text box is a title or silently keep old article copy. */
export function canvaFolderDatasetErrors(dataset: CanvaDataset): string[] {
  const expected = new Set<string>(CANVA_READING_TEXT_FIELDS);
  const errors: string[] = [];
  for (const name of expected) if (dataset[name]?.type !== 'text') errors.push(`${name}: 텍스트 필드 필요`);
  for (const [name, field] of Object.entries(dataset)) {
    if (field.type === 'text' && !expected.has(name)) errors.push(`${name}: 지원하지 않는 텍스트 필드`);
    if (field.type !== 'text' && field.type !== 'image') errors.push(`${name}: 지원하지 않는 필드 유형`);
  }
  return errors;
}

/** Native pictures and their existing attribution stay together. Only explicit credit edits replace it. */
export function canvaFolderTextFields(copy:CardCopyV2,options:CanvaTextOptions={}){
  const fields=canvaReadingTextFields(copy,{context:options.context});
  for(const page of copy.pages){
    const field=`P${String(page.page).padStart(2,'0')}_IMAGE_CREDIT`;
    if(Object.hasOwn(fields,field)&&!Object.hasOwn(page.displayOverrides??{},'imageCredit'))delete fields[field];
  }
  return fields;
}
export function canvaFolderTextErrors(copy:CardCopyV2,dataset:CanvaDataset):string[]{
  const errors=canvaFolderDatasetErrors(dataset),expected=new Set<string>(CANVA_READING_TEXT_FIELDS);
  for(const page of copy.pages)for(const descriptor of familyDisplayDescriptors(page)){
    if(!expected.has(descriptor.canvaField)&&Object.hasOwn(page.displayOverrides??{},descriptor.key)&&page.displayOverrides?.[descriptor.key]!=='')
      errors.push(`${page.page}장 ${descriptor.label}: 선택한 Canva 원본에는 이 표시 필드가 없습니다.`);
  }
  const fields=canvaFolderTextFields(copy);
  if(Object.values(fields).some(field=>typeof field.text!=='string'||field.text.length>10_000))errors.push('원고 텍스트 필드의 길이를 확인해 주세요.');
  return errors;
}

export function parseCanvaFolderId(value: string): string | null {
  const text = value.trim();
  if (/^FA[A-Za-z0-9_-]{3,197}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['canva.com', 'www.canva.com'].includes(url.hostname)) return null;
    const match = /^\/folder\/(FA[A-Za-z0-9_-]{3,197})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch { return null; }
}
