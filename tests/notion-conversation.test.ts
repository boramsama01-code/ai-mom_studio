import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import sharp from 'sharp';
import {setTestEnv,resetDb,login} from './helpers';
import {applyNotionConversationPatch,defaultNotionProductionProfile,notionConversationSignature,notionConversationRequestSchema,notionProductionProfileSchema} from '../shared/notionConversation';
import type {NotionDocument} from '../shared/notionSync';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),patch:vi.fn(),call:vi.fn()}));
vi.mock('../server/services/notionClient',async original=>({...await original<object>(),fetchNotionDocument:mocks.fetch,patchNotionDocumentProperties:mocks.patch}));
vi.mock('../server/services/llm',async original=>({...await original<object>(),callTool:mocks.call}));
setTestEnv();
const pageId='4135c7c8-45fc-8101-ba1c-000000008001';
let db:ReturnType<typeof import('../server/db').getDb>,schemas:typeof import('../shared/schema'),service:typeof import('../server/services/notionConversation'),studio:typeof import('../server/services/notionStudio'),app:ReturnType<typeof import('../server/app').createApp>,doc:NotionDocument,ch:number;
beforeAll(async()=>{
 const url=new URL(process.env.APP_DATABASE_URL!);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/spacepenguin_test')throw new Error('Isolated loopback test DB required');
 db=(await import('../server/db')).getDb();schemas=await import('../shared/schema');service=await import('../server/services/notionConversation');studio=await import('../server/services/notionStudio');
});
beforeEach(async()=>{
 await resetDb();app=(await import('../server/app')).createApp();vi.clearAllMocks();
 doc={pageId,url:`https://www.notion.so/${pageId.replaceAll('-','')}`,lastEditedAt:'2026-11-11T02:00:00Z',contentKey:'conversation-test',title:'격리된 추천서 원고',coverTitle:'추천서 부탁하기',channel:'HighScoop',category:'꿀팁',template:'highscoop-a',stage:'원고 검토',verified:true,caption:'별도 캡션',sourceHash:'a'.repeat(64),photos:[],pages:[
  {index:1,title:'원본 표지 제목',body:'실제 보냈던 자료 공개',headingBlockId:'h1',bodyBlockIds:['b1']},
  {index:2,title:'봉투에 넣은 자료',body:'고정 소제목\n\n제가 쓴 메모와 아이의 자기소개서를 보냈어요.',headingBlockId:'h2',bodyBlockIds:['b2'],cardFields:{subtitle:'고정 소제목',body:'제가 쓴 메모와 아이의 자기소개서를 보냈어요.',footnote:'보존할 각주',sourceLabel:'사용자 경험'}},
  {index:3,title:'확인할 사항',body:'추천 마감은 기관마다 확인해주세요.',headingBlockId:'h3',bodyBlockIds:['b3']},
 ],sourceReferences:[{title:'GED',url:'https://ged.kedi.re.kr/'}],teaser:{title:'다음 편',body:'연구계획서 쓰기'}};
 mocks.fetch.mockImplementation(async()=>structuredClone(doc));mocks.patch.mockResolvedValue(undefined);
 mocks.call.mockResolvedValue({ok:true,data:{patch:{title:'제가 보낸 봉투',body:'메모와 자기소개서를 같이 넣었어요ㅎㅎ.',emphasis:'메모와 자기소개서'},summary:'부탁했던 경험이 자연스럽게 읽히도록 다듬었어요.'},model:'fixture',usage:{inputTokens:10,outputTokens:10},droppedEvidence:0});
 ch=(await db.select().from(schemas.channels)).find(c=>c.slug==='opportunities'||c.slug==='highscoop')!.id;
});
afterAll(async()=>{await (await import('../server/db')).closeDb();});
async function imported(){return studio.importNotionStudio(db,{pageId:doc.pageId,channelId:ch,expectedSourceHash:doc.sourceHash,coverStyle:'A'},'test');}
const requestOf=(d:Awaited<ReturnType<typeof imported>>,page=1)=>({version:d.link.version,itemVersion:d.itemVersion,copy:structuredClone(d.copy),designEdits:structuredClone(d.designEdits??{emphasisByPage:{}}),page,instruction:'이 카드만 경험담 말투로 바꿔줘.',history:[]});

