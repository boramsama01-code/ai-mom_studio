import { aiProviderLabels, aiProviders, type AiProvider } from "@shared/aiProviders";
import { channelAiRoleLabels, channelAiTaskRoles, defaultChannelRoleSettings, type AiSelection, type ChannelAiTaskRole, type ChannelAiRuntime, type ChannelAiSettingsV2 } from "@shared/channelAi";
import "./channelAi.css";
import { normalizeOptionalResourceInput, resolveFamilyDialogueSettings } from "@shared/familyDialogueSettings";

const descriptions: Record<ChannelAiTaskRole, string> = {
  article_analysis: "원문에서 사실·발언·전망과 조건·한계를 구분합니다.",
  resource_research: "실제 검색과 페이지 확인으로 원자료·추가 활동 자료를 찾습니다.",
  card_copy: "근거를 바탕으로 8장 기획·문구와 가족 대화를 설계합니다.",
  caption: "게시물 아래의 설명·출처·해시태그를 별도 단계로 씁니다.",
  image_brief: "선택한 장의 그림 구도·색상·텍스트 여백을 정합니다.",
  image_generation: "표지와 선택한 페이지의 그림을 실제로 생성·편집합니다.",
  editorial_review: "완성한 원고의 근거·논리·읽기 수준을 대조합니다.",
};
const primaryRoles: ChannelAiTaskRole[] = ["article_analysis", "card_copy", "image_generation"];
const additionalRoles: ChannelAiTaskRole[] = ["resource_research", "caption", "image_brief", "editorial_review"];

export function ChannelAiFields({ value, onChange, runtime }: {
  value: ChannelAiSettingsV2;
  onChange: (value: ChannelAiSettingsV2) => void;
  runtime?: Partial<ChannelAiRuntime>;
}) {
  const changeRole = (role: ChannelAiTaskRole, selection: ChannelAiSettingsV2["roleModels"][ChannelAiTaskRole]) => {
    onChange({ ...value, version: 2, roleModels: { ...value.roleModels, [role]: selection } } as ChannelAiSettingsV2);
  };
  const previewSelection = (role: ChannelAiTaskRole): AiSelection | null => {
    // A partially typed model ID must not make unrelated inheritance previews report a cycle.
    const visited = new Set<ChannelAiTaskRole>();
    let current = role;
    while (!visited.has(current)) {
      visited.add(current);
      const selection = value.roleModels[current];
      if (!("inherit" in selection)) return selection;
      if (selection.inherit === "image_generation") return null;
      current = selection.inherit;
    }
    return null;
  };
  const field = (role: ChannelAiTaskRole) => {
    const configured = value.roleModels[role], label = channelAiRoleLabels[role];
    const resolved = previewSelection(role);
    const isImage = role === "image_generation";
    const inherited = "inherit" in configured;
    const provider = resolved?.provider ?? "openai";
    const defaultModel = runtime?.aiDefaultModels?.[isImage ? "image" : provider];
    const ready = runtime?.aiAvailability?.[provider];
    return <fieldset key={role} className="channel-ai-role">
      <legend>{label}</legend><p className="small muted">{descriptions[role]}</p>
      {!isImage && <label className="field">모델 선택 방식<select aria-label={`${label} 모델 선택 방식`} value={inherited ? `inherit:${configured.inherit}` : "direct"}
        onChange={event => changeRole(role, event.target.value.startsWith("inherit:")
          ? { inherit: event.target.value.slice(8) as ChannelAiTaskRole }
          : { provider, model: resolved?.model || defaultModel || "" })}>
        <option value="direct">이 역할의 모델 직접 지정</option>
        {channelAiTaskRoles.filter(target => target !== role && target !== "image_generation").map(target => <option key={target} value={`inherit:${target}`}>{channelAiRoleLabels[target]} 모델 따르기</option>)}
      </select></label>}
      {inherited ? <p className="channel-ai-inherited small" role="status">{resolved ? <>{channelAiRoleLabels[configured.inherit]} 설정을 따릅니다.<br />{aiProviderLabels[provider]} · {resolved.model || defaultModel || "연결 설정의 기본 모델"}</> : "상속이 순환합니다. 직접 지정하거나 다른 역할을 선택해 주세요."}</p> : <>
        <label className="field">{label} AI<select aria-label={`${label} AI`} value={configured.provider} onChange={event => changeRole(role, { provider: event.target.value as AiProvider, model: "" })}>
          {isImage ? <option value="openai">ChatGPT 이미지 · OpenAI API</option> : aiProviders.map(item => <option key={item} value={item}>{aiProviderLabels[item]}</option>)}
        </select></label>
        <label className="field">{label} 모델 ID<input aria-label={`${label} 모델 ID`} maxLength={120} autoComplete="off" spellCheck={false} value={configured.model}
          onChange={event => changeRole(role, { ...configured, model: event.target.value })}
          placeholder={defaultModel ? `기본: ${defaultModel}` : "비우면 연결 설정의 기본 모델"} />
          <span className="hint">{configured.model.trim() ? "계정에 이 모델의 API 이용 권한이 필요합니다." : defaultModel ? `현재 연결 기본 모델: ${defaultModel}` : "비우면 연결 설정의 기본 모델을 유지합니다."}</span>
        </label>
      </>}
      {ready === false && <p className="notice warn small">{aiProviderLabels[provider]} API 키 연결이 필요합니다. 설정 저장만으로는 호출되지 않습니다.</p>}
      {role === "resource_research" && resolved && provider !== "gemini" && <p className="notice warn small">이 공급자는 연결한 자료의 정리만 지원합니다. 실제 자동 검색을 사용하려면 이 역할에 Gemini를 선택해 주세요. 다른 AI로 자동 전환하지 않습니다.</p>}
    </fieldset>;
  };
  return <section className="channel-ai-fields stack" aria-labelledby="channel-ai-heading">
    <div className="row between"><h3 id="channel-ai-heading">역할별 AI</h3><button type="button" className="btn sm ghost" onClick={() => onChange({ ...value, ...defaultChannelRoleSettings() })}>AI 기본값으로 되돌리기</button></div>
    <p className="small muted">원문 분석·문구·그림을 나누고, 캡션·이미지 지시·검수는 기본적으로 문구 모델을 따릅니다. 저장한 설정은 다음 실행부터 적용되며 실행 중인 작업은 시작할 때의 모델을 유지합니다.</p>
    <div className="channel-ai-grid">{primaryRoles.map(field)}</div>
    <details className="settings-details channel-ai-additional"><summary>추가 역할 · 자료 조사·캡션·이미지 지시·검수</summary><div className="channel-ai-grid">{additionalRoles.map(field)}</div></details>
    <EditorialResearchFields value={value} onChange={onChange} />
    <p className="small muted">새 기본값: Gemini 4 Argon 분석·조사 → GPT-6 Astra 문구 → GPT-Image-2.5 Sunburst 이미지. 기존에 저장한 모델은 유지합니다. ChatGPT 구독과 API 사용료는 별도이며 실패할 때 다른 AI로 자동 전환하지 않습니다.</p>
  </section>;
}

