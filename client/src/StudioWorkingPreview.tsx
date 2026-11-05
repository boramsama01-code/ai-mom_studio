import { useEffect, useState } from "react";
import type { StudioContent } from "@shared/studio";
import { Icon } from "./icons";

/** Shares the editor's selected panel and draft; never creates another content copy. */
export function StudioWorkingPreview({ form, base, selected, onSelect, onEdit }: { form: StudioContent; base: StudioContent; selected: number; onSelect: (index: number) => void; onEdit: () => void }) {
  const [open, setOpen] = useState(() => typeof matchMedia === "function" && matchMedia("(min-width:1100px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(min-width:1100px)");
    const change = () => setOpen(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const panel = form.panels[selected], saved = base.panels[selected];
  const changed = panel.scene !== saved.scene || panel.dialogue !== saved.dialogue;
  return <details className="studio-working-preview" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary><span><Icon name="design" size={17}/>컷 미리보기</span><Icon name="chevron" size={14}/></summary>
    <div className="working-preview-body">
      <div className="working-preview-pages" role="group" aria-label="미리볼 컷">{form.panels.map((value,index) => <button type="button" key={index} aria-label={`${index+1}컷 미리보기`} aria-pressed={selected === index} onClick={() => onSelect(index)}>{String(index+1).padStart(2,"0")}<span>{value.imageId ? "그림" : "구성"}</span></button>)}</div>
      <figure><div className="working-preview-art">{panel.imageId ? <img src={`/api/studio/images/${panel.imageId}`} alt="선택한 컷의 저장된 그림"/> : <div className="working-preview-empty"><Icon name="pen" size={28}/><span>아직 그림이 없습니다</span></div>}</div><figcaption><span>{selected+1} / {form.panels.length}</span><span>{changed ? "문구 편집 중" : "저장된 컷"}</span></figcaption><p className="working-preview-dialogue">{panel.dialogue || "이 컷의 문구를 작성해 주세요."}</p></figure>
      <p className="small muted">저장된 그림과 현재 입력한 문구입니다. 최종 배치는 완성 단계에서 확인하세요.</p>
      <button type="button" className="btn" onClick={onEdit}>이 컷 장면·문구 편집 <Icon name="arrow" size={16}/></button>
    </div>
  </details>;
}
