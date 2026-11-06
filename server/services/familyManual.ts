/** First manual v2 save: supplied text and operator-declared claims, no AI/network. */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { channels, contentItems, contentRevisions, contentSources, familyManualRequests, sourceDocuments, studioCards } from '../../shared/schema';
import { familyManualCreateSchema, familyManualInitializeSchema, familyManualReceiptSchema, type FamilyManualCreate, type FamilyManualInitialize, type FamilyManualReceipt } from '../../shared/familyManual';
import { defaultPageDesigns, familyCardCopySchema, familyDialogueMetadataSchema, familyFieldValue, type FamilyDialogueMetadata } from '../../shared/familyDialogue';
import { sourceAnalysisSchema, sourceSnapshotSchema, type FamilyFact } from '../../shared/familyEvidence';
import { emptyPayload } from '../../shared/payloads';
import { audit } from '../audit';
import { createRevision } from '../content';
import { HttpError } from '../routes/util';
import { familyEvidenceView, familyHash, putFamilyEvidence, createFamilyEvidenceSet, validateFamilySourceAnalysis } from './familyEvidence';
import { assertFamilyEvidenceForCopy } from './familyEditorialPersistence';
import { assertCardPageArtworkOwnership } from './cardPageArtwork';
import { ensureSourceWorkspace } from './sourceWorkspace';
import { assertStudioActive } from './studio';
import { resolveStyle, TemplateNotFound } from './templates';
import { sha256 } from './text';

