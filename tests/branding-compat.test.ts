import { describe, expect, it } from "vitest";
import { cardBrandName } from "../shared/branding";
import { channelSlug, studioKey } from "../shared/channelKeys";
import { studioContentSchema, studioPatchSchema } from "../shared/studio";

describe("current brand with older saved content", () => {
  it("reads an old channel key as Highscoop without losing content or patch defaults", () => {
    const saved = studioContentSchema.parse({ title: "내 원고", channel: "highway", memo: "사용자가 작성한 메모", characters: ["pempem"] });
    expect(saved).toMatchObject({ channel: "highscoop", memo: "사용자가 작성한 메모", characters: ["pempem"] });
    expect(studioKey("opportunities")).toBe("highscoop");
    expect(channelSlug("highway")).toBe(channelSlug("highscoop"));
    expect(studioPatchSchema.parse({ version: 3, stage: "review" })).toEqual({ version: 3, stage: "review" });
    expect(studioPatchSchema.parse({ version: 3, channel: "highway" })).toEqual({ version: 3, channel: "highscoop" });
    expect(channelSlug("custom-family")).toBe("custom-family");
  });

  it.each([
    ["Highway", "Highscoop"], ["하이웨이 · 고입", "Highscoop"], ["아이맘 · 도전·진학", "Highscoop"],
    ["하루10분 모집정보", "Highscoop"], ["하루 10분", "Alligodang"], ["하루10분 과학", "Alligodang"],
    ["하루 10분 · 시사", "Alligodang"], ["아이맘 · 하루 과학 대화", "Alligodang"], ["와이브리프", "Alligodang"],
    ["Why Brief", "Alligodang"], ["AI-MOM Studio", "우주펭귄상회"], ["Fryday", "Fryday"], ["직접 만든 채널", "직접 만든 채널"],
  ])("prints %s with the current brand", (before, after) => expect(cardBrandName(before)).toBe(after));
});
