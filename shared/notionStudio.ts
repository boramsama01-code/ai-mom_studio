import { z } from 'zod';
import { type CardCopy } from './cardCopy';
import { NOTION_MANUSCRIPT_MAX_PAGES, type NotionDocumentPage } from './notionSync';
import { notionCardCopySchema } from './notionStudioCopy';
import { notionInteriorTemplates } from './notionPageTemplates';

export const notionCoverStyles = ['A','B','C'] as const;
export const notionImportRequestSchema=z.object({pageId:z.string().min(1).max(200),channelId:z.number().int().positive(),expectedSourceHash:z.string().min(1).max(128),coverStyle:z.enum(notionCoverStyles).default('A')}).strict();
export const notionPullRequestSchema=z.object({version:z.number().int().positive(),itemVersion:z.number().int().positive(),expectedSourceHash:z.string().min(1).max(128),resolveConflict:z.boolean().default(false)}).strict();
export const notionPushRequestSchema=z.object({version:z.number().int().positive(),itemVersion:z.number().int().positive(),expectedSourceHash:z.string().min(1).max(128),resolveConflict:z.boolean().default(false)}).strict();
const pageKey=z.string().min(1).max(200);
const pageMap=<T extends z.ZodType>(value:T)=>z.record(pageKey,value).refine(values=>Object.keys(values).length<=NOTION_MANUSCRIPT_MAX_PAGES);
export const notionDesignEditsSchema=z.object({
  emphasisByPage:pageMap(z.string().max(100)),
  templateByPage:pageMap(z.enum(notionInteriorTemplates)).optional(),
  photoByPage:pageMap(z.number().int().positive()).optional(),
}).strict();
export type NotionDesignEdits=z.infer<typeof notionDesignEditsSchema>;
export const notionEditorRequestSchema=z.object({version:z.number().int().positive(),itemVersion:z.number().int().positive(),copy:notionCardCopySchema,designEdits:notionDesignEditsSchema}).strict();
export type NotionStudioPhoto={id:number;name:string;mimeType:string;width:number;height:number;url:string};
export type NotionCanvaState={phase:'idle'|'importing'|'ready'|'exporting'|'complete'|'failed'|'result_unknown';jobId?:string;exportJobId?:string;designId?:string;editUrl?:string|null;viewUrl?:string|null;sourceVersion?:number;sourceRevisionId?:number;pageCount?:number;outputAssetId?:number;error?:string|null;updatedAt?:string;currentSource?:boolean};
export type NotionCanvaAutoSaveState={enabled:boolean;phase:'idle'|'queued'|'processing'|'failed'|'blocked';requestedAt?:string;notBefore?:string;sourceRevisionId?:number;sourceVersion?:number;error?:string|null};
/** Internal worker ownership is never returned in the public link DTO. */
export type NotionCanvaAutoSaveStored=NotionCanvaAutoSaveState&{requestId?:string;leaseToken?:string;leaseUntil?:string;principal?:string};
export type NotionStudioLink={id:number;version:number;pageId:string;notionUrl:string;channelId:number;itemId:number;studioCardId:number|null;title:string;sourceHash:string;lastEditedAt:string;lastSyncedAt:string;autoSync:boolean;lastCheckedAt:string|null;coverStyle:typeof notionCoverStyles[number];status:'synced'|'studio_changed';studioUrl:string;canva:NotionCanvaState;canvaAutoSave?:NotionCanvaAutoSaveState;canvaAutoSaveSupported?:boolean;photoCount:number};
export type NotionStudioDetail={link:NotionStudioLink;itemVersion:number;copy:CardCopy;designEdits?:NotionDesignEdits;photos:NotionStudioPhoto[];source:{title:string;coverTitle:string;pages:Array<{index:number;title:string;body:string;key?:string;cardFields?:NotionDocumentPage['cardFields'];emphasis?:string;infographic?:NotionDocumentPage['infographic']}>;sourceCard?:{title:string;body:string;footnote?:string};sourceReferences?:Array<{title:string;url:string}>;teaser?:{title:string;body:string}};notion?:{sourceHash:string;lastEditedAt:string;coverTitle?:string;changed:boolean;pages:Array<{index:number;title:string;body:string}>};warnings:string[]};
export type NotionStudioList={links:NotionStudioLink[]};
