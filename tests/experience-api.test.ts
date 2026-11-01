import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { login, resetDb, setTestEnv } from "./helpers";
setTestEnv();
const upstream=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("../server/services/llm",async original=>({...await original<object>(),openaiRequest:upstream.call}));
vi.mock("../server/services/studioAi",async original=>({...await original<object>(),studioAiStatus:()=>({defaultProvider:"openai",text:{openai:true,gemini:false,anthropic:false},image:false})}));
const {createApp}=await import("../server/app");const {getDb,closeDb}=await import("../server/db");const {claimJob}=await import("../server/worker/queue");const {processStudioJob}=await import("../server/worker/studio");
let app:ReturnType<typeof createApp>;let photo:Buffer;
beforeAll(async()=>{await resetDb();app=createApp();photo=await sharp({create:{width:120,height:80,channels:3,background:"#73957c"}}).withMetadata().jpeg().toBuffer();});
afterAll(closeDb);
async function setup(){const a=await login(app),headers={"x-csrf-token":a.csrf};const r=await a.agent.post("/api/studio/cards").set(headers).send({title:"검증용 방문 기록",channel:"news",format:"카드뉴스",experience:{notes:"테스트 자료를 관찰했습니다.",event:"UI 검증"}});expect(r.status).toBe(201);return {...a,headers,card:r.body};}
describe("사진·영상 후기의 저장과 내보내기",()=>{
 it("원본 파일은 인증·CSRF·콘텐츠 버전을 확인하고 메타데이터를 제거한다",async()=>{
  const {agent,headers,card}=await setup(),url=`/api/studio/cards/${card.id}/media?version=1&name=photo.jpg`;
  expect((await request(app).post(url).type("image/jpeg").send(photo)).status).toBe(401);
  expect((await agent.post(url).type("image/jpeg").send(photo)).status).toBe(403);
  const saved=await agent.post(url).set(headers).type("image/jpeg").send(photo);expect(saved.status).toBe(201);expect(saved.body.card.experience.coverId).toBe(saved.body.mediaId);
  expect((await agent.post(url).set(headers).type("image/jpeg").send(photo)).status).toBe(409);
  const mediaId=saved.body.mediaId;expect((await request(app).get(`/api/studio/media/${mediaId}`)).status).toBe(401);
  const image=await agent.get(`/api/studio/media/${mediaId}/preview`);expect(image.status).toBe(200);expect((await sharp(image.body).metadata()).exif).toBeUndefined();
  const other=await setup();expect((await other.agent.patch(`/api/studio/cards/${other.card.id}`).set(other.headers).send({version:1,experience:{...other.card.experience,coverId:mediaId,media:[{id:mediaId,note:""}]}})).status).toBe(400);
  expect((await agent.post(`/api/studio/cards/${card.id}/media?version=2&name=bad.jpg`).set(headers).type("image/jpeg").send(Buffer.from("<script>bad</script>"))).status).toBe(400);
  await agent.post(`/api/studio/cards/${card.id}/trash`).set(headers).send({version:2});expect((await agent.post(`/api/studio/cards/${card.id}/media?version=3`).set(headers).type("image/jpeg").send(photo)).status).toBe(409);
 });
 it("영상 범위 재생과 대표 장면을 지원하며 ZIP에 모든 카드·캡션·영상 원본을 담는다",async()=>{
  const {agent,headers,card}=await setup(),mp4=Buffer.from("000000186674797069736f6d0000000069736f6d6d703432","hex");
  const uploaded=await agent.post(`/api/studio/cards/${card.id}/media?version=1&name=clip.mp4`).set(headers).type("video/mp4").send(mp4);expect(uploaded.status).toBe(201);
  const id=uploaded.body.mediaId;const range=await agent.get(`/api/studio/media/${id}`).set("Range","bytes=4-11");expect(range.status).toBe(206);expect(range.headers["content-range"]).toBe(`bytes 4-11/${mp4.length}`);
  expect((await agent.get(`/api/studio/media/${id}`).set("Range","bytes=9999-")).status).toBe(416);
  const frame=await agent.post(`/api/studio/cards/${card.id}/media/${id}/preview?version=2&seconds=1.5`).set(headers).type("image/jpeg").send(photo);expect(frame.status).toBe(200);
  const experience={...frame.body.experience,pages:Array.from({length:4},(_,i)=>({mediaId:id,title:`장면 ${i+1}`,body:"검증용 영상 장면입니다.",fit:"contain"}))};
  const ready=await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({version:3,experience,caption:"내가 쓴 후기 캡션"});expect(ready.status).toBe(200);
  const zip=await agent.get(`/api/studio/cards/${card.id}/export.zip?version=4`).buffer(true).parse((res,cb)=>{const buffers:Buffer[]=[];res.on("data",chunk=>buffers.push(chunk));res.on("end",()=>cb(null,Buffer.concat(buffers)));});expect(zip.status).toBe(200);
  const report=JSON.parse(execFileSync("python3",["-c","import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({'names':z.namelist(),'bad':z.testzip(),'caption':z.read('caption.txt').decode()}))"],{input:zip.body}).toString());
  expect(report.names).toContain(`video-${id}.mp4`);expect(report.names).toContain("alt-text.txt");expect(report.names.filter((n:string)=>n.endsWith(".png"))).toHaveLength(5);expect(report.bad).toBeNull();expect(report.caption).toBe("내가 쓴 후기 캡션");
 });
 it("AI 호출은 저장한 실제 사진을 전송하고 오래된 결과로 새 편집을 덮어쓰지 않는다",async()=>{
  const {agent,headers,card}=await setup();const uploaded=await agent.post(`/api/studio/cards/${card.id}/media?version=1&name=photo.jpg`).set(headers).type("image/jpeg").send(photo);const id=uploaded.body.mediaId;
  upstream.call.mockImplementationOnce(async(_endpoint,body)=>{
   const parts=body.input[0].content;expect(parts.some((p:any)=>p.type==="input_image"&&p.image_url.startsWith("data:image/jpeg;base64,"))).toBe(true);expect(body.instructions).toContain("영상은 대표 정지 장면만");expect(body.store).toBe(false);
   await agent.patch(`/api/studio/cards/${card.id}`).set(headers).send({version:2,title:"내가 새로 고친 제목"});
   return {status:"completed",model:"mock-vision",output:[{type:"function_call",name:"save_experience",arguments:JSON.stringify({title:"AI 제목",caption:"AI 캡션",coverId:id,pages:Array.from({length:4},()=>({mediaId:id,title:"직접 본 장면",body:"메모에 기록된 경험입니다.",fit:"contain"})),questions:[]})}]};
  });
  const queued=await agent.post(`/api/studio/cards/${card.id}/generate`).set(headers).send({version:2,kind:"text",textTarget:"experience",provider:"openai",requestId:crypto.randomUUID()});expect(queued.status).toBe(202);
  const job=await claimJob(getDb(),"experience-test",["studio_generate"]);expect(job?.id).toBe(queued.body.job.id);expect(await processStudioJob(getDb(),job!,"experience-test")).toBe(true);
  const detail=(await agent.get(`/api/studio/cards/${card.id}`)).body;expect(detail.card.title).toBe("내가 새로 고친 제목");expect(detail.revisions.some((r:any)=>!r.applied&&r.snapshot.title==="AI 제목")).toBe(true);expect(upstream.call).toHaveBeenCalledOnce();
 });
});