describe('Notion selected-card conversation',()=>{
 it('returns a selected-card proposal, preserves protected source fields, and makes no durable content or Canva change',async()=>{
  const d=await imported(),request=requestOf(d),before=structuredClone(request),beforeLink=(await db.select().from(schemas.notionSyncLinks))[0],beforeItem=(await db.select().from(schemas.contentItems).where(eq(schemas.contentItems.id,d.link.itemId)))[0];
  request.copy.pages[1].body='아직 저장하지 않은 다른 카드 초안';
  const response=await service.generateNotionConversation(db,d.link.id,request),source=d.source.pages[1],applied=applyNotionConversationPatch(request.copy,request.designEdits,1,source,response.patch);
  expect(response.page).toBe(1);expect(response.sourceSignature).toBe(notionConversationSignature(request.copy,request.designEdits,1));
  expect(applied.copy.cover).toEqual(request.copy.cover);expect(applied.copy.pages[1]).toEqual(request.copy.pages[1]);expect(applied.copy.pages[0].body).toBe('고정 소제목\n\n메모와 자기소개서를 같이 넣었어요ㅎㅎ.');
  expect(request.copy.pages[0]).toEqual(before.copy.pages[0]);expect(applied.designEdits.emphasisByPage).toEqual({h2:'메모와 자기소개서'});
  expect((await db.select().from(schemas.notionSyncLinks))[0]).toEqual(beforeLink);expect((await db.select().from(schemas.contentItems).where(eq(schemas.contentItems.id,d.link.itemId)))[0]).toEqual(beforeItem);expect(await db.select().from(schemas.contentRevisions)).toHaveLength(1);expect(mocks.call).toHaveBeenCalledTimes(1);
  const prompt=JSON.parse(mocks.call.mock.calls[0][0].user);expect(prompt.selected_page.body).not.toContain('고정 소제목');expect(prompt.nearby_pages).toHaveLength(2);expect(prompt.production_profile.voice).toContain('워킹맘');expect(prompt).not.toHaveProperty('copy');
  const logs=await db.select().from(schemas.auditLogs).where(eq(schemas.auditLogs.action,'notion_conversation_proposal'));expect(logs).toHaveLength(1);
  expect(logs[0].detail).toEqual({page:2,provider:mocks.call.mock.calls[0][0].provider,model:'fixture',usage:{inputTokens:10,outputTokens:10},usageStatus:'known'});
  expect(JSON.stringify(logs[0].detail)).not.toMatch(/메모|자기소개서|아직 저장|instruction|history|referenceText/);
 });
 it('rejects extras, invalid selection, foreign photos and stale item versions before a model call',async()=>{
  const d=await imported(),r=requestOf(d);
  await expect(service.generateNotionConversation(db,d.link.id,{...r,page:3})).rejects.toMatchObject({status:422});
  await expect(service.generateNotionConversation(db,d.link.id,{...r,itemVersion:r.itemVersion+1})).rejects.toMatchObject({status:409});
  await expect(service.generateNotionConversation(db,d.link.id,{...r,designEdits:{emphasisByPage:{},photoByPage:{h2:99999}}})).rejects.toMatchObject({status:422});
  expect(mocks.call).not.toHaveBeenCalled();
 });
 it('can convert prose to a structured selected page while preserving an unrelated pending photo page',async()=>{
  const d=await imported(),r=requestOf(d);r.designEdits={emphasisByPage:{},templateByPage:{h2:'process',h3:'image_text'}};
  mocks.call.mockResolvedValueOnce({ok:true,data:{patch:{title:'추천 요청 순서',body:'단계 | 내용\n준비 | 메모와 자료 챙기기\n전달 | 아이가 부탁드리기',emphasis:'',template:'process'},summary:'제공된 두 단계로 정리했어요.'},usage:{inputTokens:1,outputTokens:1},model:'fixture',droppedEvidence:0});
  const response=await service.generateNotionConversation(db,d.link.id,r);expect(response.patch.template).toBe('process');expect(response.patch.body).toContain('메모와 자료');
 });
 it('rejects an incompatible structured response and invalid highlight instead of corrupting the draft',async()=>{
  const d=await imported(),r=requestOf(d);
  mocks.call.mockResolvedValueOnce({ok:true,data:{patch:{title:'새 제목',body:'표가 아닌 일반 문장입니다.',emphasis:'',template:'process'},summary:'바꿨어요.'}});
  await expect(service.generateNotionConversation(db,d.link.id,r)).rejects.toMatchObject({status:422});
  mocks.call.mockResolvedValueOnce({ok:true,data:{patch:{title:'새 제목',body:'기존 경험만 정리했어요.',emphasis:'없는 숫자 123'},summary:'바꿨어요.'}});
  await expect(service.generateNotionConversation(db,d.link.id,r)).rejects.toMatchObject({status:422});expect(await db.select().from(schemas.contentRevisions)).toHaveLength(1);
 });
 it('discards a response if the source is saved elsewhere during the model request',async()=>{
  const d=await imported(),r=requestOf(d);mocks.call.mockImplementationOnce(async()=>{
   await db.update(schemas.contentItems).set({version:r.itemVersion+1}).where(eq(schemas.contentItems.id,d.link.itemId));
   return {ok:true,data:{patch:{title:'새 제목',body:'새 문장',emphasis:''},summary:'다듬었어요.'}};
  });
  await expect(service.generateNotionConversation(db,d.link.id,r)).rejects.toMatchObject({status:409,extra:{code:'notion_conversation_source_changed'}});
 });
 it('preserves the draft when the provider fails or the operator cancels',async()=>{
  const d=await imported(),r=requestOf(d);mocks.call.mockResolvedValueOnce({ok:false,kind:'api',error:'모델 응답을 받지 못했습니다.'});
  await expect(service.generateNotionConversation(db,d.link.id,r)).rejects.toMatchObject({status:502});
  const controller=new AbortController();controller.abort();await expect(service.generateNotionConversation(db,d.link.id,r,controller.signal)).rejects.toBeTruthy();expect(mocks.call).toHaveBeenCalledTimes(1);expect(await db.select().from(schemas.contentRevisions)).toHaveLength(1);
 });
 it('discards a proposal made with an outdated production profile',async()=>{
  const d=await imported(),r=requestOf(d);mocks.call.mockImplementationOnce(async()=>{
   const profile=await service.getNotionProductionProfile(db,d.link.id);await service.saveNotionProductionProfile(db,d.link.id,{...profile,profile:{...profile.profile,voice:'방금 고친 말투'}},'test');
   return {ok:true,data:{patch:{title:'새 제목',body:'새 문장',emphasis:''},summary:'다듬었어요.'}};
  });
  await expect(service.generateNotionConversation(db,d.link.id,r)).rejects.toMatchObject({status:409,extra:{code:'production_profile_changed'}});expect(await db.select().from(schemas.contentRevisions)).toHaveLength(1);
 });
 it('uses operator authentication and CSRF for conversation and profile writes',async()=>{
  const d=await imported(),r=requestOf(d),{agent,csrf}=await login(app);
  expect((await agent.post(`/api/notion/links/${d.link.id}/conversation`).send(r)).status).toBe(403);
  const response=await agent.post(`/api/notion/links/${d.link.id}/conversation`).set('x-csrf-token',csrf).send(r);expect(response.status).toBe(200);expect(response.body.page).toBe(1);expect(response.headers['cache-control']).toContain('no-store');
  expect((await agent.put(`/api/notion/links/${d.link.id}/production-profile`).send({version:0,profile:defaultNotionProductionProfile()})).status).toBe(403);
 });
 it('honors the global stop before any billable model request',async()=>{
  const d=await imported();await db.insert(schemas.appSettings).values({key:'global_stop',value:true}).onConflictDoUpdate({target:schemas.appSettings.key,set:{value:true}});
  await expect(service.generateNotionConversation(db,d.link.id,requestOf(d))).rejects.toMatchObject({status:409,extra:{code:'notion_conversation_global_stop'}});
  expect(mocks.call).not.toHaveBeenCalled();expect(await db.select().from(schemas.contentRevisions)).toHaveLength(1);
  expect(await db.select().from(schemas.auditLogs).where(eq(schemas.auditLogs.action,'notion_conversation_proposal'))).toHaveLength(0);
 });
 it('reads only the selected photo bytes and no photo bytes for a text-only preview',async()=>{
  const initial=await imported(),bytes=await sharp({create:{width:30,height:40,channels:3,background:'#72A7FF'}}).png().toBuffer();
  const [unused,selected]=await db.insert(schemas.notionSyncPhotos).values([
   {linkId:initial.link.id,sourceKey:'unselected',name:'선택하지 않은 사진.png',mimeType:'image/png',bytes:Buffer.from('unselected binary must not be decoded'),sha256:'b'.repeat(64),width:30,height:40},
   {linkId:initial.link.id,sourceKey:'selected',name:'선택한 사진.png',mimeType:'image/png',bytes,sha256:'c'.repeat(64),width:30,height:40},
  ]).returning();
  await db.update(schemas.notionSyncLinks).set({photoOrder:[unused.id,selected.id]}).where(eq(schemas.notionSyncLinks.id,initial.link.id));
  const d=await studio.notionStudioDetail(db,initial.link.id),pool=(await import('../server/db')).getPool(),query=vi.spyOn(pool,'query');
  const photoQueries=()=>query.mock.calls.map(args=>{const config=args[0] as unknown as string|{text?:string};return {sql:typeof config==='string'?config:config.text??'',values:args[1]};}).filter(q=>q.sql.includes('from "notion_sync_photos"'));
  const preview=(await import('../server/services/notionStudioCanva')).previewNotionStudioCard;
  const input={version:d.link.version,itemVersion:d.itemVersion,copy:d.copy,designEdits:{emphasisByPage:{},templateByPage:{h2:'image_text' as const,h3:'text' as const},photoByPage:{h2:selected.id}},page:1};
  try{
   const image=await preview(db,d.link.id,input);expect(await sharp(image).metadata()).toMatchObject({width:1080,height:1350});
   const imageQueries=photoQueries();expect(imageQueries).toHaveLength(2);expect(imageQueries[0].sql).not.toContain('"bytes"');expect(imageQueries[1].sql).toContain('"bytes"');expect(imageQueries[1].values).toEqual([d.link.id,selected.id]);
   query.mockClear();await preview(db,d.link.id,{...input,page:2});const textQueries=photoQueries();expect(textQueries).toHaveLength(1);expect(textQueries[0].sql).not.toContain('"bytes"');
  }finally{query.mockRestore();}
 });
});

