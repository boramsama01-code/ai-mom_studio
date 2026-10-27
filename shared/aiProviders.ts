export const aiProviders = ["gemini", "openai", "anthropic"] as const;
export type AiProvider = typeof aiProviders[number];
export const aiProviderLabels: Record<AiProvider, string> = { gemini: "Gemini", openai: "GPT", anthropic: "Claude" };
export const aiUsageHelp: Record<AiProvider, string> = {
  gemini: "Gemini 무료 등급 프로젝트에서는 무료 한도 내에서 사용합니다. 유료 등급 프로젝트는 과금됩니다. 한도 초과 시 멈추며 다른 AI로 자동 전환하지 않습니다.",
  openai: "OpenAI 무료 토큰은 대상 조직의 데이터 공유·대상 모델·양수 잔액 조건이 필요합니다. 무료 한도 초과 요청은 과금될 수 있으며 스튜디오에서 무료 적용을 보장할 수 없습니다.",
  anthropic: "Claude API 사용료가 발생합니다. 다른 AI로 자동 전환하지 않습니다.",
};
