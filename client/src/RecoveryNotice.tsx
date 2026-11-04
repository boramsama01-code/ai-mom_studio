import { useEffect, useState } from "react";
import type { DraftRecovery } from "./useDraftRecovery";
import "./recovery.css";

export function RecoveryNotice<T>({ recovery, formatValue }: { recovery: DraftRecovery<T>; formatValue?: (value: T) => string }) {
  const [compared, setCompared] = useState(false);
  useEffect(() => setCompared(false), [recovery.pending?.token, recovery.conflict]);
  const format = formatValue ?? ((value: T) => typeof value === "string" ? value : JSON.stringify(value, null, 2));
  if (recovery.pending) return <section className="notice warn stack draft-recovery" aria-label={`${recovery.label} 기기 복구본`}>
    <strong>서버에 저장하지 않은 {recovery.label}의 기기 복구본이 있어요.</strong>
    <p className="small">{new Date(recovery.pending.savedAt).toLocaleString("ko-KR")}에 임시 보관했습니다. 복원은 편집기에만 적용되며, 서버에 반영하려면 따로 저장해야 합니다.</p>
    {recovery.copies.length > 1 && <label className="field">확인할 복구본<select value={recovery.pending.token} onChange={event => recovery.choose(event.target.value)}>{recovery.copies.map((record, index) => <option key={record.token} value={record.token}>{index + 1}번 · {new Date(record.savedAt).toLocaleString("ko-KR")} · {format(record.value).replace(/\s+/g, " ").slice(0, 50)}</option>)}</select><span className="hint">같은 콘텐츠의 복구본 {recovery.copies.length}개가 있습니다. 선택하지 않은 복구본은 그대로 보관됩니다.</span></label>}
    {recovery.conflict ? <div className="stack">
      <p className="small">복구본을 작성한 뒤 서버 버전이 바뀌었습니다. 두 내용을 비교한 뒤 선택해 주세요.</p>
      <details open><summary>서버 저장본과 기기 복구본 비교</summary><div className="draft-recovery-compare"><div><h4>현재 서버 저장본</h4><pre>{format(recovery.serverValue)}</pre></div><div><h4>이 기기의 미저장 복구본</h4><pre>{format(recovery.pending.value)}</pre></div></div></details>
      <label className="check"><input type="checkbox" checked={compared} onChange={event => setCompared(event.target.checked)} />두 내용의 차이를 확인했습니다.</label>
    </div> : <details><summary>복구본 내용 확인</summary><pre>{format(recovery.pending.value)}</pre></details>}
    <div className="row"><button className="btn primary sm" disabled={recovery.conflict && !compared} onClick={recovery.restore}>복구본을 편집기에 불러오기</button><button className="btn sm" onClick={recovery.discard}>기기 복구본 버리기</button></div>
    {recovery.error && <p className="small" role="alert">{recovery.error}</p>}
  </section>;
  if (recovery.error && recovery.dirty) return <p className="notice warn small draft-recovery" role="alert">{recovery.error}</p>;
  if (recovery.status === "saved" && recovery.dirty) return <p className="small muted draft-recovery" role="status">이 기기에 임시 보관됨 · 서버에는 아직 저장하지 않았습니다. 같은 로그인에서 7일 동안 복구할 수 있습니다.</p>;
  return null;
}
