import { z } from "zod";

/** A claim being present in a newspaper is not proof that the claim is true. */
export const articleClaimKinds = ["reported_fact", "attributed_claim", "forecast", "interpretation"] as const;
export const articleAnalysisSchema = z.object({
  version: z.literal(1),
  articleType: z.enum(["report", "interview", "opinion", "research", "announcement", "mixed"]),
  centralEvent: z.string().trim().min(1).max(500),
  claims: z.array(z.object({
    id: z.string().regex(/^claim-[1-9][0-9]?$/),
    kind: z.enum(articleClaimKinds),
    statement: z.string().trim().min(1).max(500),
    speaker: z.string().trim().max(100).nullable(),
    source_id: z.number().int().positive(),
    quote: z.string().trim().min(2).max(240),
  }).strict()).min(1).max(12),
  limitations: z.array(z.string().trim().min(1).max(300)).max(8),
  keyConcepts: z.array(z.object({ term: z.string().trim().min(1).max(60), meaning: z.string().trim().min(1).max(300) }).strict()).max(6),
}).strict().refine(value => new Set(value.claims.map(claim => claim.id)).size === value.claims.length, "근거 ID가 중복되었습니다.");
export type ArticleAnalysis = z.infer<typeof articleAnalysisSchema>;

export const aiWorkflowSchema = z.object({
  version: z.literal(1),
  summary: z.object({ provider: z.string().max(40), model: z.string().max(160) }),
  copy: z.object({ provider: z.string().max(40), model: z.string().max(160) }).nullable(),
  warnings: z.array(z.string().max(700)).max(8),
}).strict();

export const ARTICLE_ANALYSIS_RULES = `
기사 분석 원칙:
- 기사에 등장했다는 사실과 그 발언이 사실이라는 주장을 구분한다. 인터뷰·칼럼·전망을 실험 결과나 확립된 과학적 사실로 바꾸지 않는다.
- reported_fact는 기사에서 확인되는 사건·관찰, attributed_claim은 인물·기관의 주장, forecast는 미래 예측, interpretation은 해석이다.
- 주장·예측에는 발언자(speaker)와 조건·시점을 남긴다. '앞으로 능가할 것'을 '이미 능가했다'로 바꾸지 않는다.
- 특히 '진화적 사건' 같은 비유는 인물의 표현이지 생물학적 진화의 증거가 아니다. 지능·성과·지혜·가치 판단을 동일시하지 않는다.
- articleAnalysis에 핵심 사건, 3~8개의 근거가 있는 주장, 아직 검증되지 않은 부분, 핵심 개념을 기록한다. 모든 claim에는 실제 source_id와 해당 원문에 있는 정확한 짧은 quote가 필요하다.
- 과학적 근거가 없는 전망 기사라면 scientific_basis에는 그 한계를 명시한다. 개인의 전망을 연구 결과처럼 포장하지 않는다.
- 제목만으로 분석하지 않는다. 원문에 없는 논문, 과학관, 연구 수치, URL을 만들지 않는다.`;
