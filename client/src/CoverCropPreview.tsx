import { useId, useState, type ReactNode } from "react";
import { INSTAGRAM_COVER_SAFE, instagramCropWindow, type InstagramPreviewMode } from "@shared/instagramCrop";
import "./coverCropPreview.css";

type Props = { src?: string; alt: string; busy?: boolean; stale?: boolean; onError?: () => void; placeholder?: ReactNode; status?: ReactNode };
const modes: Array<{ id: InstagramPreviewMode; label: string }> = [{ id: "full", label: "전체 4:5" }, { id: "square", label: "정방형 1:1" }, { id: "profile", label: "프로필 3:4" }];

/** All modes use the same render bytes. Viewing a crop never saves or regenerates. */
export function CoverCropPreview({ src, alt, busy, stale, onError, placeholder, status }: Props) {
  const [mode, setMode] = useState<InstagramPreviewMode>("full"), [guides, setGuides] = useState(false), id = useId();
  const crop = instagramCropWindow(mode), safe = INSTAGRAM_COVER_SAFE;
  return <section className="cover-crop-preview" aria-label="표지 잘림 확인">
    <div className="cover-crop-modes" role="group" aria-label="표지 미리보기 비율">{modes.map(value => <button key={value.id} type="button" aria-pressed={mode === value.id} onClick={() => setMode(value.id)}>{value.label}</button>)}</div>
    <figure className={`card-copy-preview cover-crop-viewport ${stale ? "is-stale" : ""}`} style={{ aspectRatio: `${crop.width} / ${crop.height}` }} aria-busy={busy} data-crop-mode={mode}>
      {src ? <img src={src} alt={alt} onError={onError} /> : <div className="card-copy-placeholder">{placeholder ?? "선택한 표지의 실제 배치를 준비하고 있습니다."}</div>}
      {guides && src && <div className="cover-crop-guide" aria-hidden="true" style={{ left: `${(safe.x - crop.x) / crop.width * 100}%`, top: `${(safe.y - crop.y) / crop.height * 100}%`, width: `${safe.width / crop.width * 100}%`, height: `${safe.height / crop.height * 100}%` }}><span>핵심 요소 안전영역</span></div>}
      {status && <figcaption role="status">{status}</figcaption>}
    </figure>
    <label className="cover-crop-toggle" htmlFor={id}><input id={id} type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} />안전영역 표시</label>
    <p className="hint">{mode === "profile" ? "프로필은 중앙 크롭 예상 모습입니다. 앱에서 조정한 썸네일 위치에 따라 달라질 수 있어요." : mode === "square" ? "정방형으로 잘렸을 때 제목·얼굴·중요한 소품이 남는지 확인하세요." : "표지는 1080×1350으로 저장됩니다. 제목과 핵심 이미지는 중앙 안전영역 안에 두세요."} 안내선과 미리보기 비율은 출력 파일에 반영되지 않습니다.</p>
  </section>;
}