export async function initializeManualFamily(db:DB,channelId:number,input:FamilyManualCreate|FamilyManualInitialize,actor:string,itemId?:number):Promise<FamilyManualReceipt>{
  const parsed=(itemId===undefined?familyManualCreateSchema:familyManualInitializeSchema).safeParse(input);
  if(!parsed.success)throw new HttpError(400,'수동 8장 원고와 제공 문서·근거 확인 항목을 다시 확인해 주세요.');
  const body=parsed.data,version='version'in body?body.version:undefined;
  const requestHash=familyHash({channelId,itemId:itemId??null,...body});
  return db.transaction(async tx=>{
    // New work has no item row yet. This durable request lock prevents duplicate
    // items/revisions after double taps or a lost HTTP receipt.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`manual-family:${body.requestId}`},0))`);
    const [receipt]=await tx.select().from(familyManualRequests).where(eq(familyManualRequests.requestId,body.requestId));
    if(receipt){
      if(receipt.channelId!==channelId||receipt.requestHash!==requestHash)throw new HttpError(409,'같은 요청 ID로 다른 채널·원고·근거를 저장할 수 없습니다.',{code:'manual_request_conflict'});
      return familyManualReceiptSchema.parse(receipt.result);
    }
    const [channel]=await tx.select().from(channels).where(eq(channels.id,channelId)).for('share');
    if(!channel)throw new HttpError(404,'채널을 찾을 수 없습니다.');
    if(!channel.active)throw new HttpError(409,'보관한 채널에는 새 수동 원고를 저장할 수 없습니다.');
    try{await resolveStyle(tx as DB,body.copy.templateKey,channelId);}catch(error){if(error instanceof TemplateNotFound)throw new HttpError(400,error.message);throw error;}
    let item:typeof contentItems.$inferSelect;
    if(itemId!==undefined){
      const [existing]=await tx.select().from(contentItems).where(and(eq(contentItems.id,itemId),eq(contentItems.channelId,channelId))).for('update');
      if(!existing)throw new HttpError(404,'콘텐츠를 찾을 수 없습니다.');
      if(existing.version!==version)throw new HttpError(409,'원고가 다른 곳에서 변경되었습니다. 최신 저장본을 확인해 주세요.',{code:'source_changed'});
      const [board]=await tx.select().from(studioCards).where(eq(studioCards.sourceItemId,existing.id));if(board)assertStudioActive(board);
      const [current]=existing.currentRevisionId?await tx.select().from(contentRevisions).where(and(eq(contentRevisions.id,existing.currentRevisionId),eq(contentRevisions.contentItemId,existing.id))):[];
      if((current?.payload.cardCopy as {version?:unknown}|undefined)?.version===2)throw new HttpError(409,'이미 저장된 8장 원고는 기존 편집·저장으로 이어가 주세요. 초기화로 덮어쓰지 않았습니다.',{code:'manual_already_initialized'});
      if(existing.excluded||existing.isSample||existing.origin==='studio')throw new HttpError(409,'이 콘텐츠는 직접 변환할 수 없습니다. 새 수동 원고로 작성해 주세요.');
      item=existing;
    }else{
      [item]=await tx.insert(contentItems).values({channelId,kind:channel.contentType,origin:'manual',title:body.title,topicKey:body.title,relevance:'relevant',scheduleStatus:channel.contentType==='notice'?'unknown':'not_applicable'}).returning();
      await tx.select({id:contentItems.id}).from(contentItems).where(eq(contentItems.id,item.id)).for('update');
    }
    const copy=familyCardCopySchema.parse(body.copy),summary=copy.pages.find(page=>page.id==='news_summary')!,concept=copy.pages.find(page=>page.id==='concept')!,discussion=copy.pages.find(page=>page.id==='discussion')!;
    const required=summary.fields.facts.map((_fact,index)=>`pages.news_summary.fields.facts.${index}`);
    if(concept.fields.mode==='scientific_explanation')required.push('pages.concept.fields.acceptedDefinition');
    if(required.length!==body.factBindings.length||required.some(path=>!body.factBindings.some(binding=>binding.fieldPath===path)))throw new HttpError(422,'뉴스 요약의 각 문구와 과학 정의에 제공 문서의 근거 구절을 각각 연결해 주세요.',{code:'manual_missing_binding'});
    for(const binding of body.factBindings){if(!body.source.text.includes(binding.excerpt))throw new HttpError(422,'근거 구절이 제공한 본문에 그대로 포함되어 있지 않습니다. 본문의 문장을 복사해 연결해 주세요.',{code:'unsupported_excerpt',field:binding.fieldPath});}
    const now=new Date(),url=body.source.url??`provided-document:${body.requestId}`;
    const [document]=await tx.insert(sourceDocuments).values({normalizedUrl:`manual-family:${body.requestId}`,originalUrl:url,kind:'manual_text',title:body.source.title,fetchedText:body.source.text,fetchStatus:'ok',contentHash:sha256(body.source.text),lastFetchedAt:now,meta:{origin:'operator_supplied',independentlyVerified:false}}).returning();
    const sourceId=`source-${document.id}`;
    const snapshot=sourceSnapshotSchema.parse({id:randomUUID(),channelId,itemId:item.id,capturedAt:now.toISOString(),primarySourceId:sourceId,identityStatus:'manual_paste',sources:[{
      id:sourceId,documentId:document.id,role:'provided',scope:'provided_document',title:body.source.title,requestedUrl:url,finalUrl:url,canonicalUrl:null,publisher:null,publishedAt:null,fetchedAt:now.toISOString(),text:body.source.text,contentHash:sha256(body.source.text)}]});
    const facts:FamilyFact[]=required.map((path,index)=>{
      const binding=body.factBindings.find(value=>value.fieldPath===path)!;
      return{id:`F${index+1}`,statement:String(familyFieldValue(copy,path)),claimType:binding.claimType,speaker:binding.speaker??null,sourceId,sourceScope:'provided_document',timeScope:binding.timeScope??null,conditions:binding.conditions??[],evidenceExcerpt:binding.excerpt,verificationStatus:'article_only'};
    });
    // The summary/definition bindings are derived from supplied excerpts, not
    // arbitrary client F-IDs. Other editorial/question references still pass
    // the unchanged canonical fact-binding validator below.
    for(const path of required){const page=copy.pages.find(page=>path.startsWith(`pages.${page.id}.`))!;page.claimRefs=page.claimRefs.filter(ref=>{
      const full=ref.fieldPath.startsWith('pages.')?ref.fieldPath:`pages.${page.id}.${ref.fieldPath}`;
      return !(full===path||full==='pages.news_summary.fields.facts');
    });const fact=facts[required.indexOf(path)];page.claimRefs.push({fieldPath:path,claimType:fact.claimType,factIds:[fact.id],resourceIds:[]});}
    const analysis=sourceAnalysisSchema.parse({sourceSnapshotId:snapshot.id,sourceAnalysisId:randomUUID(),articleCore:body.title,articleType:'mixed',facts,essentialConditions:[...new Set(facts.flatMap(fact=>fact.conditions))].slice(0,12),cannotConclude:['제공된 문서 밖의 사실이나 독립 검증 결과를 주장하지 않습니다.'],missingInformation:['운영자가 제공한 문서이며 원문 발행·외부 사실을 별도로 검증하지 않았습니다.'],headlineBodyGap:null,conceptCandidates:[]});
    const flags=validateFamilySourceAnalysis(analysis,snapshot);if(flags.length)throw new HttpError(422,flags[0].message,{code:flags[0].code,reviewFlags:flags});
    await putFamilyEvidence(tx as DB,{id:snapshot.id,itemId:item.id,channelId,kind:'source_snapshot',fingerprint:familyHash(snapshot),payload:snapshot});
    await putFamilyEvidence(tx as DB,{id:analysis.sourceAnalysisId,itemId:item.id,channelId,kind:'source_analysis',sourceSnapshotId:snapshot.id,fingerprint:familyHash(analysis),payload:analysis});
    const evidenceSet=await createFamilyEvidenceSet(tx as DB,item,snapshot,analysis,null,[]);
    const metadata:FamilyDialogueMetadata={editorialPlan:{articleCore:body.title,coreQuestion:discussion.fields.question,thinkingSkill:'perspectives',keyConcept:concept.fields.concept,conceptMode:concept.fields.mode,connectionReason:'운영자가 제공 문서를 읽고 직접 작성한 대화 원고입니다.',essentialConditions:analysis.essentialConditions,questionCandidates:[discussion.fields.question],resourceNeeds:[]},evidenceBinding:{evidenceSetId:evidenceSet.evidenceSetId,sourceSnapshotId:snapshot.id,sourceAnalysisId:analysis.sourceAnalysisId,resourceResearchId:null},pageDesigns:defaultPageDesigns(),parentGuide:null,captionPackage:null,visualBriefs:{},editorialReview:null,fieldLocks:{},generationRuns:[],dependencies:{caption:'not_generated',visuals:'not_generated',review:'not_generated',render:'needs_review'}};
    if(!familyDialogueMetadataSchema.safeParse(metadata).success)throw new HttpError(422,'중심 질문은 300자, 핵심 개념은 100자 이내로 정리해 주세요. 입력과 이전 저장본은 유지했습니다.',{code:'manual_plan_invalid'});
    await assertCardPageArtworkOwnership(tx as DB,item.id,channelId,copy,metadata.pageDesigns);
    const bundle=await assertFamilyEvidenceForCopy(tx as DB,item,copy,metadata);
    await tx.update(contentSources).set({role:'previous_manual'}).where(and(eq(contentSources.contentItemId,item.id),eq(contentSources.role,'manual_primary')));
    await tx.insert(contentSources).values({contentItemId:item.id,sourceDocumentId:document.id,role:'manual_primary'});
    const payload={...emptyPayload(item.kind,body.title),...metadata,cardCopy:copy,rendererProvider:'builtin',manualAuthoring:{origin:'operator',requestId:body.requestId,sourceScope:'provided_document',independentlyVerified:false,createdAt:now.toISOString()},title:body.title};
    await tx.update(contentItems).set({title:body.title,primarySourceId:document.id}).where(eq(contentItems.id,item.id));
    const revision=await createRevision(tx,{contentItemId:item.id,author:'operator',payload,note:'제공 문서·직접 작성한 8장 원고 저장 · AI 호출 없음'});
    const nextVersion=item.version+1;
    await tx.update(contentItems).set({edited:payload,version:nextVersion,reviewStatus:'pending',publishStatus:'waiting',updatedAt:now}).where(eq(contentItems.id,item.id));
    const studioCardId=await ensureSourceWorkspace(tx,item.id);if(!studioCardId)throw new HttpError(409,'수동 원고의 작업 공간을 연결하지 못했습니다. 저장을 적용하지 않았습니다.');
    const result=familyManualReceiptSchema.parse({requestId:body.requestId,itemId:item.id,studioCardId,version:nextVersion,revisionId:revision.id});
    await tx.insert(familyManualRequests).values({requestId:body.requestId,channelId,requestHash,contentItemId:item.id,result});
    await audit(tx,{actor,action:'initialize_manual_family',entity:'content_item',entityId:item.id,channelId,detail:{revisionId:revision.id,sourceSnapshotId:snapshot.id,manual:true,aiCalls:0,sourceScope:'provided_document',facts:familyEvidenceView(bundle).facts.length}});
    return result;
  });
}
