import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { approvals, channels, contentItems, contentRevisions, mediaAssets, studioCards, studioMedia, studioRevisions } from '../shared/schema';
import { emptyStudioCard } from '../shared/studio';
import { emptyExperience } from '../shared/experience';
import { emptyVideoProject } from '../shared/videoProject';
import { emptyPayload } from '../shared/payloads';
import { login, resetDb, setTestEnv } from './helpers';

const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test')) throw new Error('Assets tests require explicit TEST_DATABASE_URL ending in _test.');
setTestEnv();
const { getDb, getPool, closeDb } = await import('../server/db');
const { createApp } = await import('../server/app');
const app = createApp(), db = getDb();
const outbound = vi.fn(() => { throw new Error('Asset discovery must not call an external service.'); });
const fixedDate = new Date('2026-10-01T12:00:00Z');
beforeAll(async () => { await resetDb(); vi.stubGlobal('fetch', outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function channel() {
  const [row] = await db.insert(channels).values({slug:`asset-${randomUUID()}`,name:'자산 테스트',contentType:'current_dialogue',accentColor:'#334455',
    budget:{naverCallsPerRun:0,resultsPerRun:0,fetchTargetsPerRun:0,fetchCallsPerRun:0,llmCallsPerRun:0,dailyPublishLimit:0}}).returning();
  return row;
}
async function image(ch:Awaited<ReturnType<typeof channel>>,status='active',title='승인 이미지') {
  const [item] = await db.insert(contentItems).values({channelId:ch.id,kind:'notice',origin:'manual',title}).returning();
  const [revision] = await db.insert(contentRevisions).values({contentItemId:item.id,revisionNo:1,author:'operator',payload:emptyPayload('notice',title)}).returning();
  await db.update(contentItems).set({currentRevisionId:revision.id}).where(eq(contentItems.id,item.id));
  const bytes=Buffer.from(`immutable-approved-image-${randomUUID()}`);
  const [asset] = await db.insert(mediaAssets).values({channelId:ch.id,contentItemId:item.id,revisionId:revision.id,sha256:digest(bytes),bytes,width:1080,height:1350,createdAt:fixedDate}).returning();
  const [approval] = await db.insert(approvals).values({channelId:ch.id,contentItemId:item.id,revisionId:revision.id,mediaAssetId:asset.id,cardSha256:asset.sha256,
    status,captions:{instagram:'승인 캡션',telegram:''},approvedBy:'test-operator',scheduledAt:new Date('2030-01-01T00:00:00Z')}).returning();
  return{item,revision,asset,approval};
}
async function video(ch:Awaited<ReturnType<typeof channel>>,reference=true) {
  const content={...emptyStudioCard(),title:'저장 영상',channel:ch.slug,format:'릴스' as const,experience:emptyExperience(),videoProject:emptyVideoProject()};
  const [card] = await db.insert(studioCards).values({content}).returning();
  const bytes=Buffer.from('private-video-body-must-not-appear-in-library'.repeat(300));
  const preview=Buffer.from('saved-jpeg-poster');
  const [media] = await db.insert(studioMedia).values({cardId:card.id,name:'내 영상.mp4',kind:'video',mimeType:'video/mp4',bytes,preview,createdAt:fixedDate}).returning();
  if(reference){content.experience.media=[{id:media.id,note:''}];content.videoProject.outputMediaId=media.id;}
  await db.update(studioCards).set({content}).where(eq(studioCards.id,card.id));
  const [revision] = await db.insert(studioRevisions).values({cardId:card.id,version:1,snapshot:content,instruction:'실제 저장한 영상 선택'}).returning();
  return{card,media,revision,content,bytes,preview};
}
async function list(ch:number,query='') {
  const {agent}=await login(app);
  const response=await agent.get(`/api/assets/library?channelId=${ch}${query}`);
  expect(response.status,JSON.stringify(response.body)).toBe(200);
  return response.body;
}

describe('bounded, authenticated immutable asset discovery on PostgreSQL',()=>{
  it('requires the ordinary operator session for listing, posters and exact old revisions',async()=>{
    for(const url of ['/api/assets/library','/api/assets/library/videos/1/preview','/api/studio/cards/1/revisions/1']) expect((await request(app).get(url)).status).toBe(401);
  });
  it('rejects malformed filters, unknown keys, duplicate values and unbounded pages',async()=>{
    const{agent}=await login(app);
    for(const query of ['kind=audio','view=approved','limit=0','limit=41','offset=-1','offset=1001','offset=1.5','channelId=0','q='+ 'x'.repeat(101),'unknown=value','kind=image&kind=video']){
      expect((await agent.get('/api/assets/library?'+query)).status,query).toBe(400);
    }
    expect((await agent.get('/api/assets/library?channelId=999999')).status).toBe(404);
  });
  it('lists only the latest matching real approval per image and retains exact approval provenance',async()=>{
    const ch=await channel(),f=await image(ch);
    await db.insert(approvals).values({...f.approval,id:undefined,status:'completed',approvedBy:'second-operator'});
    const response=await list(ch.id);
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({key:`image:${f.asset.id}`,kind:'image',assetId:f.asset.id,current:true,sha256:f.asset.sha256,
      approval:{status:'completed',approvedBy:'second-operator'},source:{itemId:f.item.id,sourceRevisionId:f.revision.id,sourceRevisionNo:1,studioRevisionId:null},
      currentPreview:{assetId:f.asset.id,sourceRevisionId:f.revision.id,approvalStatus:'completed'}});
    expect(response.items[0].historyUrl).toBe(`/items/${ch.id}/${f.item.id}?tab=history&revision=${f.revision.id}`);
  });
  it('does not mistake an unapproved current output for a historical approved image',async()=>{
    const ch=await channel(),f=await image(ch,'completed');
    const [revision]=await db.insert(contentRevisions).values({contentItemId:f.item.id,revisionNo:2,author:'operator',payload:emptyPayload('notice','새 원고')}).returning();
    const [current]=await db.insert(mediaAssets).values({channelId:ch.id,contentItemId:f.item.id,revisionId:revision.id,sha256:'c'.repeat(64),bytes:Buffer.from('current draft'),width:1080,height:1350}).returning();
    await db.update(contentItems).set({currentRevisionId:revision.id,version:2}).where(eq(contentItems.id,f.item.id));
    expect((await list(ch.id)).items).toEqual([]);
    const response=await list(ch.id,'&view=history');
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({assetId:f.asset.id,current:false,approval:{status:'completed'},currentPreview:{assetId:current.id,sourceRevisionId:revision.id,approvalStatus:null}});
  });
  it.each(['invalidated','cancelled'])('keeps %s approval evidence in history without calling it currently approved',async status=>{
    const ch=await channel(),f=await image(ch,status);
    expect((await list(ch.id)).items).toEqual([]);
    const result=await list(ch.id,'&view=history');
    expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({assetId:f.asset.id,current:true,approval:{status},currentPreview:{approvalStatus:status}});
  });
  it('retains a historical approved image when no current revision or artifact is available',async()=>{
    const ch=await channel(),f=await image(ch,'completed');
    await db.update(contentItems).set({currentRevisionId:null}).where(eq(contentItems.id,f.item.id));
    expect((await list(ch.id)).items).toEqual([]);
    expect((await list(ch.id,'&view=history')).items[0]).toMatchObject({assetId:f.asset.id,current:false,currentPreview:null,approval:{status:'completed'}});
  });
  it('excludes forged cross-revision/hash approvals and metadata outside active content scope',async()=>{
    const ch=await channel(),good=await image(ch),bad=await image(ch),excluded=await image(ch),sample=await image(ch),trashed=await image(ch);
    await db.update(approvals).set({cardSha256:'wrong-hash'}).where(eq(approvals.id,bad.approval.id));
    await db.update(contentItems).set({excluded:true}).where(eq(contentItems.id,excluded.item.id));
    await db.update(contentItems).set({isSample:true}).where(eq(contentItems.id,sample.item.id));
    await db.insert(studioCards).values({sourceItemId:trashed.item.id,content:{...emptyStudioCard(),channel:ch.slug},trashedAt:new Date()});
    expect((await list(ch.id,'&view=all')).items.map((row:any)=>row.assetId)).toEqual([good.asset.id]);
    await db.update(channels).set({active:false}).where(eq(channels.id,ch.id));
    const{agent}=await login(app);expect((await agent.get(`/api/assets/library?channelId=${ch.id}`)).status).toBe(404);
    expect((await agent.get('/api/assets/library?view=all')).body.items.some((row:any)=>row.channelId===ch.id)).toBe(false);
  });
  it('uses literal text search and stable combined type/id pagination at equal timestamps',async()=>{
    const ch=await channel(),f=await image(ch,'active','실제%_문자'),v=await video(ch);
    await image(ch,'active','실제ZZ문자');
    expect((await list(ch.id,'&q=%25_')).items.map((row:any)=>row.assetId)).toEqual([f.asset.id]);
    const first=await list(ch.id,'&limit=1');const second=await list(ch.id,'&limit=1&offset=1');const third=await list(ch.id,'&limit=1&offset=2');
    expect(first.hasMore).toBe(true);expect(first.nextOffset).toBe(1);expect(second.nextOffset).toBe(2);expect(third.nextOffset).toBeNull();
    expect(new Set([first.items[0].key,second.items[0].key,third.items[0].key]).size).toBe(3);
    expect(third.items[0].key).toBe(`video:${v.media.id}`);
    expect((await list(ch.id,'&kind=video')).items.map((row:any)=>row.kind)).toEqual(['video']);
  });
  it('never advertises a next offset rejected by the bounded API while truthfully retaining hasMore',async()=>{
    const ch=await channel(),f=await image(ch);
    const rows=await db.insert(mediaAssets).values(Array.from({length:1009},(_,index)=>({channelId:ch.id,contentItemId:f.item.id,revisionId:f.revision.id,
      sha256:digest(Buffer.from(`bounded-page-${f.item.id}-${index}`)),bytes:Buffer.from('x'),width:1,height:1}))).returning({id:mediaAssets.id,sha256:mediaAssets.sha256});
    await db.insert(approvals).values(rows.map(row=>({channelId:ch.id,contentItemId:f.item.id,revisionId:f.revision.id,mediaAssetId:row.id,cardSha256:row.sha256,
      captions:{instagram:'보존할 승인',telegram:''},approvedBy:'test',scheduledAt:new Date('2030-01-01T00:00:00Z')})));
    const earlier=await list(ch.id,'&kind=image&offset=960&limit=24');expect(earlier.hasMore).toBe(true);expect(earlier.nextOffset).toBe(984);
    const last=await list(ch.id,'&kind=image&offset=984&limit=24');expect(last.items).toHaveLength(24);expect(last.hasMore).toBe(true);expect(last.nextOffset).toBeNull();
  });
  it('shows only actually referenced saved videos, with no invented publication approval or usage',async()=>{
    const ch=await channel(),f=await video(ch),orphan=await video(ch,false);
    const [unapplied]=await db.insert(studioMedia).values({cardId:orphan.card.id,name:'미채택 영상',kind:'video',mimeType:'video/mp4',bytes:Buffer.from('unapplied')}).returning();
    await db.insert(studioRevisions).values({cardId:orphan.card.id,version:2,snapshot:{...orphan.content,videoProject:{...emptyVideoProject(),outputMediaId:unapplied.id}},applied:false});
    const result=await list(ch.id,'&kind=video');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({assetId:f.media.id,approval:null,sha256:null,current:true,source:{sourceRevisionId:null,studioRevisionId:f.revision.id,studioVersion:1},
      previewUrl:`/api/assets/library/videos/${f.media.id}/preview`,currentPreview:{assetId:f.media.id,approvalStatus:null,studioVersion:1}});
    expect(result.items[0].historyUrl).toBe(`/studio/${f.card.id}?tab=history&revision=${f.revision.id}`);
    expect(JSON.stringify(result)).not.toContain('private-video-body');
  });
  it('pins a historical video to its actual applied revision, never the current version or an old current-artifact fallback',async()=>{
    const ch=await channel(),f=await video(ch);
    const next={...f.content,experience:emptyExperience(),videoProject:emptyVideoProject()};
    await db.update(studioCards).set({content:next,version:2}).where(eq(studioCards.id,f.card.id));
    await db.insert(studioRevisions).values({cardId:f.card.id,version:2,snapshot:next});
    expect((await list(ch.id,'&kind=video')).items).toEqual([]);
    expect((await list(ch.id,'&kind=video&view=history')).items[0]).toMatchObject({assetId:f.media.id,current:false,currentPreview:null,source:{studioRevisionId:f.revision.id,studioVersion:1,currentVersion:2}});
  });
  it('links Studio-authored approved images only to the exact actual Studio revision',async()=>{
    const ch=await channel(),f=await image(ch);
    const content={...emptyStudioCard(),channel:ch.slug};
    const [card]=await db.insert(studioCards).values({content,sourceItemId:f.item.id}).returning();
    const [revision]=await db.insert(studioRevisions).values({cardId:card.id,version:1,snapshot:content}).returning();
    await db.update(contentItems).set({origin:'studio'}).where(eq(contentItems.id,f.item.id));
    await db.update(contentRevisions).set({payload:{title:'출력',studioCardId:card.id,studioVersion:1}}).where(eq(contentRevisions.id,f.revision.id));
    const current=(await list(ch.id)).items[0];
    expect(current.source.studioRevisionId).toBe(revision.id);expect(current.historyUrl).toBe(`/studio/${card.id}?tab=history&revision=${revision.id}`);
    await db.update(studioCards).set({version:2}).where(eq(studioCards.id,card.id));
    const historical=(await list(ch.id,'&view=history')).items[0];
    expect(historical.current).toBe(false);expect(historical.currentPreview).toBeNull();
  });
  it('fetches an exact Studio revision beyond60 with strict owner scope and no mutation',async()=>{
    const ch=await channel(),f=await video(ch),other=await video(ch);
    for(let version=2;version<=63;version++)await db.insert(studioRevisions).values({cardId:f.card.id,version,snapshot:{...f.content,title:`버전${version}`}});
    const{agent}=await login(app),url=`/api/studio/cards/${f.card.id}/revisions/${f.revision.id}`;
    const response=await agent.get(url);expect(response.status).toBe(200);expect(response.body).toMatchObject({id:f.revision.id,cardId:f.card.id,version:1,snapshot:f.content});
    expect((await agent.get(`/api/studio/cards/${other.card.id}/revisions/${f.revision.id}`)).status).toBe(404);
    expect((await agent.get(`/api/studio/cards/${f.card.id}/revisions/9999999`)).status).toBe(404);
    expect((await db.select().from(studioCards).where(eq(studioCards.id,f.card.id)))[0].version).toBe(1);
    await db.update(studioCards).set({trashedAt:new Date()}).where(eq(studioCards.id,f.card.id));expect((await agent.get(url)).status).toBe(404);
  });
  it('projects metadata without bodies and serves a poster without selecting video bytes',async()=>{
    const ch=await channel(),f=await video(ch);await image(ch);const{agent}=await login(app);
    const spy=vi.spyOn(getPool(),'query');
    try{
      const result=await agent.get(`/api/assets/library?channelId=${ch.id}`);expect(result.status,JSON.stringify(result.body)).toBe(200);
      const statements=spy.mock.calls.map(call=>typeof call[0]==='string'?call[0]:(call[0] as {text?:string})?.text??'').filter(Boolean);
      expect(statements.length).toBeGreaterThanOrEqual(3);
      for(const statement of statements){expect(statement).not.toMatch(/\bselect\s+(?:[a-z_]+\.)?\*/i);expect(statement).not.toMatch(/\b(?:media|current_media|latest)\.bytes\b/i);}
      expect(JSON.stringify(result.body).length).toBeLessThan(20000);expect(JSON.stringify(result.body)).not.toContain(f.bytes.toString());
      spy.mockClear();const poster=await agent.get(`/api/assets/library/videos/${f.media.id}/preview`);
      expect(poster.status).toBe(200);expect(poster.body).toEqual(f.preview);
      const posterSql=spy.mock.calls.map(call=>typeof call[0]==='string'?call[0]:(call[0] as {text?:string})?.text??'').find(value=>value.includes('select media.preview'));
      expect(posterSql).toBeDefined();expect(posterSql).not.toMatch(/\.bytes\b/);
    }finally{spy.mockRestore();}
    await db.update(channels).set({active:false}).where(eq(channels.id,ch.id));expect((await agent.get(`/api/assets/library/videos/${f.media.id}/preview`)).status).toBe(404);
  });
  it('preserves approved original bytes and approval snapshots when existing manuscript restoration creates a new draft',async()=>{
    const ch=await channel(),f=await image(ch,'completed');
    const [next]=await db.insert(contentRevisions).values({contentItemId:f.item.id,revisionNo:2,author:'operator',payload:emptyPayload('notice','新 원고')}).returning();
    await db.update(contentItems).set({currentRevisionId:next.id,version:2}).where(eq(contentItems.id,f.item.id));
    const{agent,csrf}=await login(app);
    await agent.get(`/api/assets/library?channelId=${ch.id}&view=history`);
    const restored=await agent.post(`/api/channels/${ch.id}/items/${f.item.id}/revisions/${f.revision.id}/restore`).set('x-csrf-token',csrf).send({version:2});
    expect(restored.status,JSON.stringify(restored.body)).toBe(200);expect(restored.body.item.version).toBe(3);expect(restored.body.revision.id).not.toBe(f.revision.id);
    expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id,f.asset.id)))[0]).toEqual(f.asset);
    const [approval]=await db.select().from(approvals).where(eq(approvals.id,f.approval.id));
    expect(approval.captions).toEqual(f.approval.captions);expect(approval.cardSha256).toBe(f.approval.cardSha256);expect(approval.status).not.toBe('active');
    expect((await list(ch.id)).items).toEqual([]);
    const original=await agent.get(`/api/channels/${ch.id}/media/${f.asset.id}?download=1`);expect(original.body).toEqual(f.asset.bytes);
  });
});
