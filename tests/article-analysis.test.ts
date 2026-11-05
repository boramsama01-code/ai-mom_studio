import { describe, expect, it } from "vitest";
import { articleAnalysisSchema } from "../shared/articleAnalysis";
import { validateArticleAnalysis } from "../server/services/llm";
import { editorialAnalysis, editorialSource } from "./fixtures/newsEditorial";

describe("attributed article analysis", () => {
  it("keeps a reported event, a person's forecast and an attributed explanation distinct", () => {
    const analysis = editorialAnalysis();
    expect(articleAnalysisSchema.parse(analysis).claims.map(claim => claim.kind)).toEqual(["reported_fact", "forecast", "attributed_claim"]);
    expect(validateArticleAnalysis(analysis, [editorialSource()])).toBeNull();
    expect(analysis.claims[1]).toMatchObject({ speaker: "김가람", quote: expect.stringContaining("2030년") });
  });

  it.each(["duplicate id", "unknown kind", "zero source", "empty statement", "unknown field", "oversized quote"])("rejects a structurally malformed analysis: %s", change => {
    const value: any = editorialAnalysis();
    if (change === "duplicate id") value.claims[1].id = value.claims[0].id;
    if (change === "unknown kind") value.claims[0].kind = "scientifically_proven";
    if (change === "zero source") value.claims[0].source_id = 0;
    if (change === "empty statement") value.claims[0].statement = "  ";
    if (change === "unknown field") value.claims[0].url = "https://invented.test";
    if (change === "oversized quote") value.claims[0].quote = "가".repeat(241);
    expect(articleAnalysisSchema.safeParse(value).success).toBe(false);
    expect(validateArticleAnalysis(value, [editorialSource()])).toContain("분석이 완성되지");
  });

  it.each(["reported_fact", "forecast", "attributed_claim"] as const)("rejects a fabricated quote even for %s", kind => {
    const analysis = editorialAnalysis();
    analysis.claims[0] = { ...analysis.claims[0], kind, speaker: "김가람", quote: "AI가 모든 상황에서 인간보다 현명하다는 사실이 증명됐다" };
    expect(validateArticleAnalysis(analysis, [editorialSource()])).toContain("원문과 일치하지");
  });

  it("ties each quote to its specific source rather than accepting text in another article", () => {
    const source = editorialSource(), other = { ...editorialSource(2), text: "다른 기사에는 이 근거가 없습니다." };
    const analysis = editorialAnalysis(); analysis.claims[0].source_id = other.source_id;
    expect(validateArticleAnalysis(analysis, [source, other])).toContain("원문과 일치하지");
    analysis.claims[0].source_id = 999;
    expect(validateArticleAnalysis(analysis, [source])).toContain("원문과 일치하지");
  });

  it.each(["forecast", "attributed_claim"] as const)("requires attribution for %s, including blank strings", kind => {
    for (const speaker of [null, "   "]) {
      const analysis = editorialAnalysis(); analysis.claims[1] = { ...analysis.claims[1], kind, speaker };
      expect(validateArticleAnalysis(analysis, [editorialSource()])).toContain("발언자가 빠져");
    }
  });

  it("accepts whitespace and Unicode normalization without accepting a different quote", () => {
    const source = editorialSource();
    source.text = source.text.normalize("NFD").replaceAll(" ", "\n  ");
    expect(validateArticleAnalysis(editorialAnalysis(), [source])).toBeNull();
  });
});
