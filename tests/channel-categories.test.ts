import { describe, expect, it } from "vitest";
import { channelCategories, validSubcategory, categoryLabel } from "../shared/channelCategories";
import { studioContentSchema, studioPatchSchema } from "../shared/studio";

describe("채널 운영 소분류", () => {
  it("수집 채널과 제작 채널에 같은 선택지를 사용한다", () => {
    expect(channelCategories("opportunities")).toEqual(["중등입시", "고등입시", "전국대회", "캠프·체험 선발모집"]);
    expect(channelCategories("current-dialogue")).toEqual(channelCategories("science-dialogue"));
    expect(channelCategories("news")).toEqual(["과학", "사회", "정치", "예술", "여행", "최신이슈"]);
    expect(channelCategories("fryday")).toHaveLength(3);
    expect(channelCategories("penguin")).toEqual(["웹툰"]);
  });
  it("타 채널 분류를 거절하고 기존 미분류 콘텐츠를 보존한다", () => {
    expect(validSubcategory("opportunities", "과학")).toBe(false);
    expect(validSubcategory("science-dialogue", "과학")).toBe(true);
    expect(validSubcategory("custom", "과학")).toBe(false);
    expect(validSubcategory("custom", null)).toBe(true);
    expect(categoryLabel(null)).toBe("미분류");
    expect(studioContentSchema.parse({ title: "기존 작업" }).subcategory).toBeUndefined();
  });
  it("단계만 수정할 때 분류를 초기화하지 않고 소분류 저장을 허용한다", () => {
    expect(studioPatchSchema.parse({ version: 1, stage: "review" })).not.toHaveProperty("subcategory");
    expect(studioPatchSchema.parse({ version: 1, subcategory: "과학" }).subcategory).toBe("과학");
  });
});
