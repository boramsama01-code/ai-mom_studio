import crypto from 'node:crypto';
import sharp from 'sharp';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {zipSync} from 'fflate';
import type {DB} from '../db';
import {channels,notionSyncLinks,notionSyncPhotos,mediaAssets,contentItems} from '../../shared/schema';
import type {NotionCanvaState} from '../../shared/notionStudio';
import type {NotionDesignEdits} from '../../shared/notionStudio';
import type {CardCopy} from '../../shared/cardCopy';
import type {NotionDocumentPage} from '../../shared/notionSync';
import {NOTION_SOURCE_REFERENCES_PER_PAGE,notionSourceReferencePageCount} from '../../shared/notionSync';
import {studioKey} from '../../shared/channelKeys';
import {notionPlainCardCopy} from '../../shared/notionStudioCopy';
import {HttpError} from '../routes/util';
import {audit} from '../audit';
import {createRevision} from '../content';
import {loadNotionStudioState,notionStudioDetail,notionDesignEdits,notionDesignPageKey,validateNotionStudioDraft} from './notionStudio';
import {rasterizeReadingSvg} from './readingCardRaster';
import {patchNotionDocumentProperties} from './notionClient';
import {CanvaRestError} from './canvaRest';
import {buildNotionCanvaPptx,submitNotionCanvaImport,getNotionCanvaImportJob,submitNotionCanvaExport,getNotionCanvaExportJob,downloadNotionCanvaExport,decodeNotionCanvaPngExport,NOTION_CANVA_OUTRO,NOTION_CANVA_MAX_OUTPUT_PAGES} from './notionCanva';

