import type { PublicationOptions } from "@shared/publicationDraft";
import { RecoveryNotice } from "./RecoveryNotice";
import type { useStudioPublicationDraft } from "./usePublicationDraft";
import { ErrorBox } from "./ui";

type Destination = { id: number; label: string };
function OptionsSummary({ options, destinations }: { options: PublicationOptions; destinations: Destination[] }) {
  return <dl className="small">
    <dt>게시 계정</dt><dd>{options.destinationIds.map(id => destinations.find(d => d.id === id)?.label ?? `계정 #${id} · 연결 확인 필요`).join(", ") || "아직 선택하지 않음"}</dd>
    <dt>게시 시점</dt><dd>{options.timing === "now" ? "지금 게시" : `예약 · ${options.scheduledAtKst.replace("T", " ") || "시각 미입력"} (한국 시간)`}</dd>
  </dl>;
}

/** Source and direct creation use the same save/conflict/recovery language. */
export function PublicationDraftControls({ draft, destinations, disabled = false }: {
  draft: ReturnType<typeof useStudioPublicationDraft>; destinations: Destination[]; disabled?: boolean;
}) {
  return <div className="stack publication-draft-controls">
    <RecoveryNotice recovery={draft.recovery} formatValue={value => [
      ...(value.captions ? [`인스타그램 캡션\n${value.captions.instagram}`, `텔레그램 캡션\n${value.captions.telegram}`] : []),
      `게시 계정\n${value.options.destinationIds.map(id => destinations.find(d => d.id === id)?.label ?? `계정 #${id}`).join(", ") || "아직 선택하지 않음"}`,
      `게시 시점\n${value.options.timing === "now" ? "지금 게시" : `예약 · ${value.options.scheduledAtKst.replace("T", " ") || "시각 미입력"} (한국 시간)`}`,
    ].join("\n\n")} />
    <div className="row publication-draft-save">
      <span className="small" role="status">{draft.saving ? "게시 준비 저장 중…" : draft.conflict ? "게시 준비 저장 충돌 · 입력 유지됨" : draft.error ? "게시 준비 저장 실패 · 입력 유지됨" : draft.needsSave ? "게시 준비에 저장할 변경이 있습니다" : `게시 준비 저장됨 · v${draft.version}`}</span>
      <button type="button" className="btn" disabled={disabled || draft.saving || !draft.needsSave || !!draft.conflict || !!draft.recovery.pending} onClick={() => { void draft.save().catch(() => {}); }}>게시 준비 저장</button>
    </div>
    <p className="hint">계정·시각을 저장해 두고 다시 열어 이어서 준비할 수 있습니다. 확인을 마치면 아래 게시 버튼으로 전송을 요청하세요.</p>
    {draft.error && <ErrorBox error={draft.error} />}
    {draft.conflict && <div className="notice warn stack"><strong>다른 곳에서 저장한 게시 준비가 있습니다. 내 입력은 유지했습니다.</strong>
      <details open><summary>최신 저장본과 비교</summary><div className="card-copy-compare">
        <div><h4>최신 저장본</h4>{draft.conflict.captions && <><pre>{draft.conflict.captions.instagram}</pre><pre>{draft.conflict.captions.telegram}</pre></>}<OptionsSummary options={draft.conflict.options} destinations={destinations} /></div>
        <div><h4>내 입력</h4>{draft.captions && <><pre>{draft.captions.instagram}</pre><pre>{draft.captions.telegram}</pre></>}<OptionsSummary options={draft.options} destinations={destinations} /></div>
      </div></details>
      <div className="row"><button type="button" className="btn sm" disabled={disabled || draft.saving || !!draft.recovery.pending} onClick={draft.acceptServer}>최신 게시 준비 사용</button><button type="button" className="btn sm" disabled={disabled || draft.saving || !!draft.recovery.pending} onClick={() => { void draft.saveMine().catch(() => {}); }}>내 게시 준비로 다시 저장</button></div>
    </div>}
  </div>;
}
