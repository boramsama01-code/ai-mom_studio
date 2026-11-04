import type { ArticleAnalysis } from "../../shared/articleAnalysis";
import type { CardCopy } from "../../shared/cardCopy";
import { emptyPayload } from "../../shared/payloads";
import type { LlmSource } from "../../server/services/llm";
import { discussionCardCopyFixture } from "./discussionCardCopy";

/** Synthetic article, person and figures: no production or external API data. */
export function editorialSource(sourceId = 1): LlmSource {
  return {
    source_id: sourceId, kind: "news", url: "https://example.test/news/ai-interview", title: "김가람의 AI 평가 인터뷰", published: "2026-11-03",
    text: "11월 3일 연구자 김가람은 인터뷰에서 ‘2030년에는 일부 평가에서 AI가 인간을 앞설 수 있다’고 전망했다. 이 발언은 아직 검증되지 않은 개인의 예측이다. 연구팀은 20개의 수학 문제로 평가했으며, 모든 지능이나 현명함을 측정한 실험은 아니라고 설명했다. 김가람은 조건이 달라지면 결과도 달라질 수 있다고 덧붙였다.",
  };
}

export function editorialAnalysis(sourceId = 1): ArticleAnalysis {
  return {
    version: 1, articleType: "interview", centralEvent: "김가람이 AI 평가 결과의 한계와 미래 전망을 설명했다.",
    claims: [
      { id: "claim-1", kind: "reported_fact", statement: "연구팀은 20개 수학 문제로 평가했다.", speaker: null, source_id: sourceId, quote: "연구팀은 20개의 수학 문제로 평가했으며" },
      { id: "claim-2", kind: "forecast", statement: "2030년에는 일부 평가에서 AI가 인간을 앞설 수 있다는 김가람의 예측이다.", speaker: "김가람", source_id: sourceId, quote: "2030년에는 일부 평가에서 AI가 인간을 앞설 수 있다" },
      { id: "claim-3", kind: "attributed_claim", statement: "평가 조건이 달라지면 결과도 달라질 수 있다는 김가람의 설명이다.", speaker: "김가람", source_id: sourceId, quote: "김가람은 조건이 달라지면 결과도 달라질 수 있다고 덧붙였다" },
    ],
    limitations: ["개인의 예측을 확립된 연구 결과로 볼 수 없다."],
    keyConcepts: [{ term: "똑똑함", meaning: "문제의 점수와 상황에 맞는 판단을 구분해서 생각할 개념" }],
  };
}

export function editorialCopy(sourceId = 1): CardCopy {
  const copy = discussionCardCopyFixture();
  copy.pages[0].body = "김가람은 2030년 일부 평가에서 AI가 인간을 앞설 수 있다고 전망했습니다. 연구팀은 20개의 수학 문제를 평가했지만, 모든 지능을 측정한 실험은 아닙니다.";
  copy.pages[0].sourceIds = [sourceId];
  return copy;
}

export function editorialSummary(kind = "science_dialogue", sourceId = 1): Record<string, unknown> {
  return {
    ...emptyPayload(kind, "AI 평가와 똑똑함"),
    articleAnalysis: editorialAnalysis(sourceId),
    evidence: [{ field: kind === "science_dialogue" ? "scientific_basis" : "summary", source_id: sourceId, quote: "연구팀은 20개의 수학 문제로 평가했으며" }],
    sources: [{ source_id: sourceId, note: "합성 테스트 기사" }],
    ...(kind === "science_dialogue" ? { scientific_basis: "20개 수학 문제의 평가이며, 미래 성능에 관한 개인의 전망은 검증되지 않았습니다." } : { summary: "김가람은 AI의 일부 평가 성능을 전망했습니다. 모든 지능이 검증된 것은 아닙니다.", independent_source_count: 1 }),
  };
}

export function geminiEditorialResponse(data: unknown) {
  return new Response(JSON.stringify({
    modelVersion: "gemini-summary-test", candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(data) }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22, thoughtsTokenCount: 3 },
  }));
}

export function openaiEditorialResponse(data: unknown, toolName = "submit_news_cards") {
  return new Response(JSON.stringify({
    status: "completed", model: "gpt-copy-test", output: [{ type: "function_call", name: toolName, arguments: JSON.stringify(data) }],
    usage: { input_tokens: 33, output_tokens: 44 },
  }));
}