type Request={version:number;itemVersion:number};
type State=Awaited<ReturnType<typeof loadNotionStudioState>>;
type CanvaSnapshot=NotionCanvaState&{sourceFingerprint?:string};
const sha=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
function valid(s:State,r:Request){if(s.link.version!==r.version||s.item.version!==r.itemVersion)throw new HttpError(409,'원고나 연결 설정이 바뀌었습니다. 최신 내용을 확인해 주세요.',{code:'studio_source_changed'});}
function plainSource(s:State){try{notionPlainCardCopy(s.copy);}catch{throw new HttpError(409,'노션 연결은 일반 카드뉴스 원고용입니다. 원고 형식을 확인해 주세요.',{code:'notion_copy_format_changed'});}}
function extras(s:State){const source=s.link.sourceSnapshot as {sourceReferences?:Array<{title:string;url:string}>;sourceCard?:{title:string;body:string;footnote?:string};teaser?:{title:string;body:string}};return {sourceReferences:source.sourceReferences,sourceCard:source.sourceCard,teaser:source.teaser};}
function expectedOutputPages(s:State){const extra=extras(s);return s.copy.pages.length+2+notionSourceReferencePageCount(extra.sourceReferences)+(extra.teaser?1:0);}
function fingerprint(s:State){const designEdits=notionDesignEdits(s.revision.payload);return sha(Buffer.from(JSON.stringify({revisionId:s.revision.id,itemVersion:s.item.version,title:s.item.title,copy:s.copy,coverStyle:s.link.coverStyle,photoOrder:s.link.photoOrder,category:s.link.sourceSnapshot.category??null,...extras(s),...(Object.keys(designEdits.emphasisByPage).length?{designEdits}:{})})));}
function currentSource(s:State,v:CanvaSnapshot){return v.sourceVersion===s.item.version&&v.sourceRevisionId===s.revision.id&&(!v.sourceFingerprint||v.sourceFingerprint===fingerprint(s));}
const sourceChanged=()=>new HttpError(409,'Canva 제작 후 원고나 표지 설정이 바뀌었습니다. 최신 원고로 다시 제작한 뒤 결과를 가져오세요.',{code:'canva_source_changed'});
async function begin(db:DB,id:number,r:Request,phase:'importing'|'exporting',expected:State,pageCount:number){
 return db.transaction(async raw=>{const tx=raw as unknown as DB;
  // Use the same item -> link lock order as manuscript editing and completion.
  await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,expected.item.id)).for('update');
  await tx.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');const fresh=await loadNotionStudioState(tx,id);valid(fresh,r);
  if(fingerprint(fresh)!==fingerprint(expected))throw new HttpError(409,'준비하는 동안 원고나 표지 설정이 바뀌었습니다. 다시 확인해 주세요.',{code:'studio_source_changed'});
  if(fresh.link.operationToken&&fresh.link.operationUntil&&fresh.link.operationUntil>new Date())throw new HttpError(409,'동기화 작업이 진행 중입니다. 완료된 뒤 제작해 주세요.');
  if(['importing','exporting','result_unknown'].includes(fresh.link.canva.phase))throw new HttpError(409,'이미 접수한 Canva 작업을 먼저 확인해 주세요. 새 디자인을 중복 생성하지 않았습니다.',{code:'canva_job_pending'});
  if(phase==='exporting'&&!currentSource(fresh,fresh.link.canva))throw sourceChanged();
  const token=crypto.randomUUID(),canva:CanvaSnapshot={...(phase==='exporting'?fresh.link.canva:{...(fresh.link.canva.outputAssetId?{outputAssetId:fresh.link.canva.outputAssetId}:{})}),phase,sourceVersion:fresh.item.version,sourceRevisionId:fresh.revision.id,sourceFingerprint:fingerprint(fresh),pageCount,error:null,updatedAt:new Date().toISOString()};
  // A previous export receipt must not be polled while the next POST is pending.
  if(phase==='exporting')delete canva.exportJobId;
  await tx.update(notionSyncLinks).set({canva,operationToken:token,operationUntil:new Date(Date.now()+120000),version:fresh.link.version+1,updatedAt:new Date()}).where(eq(notionSyncLinks.id,id));return {...fresh,token,canva};
 });
}
async function finishSubmit(db:DB,id:number,token:string,canva:CanvaSnapshot){
 const rows=await db.update(notionSyncLinks).set({canva,operationToken:null,operationUntil:null,version:sql`${notionSyncLinks.version}+1`,updatedAt:new Date()}).where(and(eq(notionSyncLinks.id,id),eq(notionSyncLinks.operationToken,token))).returning({id:notionSyncLinks.id});
 if(!rows.length)throw new HttpError(409,'Canva 요청은 전송됐지만 연결 상태가 바뀌었습니다. 다시 생성하지 말고 기존 결과를 확인하세요.',{code:'canva_result_unknown'});
}
async function failedSubmit(db:DB,id:number,token:string,base:CanvaSnapshot,e:unknown,accepted?:CanvaSnapshot){
 const unknown=e instanceof CanvaRestError&&e.outcomeUnknown;
 const error=e instanceof CanvaRestError?e.message:'Canva 요청 상태를 저장하지 못했습니다. 새로 생성하지 말고 기존 작업 결과를 먼저 확인해 주세요.';
 // Receiving a job then failing to save its receipt is not a provider rejection.
 const receipt=accepted??(unknown&&e instanceof CanvaRestError&&e.jobId?{...base,...(base.phase==='exporting'?{exportJobId:e.jobId}:{jobId:e.jobId}),error:error.slice(0,600)}:undefined);
 const canva:CanvaSnapshot=receipt??{...base,phase:unknown?'result_unknown':'failed',error:error.slice(0,600)};
 await db.update(notionSyncLinks).set({canva,operationToken:null,operationUntil:null,version:sql`${notionSyncLinks.version}+1`,updatedAt:new Date()}).where(and(eq(notionSyncLinks.id,id),eq(notionSyncLinks.operationToken,token)));
}
async function failCurrentJob(db:DB,s:State,v:CanvaSnapshot,message:string){await db.update(notionSyncLinks).set({canva:{...v,phase:'failed',error:message},operationToken:null,operationUntil:null,version:s.link.version+1,updatedAt:new Date()}).where(and(eq(notionSyncLinks.id,s.link.id),eq(notionSyncLinks.version,s.link.version)));}
async function writeReadyLink(db:DB,s:State,v:CanvaSnapshot,editUrl:string){
 const token=crypto.randomUUID();
 const reserved=await db.transaction(async raw=>{const tx=raw as unknown as DB;
  await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,s.item.id)).for('update');
  await tx.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.id,s.link.id)).for('update');
  const fresh=await loadNotionStudioState(tx,s.link.id);
  if(fresh.link.version!==s.link.version+1||fresh.link.canva.designId!==v.designId||!currentSource(fresh,v)||(fresh.link.operationToken&&fresh.link.operationUntil&&fresh.link.operationUntil>new Date()))return false;
  // Serialize secondary Notion link writes with the next Canva submission so
  // a slow old writeback cannot replace the URL of a newer finished design.
  await tx.update(notionSyncLinks).set({operationToken:token,operationUntil:new Date(Date.now()+120000)}).where(eq(notionSyncLinks.id,s.link.id));return true;
 });
 if(!reserved)return;
 try{await patchNotionDocumentProperties(s.link.notionPageId,{outputUrl:editUrl});}
 catch{await db.update(notionSyncLinks).set({lastError:'Canva 디자인은 만들었지만 노션 결과물 링크 기록은 완료하지 못했습니다. 노션 반영으로 다시 연결하세요.'}).where(and(eq(notionSyncLinks.id,s.link.id),eq(notionSyncLinks.operationToken,token)));}
 finally{await db.update(notionSyncLinks).set({operationToken:null,operationUntil:null}).where(and(eq(notionSyncLinks.id,s.link.id),eq(notionSyncLinks.operationToken,token)));}
}
async function prepareNotionStudioDeck(db:DB,before:State,copy:CardCopy=before.copy,designEdits:NotionDesignEdits=notionDesignEdits(before.revision.payload),previewPage?:number){
 const id=before.link.id;
 const [channel]=await db.select().from(channels).where(eq(channels.id,before.link.channelId));
 if(!channel||studioKey(channel.slug)!=='highscoop')throw new HttpError(422,'이번 A·B·C 표지는 하이스쿱용입니다. 하이스쿱 채널의 원고를 선택해 주세요.');
 const all=before.link.photoOrder.length?await db.select().from(notionSyncPhotos).where(and(eq(notionSyncPhotos.linkId,id),inArray(notionSyncPhotos.id,before.link.photoOrder))):[];
 const ordered=before.link.photoOrder.map(pid=>all.find(p=>p.id===pid)).filter((p):p is NonNullable<typeof p>=>!!p).slice(0,copy.pages.length+1);
 const photos=[];
 for(const p of ordered){const bytes=await sharp(p.bytes,{limitInputPixels:50_000_000}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).png().toBuffer();photos.push({id:String(p.id),name:p.name,bytes,mimeType:'image/png'});}
 const source=before.link.sourceSnapshot as {category?:string};
 const sourcePages=(before.link.sourceSnapshot as unknown as {pages?:NotionDocumentPage[]} ).pages??[];
 const pages=[{title:copy.cover.title,body:copy.cover.subtitle},...copy.pages.map(p=>({title:p.title,body:[p.subtitle,p.body].filter(Boolean).join('\n\n')}))].map((page,i)=>{
  const sourcePage=sourcePages[i],key=sourcePage?notionDesignPageKey(sourcePage,i):`page:${i+1}`,emphasis=designEdits.emphasisByPage[key]??sourcePage?.emphasis;
  return {...page,...(ordered[i]?{imageId:String(ordered[i].id)}:{}),...(sourcePage?.cardFields?{footnote:sourcePage.cardFields.footnote,sourceLabel:sourcePage.cardFields.sourceLabel}:{}),...(sourcePage?.infographic?{infographic:sourcePage.infographic}:{}),...(emphasis!==undefined?{emphasis}:{})};
 });
 // The builder validates fit before a durable reservation or external POST is made.
 const deck=await buildNotionCanvaPptx({title:before.item.title,coverStyle:before.link.coverStyle as 'A'|'B'|'C',category:source.category||undefined,pages,...extras(before)},photos,previewPage===undefined?{}:{previewPage,previewOnly:true});
 const unusedPhotos=before.link.photoOrder.length-ordered.length;
 const warnings=[...deck.warnings,...(unusedPhotos>0?[`사진 ${unusedPhotos}개는 원고 페이지 수에 맞춰 이번 디자인에 넣지 않았습니다. Studio 원본은 그대로 보존했습니다.`]:[])];
 return {...deck,warnings};
}
/** The same layout primitives as PPTX, rendered locally without a Canva/AI request. */
export async function previewNotionStudioCard(db:DB,id:number,input:Request&{copy:CardCopy;designEdits:NotionDesignEdits;page:number},cancelled=()=>false){
 const before=await loadNotionStudioState(db,id);valid(before,input);
 const copy=validateNotionStudioDraft(before,input.copy,input.designEdits);
 if(input.page<0||input.page>=expectedOutputPages(before))throw new HttpError(422,'미리볼 카드 번호를 확인해 주세요.');
 return rasterizeReadingSvg(async()=>{
  if(cancelled())throw new HttpError(499,'미리보기 요청이 취소되었습니다.');
  const deck=await prepareNotionStudioDeck(db,before,copy,input.designEdits,input.page);
  if(!deck.previewSvg)throw new HttpError(502,'카드 미리보기를 만들지 못했습니다. 원고는 유지했습니다.');
  return deck.previewSvg;
 });
}
export async function createNotionStudioCanva(db:DB,id:number,r:Request,actor:string){
 const before=await loadNotionStudioState(db,id);valid(before,r);plainSource(before);
 // The builder validates fit before a durable reservation or external POST is made.
 const deck=await prepareNotionStudioDeck(db,before),warnings=deck.warnings;
 const s=await begin(db,id,r,'importing',before,deck.pageCount);let accepted:CanvaSnapshot|undefined;
 try{const job=await submitNotionCanvaImport(db,{title:before.item.title,bytes:deck.bytes});accepted={...s.canva,jobId:job.id,phase:job.status==='failed'?'failed':'importing',error:job.status==='failed'?'Canva 디자인 가져오기를 완료하지 못했습니다.':warnings.length?warnings.join(' '):null};
  await finishSubmit(db,id,s.token,accepted);await audit(db,{actor,action:'notion_canva_import',entity:'content_item',entityId:s.item.id,channelId:s.link.channelId,detail:{jobId:job.id,pages:deck.pageCount}});
 }catch(e){await failedSubmit(db,id,s.token,s.canva,e,accepted);throw e;}
 return pollNotionStudioCanva(db,id);
}
export async function exportNotionStudioCanva(db:DB,id:number,r:Request,actor:string){
 const before=await loadNotionStudioState(db,id);valid(before,r);plainSource(before);
 if(!before.link.canva.designId)throw new HttpError(409,'Canva 디자인을 먼저 만들어 주세요.');
 if(!currentSource(before,before.link.canva))throw sourceChanged();
 const pageCount=before.link.canva.pageCount;if(!Number.isInteger(pageCount)||!pageCount||pageCount>NOTION_CANVA_MAX_OUTPUT_PAGES||pageCount!==expectedOutputPages(before))throw new HttpError(409,'저장된 Canva 페이지 수를 확인할 수 없습니다. 새 디자인을 먼저 만들어 주세요.');
 const s=await begin(db,id,r,'exporting',before,pageCount);let accepted:CanvaSnapshot|undefined;
 try{const job=await submitNotionCanvaExport(db,{designId:before.link.canva.designId,pageCount,format:'png'});accepted={...s.canva,exportJobId:job.id,phase:job.status==='failed'?'failed':'exporting',error:job.status==='failed'?'Canva 내보내기를 완료하지 못했습니다.':null};await finishSubmit(db,id,s.token,accepted);
  await audit(db,{actor,action:'notion_canva_export',entity:'content_item',entityId:s.item.id,channelId:s.link.channelId,detail:{jobId:job.id}});
 }catch(e){await failedSubmit(db,id,s.token,s.canva,e,accepted);throw e;}
 return pollNotionStudioCanva(db,id);
}
export async function pollNotionStudioCanva(db:DB,id:number){
 const s=await loadNotionStudioState(db,id),v=s.link.canva as CanvaSnapshot;
 const awaitingReceipt=(v.phase==='importing'&&!v.jobId)||(v.phase==='exporting'&&!v.exportJobId);
 if(awaitingReceipt){
  if(!s.link.operationUntil||s.link.operationUntil<new Date())await db.update(notionSyncLinks).set({canva:{...v,phase:'result_unknown',error:'Canva 접수 결과를 확인하지 못했습니다. 기존 작업 결과를 먼저 확인해 주세요.'},operationToken:null,operationUntil:null,version:s.link.version+1,updatedAt:new Date()}).where(and(eq(notionSyncLinks.id,id),eq(notionSyncLinks.version,s.link.version)));
  return notionStudioDetail(db,id);
 }
 if(s.link.operationToken&&s.link.operationUntil&&s.link.operationUntil>new Date())return notionStudioDetail(db,id);
 if(v.phase==='importing'&&v.jobId){
  const job=await getNotionCanvaImportJob(db,v.jobId);if(job.status==='in_progress')return notionStudioDetail(db,id);
  const designs=job.status==='success'?job.result?.designs:undefined;
  const candidate=designs?.length===1?designs[0]:undefined;
  const design=candidate&&(candidate.pageCount===null||candidate.pageCount===v.pageCount)?candidate:undefined;
  const canva:CanvaSnapshot=design?{...v,phase:'ready',designId:design.designId,editUrl:design.editUrl,viewUrl:design.viewUrl,updatedAt:new Date().toISOString()}:{...v,phase:job.status==='failed'?'failed':'result_unknown',error:job.status==='failed'?'Canva 디자인 가져오기를 완료하지 못했습니다.':'Canva 디자인이 생성됐지만 결과나 페이지 수가 원고와 다릅니다. 새로 생성하지 말고 Canva 목록에서 기존 결과를 확인해 주세요.'};
  const saved=await db.update(notionSyncLinks).set({canva,version:s.link.version+1,updatedAt:new Date()}).where(and(eq(notionSyncLinks.id,id),eq(notionSyncLinks.version,s.link.version))).returning({id:notionSyncLinks.id});
  if(saved.length&&design?.editUrl&&currentSource(s,v)){
   const attached=await db.update(contentItems).set({canvaDesign:{designId:design.designId,editUrl:design.editUrl,viewUrl:design.viewUrl,revisionId:s.revision.id,createdAt:new Date().toISOString()}}).where(and(eq(contentItems.id,s.item.id),eq(contentItems.version,s.item.version),eq(contentItems.currentRevisionId,s.revision.id))).returning({id:contentItems.id});
   if(attached.length)await writeReadyLink(db,s,{...v,designId:design.designId},design.editUrl);
  }
 }
 if(v.phase==='exporting'&&v.exportJobId){
  if(!currentSource(s,v)){await failCurrentJob(db,s,v,sourceChanged().message);throw sourceChanged();}
  const job=await getNotionCanvaExportJob(db,v.exportJobId);if(job.status==='in_progress')return notionStudioDetail(db,id);
  if(job.status==='failed'){await failCurrentJob(db,s,v,'Canva 내보내기를 완료하지 못했습니다.');return notionStudioDetail(db,id);}
  if(!job.result?.urls.length){await failCurrentJob(db,s,v,'Canva 출력 주소를 확인할 수 없습니다.');throw new HttpError(502,'Canva 출력 주소를 확인할 수 없습니다.');}
  const downloads=[];for(const [i,url]of job.result.urls.entries())downloads.push({name:`page-${i+1}.png`,pageNumber:i+1,bytes:await downloadNotionCanvaExport(url)});
  let images:Buffer[];
  try{images=await decodeNotionCanvaPngExport(downloads,v.pageCount??0);if(images.length!==expectedOutputPages(s))throw new HttpError(502,'원고·원문 QR·예고·브랜드 마지막 장의 페이지 수가 다릅니다.');}
  catch(e){await failCurrentJob(db,s,v,'Canva 출력 파일의 페이지 수·순서·크기를 확인해 주세요. 기존 완성본은 유지했습니다.');throw e;}
  const imported=await db.transaction(async raw=>{const tx=raw as unknown as DB;
   await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,s.item.id)).for('update');
   await tx.select({id:notionSyncLinks.id}).from(notionSyncLinks).where(eq(notionSyncLinks.id,id)).for('update');
   const fresh=await loadNotionStudioState(tx,id),link=fresh.link;
   if(link.version!==s.link.version||link.canva.exportJobId!==v.exportJobId||link.canva.phase!=='exporting')return 'superseded';
   if(!currentSource(fresh,v)){await tx.update(notionSyncLinks).set({canva:{...v,phase:'failed',error:sourceChanged().message},version:link.version+1,updatedAt:new Date()}).where(eq(notionSyncLinks.id,id));return 'source_changed';}
   // Each result owns a non-current revision. Reusing an unchanged cover must
   // never replace the carousel attached to an earlier completed export.
   const output=await createRevision(tx,{contentItemId:fresh.item.id,author:'operator',payload:{...fresh.revision.payload,notionCanvaOutput:{designId:v.designId,exportJobId:v.exportJobId,sourceRevisionId:fresh.revision.id,sourceVersion:fresh.item.version}},makeCurrent:false,note:'Canva 완성본 가져오기 · 원고 원본과 이전 결과 보존'});
   const manifest:NonNullable<typeof mediaAssets.$inferInsert.carousel>={version:1,altVersion:1,pages:[],cover:{kind:'typography',credit:'Canva · 노션 연결 원고'},rendererProvider:'canva'};
   for(const [i,bytes]of images.entries()){
    const digest=sha(bytes);const [old]=await tx.select({id:mediaAssets.id}).from(mediaAssets).where(and(eq(mediaAssets.contentItemId,fresh.item.id),eq(mediaAssets.sha256,digest),eq(mediaAssets.revisionId,output.id))).limit(1);
    const [created]=old?[old]:await tx.insert(mediaAssets).values({channelId:link.channelId,contentItemId:fresh.item.id,revisionId:output.id,kind:i===0?'card':'card_page',source:'canva',sha256:digest,bytes,mime:'image/png',width:1080,height:1350}).returning({id:mediaAssets.id});
    const extra=extras(fresh),sourcePageCount=notionSourceReferencePageCount(extra.sourceReferences),sourceTitle=extra.sourceCard?.title||'원문 공고 확인';
    const titles=[fresh.copy.cover.title,...fresh.copy.pages.map(p=>p.title),...Array.from({length:sourcePageCount},(_,page)=>sourcePageCount===1?sourceTitle:`${sourceTitle} (${page+1}/${sourcePageCount})`),...(extra.teaser?[extra.teaser.title]:[]),NOTION_CANVA_OUTRO.title];
    const last=i===images.length-1,title=titles[i];
    const sourcePageIndex=i-fresh.copy.pages.length-1;
    const sourceAlt=sourcePageIndex>=0&&sourcePageIndex<sourcePageCount?`원문 공고 확인: ${extra.sourceReferences!.slice(sourcePageIndex*NOTION_SOURCE_REFERENCES_PER_PAGE,(sourcePageIndex+1)*NOTION_SOURCE_REFERENCES_PER_PAGE).map(ref=>ref.title).join(', ')}`:title;
    manifest.pages.push({id:created.id,sha256:digest,title,altText:last?NOTION_CANVA_OUTRO.altText:sourceAlt});
   }
   const outputAssetId=manifest.pages[0].id;await tx.update(mediaAssets).set({carousel:manifest}).where(eq(mediaAssets.id,outputAssetId));
   await tx.update(notionSyncLinks).set({canva:{...v,phase:'complete',outputAssetId,error:null,updatedAt:new Date().toISOString()},operationToken:null,operationUntil:null,version:link.version+1,updatedAt:new Date()}).where(eq(notionSyncLinks.id,id));return 'complete';
  });
  if(imported==='source_changed')throw sourceChanged();
 }
 return notionStudioDetail(db,id);
}
export async function downloadNotionStudioOutput(db:DB,id:number){
 const s=await loadNotionStudioState(db,id),assetId=s.link.canva.outputAssetId;
 if(!assetId)throw new HttpError(404,'가져온 Canva 완성본이 없습니다.');
 const [main]=await db.select().from(mediaAssets).where(and(eq(mediaAssets.id,assetId),eq(mediaAssets.contentItemId,s.item.id)));
 if(!main?.carousel)throw new HttpError(404,'완성본 파일을 찾을 수 없습니다.');
 const ids=main.carousel.pages.map(p=>p.id),rows=await db.select({id:mediaAssets.id,bytes:mediaAssets.bytes}).from(mediaAssets).where(and(eq(mediaAssets.contentItemId,s.item.id),eq(mediaAssets.revisionId,main.revisionId),inArray(mediaAssets.id,ids)));
 const files:Record<string,Uint8Array>={};for(const [i,p]of main.carousel.pages.entries()){const row=rows.find(r=>r.id===p.id);if(!row)throw new HttpError(409,'일부 페이지 파일을 찾을 수 없습니다. 다시 가져오세요.');files[`${String(i+1).padStart(2,'0')}.png`]=row.bytes;}
 return Buffer.from(zipSync(files,{level:6}));
}
