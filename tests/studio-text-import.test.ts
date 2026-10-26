import { describe, expect, it } from "vitest";
import { studioContentSchema } from "../shared/studio";
import { applyStudioTextReply, parseStudioTextReply, studioChatGptCaptionPrompt, studioChatGptTextPrompt, studioTextAdditions } from "../shared/studioTextImport";

const draft = { script: "새 전체 원고", caption: "새 캡션", panels: Array.from({ length: 4 }, (_, i) => ({ scene: `${i + 1}번째 장면`, dialogue: `${i + 1}번째 대사` })) };
const content = studioContentSchema.parse({ title: "내 제목", channel: "fryday", memo: "비공개 메모", stage: "making", dueDate: "2026-11-03", sourceLabel: "공식 자료", panels: [
  { scene: "내 장면", dialogue: "내 대사", imageId: 42 }, ...Array.from({ length: 3 }, () => ({ scene: "", dialogue: "", imageId: null })),
] });

describe("ChatGPT 원고 가져오기", () => {
  it("기획 메모는 선택한 경우만 포함하고 내부 저장 필드는 복사하지 않는다", () => {
    const prompt = studioChatGptTextPrompt(content, "실제 내 채널");
    expect(prompt).toContain("실제 내 채널"); expect(prompt).toContain("내 대사");
    expect(prompt).not.toContain(content.memo); expect(prompt).not.toContain("imageId"); expect(prompt).not.toContain(content.dueDate);
    expect(studioChatGptTextPrompt(content, "채널", true)).toContain(content.memo);
    expect(studioChatGptCaptionPrompt(content, "채널")).not.toContain(content.memo);
  });
  it("JSON과 코드 블록을 읽고 불완전하거나 범위를 벗어난 답변은 거절한다", () => {
    expect(parseStudioTextReply(JSON.stringify(draft))).toEqual(draft);
    expect(parseStudioTextReply('```json\n' + JSON.stringify(draft) + '\n```')).toEqual(draft);
    for (const value of [{ ...draft, panels: draft.panels.slice(1) }, { ...draft, title: "제목 변경" }, { ...draft, caption: "x".repeat(8001) }, { ...draft, panels: draft.panels.map(p => ({ ...p, imageId: 123 })) }]) {
      expect(() => parseStudioTextReply(JSON.stringify(value))).toThrow("모두 필요");
    }
    expect(() => parseStudioTextReply('설명\n' + JSON.stringify(draft))).toThrow("답변 형식");
    expect(() => parseStudioTextReply("x".repeat(100001))).toThrow("너무 깁니다");
  });
  it("미리보기 이후 직접 쓴 글도 보존하며 빈칸만 반영한다", () => {
    expect(studioTextAdditions(content, draft)).toHaveLength(8);
    const latest = { ...content, script: "검토 중 직접 쓴 원고", panels: content.panels.map((p, i) => i === 1 ? { ...p, dialogue: "검토 중 쓴 대사" } : p) };
    const result = applyStudioTextReply(latest, draft);
    expect(result.script).toBe(latest.script); expect(result.panels[1].dialogue).toBe("검토 중 쓴 대사");
    expect(result.panels[0]).toEqual(content.panels[0]);
    expect(result.caption).toBe(draft.caption); expect(result.panels[2].scene).toBe(draft.panels[2].scene);
    for (const key of ["title", "channel", "memo", "dueDate", "stage", "sourceLabel", "characters", "exportDesign"] as const) expect(result[key]).toEqual(content[key]);
    expect(content.script).toBe(""); expect(studioTextAdditions(result, draft)).toEqual([]);
  });
});
