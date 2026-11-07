import type { FamilyPageId } from "@shared/familyDialogue";
import { familyCollectionDesign } from "@shared/familyCollectionDesigns";
import { READING_CARD_PROFILES, readingProfileForTemplateKey } from "@shared/readingCardProfiles";

/** A role diagram only: it never contains manuscript text or rendered artwork. */
export function FamilyPageLayout({ pageId }: { pageId: FamilyPageId }) {
  const line = (y: number, width = 52, x = 14) => <rect x={x} y={y} width={width} height="3" rx="1.5" />;
  const panel = (x: number, y: number, width: number, height: number) => <rect className="family-layout-panel" x={x} y={y} width={width} height={height} rx="3" />;
  return <svg className="family-page-layout" viewBox="0 0 80 100" aria-hidden="true" focusable="false">
    <rect className="family-layout-paper" x="1" y="1" width="78" height="98" rx="5" />
    {pageId === "cover" && <>{line(12, 26)}{line(24)}{line(32, 40)}{panel(14, 45, 52, 32)}{line(86, 32)}</>}
    {pageId === "news_summary" && <>{line(12, 36)}{panel(14, 25, 52, 17)}{panel(14, 47, 52, 17)}{panel(14, 69, 52, 17)}</>}
    {pageId === "implication" && <>{line(12, 38)}{line(27)}{line(35, 44)}{panel(14, 48, 52, 30)}{line(87, 30)}</>}
    {pageId === "discussion" && <>{line(12, 28)}{panel(12, 30, 56, 40)}{line(80, 44)}{line(88, 32)}</>}
    {pageId === "perspectives" && <>{line(12, 40)}{panel(10, 27, 27, 54)}{panel(43, 27, 27, 54)}{line(88, 36)}</>}
    {pageId === "concept" && <>{line(12, 36)}{panel(14, 27, 52, 24)}{line(59, 44)}{line(67)}{line(75, 40)}{line(87, 28)}</>}
    {pageId === "activity" && <>{line(12, 34)}{panel(14, 27, 52, 22)}{line(59)}{line(69, 46)}{line(79, 38)}{line(89, 24)}</>}
    {pageId === "outro" && <><circle className="family-layout-panel" cx="40" cy="30" r="15" />{line(57, 40, 20)}{line(68, 48, 16)}{line(80, 28, 26)}</>}
  </svg>;
}

export function FamilyDesignPicker({ templateKey, disabled, onChange }: { templateKey: string; disabled: boolean; onChange: (key: string) => void }) {
  const profile = readingProfileForTemplateKey(templateKey), collection = familyCollectionDesign(templateKey);
  const collectionName = collection && `${collection.name}${collection.colorName ? ` · ${collection.colorName}` : ""}`;
  const currentName = profile?.label ?? collectionName ?? "기존 8장 디자인";
  return <details className="family-whole-design">
    <summary><strong>전체 8장 디자인</strong><span>현재 · {currentName}</span></summary>
    <div className="family-design-content stack">
      <p className="hint">8장 전체에 사용할 배치와 색을 선택하세요. 실제 문구와 이미지 배치는 선택한 페이지의 미리보기에서 확인합니다.</p>
      <label className="field">전체 목록에서 선택
        <select aria-label="전체 목록에서 선택" value={profile?.templateKey ?? (collection ? templateKey : "legacy")} disabled={disabled} onChange={event => onChange(event.target.value === "legacy" ? "builtin:classic" : event.target.value)}>
          <option value="legacy">기존 8장 디자인</option>
          {collection && <option value={templateKey}>{collectionName} · 8장 컬러 적용</option>}
          {READING_CARD_PROFILES.map(value => <option key={value.id} value={value.templateKey}>{value.label}{value.sourceStyleId ? "" : " · 기존"} · 사진 {value.images.length - 1}장</option>)}
        </select>
        <span className="hint">{collection ? "기본 세트에서 선택한 컬러를 8장 전용 배치에 적용합니다. 현재 원고의 8장 구성과 직접 지정한 배경색은 유지합니다." : "1080×1350 · 8장. 디자인을 바꿔도 입력한 문구와 이전 이미지 기록은 유지합니다. Canva 자동 제작은 해당 마스터 검증·등록이 완료된 뒤 가능합니다."}</span>
      </label>
      <div className="family-design-example-heading"><strong>디자인 예시</strong><span className="hint">현재 원고가 아닙니다. 예시 속 문구와 사진은 가져오지 않습니다.</span></div>
      <div className="family-design-examples" role="group" aria-label="전체 8장 디자인 예시">
        {READING_CARD_PROFILES.filter(value => value.sourceStyleId).map(value => <button key={value.id} className="family-design-example" type="button" aria-label={`디자인 선택 · ${value.label}`} aria-pressed={templateKey === value.templateKey} disabled={disabled} onClick={() => onChange(value.templateKey)}>
          <img src={`/cardnews14/${value.sourceStyleId}-cover.webp`} alt="" loading="lazy" decoding="async" width="270" height="337" />
          <strong>{value.label}</strong><span>{templateKey === value.templateKey ? "선택됨" : "8장에 적용"}</span>
        </button>)}
      </div>
    </div>
  </details>;
}
