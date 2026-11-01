import { describe,it,expect } from "vitest";
import {studioContentSchema,studioPatchSchema} from "../shared/studio";
import {studioAltTexts,altTextFile} from "../shared/altText";
import {applyExperienceDraft} from "../server/services/experienceAi";
describe("페이지별 대체텍스트",()=>{
 it("기존 카드의 제목과 실제 본문으로 초안을 만들고 수정한 설명은 보존한다",()=>{
  const c=studioContentSchema.parse({title:"하늘의 색",format:"카드뉴스",exportDesign:"set:n01",panels:Array.from({length:4},(_,i)=>({scene:"",dialogue:`본문 ${i+1}`}))});
  const values=studioAltTexts(c);expect(values).toHaveLength(5);expect(values[0]).toContain("하늘의 색");expect(values[3]).toContain("본문 3");
  expect(studioAltTexts({...c,altTexts:["직접 작성한 표지 설명"]})[0]).toBe("직접 작성한 표지 설명");expect(studioPatchSchema.parse({version:1,title:"새 제목"})).not.toHaveProperty("altTexts");
  expect(altTextFile(values)).toContain("[05페이지]");expect(studioContentSchema.safeParse({...c,altTexts:["가".repeat(1001)]}).success).toBe(false);
 });
 it("AI 사진 설명을 카드와 함께 저장하고 순서를 바꾸면 설명도 따라간다",()=>{
  const c=studioContentSchema.parse({title:"기록",format:"카드뉴스",experience:{notes:"실제 메모",pageCount:3,media:[{id:1,note:"사진 메모"}],coverId:1}});
  const result=applyExperienceDraft(c,{title:"기록",caption:"게시 캡션",coverId:1,coverAltText:"사진이 배경에 놓인 표지.",pages:[{mediaId:1,title:"첫 장면",body:"본문",altText:"첫 장면의 설명",fit:"contain"},{mediaId:1,title:"둘째 장면",body:"본문",altText:"둘째 장면의 설명",fit:"contain"}],questions:[]});
  expect(studioAltTexts(result)).toEqual(["사진이 배경에 놓인 표지.","첫 장면의 설명","둘째 장면의 설명"]);
  expect(studioAltTexts({...result,experience:{...result.experience!,pages:[...result.experience!.pages].reverse()}})).toEqual(["사진이 배경에 놓인 표지.","둘째 장면의 설명","첫 장면의 설명"]);
 });
});
