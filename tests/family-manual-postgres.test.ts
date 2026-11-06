/** Real transactions, immutable evidence and normal authenticated UI routes; no AI/network. */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { approvals, channels, contentItems, contentRevisions, familyManualRequests, jobs, mediaAssets, sourceDocuments, studioCards } from '../shared/schema';
import { familyEvidenceRecords, familyEditorialStages } from '../shared/familyEvidenceDb';
import { familyManualCreateSchema, type FamilyManualCreate } from '../shared/familyManual';
import { familyEvidenceFixture } from './fixtures/familyEvidence';
import { familyDialogueCardFixture, scientificFamilyCardFixture } from './fixtures/familyDialogueCard';
import { login, resetDb, setTestEnv } from './helpers';
if(!process.env.TEST_DATABASE_URL||!new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'))throw Error('Explicit isolated TEST_DATABASE_URL ending _test required');
setTestEnv();
const canva=vi.hoisted(()=>({principal:vi.fn(),design:vi.fn(),pages:vi.fn()}));
vi.mock('../server/services/canvaRest',async original=>({...await original<object>(),getCanvaPrincipal:canva.principal,getCanvaDesign:canva.design,getCanvaPages:canva.pages}));
const {getDb,closeDb}=await import('../server/db');
const {initializeManualFamily}=await import('../server/services/familyManual');
const {familyMetadataFromPayload}=await import('../server/services/familyEditorial');
const {assertFamilyEvidenceForCopy,saveFamilyCardCopy}=await import('../server/services/familyEditorialPersistence');
const {loadFamilyEvidence}=await import('../server/services/familyEvidence');
const {createApp}=await import('../server/app');
const {createRevision}=await import('../server/content');
const {enqueueCanvaManualImport}=await import('../server/services/canvaManualImport');
let app:ReturnType<typeof createApp>;
beforeAll(async()=>{await resetDb();app=createApp();});
afterAll(closeDb);
afterEach(()=>{if(vi.isMockFunction(fetch))expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
function body():FamilyManualCreate{
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Manual authoring must not call a provider');}));
  const evidence=familyEvidenceFixture();
  return familyManualCreateSchema.parse({requestId:randomUUID(),title:'직접 작성한 가족 대화',copy:familyDialogueCardFixture(),source:{title:'운영자가 제공한 문서',text:evidence.snapshot.sources[0].text},
    factBindings:evidence.analysis.facts.map((fact,index)=>({fieldPath:`pages.news_summary.fields.facts.${index}`,excerpt:fact.evidenceExcerpt,claimType:fact.claimType,speaker:fact.speaker,timeScope:fact.timeScope,conditions:fact.conditions})),confirmed:true});
}
async function latest(id:number){const [item]=await getDb().select().from(contentItems).where(eq(contentItems.id,id));const [revision]=await getDb().select().from(contentRevisions).where(eq(contentRevisions.id,item.currentRevisionId!));return{item,revision};}
async function legacy(){const db=getDb();const [item]=await db.insert(contentItems).values({channelId:2,kind:'science_dialogue',origin:'manual',title:'보존할 이전 원고'}).returning();const revision=await createRevision(db,{contentItemId:item.id,author:'operator',payload:{title:'보존할 이전 원고',summary:'이전 문구'},note:'이전 저장본'});return{item,revision};}

it('creates source-backed eight-page work without any AI result, job or invented verification',async()=>{
  const db=getDb(),input=body(),result=await initializeManualFamily(db,2,input,'test-operator');
  expect(result).toMatchObject({requestId:input.requestId,itemId:expect.any(Number),studioCardId:expect.any(Number),version:2,revisionId:expect.any(Number)});
  const {item,revision}=await latest(result.itemId),metadata=familyMetadataFromPayload(revision.payload)!;
  expect(item).toMatchObject({origin:'manual',reviewStatus:'pending',publishStatus:'waiting'});
  expect(revision).toMatchObject({author:'operator',model:null,usage:null});expect(revision.payload.aiWorkflow).toBeUndefined();
  expect(metadata).toMatchObject({generationRuns:[],parentGuide:null,captionPackage:null,dependencies:{caption:'not_generated',review:'not_generated',render:'needs_review'}});
  const bundle=await assertFamilyEvidenceForCopy(db,item,revision.payload.cardCopy as typeof input.copy,metadata);
  expect(bundle.snapshot).toMatchObject({identityStatus:'manual_paste',sources:[{scope:'provided_document',role:'provided',text:input.source.text}]});
  expect(bundle.evidenceSet.facts.every(fact=>fact.verificationStatus==='article_only'&&fact.sourceScope==='provided_document')).toBe(true);
  expect(await db.select().from(jobs).where(eq(jobs.channelId,2))).toHaveLength(0);expect(await db.select().from(familyEditorialStages).where(eq(familyEditorialStages.contentItemId,item.id))).toHaveLength(0);
  expect(await db.select().from(familyEvidenceRecords).where(eq(familyEvidenceRecords.contentItemId,item.id))).toHaveLength(3);
  const {agent}=await login(app),workspace=await agent.get(`/api/studio/cards/${result.studioCardId}`);expect(workspace.status).toBe(200);
  expect(workspace.body.card.sourceReference).toMatchObject({itemId:item.id,channelId:2});
  const editor=await agent.get(`/api/channels/2/items/${item.id}/card-copy`);expect(editor.status).toBe(200);expect(editor.body.copy.version).toBe(2);expect(editor.body.generationRuns).toEqual([]);
});

it('serializes duplicate first saves into one item, source, revision, workspace and receipt',async()=>{
  const db=getDb(),input=body(),[a,b]=await Promise.all([initializeManualFamily(db,2,input,'test'),initializeManualFamily(db,2,input,'test')]);expect(a).toEqual(b);
  expect(await db.select().from(familyManualRequests).where(eq(familyManualRequests.requestId,input.requestId))).toHaveLength(1);
  expect(await db.select().from(contentRevisions).where(eq(contentRevisions.contentItemId,a.itemId))).toHaveLength(1);
  expect(await db.select().from(studioCards).where(eq(studioCards.sourceItemId,a.itemId))).toHaveLength(1);
  expect(await db.select().from(sourceDocuments).where(eq(sourceDocuments.normalizedUrl,`manual-family:${input.requestId}`))).toHaveLength(1);
});

it('replays a saved receipt after source/version edits and rejects changed scope or payload',async()=>{
  const db=getDb(),input=body(),first=await initializeManualFamily(db,2,input,'test');
  await db.update(contentItems).set({version:9}).where(eq(contentItems.id,first.itemId));
  expect(await initializeManualFamily(db,2,input,'test')).toEqual(first);
  await expect(initializeManualFamily(db,2,{...input,title:'다른 요청'},'test')).rejects.toMatchObject({status:409});
  await expect(initializeManualFamily(db,3,input,'test')).rejects.toMatchObject({status:409});
});

it('requires literal provided excerpts and rolls back every partial row on failure',async()=>{
  const db=getDb(),input=body(),beforeItems=await db.select({id:contentItems.id}).from(contentItems);input.factBindings[0].excerpt='본문에 존재하지 않는 구절';
  await expect(initializeManualFamily(db,2,input,'test')).rejects.toMatchObject({status:422,extra:{code:'unsupported_excerpt'}});
  expect(await db.select({id:contentItems.id}).from(contentItems)).toHaveLength(beforeItems.length);
  expect(await db.select().from(sourceDocuments).where(eq(sourceDocuments.normalizedUrl,`manual-family:${input.requestId}`))).toHaveLength(0);
  expect(await db.select().from(familyManualRequests).where(eq(familyManualRequests.requestId,input.requestId))).toHaveLength(0);
});

it('requires a separate binding for every summary fact',async()=>{
  const input=body();input.copy.pages[1].id==='news_summary'&&input.copy.pages[1].fields.facts.push('새로 쓴 세 번째 사실');
  await expect(initializeManualFamily(getDb(),2,input,'test')).rejects.toMatchObject({status:422,extra:{code:'manual_missing_binding'}});
});

it('rejects metadata that the canonical editor cannot reopen instead of saving an unreadable draft',async()=>{
  const input=body();if(input.copy.pages[3].id==='discussion')input.copy.pages[3].fields.question='질'.repeat(301);
  await expect(initializeManualFamily(getDb(),2,input,'test')).rejects.toMatchObject({status:422,extra:{code:'manual_plan_invalid'}});
  expect(await getDb().select().from(familyManualRequests).where(eq(familyManualRequests.requestId,input.requestId))).toHaveLength(0);
});

it.each(['speaker','uncertainty','numeric_condition'] as const)('retains the existing %s fact guard',async kind=>{
  const input=body();
  if(kind==='speaker')input.factBindings[0].speaker='원문에없는발언자';
  if(kind==='uncertainty'&&input.copy.pages[1].id==='news_summary')input.copy.pages[1].fields.facts[0]='게이츠의 말은 이미 입증된 연구 결과예요.';
  if(kind==='numeric_condition')input.factBindings[0].timeScope='2030년';
  await expect(initializeManualFamily(getDb(),2,input,'test')).rejects.toMatchObject({status:422});
});

it('rejects invented foreign fact IDs while canonicalizing supplied summary bindings',async()=>{
  const input=body();input.copy.pages[2].claimRefs=[{fieldPath:'fields.takeaway',claimType:'reported_event',factIds:['F999'],resourceIds:[]}];
  await expect(initializeManualFamily(getDb(),2,input,'test')).rejects.toMatchObject({status:422,extra:{code:'unknown_evidence'}});
});

it('supports scientific definitions only with an exact provided definition binding',async()=>{
  const input=body();input.copy=scientificFamilyCardFixture();const definition='평균 속력은 이동한 거리를 걸린 시간으로 나눈 값이다.';input.source.text+=`\n${definition}`;
  await expect(initializeManualFamily(getDb(),2,input,'test')).rejects.toMatchObject({status:422});
  input.factBindings.push({fieldPath:'pages.concept.fields.acceptedDefinition',excerpt:definition,claimType:'research_finding'});
  const receipt=await initializeManualFamily(getDb(),2,input,'test'),{revision}=await latest(receipt.itemId);expect((revision.payload.cardCopy as typeof input.copy).pages[5]).toMatchObject({fields:{mode:'scientific_explanation'}});
});

it('preserves legacy revisions/assets and rejects stale or repeated destructive initialization',async()=>{
  const db=getDb(),f=await legacy(),input=body(),bytes=Buffer.from('preserved-old-artifact');
  const [asset]=await db.insert(mediaAssets).values({channelId:2,contentItemId:f.item.id,revisionId:f.revision.id,sha256:'a'.repeat(64),bytes,width:1080,height:1350}).returning();
  const [approval]=await db.insert(approvals).values({channelId:2,contentItemId:f.item.id,revisionId:f.revision.id,mediaAssetId:asset.id,cardSha256:asset.sha256,captions:{instagram:'이전 승인',telegram:'이전 승인'},scheduledAt:new Date(),approvedBy:'test'}).returning();
  await expect(initializeManualFamily(db,2,{...input,version:f.item.version+1},'test',f.item.id)).rejects.toMatchObject({status:409});
  const receipt=await initializeManualFamily(db,2,{...input,version:f.item.version},'test',f.item.id);
  expect((await db.select().from(contentRevisions).where(eq(contentRevisions.id,f.revision.id)))[0].payload).toEqual(f.revision.payload);
  expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id,asset.id)))[0].bytes).toEqual(bytes);
  expect((await db.select().from(approvals).where(eq(approvals.id,approval.id)))[0].status).toBe('invalidated');
  await expect(initializeManualFamily(db,2,{...input,requestId:randomUUID(),version:receipt.version},'test',f.item.id)).rejects.toMatchObject({status:409,extra:{code:'manual_already_initialized'}});
  expect(await initializeManualFamily(db,2,{...input,version:f.item.version},'test',f.item.id)).toEqual(receipt);
});