function EditorialResearchFields({ value, onChange }: { value: ChannelAiSettingsV2; onChange: (value: ChannelAiSettingsV2) => void }) {
  const settings = resolveFamilyDialogueSettings(value.editorial);
  const update = (patch: Partial<typeof settings>) => onChange({ ...value, editorial: { ...settings, ...patch } });
  return <details className="settings-details channel-ai-research"><summary>추가 활동 자료 · 자동 검색과 방문 범위</summary><div className="stack">
    <label className="check-row"><input type="checkbox" checked={settings.additionalResourcesAutoSearch} onChange={event => update({ additionalResourcesAutoSearch: event.target.checked })} />추가 활동 자료 자동 검색</label>
    <p className="small muted">8장 콘텐츠 생성을 실행할 때만 검색합니다. 설정 저장으로는 검색·유료 AI 요청이 시작되지 않습니다. 자료 확인에 실패하면 선택 추천을 생략하고 기존 원고를 보존합니다.</p>
    <label className="field">방문 활동 지역<input aria-label="방문 활동 지역" value={settings.activityRegion ?? ""} maxLength={120} placeholder="예: 서울 종로구" onChange={event => update({ activityRegion: event.target.value, ...(settings.visitScope === "region" && normalizeOptionalResourceInput(event.target.value) === undefined ? { visitScope: "off" as const } : {}) })} /><span className="hint">입력한 지역만 사용합니다. 위치를 추측하지 않습니다.</span></label>
    <label className="field">방문 활동 추천 범위<select aria-label="방문 활동 추천 범위" value={settings.visitScope} onChange={event => update({ visitScope: event.target.value as typeof settings.visitScope })}>
      <option value="off">추천하지 않기 · 집에서 할 활동만</option>
      <option value="region" disabled={!settings.activityRegion?.trim()}>입력한 지역에서 찾기</option>
      <option value="national">전국에서 찾기</option>
    </select></label>
  </div></details>;
}
