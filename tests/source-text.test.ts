import { expect, it } from "vitest";
import { suggestSourceQuotes } from "../shared/sourceText";
import { computeEvidenceStatus } from "../server/worker/evidence";

it("원문의 연속된 구절만 제안하고 중복·저작권 문구를 제외한다", () => {
  const text = "청소년 연구 프로그램 참가자를 10월 30일까지 모집합니다.\n지원 대상은 과학 탐구에 관심이 있는 중학생입니다.\n지원 대상은 과학 탐구에 관심이 있는 중학생입니다.\nCopyright 이 자료는 무단 전재할 수 없습니다.";
  const quotes = suggestSourceQuotes(text);
  expect(quotes).toHaveLength(2);
  expect(quotes.every(q => text.includes(q) && q.length <= 400)).toBe(true);
  expect(suggestSourceQuotes("가".repeat(900))[0]).toHaveLength(400);
});
it("직접 붙여넣은 본문을 자동으로 공식 확인 처리하지 않는다", () => {
  expect(computeEvidenceStatus({ kind: "manual_text", normalizedUrl: "https://school.example", fetchStatus: "ok" }, null, [])).toBe("needs_review");
});
