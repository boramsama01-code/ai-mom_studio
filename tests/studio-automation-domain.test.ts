import { describe, expect, it } from "vitest";
import { studioGenerationSchema } from "../shared/studio";
import { studioGenerationFeedback, studioImageProgress } from "../shared/studioGenerationFeedback";
import { channelBrandName } from "../shared/branding";
import { collectionSample } from "../server/services/cardDesignSamples";

const imageRequest = { version: 1, kind: "image", provider: "openai", requestId: "78298f4a-9b46-48f5-9318-0cfac06d8c8a" };
describe("bounded partial Studio generation contract", () => {
  it("accepts one or up to four unique panel choices and rejects ambiguous or unbounded batches", () => {
    expect(studioGenerationSchema.parse({ ...imageRequest, panelIndex: 2 }).panelIndex).toBe(2);
    expect(studioGenerationSchema.parse({ ...imageRequest, panelIndexes: [3, 1, 0, 2] }).panelIndexes).toEqual([3, 1, 0, 2]);
    for (const choice of [{}, { panelIndexes: [] }, { panelIndexes: [0, 0] }, { panelIndexes: [4] }, { panelIndex: 0, panelIndexes: [1] }, { panelIndexes: [0, 1, 2, 3, 4] }]) {
      expect(studioGenerationSchema.safeParse({ ...imageRequest, ...choice }).success).toBe(false);
    }
  });
  it("requires an explicit single text panel and retains the separate caption contract", () => {
    const request = { ...imageRequest, kind: "text", textTarget: "panel" };
    expect(studioGenerationSchema.safeParse(request).success).toBe(false);
    expect(studioGenerationSchema.parse({ ...request, panelIndex: 1 }).textTarget).toBe("panel");
    expect(studioGenerationSchema.safeParse({ ...request, panelIndexes: [0, 1] }).success).toBe(false);
    expect(studioGenerationSchema.safeParse({ ...request, kind: "image", panelIndex: 0 }).success).toBe(false);
    expect(studioGenerationSchema.parse({ ...request, textTarget: "caption" }).textTarget).toBe("caption");
  });
});
describe("safe AI failure guidance", () => {
  it.each([
    ["설정에서 OpenAI API 키를 먼저 입력하세요.", "not_configured"],
    ["OpenAI HTTP 401: API 키가 유효하지 않거나 폐기되었습니다.", "auth"],
    ["OpenAI HTTP 429: 이 API 키가 속한 프로젝트의 월간 지출 한도에 도달했습니다.", "quota"],
    ["Gemini HTTP 429: 프로젝트 사용 한도에 도달했습니다. 할당량·결제 상태를 확인하세요.", "quota"],
    ["OpenAI HTTP 429: 일시적인 요청 속도 한도에 도달했습니다. 이 오류만으로 크레딧 부족을 의미하지는 않습니다.", "rate_limit"],
    ["OpenAI HTTP 429: 호출 한도 초과 또는 API 크레딧 부족입니다.", "unknown"],
    ["Gemini HTTP 503: 서버가 잠시 혼잡합니다.", "overload"],
    ["OpenAI 응답 대기 시간이 초과됐습니다. 처리·과금 여부를 확인할 수 없습니다.", "timeout"],
    ["생성 결과의 형식이 올바르지 않습니다.", "parse"],
  ])("classifies application-safe message %s without automatically switching mode", (message, kind) => {
    expect(studioGenerationFeedback(message).kind).toBe(kind);
    expect(studioGenerationFeedback(message).manualFallback).toBe(true);
  });
  it("marks ambiguous completion and cancellation as unconfirmed rather than a rejected request", () => {
    expect(studioGenerationFeedback("응답 대기 시간이 초과됐습니다.").outcomeUnknown).toBe(true);
    expect(studioGenerationFeedback("", "cancelled")).toMatchObject({ kind: "cancelled", outcomeUnknown: true });
    expect(studioImageProgress({ kind: "image", applied: true })).toBeNull();
  });
  it("does not rename an operator-created brand that happens to use a historical built-in display name", () => {
    expect(channelBrandName({ slug: "my-highway", name: "Highway" })).toBe("Highway");
    expect(channelBrandName({ slug: "opportunities", name: "Highway" })).toBe("Highscoop");
    expect(collectionSample("n03", "Highway", "my-highway").plan.base.brandLine).toBe("Highway");
    expect(collectionSample("n03", "Highway", "opportunities").plan.base.brandLine).toBe("Highscoop");
  });
});
