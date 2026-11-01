import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { studioContentSchema, studioGenerationSchema, studioPatchSchema, studioPageCount } from "../shared/studio";
import { experienceSchema } from "../shared/experience";
import { applyExperienceDraft } from "../server/services/experienceAi";
import { createStudioRenderer, checkStudioExport } from "../server/services/studioExport";
import { mediaRange, videoMime } from "../server/services/experienceMedia";
const content=()=>studioContentSchema.parse({title:"함께 다녀온 체험 기록",format:"카드뉴스",channel:"news",experience:{notes:"직접 관찰한 장면과 메모",media:[{id:1,note:"첫 장면"},{id:2,note:"둘째 장면"}],coverId:1,pageCount:5,pages:Array.from({length:4},(_,i)=>({mediaId:i%2+1,title:`기록 ${i+1}`,body:"직접 본 장면을 차분하게 기록합니다.",fit:"contain"}))}});
describe("실제 경험 기반 후기",()=>{
 it("이전 콘텐츠와 부분 수정은 후기 데이터를 지우지 않는다",()=>{
  expect(studioContentSchema.parse({title:"기존 작업"}).experience).toBeNull();
  expect(studioPatchSchema.parse({version:1,stage:"review"})).toEqual({version:1,stage:"review"});
  const c=content();expect(studioContentSchema.parse({...c,...studioPatchSchema.omit({version:true}).parse({caption:"새 캡션"})}).experience).toEqual(c.experience);
  expect(experienceSchema.safeParse({date:"2026-02-30"}).success).toBe(false);
  expect(experienceSchema.safeParse({media:[{id:1},{id:1}]}).success).toBe(false);
 });
 it("AI는 선택한 자료만 사용할 수 있고 메모와 순서는 보존한다",()=>{
  const c=content(),draft={title:"정리한 제목",caption:"짧은 후기",coverId:2,pages:c.experience!.pages,questions:["방문일을 확인해 주세요."]};
  const result=applyExperienceDraft(c,draft);expect(result.experience?.notes).toBe(c.experience?.notes);expect(result.experience?.media).toEqual(c.experience?.media);expect(result.stage).toBe("review");expect(result.caption).toBe("짧은 후기");
  expect(()=>applyExperienceDraft(c,{...draft,coverId:999})).toThrow("선택하지 않은");
  expect(()=>applyExperienceDraft(c,{...draft,pages:draft.pages.slice(0,2)})).toThrow("장수");
  const input={version:1,kind:"text",textTarget:"experience",provider:"openai",requestId:crypto.randomUUID()};expect(studioGenerationSchema.safeParse(input).success).toBe(true);expect(studioGenerationSchema.safeParse({...input,provider:"gemini"}).success).toBe(false);
 });
 it("사진 후기 두 디자인은 실제 이미지를 5장 출력하고 페이지 수 변경을 지원한다",async()=>{
  const c=content(),picture=await sharp({create:{width:160,height:120,channels:3,background:"#9ea789"}}).jpeg().toBuffer();
  expect(checkStudioExport(c).errors).toEqual([]);const previews=[];
  for(const layout of ["photo","journal"] as const){const r=createStudioRenderer({...c,experience:{...c.experience!,layout}},1,"Alligodang","#286a64",new Map([[1,picture],[2,picture]]));expect(r.pageCount).toBe(5);previews.push(await r.page(0));for(let i=0;i<5;i++){const info=await sharp(await r.page(i)).metadata();expect([info.width,info.height]).toEqual([1080,1350]);}}
  expect(previews[0].equals(previews[1])).toBe(false);
  expect(studioPageCount({...c,experience:{...c.experience!,pages:c.experience!.pages.slice(0,2)}})).toBe(3);
  expect(checkStudioExport({...c,experience:{...c.experience!,coverId:null}}).errors[0].field).toBe("experience.coverId");
  await expect(createStudioRenderer(c,1,"Alligodang","#286a64").page(0)).rejects.toThrow("대표 장면");
 });
 it("서버가 영상 형식과 Range 범위를 검사한다",()=>{
  const mp4=Buffer.from("000000186674797069736f6d0000000069736f6d6d703432","hex");expect(videoMime(mp4)).toBe("video/mp4");expect(videoMime(Buffer.from("not a video at all"))).toBeNull();
  expect(mediaRange("bytes=10-19",100)).toEqual({start:10,end:19});expect(mediaRange("bytes=-5",100)).toEqual({start:95,end:99});expect(mediaRange("bytes=95-200",100)).toEqual({start:95,end:99});for(const bad of ["bytes=101-","bytes=20-10","bytes=-0","bytes=0-2,4-6"])expect(()=>mediaRange(bad,100)).toThrow();
 });
});
