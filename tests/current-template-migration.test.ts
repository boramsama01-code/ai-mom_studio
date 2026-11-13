import fs from 'node:fs/promises';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {login,resetDb,setTestEnv} from './helpers';
setTestEnv();
const {getDb,getPool,closeDb}=await import('../server/db');
const {createApp}=await import('../server/app');
const {channels,contentItems}=await import('../shared/schema');
const {creativeProfileFor}=await import('../shared/creativeProfile');
const {eq}=await import('drizzle-orm');
beforeAll(resetDb);afterAll(closeDb);

describe('current channel defaults migration',()=>{
 it('changes future defaults while preserving brand guides and saved legacy copy, idempotently',async()=>{
  const db=getDb(),[channel]=await db.select().from(channels).where(eq(channels.slug,'current-dialogue'));
  const profile={...creativeProfileFor(channel),defaultTemplate:'set:n03' as const,tone:'운영자가 지정한 말투'};
  await db.update(channels).set({cardTemplate:'cardnews14-cinematic-v1',creativeProfile:profile,accentColor:'#57C7E3'}).where(eq(channels.id,channel.id));
  const legacy={cardCopy:{version:1,templateKey:'set:n03',cover:{title:'원래 표지',subtitle:''},pages:[{id:'body-1',title:'원래 내지',subtitle:'',body:'원고와 근거를 그대로 보존'}]},sourceIds:[11,12]};
  const [item]=await db.insert(contentItems).values({channelId:channel.id,kind:'current_dialogue',title:'저장된 원고',edited:legacy}).returning();
  const sql=await fs.readFile('migrations/0029_shared_current_templates.sql','utf8');
  await getPool().query(sql);
  const [changed]=await db.select().from(channels).where(eq(channels.id,channel.id));
  expect(changed.cardTemplate).toBe('editorial:cyan');
  expect(changed.creativeProfile).toEqual({...profile,defaultTemplate:'editorial:cyan'});
  expect((await db.select().from(contentItems).where(eq(contentItems.id,item.id)))[0].edited).toEqual(legacy);
  await getPool().query(sql);
  expect((await db.select().from(channels).where(eq(channels.id,channel.id)))[0].version).toBe(changed.version);
 });
 it('initializes a newly created channel with a selectable current color',async()=>{
  const {agent,csrf}=await login(createApp());
  const response=await agent.post('/api/channels').set('x-csrf-token',csrf).send({name:'새로운 채널',slug:'new-current-channel',accentColor:'#BAA0FF'});
  expect(response.status).toBe(201);expect(response.body.cardTemplate).toBe('editorial:purple');
 });
 it('moves only future News presentation defaults to cyan, preserving source topics and copy',async()=>{
  const db=getDb(),[channel]=await db.select().from(channels).where(eq(channels.slug,'current-dialogue'));
  const profile={...creativeProfileFor(channel),defaultTemplate:'editorial:blue' as const,tone:'저장한 말투'};
  await db.update(channels).set({cardTemplate:'editorial:blue',creativeProfile:profile,categories:['과학','사회']}).where(eq(channels.id,channel.id));
  const copyBefore=await db.select().from(contentItems).where(eq(contentItems.channelId,channel.id));
  const sql=await fs.readFile('migrations/0030_single_news_master.sql','utf8');await getPool().query(sql);
  const [changed]=await db.select().from(channels).where(eq(channels.id,channel.id));
  expect(changed.cardTemplate).toBe('editorial:cyan');expect(changed.creativeProfile).toEqual({...profile,defaultTemplate:'editorial:cyan'});
  expect(changed.categories).toEqual(['과학','사회']);
  expect(await db.select().from(contentItems).where(eq(contentItems.channelId,channel.id))).toEqual(copyBefore);
  await getPool().query(sql);expect((await db.select().from(channels).where(eq(channels.id,channel.id)))[0].version).toBe(changed.version);
 });
});
