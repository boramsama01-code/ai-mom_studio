import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { login, resetDb, setTestEnv } from "./helpers";
import { creativeProfileFor } from "../shared/creativeProfile";
import { channels, creationReceipts, sourceDocuments, studioCards } from "../shared/schema";
setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
const app = createApp();
const outbound = vi.fn(() => { throw new Error("No external AI, URL fetch or social post in workspace tests"); });
let sequence = 0;
beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch",outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });
async function fixture() {
  const {agent,csrf} = await login(app), H = { "x-csrf-token":csrf };
  const slug = "creative-test-" + (++sequence);
  const response = await agent.post("/api/channels").set(H).send({ name:"새 제작 채널",slug,contentType:"manual",categories:[] });
  expect(response.status,JSON.stringify(response.body)).toBe(201);
  return {agent,H,ch:response.body,slug};
}
describe("creative workspace on real PostgreSQL", () => {
  it("resolves concurrent and lost-response creation retries to one durable card", async () => {
    const f=await fixture(), requestId=randomUUID();
    const body={title:"모바일에서 시작한 같은 원고",channel:f.slug,format:"카드뉴스",requestId};
    const responses=await Promise.all([1,2].map(() => f.agent.post("/api/studio/cards").set(f.H).send(body)));
    expect(responses.map(r=>r.status)).toEqual([201,201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    const reopened=await f.agent.get("/api/studio/cards/"+responses[0].body.id);
    expect(reopened.body.card.title).toBe(body.title);
    const retried=await f.agent.post("/api/studio/cards").set(f.H).send(body);
    expect(retried.body.id).toBe(reopened.body.card.id);
    expect(await getDb().select().from(creationReceipts).where(eq(creationReceipts.resourceId,retried.body.id))).toHaveLength(1);
    const changed=await f.agent.post("/api/studio/cards").set(f.H).send({...body,title:"응답 유실 후 다른 제목"});
    expect(changed.status).toBe(409);
    expect(changed.body.cardId).toBe(retried.body.id);
  });
  it("keeps the accepted server version and rejects an older device save", async () => {
    const f=await fixture();
    const created=await f.agent.post("/api/studio/cards").set(f.H).send({title:"함께 편집",channel:f.slug,format:"웹툰"});
    const first=await f.agent.patch("/api/studio/cards/"+created.body.id).set(f.H).send({version:created.body.version,script:"PC에서 저장한 최신 원고",characters:["pengpeng"],panels:[0,1,2,3].map(i=>({scene:"장면 "+i,dialogue:"대사 "+i,imageId:null,poseRefs:[]}))});
    expect(first.status).toBe(200);
    const stale=await f.agent.patch("/api/studio/cards/"+created.body.id).set(f.H).send({version:created.body.version,script:"오래된 모바일 입력"});
    expect(stale.status).toBe(409);
    const reopened=(await f.agent.get("/api/studio/cards/"+created.body.id)).body.card;
    expect(reopened.script).toBe("PC에서 저장한 최신 원고"); expect(reopened.characters).toEqual(["pengpeng"]);
  });
  it("captures a URL once, preserves its body and keeps channel ownership independent", async () => {
    const f=await fixture(), other=await fixture();
    const url="https://example.org/youth-program?item=123";
    const responses=await Promise.all([url,url+"&utm_source=test"].map(value=>f.agent.post("/api/channels/"+f.ch.id+"/capture").set(f.H).send({url:value,title:"이동 중 저장한 모집 공고"})));
    expect(responses.map(r=>r.status).sort()).toEqual([200,201]);
    expect(responses[0].body.studioCardId).toBe(responses[1].body.studioCardId);
    const row=(await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.normalizedUrl,url)))[0];
    await getDb().update(sourceDocuments).set({fetchedText:"이미 확보한 공식 원문",fetchStatus:"ok"}).where(eq(sourceDocuments.id,row.id));
    const another=await other.agent.post("/api/channels/"+other.ch.id+"/capture").set(other.H).send({url,title:"다른 채널의 제목"});
    expect(another.status).toBe(201); expect(another.body.studioCardId).not.toBe(responses[0].body.studioCardId);
    expect((await getDb().select().from(sourceDocuments).where(eq(sourceDocuments.id,row.id)))[0].fetchedText).toBe("이미 확보한 공식 원문");
    expect((await f.agent.get("/api/studio/cards/"+responses[0].body.studioCardId)).body.card.channel).toBe(f.slug);
    expect((await f.agent.post("/api/channels/"+f.ch.id+"/capture").send({url})).status).toBe(403);
  });
  it("round-trips one channel profile and archive without changing another channel", async () => {
    const f=await fixture(), other=await fixture();
    const baseline=(await getDb().select().from(channels).where(eq(channels.id,other.ch.id)))[0];
    const profile={...creativeProfileFor({slug:f.slug}),formats:["웹툰"],defaultFormat:"웹툰",tone:"짧고 건조한 한국어",defaultRoute:"writing"};
    const saved=await f.agent.patch("/api/channels/"+f.ch.id).set(f.H).send({version:f.ch.version,creativeProfile:profile});
    expect(saved.status,JSON.stringify(saved.body)).toBe(200); expect(saved.body.creativeProfile.tone).toBe(profile.tone);
    const disallowed=await f.agent.post("/api/studio/cards").set(f.H).send({title:"금지된 형식",channel:f.slug,format:"카드뉴스"});
    expect(disallowed.status).toBe(400);
    expect((await f.agent.patch("/api/channels/"+f.ch.id).set(f.H).send({version:f.ch.version,active:false})).status).toBe(409);
    const archived=await f.agent.patch("/api/channels/"+f.ch.id).set(f.H).send({version:saved.body.version,active:false});
    expect(archived.status).toBe(200);
    expect((await f.agent.post("/api/channels/"+f.ch.id+"/capture").set(f.H).send({url:"https://example.org/new"})).status).toBe(409);
    const restored=await f.agent.patch("/api/channels/"+f.ch.id).set(f.H).send({version:archived.body.version,active:true});
    expect(restored.body.creativeProfile).toEqual(saved.body.creativeProfile);
    expect((await getDb().select().from(channels).where(eq(channels.id,other.ch.id)))[0]).toEqual(baseline);
  });
});
