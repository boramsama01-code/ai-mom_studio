/** Isolated PostgreSQL; provider calls are mocked and no production data is read. */
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {HIGH_SCOOP_TEMPLATE_KITS} from '../shared/highscoopTemplates';
import {DEFAULT_BUDGET} from '../shared/domain';
import {channels,contentItems,contentRevisions} from '../shared/schema';
import type {NotionDocument} from '../shared/notionSync';
import {resetDb,setTestEnv} from './helpers';

const url=process.env.TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test'))throw new Error('Explicit loopback PostgreSQL TEST_DATABASE_URL ending _test is required');
setTestEnv();
const provider=vi.hoisted(()=>({fetch:vi.fn(),patch:vi.fn(),build:vi.fn(),submit:vi.fn(),poll:vi.fn()}));
vi.mock('../server/services/notionClient',async original=>({...await original<object>(),fetchNotionDocument:provider.fetch,patchNotionDocumentProperties:provider.patch}));
vi.mock('../server/services/notionCanva',async original=>({...await original<object>(),buildNotionCanvaPptx:provider.build,submitNotionCanvaImport:provider.submit,getNotionCanvaImportJob:provider.poll}));
const {getDb,closeDb}=await import('../server/db');
const {importNotionStudio,saveNotionStudioDraft,pullNotionStudio}=await import('../server/services/notionStudio');
const {createNotionStudioCanva}=await import('../server/services/notionStudioCanva');
let doc:NotionDocument,highscoopId:number;
const db=getDb();
beforeAll(async()=>{await resetDb();highscoopId=(await db.select().from(channels)).find(channel=>channel.slug==='opportunities')!.id;});
beforeEach(()=>{
 for(const mock of Object.values(provider))mock.mockReset();
 const pageId=randomUUID();
 doc={pageId,url:`https://www.notion.so/${pageId}`,lastEditedAt:'2026-11-13T00:00:00.000Z',contentKey:'category-regression',title:'새 원고',coverTitle:'표지 제목',channel:'HighScoop',category:'영재원',template:'',stage:'원고 검토',verified:true,caption:'캡션',sourceHash:'a'.repeat(64),photos:[],pages:[{index:1,title:'원고 표지',body:'표지 설명',headingBlockId:'h1',bodyBlockIds:['b1']},{index:2,title:'내지 제목',body:'내 아이의 생각을 들어보세요.',headingBlockId:'h2',bodyBlockIds:['b2']}]};
 provider.fetch.mockImplementation(async()=>structuredClone(doc));provider.patch.mockResolvedValue(undefined);
 provider.build.mockResolvedValue({bytes:Buffer.from('mock editable PPTX'),sourcePageCount:2,pageCount:3,width:1080,height:1350,warnings:[]});
 provider.submit.mockResolvedValue({id:'job_'+pageId,status:'in_progress'});
 provider.poll.mockResolvedValue({id:'job_'+pageId,status:'in_progress'});
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Live provider calls prohibited');}));
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
afterAll(closeDb);
const imported=(channelId=highscoopId)=>importNotionStudio(db,{pageId:doc.pageId,channelId,expectedSourceHash:doc.sourceHash,coverStyle:'A'},'category-test');
const save=(detail:Awaited<ReturnType<typeof imported>>,templateKey:string)=>saveNotionStudioDraft(db,detail.link.id,{version:detail.link.version,itemVersion:detail.itemVersion,copy:{...detail.copy,templateKey},designEdits:{emphasisByPage:{}}},'category-test');

describe('HighScoop category selection across Notion and native Canva output',()=>{
 it.each(HIGH_SCOOP_TEMPLATE_KITS)('uses the channel default for a newly imported $category manuscript',async kit=>{
  await db.update(channels).set({cardTemplate:kit.key}).where(eq(channels.id,highscoopId));
  const detail=await imported();
  expect(detail.copy.templateKey).toBe(kit.key);expect(detail.copy.pages[0].body).toBe(doc.pages[1].body);
  await createNotionStudioCanva(db,detail.link.id,{version:detail.link.version,itemVersion:detail.itemVersion},'category-test');
  expect(provider.build.mock.calls[0][0]).toMatchObject({category:kit.category,categoryColor:kit.color,coverStyle:'A'});
 });

 it('supports a HighScoop name with a nonstandard slug consistently through saving and export',async()=>{
  const [channel]=await db.insert(channels).values({slug:'highscoop-special-'+randomUUID(),name:'HighScoop · 특집',contentType:'notice',accentColor:'#BAA0FF',cardTemplate:'highscoop:competition',budget:DEFAULT_BUDGET}).returning();
  const detail=await imported(channel.id);expect(detail.link.canvaAutoSaveSupported).toBe(true);expect(detail.copy.templateKey).toBe('highscoop:competition');
  const changed=await save(detail,'highscoop:conversation');
  await createNotionStudioCanva(db,changed.link.id,{version:changed.link.version,itemVersion:changed.itemVersion},'category-test');
  expect(provider.build.mock.calls[0][0]).toMatchObject({category:'말풍선',categoryColor:'#FFD166'});expect(provider.submit).toHaveBeenCalledTimes(1);
 });

 it('keeps an existing user-selected master when the channel default changes, on reimport and pull',async()=>{
  await db.update(channels).set({cardTemplate:'highscoop:news'}).where(eq(channels.id,highscoopId));
  const first=await imported(),selected=await save(first,'highscoop:experience');
  await db.update(channels).set({cardTemplate:'highscoop:admissions'}).where(eq(channels.id,highscoopId));
  const reopened=await imported();expect(reopened.link.id).toBe(first.link.id);expect(reopened.copy.templateKey).toBe('highscoop:experience');
  doc.sourceHash='b'.repeat(64);doc.pages[1].body='노션에서 새로 쓴 본문';
  const pulled=await pullNotionStudio(db,selected.link.id,{version:reopened.link.version,itemVersion:reopened.itemVersion,expectedSourceHash:doc.sourceHash,resolveConflict:false},'category-test');
  expect(pulled.copy.templateKey).toBe('highscoop:experience');expect(pulled.copy.pages[0].body).toBe(doc.pages[1].body);
 });

 it('does not change another brand default or allow it to adopt the HighScoop export path',async()=>{
  const [channel]=await db.insert(channels).values({slug:'other-brand-'+randomUUID(),name:'Fryday · 테스트',contentType:'notice',accentColor:'#BD742B',cardTemplate:'builtin:minimal',budget:DEFAULT_BUDGET}).returning();
  const detail=await imported(channel.id);expect(detail.copy.templateKey).toBe('builtin:classic');expect(detail.link.canvaAutoSaveSupported).toBe(false);
  await expect(save(detail,'highscoop:news')).rejects.toMatchObject({status:422});
  await expect(createNotionStudioCanva(db,detail.link.id,{version:detail.link.version,itemVersion:detail.itemVersion},'category-test')).rejects.toMatchObject({status:422});
  expect(provider.build).not.toHaveBeenCalled();expect(provider.submit).not.toHaveBeenCalled();
  expect((await db.select().from(channels).where(eq(channels.id,channel.id)))[0].cardTemplate).toBe('builtin:minimal');
  const [item]=await db.select().from(contentItems).where(eq(contentItems.id,detail.link.itemId));
  expect((await db.select().from(contentRevisions).where(eq(contentRevisions.id,item.currentRevisionId!)))[0].payload.cardCopy).toEqual(detail.copy);
 });
});