it('uses the ordinary editor after initialization without requiring an AI proposal',async()=>{
  const db=getDb(),input=body(),receipt=await initializeManualFamily(db,2,input,'test'),{revision}=await latest(receipt.itemId),metadata=familyMetadataFromPayload(revision.payload)!;
  const copy=structuredClone(revision.payload.cardCopy) as typeof input.copy;copy.pages[3].id==='discussion'&&(copy.pages[3].fields.question='우리는 어떤 기준을 중요하게 볼까요?');
  const result=await saveFamilyCardCopy(db,receipt.itemId,2,{version:receipt.version,copy,pageDesigns:metadata.pageDesigns,fieldLocks:{}},'test');
  expect(result.version).toBe(receipt.version+1);expect(result.generationRuns).toEqual([]);expect(result.evidenceBinding).toEqual(metadata.evidenceBinding);
});

it('can continue the real manually initialized source into the export-only Canva path',async()=>{
  const db=getDb(),input=body(),receipt=await initializeManualFamily(db,2,input,'test');
  const principal={userId:'manual_author',teamId:'manual_team'},designId=`Dmanual_${randomUUID()}`;
  canva.principal.mockResolvedValue(principal);canva.design.mockResolvedValue({id:designId,owner:principal,pageCount:8,updatedAt:123,editUrl:`https://www.canva.com/design/${designId}/edit`});
  canva.pages.mockResolvedValue({validEightPageMaster:true,items:Array.from({length:8},(_,index)=>({id:null,pageNumber:index+1,width:1080,height:1350}))});
  const job=await enqueueCanvaManualImport(db,{channelId:2,itemId:receipt.itemId,version:receipt.version,requestId:randomUUID(),designId,confirmed:true,actor:'test'});
  expect(job).toMatchObject({purpose:'import',masterId:null,phase:'export_prepare',sourceRevisionId:receipt.revisionId,input:{payload:{manualAuthoring:{origin:'operator'},generationRuns:[]}}});
  expect(await db.select().from(jobs).where(eq(jobs.channelId,2))).toHaveLength(0);
});

