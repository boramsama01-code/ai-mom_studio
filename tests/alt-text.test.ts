import { describe,it,expect } from "vitest";
import {studioContentSchema,studioPatchSchema,studioCreateSchema} from "../shared/studio";
import {studioAltTexts,altTextFile,altTextLength,altTextError,altTextSentenceCount,conciseAlt} from "../shared/altText";
import { importedProposalSchema } from "../server/services/importedCarousel";
import { checkStudioExport } from "../server/services/studioExport";
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

it("keeps deliberately cleared manual descriptions empty during editing and can explicitly regenerate text defaults",async()=>{
 const {studioAltTextDrafts,studioAltTextDefaults}=await import("../shared/altText");
 const c=studioContentSchema.parse({title:"하늘의 색",format:"카드뉴스",altTexts:[""],panels:[{scene:"",dialogue:"첫 본문"},{scene:"",dialogue:"둘째"},{scene:"",dialogue:"셋째"},{scene:"",dialogue:"넷째"}]});
 expect(studioAltTextDrafts(c)[0]).toBe("");expect(studioAltTextDefaults(c)[0]).toContain("하늘의 색");
 const e=studioContentSchema.parse({...c,experience:{coverAltText:"",pages:[{title:"본문",body:"내용",altText:"",mediaId:null,fit:"contain"}]}});
 expect(studioAltTextDrafts(e)).toEqual(["",""]);expect(studioAltTextDefaults(e)[1]).toContain("내용");
});

describe("125-character limit including spaces and at most two sentences", () => {
 it("allows exactly 125 Unicode characters including spaces, rejects 126, and counts sentence endings", () => {
  const boundary = "가".repeat(123) + " 나";
  expect(altTextLength(boundary)).toBe(125);
  expect(altTextError(boundary)).toBeNull();
  expect(altTextError(boundary + "다")).toContain("125자");
  expect(altTextLength("😀")).toBe(1);
  expect(altTextSentenceCount("첫 문장. 두 번째 문장!")).toBe(2);
  expect(altTextError("첫 문장. 두 번째 문장! 세 번째 문장.")).toContain("1~2문장");
  expect(altTextError("", true)).toBeNull();
 });
 it("shortens automatic defaults without cutting manually saved old text", () => {
  const generated = conciseAlt(["첫 문장. 둘째 문장. 셋째 문장.", "가".repeat(200)]);
  expect(generated).toBe("첫 문장. 둘째 문장.");
  expect(altTextError(conciseAlt(["공백 포함 ", "가 ".repeat(180)]))).toBeNull();
  const old = "가".repeat(180);
  const saved = studioContentSchema.parse({ title: "기존 카드", format: "카드뉴스", altTexts: [old] });
  expect(studioAltTexts(saved)[0]).toBe(old);
  expect(studioPatchSchema.safeParse({ version: 1, title: "제목만 수정" }).success).toBe(true);
  expect(studioPatchSchema.safeParse({ version: 1, altTexts: [old] }).success).toBe(false);
  expect(studioCreateSchema.safeParse({ title: "새 콘텐츠", altTexts: [old] }).success).toBe(false);
  expect(studioPatchSchema.safeParse({ version: 1, altTexts: ["첫 문장. 둘째 문장. 셋째 문장."] }).success).toBe(false);
  const deck = studioContentSchema.parse({ title: "기존 카드", format: "카드뉴스", finishedDeck: { pages: [{imageId: 1, name: "01.png", altText: old}] } });
  expect(checkStudioExport(deck).errors[0].message).toContain("125자");
  expect(studioPatchSchema.safeParse({version:1,finishedDeck:deck.finishedDeck}).success).toBe(false);
 });
 it("rejects overly long or three-sentence AI proposals without mutating cards", () => {
  const ok = {caption:"게시용 캡션",altTexts:["사진에 감자가 놓여 있다.", "표지의 제목과 노란 캐릭터가 보인다."]};
  expect(importedProposalSchema.safeParse(ok).success).toBe(true);
  expect(importedProposalSchema.safeParse({...ok,altTexts:["가".repeat(126)]}).success).toBe(false);
  expect(importedProposalSchema.safeParse({...ok,altTexts:["첫 문장. 둘째 문장. 셋째 문장."]}).success).toBe(false);
 });
});
