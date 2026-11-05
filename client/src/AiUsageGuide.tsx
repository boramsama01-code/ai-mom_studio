import { aiUsageHelp, type AiProvider } from "@shared/aiProviders";

/** Account eligibility and remaining free quotas cannot be inferred from an API key lookup. */
export function AiUsageGuide({ provider, setup = false }: { provider: AiProvider; setup?: boolean }) {
  return <div className="small muted">
    <p>{aiUsageHelp[provider]}</p>
    {setup && provider === "gemini" && <>
      <ol><li>Google AI Studio에서 프로젝트 등급이 <strong>Free</strong>인지 확인합니다. 무료로 사용하려면 결제를 연결하지 마세요.</li><li>그 프로젝트의 API 키를 아래에 저장하고 연결을 확인합니다.</li><li>채널 설정의 역할별 AI에서 기사 요약 또는 카드 문구를 Gemini로 정하거나, 작성 화면에서 이번 작업의 AI로 선택합니다.</li></ol>
      <p>무료 등급의 입력·응답은 Google 제품 개선에 사용될 수 있습니다. 개인정보·기밀 자료는 넣지 마세요.</p>
      <div className="row"><a href="https://aistudio.google.com/projects" target="_blank" rel="noopener noreferrer">프로젝트 등급 확인 ↗</a><a href="https://ai.google.dev/gemini-api/docs/rate-limits" target="_blank" rel="noopener noreferrer">현재 한도 안내 ↗</a></div>
    </>}
    {setup && provider === "openai" && <>
      <ol><li>조직 소유자가 Data controls에서 일일 무료 토큰 <strong>대상 안내</strong>를 확인합니다. $5 결제만으로 혜택이 보장되지는 않습니다.</li><li>Share inputs and outputs with OpenAI에서 스튜디오 키가 속한 프로젝트의 입력·출력 공유를 활성화합니다.</li><li>API 잔액을 0보다 크게 유지하고, 대상 모델과 조직 전체의 일일 사용량을 확인합니다. mini 그룹 모델 예: <code>gpt-5-mini-2025-08-07</code>.</li></ol>
      <p>입력·응답이 OpenAI 모델 개선에 사용됩니다. 개인정보·기밀 자료는 넣지 마세요. 무료 한도는 매일 한국 시간 오전 9시에 초기화되며 조직의 다른 앱과 공유합니다. 이미지 생성은 이 무료 글 토큰 혜택으로 안내하지 않습니다.</p>
      <p><strong>무료 혜택 상태: 계정에서 확인 필요.</strong> 아래 연결 확인은 키·모델 접근만 검사합니다. 스튜디오가 데이터 공유를 켜거나 결제·자동 충전을 설정하지 않습니다.</p>
      <div className="row"><a href="https://platform.openai.com/settings/organization/data-controls/sharing" target="_blank" rel="noopener noreferrer">데이터 공유 설정 ↗</a><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">API 잔액 확인 ↗</a><a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer">사용량 확인 ↗</a><a href="https://help.openai.com/en/articles/10306912" target="_blank" rel="noopener noreferrer">무료 토큰 조건 ↗</a></div>
    </>}
  </div>;
}
