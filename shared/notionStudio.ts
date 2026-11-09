import { z } from 'zod';
import type { CardCopy } from './cardCopy';

export const notionCoverStyles = ['A','B','C'] as const;
export const notionImportRequestSchema=z.object({pageId:z.string().min(1).max(200),channelId:z.number().int().positive(),expectedSourceHash:z.string().min(1).max(128),coverStyle:z.enum(notionCoverStyles).default('A')}).strict();
export const notionPullRequestSchema=z.object({version:z.number().int().positive(),itemVersion:z.number().int().positive(),expectedSourceHash:z.string().min(1).max(128),resolveConflict:z.boolean().default(false)}).strict();
export const notionPushRequestSchema=z.object({version:z.number().int().positive(),itemVersion:z.number().int().positive(),expectedSourceHash:z.string().min(1).max(128),resolveConflict:z.boolean().default(false)}).strict();
export type NotionStudioPhoto={id:number;name:string;mimeType:string;width:number;height:number;url:string};
export type NotionCanvaState={phase:'idle'|'importing'|'ready'|'exporting'|'complete'|'failed'|'result_unknown';jobId?:string;exportJobId?:string;designId?:string;editUrl?:string|null;viewUrl?:string|null;sourceVersion?:number;sourceRevisionId?:number;pageCount?:number;outputAssetId?:number;error?:string|null;updatedAt?:string};
export type NotionStudioLink={id:number;version:number;pageId:string;notionUrl:string;channelId:number;itemId:number;studioCardId:number|null;title:string;sourceHash:string;lastEditedAt:string;lastSyncedAt:string;autoSync:boolean;lastCheckedAt:string|null;coverStyle:typeof notionCoverStyles[number];status:'synced'|'studio_changed';studioUrl:string;canva:NotionCanvaState;photoCount:number};
export type NotionStudioDetail={link:NotionStudioLink;itemVersion:number;copy:CardCopy;photos:NotionStudioPhoto[];source:{title:string;coverTitle:string;pages:Array<{index:number;title:string;body:string}>;sourceReferences?:Array<{title:string;url:string}>;teaser?:{title:string;body:string}};notion?:{sourceHash:string;lastEditedAt:string;coverTitle?:string;changed:boolean;pages:Array<{index:number;title:string;body:string}>};warnings:string[]};
export type NotionStudioList={links:NotionStudioLink[]};
