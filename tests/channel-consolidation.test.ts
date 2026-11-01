import { afterAll,beforeAll,describe,it,expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { login,resetDb,setTestEnv } from "./helpers";
setTestEnv();
const {getDb,closeDb}=await import("../server/db");
const {createApp}=await import("../server/app");
const {consolidateAlligodang}=await import("../server/services/channelConsolidation");
const {seedIdeaBank}=await import("../server/services/ideaBank");
const {itemPrimarySource}=await import("../server/services/itemSources");
const {orderedChannels}=await import("../server/services/channelOrder");
const {channels,contentItems,contentRevisions,contentSources,sourceDocuments,searchRules}=await import("../shared/schema");
beforeAll(resetDb);afterAll(closeDb);
describe("Alligodang consolidation and idea inbox",()=>{
  it("retains overlapping drafts, private pasted sources, rules, revisions and old links",async()=>{
    const db=getDb();const all=await db.select().from(channels); const old=all.find(c=>c.slug==="science-dialogue")!, target=all.find(c=>c.slug==="current-dialogue")!;
    const [source]=await db.insert(sourceDocuments).values({normalizedUrl:"https://example.com/shared",originalUrl:"https://example.com/shared",kind:"manual",title:"공통 원문"}).returning();
    const [manual]=await db.insert(sourceDocuments).values({normalizedUrl:"manual:private",originalUrl:"manual:private",kind:"manual_text",title:"직접 보완",fetchedText:"보존해야 할 본문"}).returning();
    const [a,b]=await db.insert(contentItems).values([{channelId:old.id,kind:"science_dialogue",title:"과학 관점",primarySourceId:source.id},{channelId:target.id,kind:"current_dialogue",title:"사회 관점",primarySourceId:source.id}]).returning();
    const [rev]=await db.insert(contentRevisions).values({contentItemId:a.id,revisionNo:1,author:"human",payload:{title:"사용자가 작성한 원고"}}).returning();
    await db.update(contentItems).set({currentRevisionId:rev.id}).where(eq(contentItems.id,a.id));
    await db.insert(contentSources).values({contentItemId:a.id,sourceDocumentId:manual.id,role:"manual_primary"});
    await db.insert(searchRules).values([{channelId:old.id,query:"중복 키워드",normalizedQuery:"중복 키워드",endpoint:"news"},{channelId:target.id,query:"중복 키워드",normalizedQuery:"중복 키워드",endpoint:"news"}]);
    expect(await consolidateAlligodang(db)).toBe(true);expect(await consolidateAlligodang(db)).toBe(false);
    const moved=(await db.select().from(contentItems).where(eq(contentItems.id,a.id)))[0];
    expect(moved).toMatchObject({channelId:target.id,currentRevisionId:rev.id,primarySourceId:null,kind:"science_dialogue"});
    expect((await itemPrimarySource(db,moved))?.fetchedText).toBe("보존해야 할 본문");
    expect((await db.select().from(contentSources).where(eq(contentSources.contentItemId,a.id))).some(x=>x.sourceDocumentId===source.id&&x.role==="merged_primary")).toBe(true);
    expect((await db.select().from(contentItems).where(eq(contentItems.id,b.id)))[0].primarySourceId).toBe(source.id);
    expect((await orderedChannels(db))[0].slug).toBe("penguin");
    expect((await orderedChannels(db)).some(c=>c.id===old.id)).toBe(false);
    expect((await db.select().from(channels).where(eq(channels.id,old.id)))[0].active).toBe(false);
    const {agent}=await login(createApp());const detail=await agent.get(`/api/channels/${old.id}/items/${a.id}`);expect(detail.status).toBe(200);expect(detail.body.item.channelId).toBe(target.id);expect(detail.body.current.payload.title).toBe("사용자가 작성한 원고");
    // Removing a pasted override still reveals the original overlapping source.
    await db.delete(contentSources).where(eq(contentSources.sourceDocumentId,manual.id));expect((await itemPrimarySource(db,moved))?.id).toBe(source.id);
  });
  it("seeds each 100 once and imports a complete idea in the correct format",async()=>{
    const db=getDb();const [web]=await db.insert(channels).values({slug:"custom-webtoon",name:"제목 미정(웹툰)",contentType:"manual",accentColor:"#466051",budget:{naverCallsPerRun:0,resultsPerRun:0,fetchTargetsPerRun:0,fetchCallsPerRun:0,llmCallsPerRun:0,dailyPublishLimit:0}}).returning();
    expect(await seedIdeaBank(db)).toBe(200);expect(await seedIdeaBank(db)).toBe(0);
    const {agent,csrf}=await login(createApp());
    const list=await agent.get(`/api/items?channelId=${web.id}&origin=idea&collectedOn=2000-01-01`);expect(list.status).toBe(200);expect(list.body.total).toBe(100);
    const selected=list.body.items[0].item;const input={title:selected.title,channel:web.slug,sourceItemId:selected.id};
    const created=await agent.post("/api/studio/cards").set("x-csrf-token",csrf).send(input);expect(created.status).toBe(201);expect(created.body.format).toBe("웹툰");expect(created.body.panels.every((p:{scene:string})=>p.scene.length>10)).toBe(true);expect(created.body.memo).toContain("창작 에피소드");
    const again=await agent.post("/api/studio/cards").set("x-csrf-token",csrf).send(input);expect(again.body.id).toBe(created.body.id);
    const fry=(await db.select().from(channels)).find(c=>c.slug==="fryday")!;const fryList=await agent.get(`/api/items?channelId=${fry.id}&origin=idea`);expect(fryList.body.total).toBe(100);
    const fryCard=await agent.post("/api/studio/cards").set("x-csrf-token",csrf).send({title:fryList.body.items[0].item.title,channel:"fryday",sourceItemId:fryList.body.items[0].item.id});expect(fryCard.body.exportDesign).toBe("set:f01");expect(fryCard.body.format).toBe("카드뉴스");
  });
  it("rejects whitespace keywords and stale deletion while preserving recovery",async()=>{
    const {agent,csrf}=await login(createApp());const H={"x-csrf-token":csrf};const ch=(await getDb().select().from(channels)).find(c=>c.slug==="current-dialogue")!;
    expect((await agent.post(`/api/channels/${ch.id}/rules`).set(H).send({query:"   ",endpoints:["news"]})).status).toBe(400);
    const created=await agent.post(`/api/channels/${ch.id}/rules`).set(H).send({query:"키워드 UI 테스트",endpoints:["news"]});expect(created.status).toBe(201);const rule=created.body.created[0];
    const edit=await agent.patch(`/api/channels/${ch.id}/rules/${rule.id}`).set(H).send({query:"수정한 키워드",version:rule.version});expect(edit.status).toBe(200);
    expect((await agent.post(`/api/channels/${ch.id}/rules/${rule.id}/delete`).set(H).send({version:rule.version})).status).toBe(409);
    const deleted=await agent.post(`/api/channels/${ch.id}/rules/${rule.id}/delete`).set(H).send({version:edit.body.version});expect(deleted.status).toBe(200);
    const restored=await agent.post(`/api/channels/${ch.id}/rules/${rule.id}/restore`).set(H).send({version:deleted.body.version});expect(restored.status).toBe(200);expect(restored.body.query).toBe("수정한 키워드");expect(restored.body.enabled).toBe(false);
  });
});
