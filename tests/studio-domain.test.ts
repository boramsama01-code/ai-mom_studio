import { describe, expect, it } from "vitest";
import { studioContentSchema, studioGenerationSchema, studioPatchSchema } from "../shared/studio";
describe("Studio 수정 계약", () => {
  it("단계만 수정할 때 원고·채널·그림 기본값을 주입하지 않는다", () => {
    const patch = studioPatchSchema.parse({ version: 2, stage: "review" });
    expect(patch).toEqual({ version: 2, stage: "review" });
    const original = studioContentSchema.parse({ title: "고입", channel: "highscoop", memo: "공식 원문", script: "편집 원고", caption: "기존 캡션", panels: Array.from({ length: 4 }, () => ({ scene: "장면", dialogue: "대사", imageId: 42 })) });
    const { version, ...changes } = patch;
    const result = studioContentSchema.parse({ ...original, ...changes });
    expect(result).toEqual({ ...original, stage: "review" });
  });
  it("실제 worker 페이로드는 cardId·snapshot과 함께 검증되고 비용 재요청 ID가 필수", () => {
    const input = { version: 1, kind: "text", provider: "openai", instruction: "개선", requestId: "7e6cfc80-83cc-4ff3-9ddf-4bde812122cd" };
    expect(studioGenerationSchema.safeParse(input).success).toBe(true);
    expect(studioGenerationSchema.safeParse({ ...input, kind: "image" }).success).toBe(false);
  });
});

