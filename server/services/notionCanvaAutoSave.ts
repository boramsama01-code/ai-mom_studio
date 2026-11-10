import {randomUUID} from 'node:crypto';
import type {NotionCanvaAutoSaveState,NotionCanvaAutoSaveStored} from '../../shared/notionStudio';

export const NOTION_CANVA_AUTOSAVE_DELAY_MS=15_000;
export function publicNotionCanvaAutoSave(value:NotionCanvaAutoSaveStored):NotionCanvaAutoSaveState{
 const {enabled,phase,requestedAt,notBefore,sourceRevisionId,sourceVersion,error}=value;
 return {enabled,phase,...(requestedAt?{requestedAt}:{}),...(notBefore?{notBefore}:{}),...(sourceRevisionId?{sourceRevisionId}:{}),...(sourceVersion?{sourceVersion}:{}),...(error!==undefined?{error}:{})};
}
/** Called inside the same transaction as the source change. No provider calls. */
export function queuedNotionCanvaAutoSave(value:NotionCanvaAutoSaveStored,revisionId:number,itemVersion:number,options:{now?:number;enable?:boolean}={}):NotionCanvaAutoSaveStored{
 const enabled=options.enable??value.enabled;
 if(!enabled)return {...value,enabled:false,phase:'idle',leaseToken:undefined,leaseUntil:undefined,error:null};
 const now=options.now??Date.now();
 return {enabled:true,phase:'queued',requestId:randomUUID(),requestedAt:new Date(now).toISOString(),notBefore:new Date(now+NOTION_CANVA_AUTOSAVE_DELAY_MS).toISOString(),sourceRevisionId:revisionId,sourceVersion:itemVersion,error:null,...(options.enable===undefined&&value.principal?{principal:value.principal}:{})};
}
