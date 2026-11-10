import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import sharp, {type Metadata} from 'sharp';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import type {DB} from '../db';
import {channels,contentItems,contentRevisions,notionSyncLinks,notionSyncPhotos,studioCards} from '../../shared/schema';
import {type CardCopy} from '../../shared/cardCopy';
import {studioKey} from '../../shared/channelKeys';
import type {NotionDocument} from '../../shared/notionSync';
import {notionDesignEditsSchema,type NotionDesignEdits,type NotionStudioDetail,type NotionStudioLink} from '../../shared/notionStudio';
import {notionDocumentToCopy,notionCopyText,notionCopyToPages,notionSyncChange,notionPlainCardCopy} from '../../shared/notionStudioCopy';
import {emptyPayload} from '../../shared/payloads';
import {env} from '../env';
import {HttpError} from '../routes/util';
import {audit} from '../audit';
import {createRevision} from '../content';
import {fetchNotionDocument,downloadNotionPhoto,updateNotionDocument,patchNotionDocumentProperties,withNotionWriteLease} from './notionClient';
import {validateInteriorTemplateBody} from './notionInteriorTemplates';
import {publicNotionCanvaAutoSave,queuedNotionCanvaAutoSave} from './notionCanvaAutoSave';

type Link=typeof notionSyncLinks.$inferSelect;
type PreparedPhoto={sourceKey:string;name:string;mimeType:string;bytes:Buffer;sha256:string;width:number;height:number};
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const notionCopyHash=(copy:CardCopy)=>hash(notionCopyText(copy));
function snapshot(doc:NotionDocument){return {...doc,photos:doc.photos.map(({key,name})=>({key,name}))} as unknown as Record<string,unknown>;}
function sourceSnapshot(link:Link){return link.sourceSnapshot as unknown as NotionDocument;}
function renderedSource(document:NotionDocument){return {category:document.category,sourceCard:document.sourceCard,sourceReferences:document.sourceReferences,teaser:document.teaser,pages:document.pages.map(page=>({infographic:page.infographic,emphasis:page.emphasis,subtitle:page.cardFields?.subtitle,footnote:page.cardFields?.footnote,sourceLabel:page.cardFields?.sourceLabel}))};}
export function notionDesignEdits(payload:Record<string,unknown>):NotionDesignEdits{return notionDesignEditsSchema.parse(payload.notionDesignEdits??{emphasisByPage:{}});}
export function notionDesignPageKey(page:Pick<NotionDocument['pages'][number],'cardRowId'|'headingBlockId'>,index:number){return page.cardRowId||page.headingBlockId||`page:${index+1}`;}
function readCopy(value:unknown){try{return notionPlainCardCopy(value);}catch{throw new HttpError(409,'이 연결은 일반 카드뉴스 원고용입니다. 원고 형식을 바꾼 경우 새 연결로 가져와 주세요.',{code:'notion_copy_format_changed'});}}
async function state(db:DB,id:number){
 const [link]=await db.select().from(notionSyncLinks).where(eq(notionSyncLinks.id,id));if(!link)throw new HttpError(404,'노션 연결을 찾을 수 없습니다.');
 const [item]=await db.select().from(contentItems).where(eq(contentItems.id,link.contentItemId));
 const [revision]=item?.currentRevisionId?await db.select().from(contentRevisions).where(and(eq(contentRevisions.id,item.currentRevisionId),eq(contentRevisions.contentItemId,item.id))):[];
 const [card]=await db.select({id:studioCards.id,trashedAt:studioCards.trashedAt}).from(studioCards).where(eq(studioCards.sourceItemId,link.contentItemId));
 if(!item||!revision)throw new HttpError(409,'연결된 스튜디오 원고를 찾을 수 없습니다.');
 if(card?.trashedAt)throw new HttpError(409,'휴지통의 콘텐츠입니다. 스튜디오에서 복원한 뒤 동기화하세요.');
 const [channel]=await db.select({slug:channels.slug}).from(channels).where(eq(channels.id,link.channelId));
 return {link,item,revision,card,copy:readCopy(revision.payload.cardCopy),canvaAutoSaveSupported:!!channel&&studioKey(channel.slug)==='highscoop'};
}
function linkDto(s:Awaited<ReturnType<typeof state>>):NotionStudioLink{
 const {link,item,copy,card}=s;
 return {id:link.id,version:link.version,pageId:link.notionPageId,notionUrl:link.notionUrl,channelId:link.channelId,itemId:item.id,studioCardId:card?.id??null,title:item.title,sourceHash:link.sourceHash,lastEditedAt:link.sourceEditedAt,lastSyncedAt:link.lastSyncedAt.toISOString(),autoSync:link.autoSync,lastCheckedAt:link.lastCheckedAt?.toISOString()??null,coverStyle:link.coverStyle as 'A'|'B'|'C',status:notionCopyHash(copy)===link.baseCopyHash?'synced':'studio_changed',studioUrl:`${env.baseUrl}/notion?link=${link.id}`,canva:{...link.canva,currentSource:['ready','complete'].includes(link.canva.phase)&&link.canva.currentSource!==false&&link.canva.sourceRevisionId===s.revision.id&&link.canva.sourceVersion===item.version},canvaAutoSave:publicNotionCanvaAutoSave(s.canvaAutoSaveSupported?link.canvaAutoSave:{enabled:false,phase:'idle'}),canvaAutoSaveSupported:s.canvaAutoSaveSupported,photoCount:link.photoOrder.length};
}
export async function notionStudioDetail(db:DB,id:number,refresh=false):Promise<NotionStudioDetail>{
 let s=await state(db,id);
 // A remote Notion read can take seconds. Reload the CAS baseline afterwards:
 // a concurrent sync/poll must not make a just-returned detail stale already.
 const fresh=refresh?await fetchNotionDocument(s.link.notionPageId):undefined;
 if(refresh)s=await state(db,id);
 const photos=s.link.photoOrder.length?await db.select({id:notionSyncPhotos.id,name:notionSyncPhotos.name,mimeType:notionSyncPhotos.mimeType,width:notionSyncPhotos.width,height:notionSyncPhotos.height}).from(notionSyncPhotos).where(and(eq(notionSyncPhotos.linkId,id),inArray(notionSyncPhotos.id,s.link.photoOrder))):[];
 const doc=sourceSnapshot(s.link),warnings:string[]=[];
 if(!doc.verified)warnings.push('노션의 검증 상태를 확인해 주세요. 가져오기는 게시 승인과 별개입니다.');
 if(s.link.lastError)warnings.push(s.link.lastError);
 const detail:NotionStudioDetail={link:linkDto(s),itemVersion:s.item.version,copy:s.copy,designEdits:notionDesignEdits(s.revision.payload),photos:s.link.photoOrder.flatMap(pid=>{const p=photos.find(p=>p.id===pid);return p?[{...p,url:`/api/notion/links/${id}/photos/${p.id}`}]:[];}),source:{title:doc.title,coverTitle:doc.coverTitle,pages:doc.pages.map((page,i)=>({index:page.index,title:page.title,body:page.body,key:notionDesignPageKey(page,i),...(page.cardFields?{cardFields:page.cardFields}:{}),...(page.emphasis!==undefined?{emphasis:page.emphasis}:{}),...(page.infographic?{infographic:page.infographic}:{})})),...(doc.sourceCard?{sourceCard:doc.sourceCard}:{}),...(doc.sourceReferences?{sourceReferences:doc.sourceReferences}:{}),...(doc.teaser?{teaser:doc.teaser}:{})},warnings};
 if(fresh)detail.notion={sourceHash:fresh.sourceHash,lastEditedAt:fresh.lastEditedAt,coverTitle:fresh.coverTitle,changed:fresh.sourceHash!==s.link.sourceHash,pages:fresh.pages.map(({index,title,body})=>({index,title,body}))};
 return detail;
}
export async function listNotionStudioLinks(db:DB){const rows=await db.select({id:notionSyncLinks.id}).from(notionSyncLinks).orderBy(desc(notionSyncLinks.updatedAt)).limit(200);const links:NotionStudioLink[]=[];for(const row of rows){try{links.push(linkDto(await state(db,row.id)));}catch(e){if(!(e instanceof HttpError)||e.status!==409)throw e;}}return {links};}
export async function notionStudioLinkForItem(db:DB,itemId:number){const [link]=await db.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.contentItemId,itemId));if(!link)throw new HttpError(404,'연결된 노션 원고가 없습니다.');return notionStudioDetail(db,link.id);}
async function preparePhotos(doc:NotionDocument):Promise<PreparedPhoto[]>{
 const prepared:PreparedPhoto[]=[],seen=new Set<string>();let total=0;
 for(const photo of doc.photos){
  const {buffer}=await downloadNotionPhoto(photo.url),sha256=crypto.createHash('sha256').update(buffer).digest('hex');
  if(seen.has(sha256))continue;seen.add(sha256);total+=buffer.length;if(total>100*1024*1024)throw new HttpError(413,'한 원고의 사진 합계는 100MB 이하로 나누어 주세요.');
  let meta:Metadata;try{meta=await sharp(buffer,{limitInputPixels:50_000_000}).metadata();}catch{throw new HttpError(422,`${photo.name}: 읽을 수 있는 JPG·PNG·WebP 이미지로 올려 주세요.`);}
  if(!meta.width||!meta.height||!['jpeg','png','webp','gif','avif','heif'].includes(meta.format??''))throw new HttpError(422,`${photo.name}: 지원하는 사진 형식을 확인해 주세요.`);
  prepared.push({sourceKey:photo.key,name:photo.name.slice(0,200),mimeType:`image/${meta.format==='jpeg'?'jpeg':meta.format}`,bytes:buffer,sha256,width:meta.width,height:meta.height});
 }
 return prepared;
}
async function assertPhotoCapacity(tx:DB,linkId:number,prepared:PreparedPhoto[]){
 if(!prepared.length)return;
 const usage=await tx.select({size:sql<number>`coalesce(sum(octet_length(${notionSyncPhotos.bytes})),0)::bigint`}).from(notionSyncPhotos).where(eq(notionSyncPhotos.linkId,linkId));
 let size=Number(usage[0]?.size??0);
 const existing=await tx.select({sha256:notionSyncPhotos.sha256}).from(notionSyncPhotos).where(and(eq(notionSyncPhotos.linkId,linkId),inArray(notionSyncPhotos.sha256,[...new Set(prepared.map(p=>p.sha256))])));
 const known=new Set(existing.map(p=>p.sha256));
 for(const p of prepared){
  if(known.has(p.sha256))continue;
  known.add(p.sha256);size+=p.bytes.length;
  if(size>200*1024*1024)throw new HttpError(413,'이 원고의 사진 보관 한도를 넘었습니다. 새 콘텐츠로 나누어 주세요.');
 }
}
async function storePhotos(tx:DB,linkId:number,prepared:PreparedPhoto[]){
 const ids:number[]=[];
 const usage=await tx.select({size:sql<number>`coalesce(sum(octet_length(${notionSyncPhotos.bytes})),0)::bigint`}).from(notionSyncPhotos).where(eq(notionSyncPhotos.linkId,linkId));let size=Number(usage[0]?.size??0);
 for(const p of prepared){
  // The same image can occur as both a Files property and a body image. Keep a
  // single immutable binary per link, including files stored by older versions.
  const key=`sha256:${p.sha256}`;
  const [prior]=await tx.select({id:notionSyncPhotos.id}).from(notionSyncPhotos).where(and(eq(notionSyncPhotos.linkId,linkId),eq(notionSyncPhotos.sha256,p.sha256))).orderBy(notionSyncPhotos.id).limit(1);
  if(prior){if(!ids.includes(prior.id))ids.push(prior.id);continue;}
  size+=p.bytes.length;if(size>200*1024*1024)throw new HttpError(413,'이 원고의 사진 보관 한도를 넘었습니다. 새 콘텐츠로 나누어 주세요.');
  const [photo]=await tx.insert(notionSyncPhotos).values({...p,sourceKey:key,linkId}).returning({id:notionSyncPhotos.id});ids.push(photo.id);
 }
 return ids;
}
export async function importNotionStudio(db:DB,input:{pageId:string;channelId:number;expectedSourceHash:string;coverStyle:'A'|'B'|'C'},actor:string){
 const doc=await fetchNotionDocument(input.pageId);if(doc.sourceHash!==input.expectedSourceHash)throw new HttpError(409,'미리보기 이후 노션 원고가 바뀌었습니다. 다시 확인해 주세요.',{code:'notion_source_changed'});
 let copy:CardCopy;try{copy=notionDocumentToCopy(doc);}catch(e){throw new HttpError(422,`원고를 자르지 않고 가져올 수 없습니다. 표지 부제는 120자, 내지 본문은 1000자 이내인지 확인해 주세요. ${(e as Error).message}`,{code:'notion_copy_limits'});}
 const prepared=await preparePhotos(doc);
 const id=await db.transaction(async raw=>{const tx=raw as unknown as DB;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`notion-page:${doc.pageId}`},0))`);
  const [exists]=await tx.select().from(notionSyncLinks).where(eq(notionSyncLinks.notionPageId,doc.pageId));
  if(exists){if(exists.channelId!==input.channelId)throw new HttpError(409,'이 노션 원고는 다른 채널의 작업에 연결되어 있습니다. 기존 연결을 열어 주세요.',{code:'notion_already_linked',linkId:exists.id});return exists.id;}
  const [ch]=await tx.select().from(channels).where(eq(channels.id,input.channelId));if(!ch?.active)throw new HttpError(404,'사용 중인 대상 채널을 선택해 주세요.');
  const [item]=await tx.insert(contentItems).values({channelId:ch.id,kind:ch.contentType,origin:'manual',title:doc.title||copy.cover.title,topicKey:`notion:${doc.pageId}`,relevance:'relevant',evidenceStatus:'needs_review',scheduleStatus:'not_applicable'}).returning();
  const [link]=await tx.insert(notionSyncLinks).values({notionPageId:doc.pageId,notionUrl:doc.url,channelId:ch.id,contentItemId:item.id,sourceHash:doc.sourceHash,baseCopyHash:notionCopyHash(copy),sourceEditedAt:doc.lastEditedAt,sourceSnapshot:snapshot(doc),coverStyle:input.coverStyle}).returning();
  const photoOrder=await storePhotos(tx,link.id,prepared);await tx.update(notionSyncLinks).set({photoOrder}).where(eq(notionSyncLinks.id,link.id));
  const revision=await createRevision(tx,{contentItemId:item.id,author:'operator',payload:{...emptyPayload(ch.contentType,item.title),cardCopy:copy,notion:{pageId:doc.pageId,sourceHash:doc.sourceHash,url:doc.url}},note:'노션 원고 직접 가져오기 · 원문과 사진 보존'});
  await tx.update(notionSyncLinks).set({canvaAutoSave:studioKey(ch.slug)==='highscoop'?queuedNotionCanvaAutoSave(link.canvaAutoSave,revision.id,item.version):{enabled:false,phase:'idle'}}).where(eq(notionSyncLinks.id,link.id));
  await audit(tx,{actor,action:'notion_import',entity:'content_item',entityId:item.id,channelId:ch.id,detail:{pageId:doc.pageId,photos:photoOrder.length}});return link.id;
 });
 // Link writeback is secondary: a missing Notion write capability must never create a second Studio draft on retry.
 try{await patchNotionDocumentProperties(doc.pageId,{studioUrl:`${env.baseUrl}/notion?link=${id}`});}catch{await db.update(notionSyncLinks).set({lastError:'원고는 가져왔지만 노션에 스튜디오 링크를 기록하지 못했습니다. 노션 쓰기 권한을 확인한 뒤 다시 반영하세요.'}).where(eq(notionSyncLinks.id,id));}
 return notionStudioDetail(db,id);
}
type SyncRequest={version:number;itemVersion:number;expectedSourceHash:string;resolveConflict:boolean};
function assertVersion(s:Awaited<ReturnType<typeof state>>,input:SyncRequest,expectedRevisionId?:number){if(s.link.version!==input.version||s.item.version!==input.itemVersion||expectedRevisionId!==undefined&&s.revision.id!==expectedRevisionId)throw new HttpError(409,'스튜디오 원고나 연결 설정이 바뀌었습니다. 최신 저장본을 확인해 주세요.',{code:'studio_source_changed'});}
export async function pullNotionStudio(db:DB,id:number,input:SyncRequest,actor:string){
 const initial=await state(db,id);assertVersion(initial,input);
 const fresh=await fetchNotionDocument(initial.link.notionPageId);if(fresh.sourceHash!==input.expectedSourceHash)throw new HttpError(409,'확인 중 노션 원고가 바뀌었습니다. 변경점을 다시 불러오세요.',{code:'notion_source_changed'});
 const changed=notionSyncChange(fresh.sourceHash!==initial.link.sourceHash,notionCopyHash(initial.copy)!==initial.link.baseCopyHash);
 if(changed==='unchanged')return notionStudioDetail(db,id);
 if(changed==='conflict'&&!input.resolveConflict)throw new HttpError(409,'노션과 스튜디오 원고가 모두 수정되었습니다. 두 내용을 비교한 뒤 노션 원고 적용을 선택하세요.',{code:'notion_sync_conflict'});
 if(changed==='studio_changed'&&!input.resolveConflict)throw new HttpError(409,'스튜디오에서 수정한 내용이 있습니다. 노션 원고로 바꾸려면 비교 후 선택하세요.',{code:'notion_sync_conflict'});
 const copy=notionDocumentToCopy(fresh,initial.copy.templateKey),prepared=await preparePhotos(fresh);
 await db.transaction(async raw=>{const tx=raw as unknown as DB;await tx.select().from(contentItems).where(eq(contentItems.id,initial.item.id)).for('update');await tx.select().from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');const current=await state(tx,id);assertVersion(current,input,initial.revision.id);
  if(current.link.operationToken&&current.link.operationUntil&&current.link.operationUntil>new Date())throw new HttpError(409,'이 원고의 동기화 작업이 진행 중입니다. 잠시 후 다시 확인하세요.');
  const photoOrder=await storePhotos(tx,id,prepared);
  const pageKeys=new Set(fresh.pages.map(notionDesignPageKey)),interiorKeys=new Set(fresh.pages.slice(1).map((page,i)=>notionDesignPageKey(page,i+1))),designEdits=notionDesignEdits(current.revision.payload);
  const survivingEdits:NotionDesignEdits={
   emphasisByPage:Object.fromEntries(Object.entries(designEdits.emphasisByPage).filter(([key])=>pageKeys.has(key))),
   ...(designEdits.templateByPage?{templateByPage:Object.fromEntries(Object.entries(designEdits.templateByPage).filter(([key])=>interiorKeys.has(key)))}:{}),
   ...(designEdits.photoByPage?{photoByPage:Object.fromEntries(Object.entries(designEdits.photoByPage).filter(([key])=>interiorKeys.has(key)))}:{}),
  };
  const revision=await createRevision(tx,{contentItemId:current.item.id,author:'operator',payload:{...current.revision.payload,cardCopy:copy,...(current.revision.payload.notionDesignEdits?{notionDesignEdits:survivingEdits}:{}),notion:{pageId:fresh.pageId,sourceHash:fresh.sourceHash,url:fresh.url}},note:'노션 변경 적용 · 이전 원고는 기록에 보존'});
  await tx.update(contentItems).set({title:fresh.title||copy.cover.title,version:current.item.version+1,updatedAt:new Date()}).where(eq(contentItems.id,current.item.id));
  await tx.update(notionSyncLinks).set({sourceHash:fresh.sourceHash,baseCopyHash:notionCopyHash(copy),sourceEditedAt:fresh.lastEditedAt,sourceSnapshot:snapshot(fresh),photoOrder,lastSyncedAt:new Date(),updatedAt:new Date(),version:current.link.version+1,lastError:null,canva:{...current.link.canva,currentSource:false},canvaAutoSave:current.canvaAutoSaveSupported?queuedNotionCanvaAutoSave(current.link.canvaAutoSave,revision.id,current.item.version+1):{enabled:false,phase:'idle'}}).where(eq(notionSyncLinks.id,id));
  await audit(tx,{actor,action:'notion_pull',entity:'content_item',entityId:current.item.id,channelId:current.link.channelId});
 });return notionStudioDetail(db,id);
}
export async function pushNotionStudio(db:DB,id:number,input:SyncRequest,actor:string){
 const initial=await state(db,id);assertVersion(initial,input);const fresh=await fetchNotionDocument(initial.link.notionPageId);
 if(fresh.sourceHash!==input.expectedSourceHash)throw new HttpError(409,'확인 중 노션 원고가 바뀌었습니다. 다시 비교해 주세요.',{code:'notion_source_changed'});
 if(fresh.sourceHash!==initial.link.sourceHash&&!input.resolveConflict)throw new HttpError(409,'노션 원고에 새 변경이 있습니다. 비교 후 스튜디오 원고 반영을 선택하세요.',{code:'notion_sync_conflict'});
 let pages:ReturnType<typeof notionCopyToPages>;
 try{pages=notionCopyToPages(initial.copy,{baseline:sourceSnapshot(initial.link),current:fresh});}
 catch(e){throw new HttpError(422,(e as Error).message,{code:'notion_copy_limits'});}
 if(pages.length!==fresh.pages.length||!fresh.pages.every((page,i)=>page.index===i+1))throw new HttpError(409,'노션과 스튜디오의 장 구성이 다릅니다. 장 번호와 장 수를 확인해 주세요.',{code:'notion_structure_conflict'});
 const photoSources=(document:NotionDocument)=>document.photos.map(({key,name})=>({key,name}));
 const photoFiles=(document:NotionDocument)=>document.photos.map(({key,name,url})=>{const parsed=new URL(url);return {key,name,identity:`${parsed.hostname}${parsed.pathname}`};});
 const freshPhotos=photoSources(fresh),freshFiles=photoFiles(fresh);
 // Photo files belong to Notion even when Studio copy wins a conflict. Ignore
 // renewed signed URLs, and validate changed files before any remote write.
 // Legacy body images keep their block key when replaced, so a changed prose
 // source must be rechecked; card-table photo keys already include file paths.
 const prosePhotosMayHaveChanged=fresh.editorialSource!=='card_table'&&fresh.sourceHash!==initial.link.sourceHash;
 const prepared=!prosePhotosMayHaveChanged&&isDeepStrictEqual(freshPhotos,photoSources(sourceSnapshot(initial.link)))?undefined:await preparePhotos(fresh);
 const token=crypto.randomUUID();
 await db.transaction(async raw=>{const tx=raw as unknown as DB;await tx.select().from(contentItems).where(eq(contentItems.id,initial.item.id)).for('update');await tx.select().from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');const current=await state(tx,id);assertVersion(current,input,initial.revision.id);
  if(current.link.operationToken&&current.link.operationUntil&&current.link.operationUntil>new Date())throw new HttpError(409,'동기화 작업이 이미 진행 중입니다.');
  // Reject a full archive before changing Notion; storePhotos checks again at commit.
  if(prepared!==undefined)await assertPhotoCapacity(tx,id,prepared);
  await tx.update(notionSyncLinks).set({operationToken:token,operationUntil:new Date(Date.now()+120_000)}).where(eq(notionSyncLinks.id,id));
 });
 try{
  const updated=await withNotionWriteLease(async()=>{
   const until=new Date(Date.now()+120_000);
   const [renewed]=await db.update(notionSyncLinks).set({operationUntil:sql`greatest(${notionSyncLinks.operationUntil},${until.toISOString()}::timestamptz)`}).where(and(eq(notionSyncLinks.id,id),eq(notionSyncLinks.operationToken,token))).returning({id:notionSyncLinks.id});
   return !!renewed;
  },options=>updateNotionDocument({pageId:initial.link.notionPageId,expectedSourceHash:fresh.sourceHash,pages,coverTitle:initial.copy.cover.title,studioUrl:`${env.baseUrl}/notion?link=${id}`,...(initial.link.canva.editUrl?{outputUrl:initial.link.canva.editUrl}:{})},options));
  if(!isDeepStrictEqual(freshFiles,photoFiles(updated)))throw new HttpError(409,'노션에 원고는 반영됐지만 사진이 바뀌었습니다. 최신 노션 사진을 다시 확인해 동기화해 주세요.',{code:'notion_source_changed'});
  await db.transaction(async raw=>{const tx=raw as unknown as DB;const [current]=await tx.select().from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');if(current.operationToken!==token)throw new HttpError(409,'노션에는 반영됐지만 연결 상태가 바뀌었습니다. 양쪽 원고를 다시 확인하세요.');
   const photoOrder=prepared===undefined?current.photoOrder:await storePhotos(tx,id,prepared);
   const visualChanged=!isDeepStrictEqual(photoOrder,current.photoOrder)||!isDeepStrictEqual(renderedSource(updated),renderedSource(sourceSnapshot(current)));
   await tx.update(notionSyncLinks).set({sourceHash:updated.sourceHash,baseCopyHash:notionCopyHash(initial.copy),sourceEditedAt:updated.lastEditedAt,sourceSnapshot:snapshot(updated),photoOrder,lastSyncedAt:new Date(),updatedAt:new Date(),version:current.version+1,operationToken:null,operationUntil:null,lastError:null,...(visualChanged?{canva:{...current.canva,currentSource:false},canvaAutoSave:initial.canvaAutoSaveSupported?queuedNotionCanvaAutoSave(current.canvaAutoSave,initial.revision.id,initial.item.version):{enabled:false,phase:'idle'}}:{})}).where(eq(notionSyncLinks.id,id));
   await audit(tx,{actor,action:'notion_push',entity:'content_item',entityId:initial.item.id,channelId:initial.link.channelId});
  });
 }catch(e){await db.update(notionSyncLinks).set({operationToken:null,operationUntil:null,lastError:(e as Error).message.slice(0,500)}).where(and(eq(notionSyncLinks.id,id),eq(notionSyncLinks.operationToken,token)));throw e;}
 return notionStudioDetail(db,id);
}
export async function setNotionStudioStyle(db:DB,id:number,input:{version:number;coverStyle?:'A'|'B'|'C';autoSync?:boolean;canvaAutoSave?:boolean}){
 await db.transaction(async raw=>{const tx=raw as unknown as DB,initial=await state(tx,id);
  await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,initial.item.id)).for('update');
  await tx.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');
  const current=await state(tx,id);if(current.link.version!==input.version)throw new HttpError(409,'연결 설정이 바뀌었습니다. 새로고침해 주세요.');
  const coverChanged=input.coverStyle!==undefined&&input.coverStyle!==current.link.coverStyle;
  if(input.canvaAutoSave===true&&!current.canvaAutoSaveSupported)throw new HttpError(422,'Canva 자동 저장은 하이스쿱에 연결한 원고에서 사용할 수 있습니다.');
  let automatic=current.canvaAutoSaveSupported?current.link.canvaAutoSave:{enabled:false,phase:'idle' as const};
  if(input.canvaAutoSave===false){
   const accepted=['importing','exporting'].includes(current.link.canva.phase);
   automatic={...automatic,enabled:false,phase:accepted?'processing':'idle',error:null,leaseToken:undefined,leaseUntil:undefined};
  }else if(input.canvaAutoSave===true||coverChanged){
   automatic=queuedNotionCanvaAutoSave(automatic,current.revision.id,current.item.version,{...(input.canvaAutoSave===true?{enable:true}:{})});
   if(['importing','exporting'].includes(current.link.canva.phase)&&current.link.canvaAutoSave.principal)automatic={...automatic,principal:current.link.canvaAutoSave.principal};
   if(current.link.canva.phase==='result_unknown'&&automatic.enabled)automatic={...automatic,phase:'blocked',error:'이미 접수한 Canva 작업의 결과가 미확정입니다. 기존 작업 결과를 먼저 확인해 주세요.'};
  }
  await tx.update(notionSyncLinks).set({...(input.coverStyle?{coverStyle:input.coverStyle}:{}),...(input.autoSync!==undefined?{autoSync:input.autoSync}:{}),canvaAutoSave:automatic,...(coverChanged?{canva:{...current.link.canva,currentSource:false}}:{}),version:current.link.version+1,updatedAt:new Date()}).where(eq(notionSyncLinks.id,id));
 });return notionStudioDetail(db,id);
}
export function validateNotionStudioDraft(s:Awaited<ReturnType<typeof state>>,copy:CardCopy,designEdits:NotionDesignEdits){
 const document=sourceSnapshot(s.link),parsed=notionPlainCardCopy(copy);
 if(parsed.templateKey!==s.copy.templateKey||parsed.pages.length!==s.copy.pages.length||parsed.pages.some((page,i)=>page.id!==s.copy.pages[i].id))throw new HttpError(422,'연결된 카드의 장 수·순서·템플릿은 유지해 주세요.',{code:'notion_structure_conflict'});
 try{notionCopyToPages(parsed,{baseline:document,current:document});}catch(error){throw new HttpError(422,(error as Error).message,{code:'notion_copy_limits'});}
 const keys=new Set(document.pages.map(notionDesignPageKey));
 if(Object.keys(designEdits.emphasisByPage).some(key=>!keys.has(key)))throw new HttpError(422,'강조문구가 현재 원고의 카드와 맞지 않습니다. 최신 저장본을 확인해 주세요.');
 const interiorKeys=new Set(document.pages.slice(1).map((page,i)=>notionDesignPageKey(page,i+1)));
 if([...Object.keys(designEdits.templateByPage??{}),...Object.keys(designEdits.photoByPage??{})].some(key=>!interiorKeys.has(key)))throw new HttpError(422,'내지 템플릿과 사진은 현재 원고의 본문 카드에서 선택해 주세요.');
 if(Object.values(designEdits.photoByPage??{}).some(id=>!s.link.photoOrder.includes(id)))throw new HttpError(422,'선택한 사진이 현재 원고에 없습니다. 페이지의 사진을 다시 선택해 주세요.');
 for(const [index,page]of document.pages.entries()){
  const key=notionDesignPageKey(page,index),template=designEdits.templateByPage?.[key];if(!template)continue;
  if(template==='image_text'&&!(designEdits.photoByPage?.[key]??s.link.photoOrder[index]))throw new HttpError(422,`${index+1}장: 사진 + 글 템플릿에 사용할 사진을 선택해 주세요.`);
  const draft=parsed.pages[index-1],combined=[draft.subtitle,draft.body].filter(Boolean).join('\n\n'),subtitle=page.cardFields?.subtitle??'',prefix=subtitle.trim()?`${subtitle}\n\n`:'';
  try{validateInteriorTemplateBody(template,prefix&&combined.startsWith(prefix)?combined.slice(prefix.length):combined);}catch(error){throw new HttpError(422,`${index+1}장: ${(error as Error).message}`,{code:'notion_template_format'});}
 }
 return parsed;
}
/** Save only reviewed card copy and Studio design choices. Source notes/extras remain untouched. */
export async function saveNotionStudioDraft(db:DB,id:number,input:{version:number;itemVersion:number;copy:CardCopy;designEdits:NotionDesignEdits},actor:string){
 await db.transaction(async raw=>{const tx=raw as unknown as DB,initial=await state(tx,id);
  await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,initial.item.id)).for('update');
  await tx.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');
  const current=await state(tx,id);assertVersion(current,{...input,expectedSourceHash:current.link.sourceHash,resolveConflict:false});
  if(current.link.operationToken&&current.link.operationUntil&&current.link.operationUntil>new Date()||['importing','exporting','result_unknown'].includes(current.link.canva.phase))throw new HttpError(409,'진행 중인 동기화·캔바 작업을 확인한 뒤 저장해 주세요. 입력한 문구는 유지했습니다.');
  const copy=validateNotionStudioDraft(current,input.copy,input.designEdits);
  if(isDeepStrictEqual(copy,current.copy)&&isDeepStrictEqual(input.designEdits,notionDesignEdits(current.revision.payload)))return;
  const payload={...current.revision.payload,cardCopy:copy,notionDesignEdits:input.designEdits};
  const revision=await createRevision(tx,{contentItemId:current.item.id,author:'operator',payload,note:'노션 연결 카드 미리보기 편집 · 원문·각주·QR·예고 보존'});
  await tx.update(contentItems).set({edited:payload,version:current.item.version+1,reviewStatus:current.item.reviewStatus==='reviewed'?'pending':current.item.reviewStatus,updatedAt:new Date()}).where(eq(contentItems.id,current.item.id));
  await tx.update(notionSyncLinks).set({canva:{...current.link.canva,currentSource:false},canvaAutoSave:queuedNotionCanvaAutoSave(current.link.canvaAutoSave,revision.id,current.item.version+1)}).where(eq(notionSyncLinks.id,id));
  await audit(tx,{actor,action:'notion_edit_card_copy',entity:'content_item',entityId:current.item.id,channelId:current.item.channelId,detail:{revisionId:revision.id,pages:copy.pages.length+1}});
 });return notionStudioDetail(db,id);
}
export {state as loadNotionStudioState};
