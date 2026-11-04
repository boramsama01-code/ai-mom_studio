import { useId, type ReactNode } from "react";
import "./workMode.css";

export type WorkMode = "auto" | "manual";

/** A production mode, not a permission to start a paid request on mount.
 * Detailed operator edits remain available in automatic mode. */
export function WorkModeControl({ mode, onChange, disabled = false, automaticUnavailable, onConfigure, children, context = "create" }: {
  mode: WorkMode;
  onChange: (mode: WorkMode) => void;
  disabled?: boolean;
  automaticUnavailable?: string | null;
  onConfigure?: () => void;
  children?: ReactNode;
  context?: "create" | "collect" | "publish";
}) {
  const id = useId();
  const automaticLabel = { create: "앱 안에서 생성·수정·미리보기", collect: "자료 수집과 원문 확인", publish: "연결 계정으로 즉시·예약 게시" }[context];
  const automaticHelp = {
    create: "자동으로 만든 뒤에도 문구와 그림을 자세히 수정하고 다시 만들 수 있습니다. 생성 버튼을 눌렀을 때만 AI를 호출합니다.",
    collect: "수집한 자료를 골라 본문을 확인하고 자동 제작으로 이어갑니다. 수집 조건은 필요한 때 펼쳐서 바꿀 수 있습니다.",
    publish: "콘텐츠에서 이미지·캡션·계정을 확인하고 승인하면 전송합니다. 예약과 실패한 전송의 실제 결과를 여기서 확인하세요.",
  }[context];
  return <section className="work-mode" aria-label="작업 방식">
    <div className="work-mode-options" role="group" aria-describedby={`${id}-help`}>
      <button type="button" className={`work-mode-option ${mode === "auto" ? "selected" : ""}`} aria-pressed={mode === "auto"} disabled={disabled} onClick={() => onChange("auto")}><strong>자동</strong><span>{automaticLabel}</span></button>
      <button type="button" className={`work-mode-option ${mode === "manual" ? "selected" : ""}`} aria-pressed={mode === "manual"} disabled={disabled} onClick={() => onChange("manual")}><strong>수동</strong><span>API 한도·연결 문제일 때</span></button>
    </div>
    <p id={`${id}-help`} className="work-mode-help">{mode === "auto" ? automaticHelp : context === "publish" ? "전송 중이거나 결과가 미확정인 콘텐츠는 먼저 실제 게시 여부를 확인하세요. 수동 게시도 중복되지 않게 진행해야 합니다." : "직접 작성하거나 외부에서 만든 결과를 가져옵니다. 저장한 작업을 유지한 채 자동으로 돌아갈 수 있습니다."}</p>
    {mode === "auto" && automaticUnavailable && <div className="notice warn small work-mode-unavailable" role="status"><span>{automaticUnavailable}</span>{onConfigure && <button type="button" className="btn sm" disabled={disabled} onClick={onConfigure}>연결 설정</button>}<button type="button" className="btn sm" disabled={disabled} onClick={() => onChange("manual")}>수동으로 계속하기</button></div>}
    {children}
  </section>;
}
