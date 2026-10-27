import { describe, expect, it } from "vitest";
import { CHATGPT_URL_LIMIT, chatGptPromptLink, itemChatGptPrompt } from "../shared/chatgptLink";

describe("ChatGPT 연결", () => {
  it("한글·줄바꿈·URL 특수문자를 하나의 프롬프트로 전달한다", () => {
    const prompt = '한글 요청 & 참고 https://example.com/?a=1&b=2\n#제목 + "인용"';
    const url = new URL(chatGptPromptLink(prompt)!);
    expect(url.origin).toBe("https://chatgpt.com");
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.searchParams.get("q")).toBe(prompt);
  });
  it("빈 요청은 열지 않고 URL 길이 초과는 생략 없이 복사 경로로 넘긴다", () => {
    expect(chatGptPromptLink(" \n ")).toBeNull();
    expect(chatGptPromptLink("긴 본문".repeat(CHATGPT_URL_LIMIT))).toBeNull();
    expect(chatGptPromptLink("test".repeat(100))).not.toBeNull();
  });
  it("현재 저장한 본문과 실제로 포함된 구절만 전달한다", () => {
    const text = "중학생 참가자를 모집합니다. 접수 기간은 공식 공고에서 확인해야 합니다.";
    const prompt = itemChatGptPrompt({ title: "검증 공고", kind: "notice", source: { title: "원문", url: "https://example.com", text, snippet: "이전 RSS 요약", quotes: ["중학생 참가자를 모집합니다.", "원문에 없는 허위 구절"] } });
    expect(prompt).toContain(text); expect(prompt).toContain("사후 홍보");
    expect(prompt).not.toContain("이전 RSS 요약"); expect(prompt).not.toContain("원문에 없는 허위 구절");
    expect(prompt).toContain("[확인 필요]");
  });
  it("확보하지 못한 본문을 사실이나 인용으로 가장하지 않는다", () => {
    const prompt = itemChatGptPrompt({ title: "과학 기사", kind: "science_dialogue", source: { title: "원문", url: "https://example.com", text: "", snippet: "RSS 제목 요약", quotes: ["검증되지 않은 인용"] } });
    expect(prompt).toContain("본문 미확보"); expect(prompt).toContain("RSS 제목 요약");
    expect(prompt).not.toContain("검증되지 않은 인용");
    expect(itemChatGptPrompt({ title: "시사", kind: "current_dialogue", source: null })).toContain("연결된 원문 없음");
  });
});