describe('Notion channel production profile',()=>{
 it('persists one channel profile across manuscripts and rejects a stale concurrent write',async()=>{
  const d=await imported(),initial=await service.getNotionProductionProfile(db,d.link.id);expect(initial.version).toBe(0);expect(initial.profile.referenceDesignUrl).toContain('DAHafIuAd5c');
  const saved=await service.saveNotionProductionProfile(db,d.link.id,{version:0,profile:{...initial.profile,voice:'내가 쓴 경험담처럼 편하게ㅎㅎ.'}},'test');expect(saved.version).toBe(1);
  doc={...doc,pageId:'4135c7c8-45fc-8101-ba1c-000000008002',sourceHash:'b'.repeat(64)};const second=await imported();expect(await service.getNotionProductionProfile(db,second.link.id)).toEqual(saved);
  await expect(service.saveNotionProductionProfile(db,d.link.id,{version:0,profile:initial.profile},'test')).rejects.toMatchObject({status:409,extra:{code:'production_profile_changed'}});
  expect(await service.getNotionProductionProfile(db,d.link.id)).toEqual(saved);expect(await db.select().from(schemas.contentRevisions)).toHaveLength(2);
 });
 it('bounds profile, conversation history and generated fields without breaking emoji',()=>{
  expect(notionProductionProfileSchema.safeParse({...defaultNotionProductionProfile(),referenceDesignUrl:'https://attacker.invalid/'}).success).toBe(false);
  expect(notionProductionProfileSchema.safeParse({...defaultNotionProductionProfile(),referenceText:'가'.repeat(6001)}).success).toBe(false);
  const copy={version:1 as const,templateKey:'builtin:classic',cover:{title:'표지',subtitle:''},pages:[{id:'body-1',title:'제목',subtitle:'',body:'본문'}]},r={version:1,itemVersion:1,copy,designEdits:{emphasisByPage:{}},page:1,instruction:'🍨'.repeat(2000)};
  expect(notionConversationRequestSchema.safeParse(r).success).toBe(true);expect(notionConversationRequestSchema.safeParse({...r,instruction:'🍨'.repeat(2001)}).success).toBe(false);
  expect(notionConversationRequestSchema.safeParse({...r,history:Array.from({length:7},()=>({role:'user',text:'다듬어줘'}))}).success).toBe(false);
 });
});
