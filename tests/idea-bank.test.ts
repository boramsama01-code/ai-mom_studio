import { describe,it,expect } from "vitest";
import { FRYDAY_IDEAS, WEBTOON_IDEAS } from "../server/data/ideas";
import { readIdea,isIdeaChannel } from "../shared/ideaBank";
import { studioContentSchema } from "../shared/studio";
describe("editorial idea catalogues",()=>{
  it.each([[FRYDAY_IDEAS,"카드뉴스"],[WEBTOON_IDEAS,"웹툰"]] as const)("has 100 distinct, actionable ideas for %s",(ideas,format)=>{
    expect(ideas).toHaveLength(100); expect(new Set(ideas.map(i=>i.key)).size).toBe(100); expect(new Set(ideas.map(i=>i.title)).size).toBe(100);
    expect(new Set(ideas.map(i=>i.category)).size).toBe(10);
    for(const idea of ideas){ expect(idea.format).toBe(format); expect(idea.beats).toHaveLength(4); expect(idea.angle.length).toBeGreaterThan(10); expect(idea.verification.length).toBeGreaterThan(20); expect(readIdea({idea})).toEqual(idea); expect(studioContentSchema.safeParse({title:idea.title,format,exportDesign:format==="카드뉴스"?"set:f01":"editorial",panels:idea.beats.map(scene=>({scene,dialogue:"",imageId:null}))}).success).toBe(true); }
  });
  it("keeps unrelated manual channels and old payloads separate",()=>{expect(readIdea({title:"old"})).toBeNull();expect(isIdeaChannel({slug:"penguin",name:"우주펭귄상회",contentType:"manual"})).toBe(false);expect(isIdeaChannel({slug:"custom-id",name:"제목 미정(웹툰)",contentType:"manual"})).toBe(true);});
});
