import { Icon } from "./icons";
export function SaveState({ saving, error, dirty, local, version }: { saving?: boolean; error?: unknown; dirty: boolean; local?: boolean; version: number }) {
  const kind = saving ? "saving" : error ? "error" : dirty ? local ? "local" : "dirty" : "saved";
  const label = saving ? "서버에 저장 중" : error ? "서버 저장 실패 · 입력 유지" : dirty ? local ? "기기에 임시 보관 · 서버 저장 전" : "저장 전 변경사항" : "서버 저장 완료";
  return <span className={`save-state is-${kind}`} role="status" aria-live="polite"><Icon name={kind === "saved" ? "check" : kind === "error" ? "alert" : "clock"} size={14}/><span>{label}</span><span className="save-state-version">v{version}</span></span>;
}