it('does not weaken the ordinary first-v2 PATCH guard',async()=>{
  const f=await legacy(),input=body(),{agent,csrf}=await login(app);
  const response=await agent.patch(`/api/channels/2/items/${f.item.id}/card-copy`).set('x-csrf-token',csrf).send({version:f.item.version,copy:input.copy,pageDesigns:familyMetadataFromPayload((await latest((await initializeManualFamily(getDb(),2,body(),'test')).itemId)).revision.payload)!.pageDesigns,fieldLocks:{}});
  expect(response.status).toBe(409);expect((await latest(f.item.id)).revision.id).toBe(f.revision.id);
});

it('protects manual creation with login/CSRF and rejects forged verification flags',async()=>{
  const input=body(),url='/api/channels/2/items/manual-family';expect((await request(app).post(url).send(input)).status).toBe(401);
  const {agent,csrf}=await login(app);expect((await agent.post(url).send(input)).status).toBe(403);
  expect((await agent.post(url).set('x-csrf-token',csrf).send({...input,confirmed:false})).status).toBe(400);
  expect((await agent.post(url).set('x-csrf-token',csrf).send({...input,factBindings:input.factBindings.map(value=>({...value,verificationStatus:'primary_checked'}))})).status).toBe(400);
  const response=await agent.post(url).set('x-csrf-token',csrf).send(input);expect(response.status).toBe(201);expect(response.body.requestId).toBe(input.requestId);
  expect((await agent.post(url).set('x-csrf-token',csrf).send(input)).body).toEqual(response.body);
});

it('rejects archived channels and trashed existing work without altering saved sources',async()=>{
  const db=getDb(),input=body();await db.update(channels).set({active:false}).where(eq(channels.id,2));
  await expect(initializeManualFamily(db,2,input,'test')).rejects.toMatchObject({status:409});await db.update(channels).set({active:true}).where(eq(channels.id,2));
  const f=await legacy();await db.update(studioCards).set({trashedAt:new Date()}).where(eq(studioCards.sourceItemId,f.item.id));
  await expect(initializeManualFamily(db,2,{...body(),version:f.item.version},'test',f.item.id)).rejects.toMatchObject({status:409});
  expect((await latest(f.item.id)).revision.id).toBe(f.revision.id);
});
