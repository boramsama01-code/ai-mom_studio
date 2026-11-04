import { aiProviderLabels, aiProviders, type AiProvider } from "@shared/aiProviders";
import { channelAiRoleLabels, channelAiRoles, defaultChannelAiSettings, type ChannelAiRole, type ChannelAiRuntime, type ChannelAiSettings } from "@shared/channelAi";
import "./channelAi.css";

export function ChannelAiFields({ value, onChange, runtime }: {
  value: ChannelAiSettings;
  onChange: (value: ChannelAiSettings) => void;
  runtime?: Partial<ChannelAiRuntime>;
}) {
  const changeProvider = (role: ChannelAiRole, provider: AiProvider) => {
    // A GPT model name must not follow an operator's switch to Gemini or Claude.
    onChange({ ...value, [role]: { provider, model: "" } } as ChannelAiSettings);
  };
  return <section className="channel-ai-fields stack" aria-labelledby="channel-ai-heading">
    <div className="row between"><h3 id="channel-ai-heading">역할별 AI</h3><button type="button" className="btn sm ghost" onClick={() => onChange(defaultChannelAiSettings())}>AI 기본값으로 되돌리기</button></div>
    <p className="small muted">기사의 사실 정리, 카드 문구 작성, 그림 제작을 각각 맡깁니다. 저장한 설정은 이 채널의 다음 생성부터 적용됩니다. 이미 실행 중인 작업은 시작할 때의 모델을 유지합니다.</p>
    <div className="channel-ai-grid">{channelAiRoles.map(role => {
      const selection = value[role], label = channelAiRoleLabels[role];
      const defaultModel = runtime?.aiDefaultModels?.[role === "image" ? "image" : selection.provider];
      const ready = runtime?.aiAvailability?.[selection.provider];
      return <fieldset key={role} className="channel-ai-role">
        <legend>{label}</legend>
        <p className="small muted">{role === "summary" ? "원문에서 사실·수치·조건을 정리합니다." : role === "copy" ? "요약과 원문 근거로 각 장의 문구를 씁니다." : "표지와 선택한 페이지의 그림을 만듭니다."}</p>
        <label className="field">{label} AI<select aria-label={`${label} AI`} value={selection.provider} onChange={event => changeProvider(role, event.target.value as AiProvider)}>
          {role === "image" ? <option value="openai">ChatGPT 이미지 · OpenAI API</option> : aiProviders.map(provider => <option key={provider} value={provider}>{aiProviderLabels[provider]}</option>)}
        </select></label>
        <label className="field">{label} 모델 ID<input aria-label={`${label} 모델 ID`} maxLength={120} autoComplete="off" spellCheck={false} value={selection.model}
          onChange={event => onChange({ ...value, [role]: { ...selection, model: event.target.value } })}
          placeholder={defaultModel ? `기본: ${defaultModel}` : "비우면 연결 설정의 기본 모델"} />
          <span className="hint">{selection.model.trim() ? "이 채널에서 사용할 모델입니다. 계정의 해당 모델 이용 권한이 필요합니다." : defaultModel ? `현재 기본 모델: ${defaultModel}` : "비우면 연결 설정의 기본 모델을 사용합니다."}</span>
        </label>
        {ready === false && <p className="notice warn small">{aiProviderLabels[selection.provider]} API 키 연결이 필요합니다. 설정 저장만으로는 호출되지 않습니다.</p>}
      </fieldset>;
    })}</div>
    <p className="small muted">기본값은 Gemini 요약 → GPT 문구 → OpenAI 이미지입니다. 이미지 생성은 현재 OpenAI의 gpt-image 계열을 지원합니다. ChatGPT 구독과 API 사용료는 별도이며, 실패할 때 다른 AI로 자동 전환하지 않습니다.</p>
  </section>;
}
