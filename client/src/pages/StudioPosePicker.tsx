import { useId, useState } from "react";
import type { StudioCharacter, StudioPanel } from "@shared/studio";
import { STUDIO_CHARACTERS, STUDIO_FAMILY_REFERENCE_URL, STUDIO_POSE_CATEGORIES, poseImageUrl, poseLabel, poseSheetUrl } from "@shared/studioCharacters";

type PoseReference = NonNullable<StudioPanel["poseRefs"]>[number];
const poseNumber = (pose: number) => String(pose).padStart(3, "0");

/** The accepted family reference is mother / father / youngest / eldest. */
const familyPosition: Record<StudioCharacter, number> = { pengpeng: 1, pempem: 0, penguin: 3, pengki: 2 };

export function CharacterPortrait({ character, className = "" }: { character: StudioCharacter; className?: string }) {
  return <span aria-hidden="true" className={`studio-character-portrait ${className}`} style={{
    backgroundImage: `url("${STUDIO_FAMILY_REFERENCE_URL}")`,
    backgroundPosition: `${familyPosition[character] * 100 / 3}% center`,
  }} />;
}

export function PoseThumbnail({ character, pose, className = "" }: { character: StudioCharacter; pose: number; className?: string }) {
  // The packaged artwork has uneven cell margins. The authenticated image
  // endpoint uses measured bounds so helmets, feet and props stay intact.
  return <img alt="" className={`studio-pose-thumbnail ${className}`} src={poseImageUrl(character, pose)} loading="lazy" decoding="async" />;
}

function PoseBrowser({ character, currentPose, disabled, onApply }: {
  character: StudioCharacter; currentPose?: number; disabled: boolean;
  onApply: (reference: PoseReference) => void;
}) {
  const [previewPose, setPreviewPose] = useState(currentPose ?? 1);
  const [category, setCategory] = useState("all");
  const characterInfo = STUDIO_CHARACTERS.find(c => c.id === character)!;
  const poses = Array.from({ length: 100 }, (_, index) => index + 1).filter(pose => category === "all" || Math.floor((pose - 1) / 10) === Number(category));
  const previewCategory = STUDIO_POSE_CATEGORIES[Math.floor((previewPose - 1) / 10)];
  return <div className="studio-pose-browser">
    <div className="studio-pose-browse-header">
      <label className="field small">동작 모아보기<select value={category} disabled={disabled} onChange={event => setCategory(event.target.value)}>
        <option value="all">전체 100개</option>
        {STUDIO_POSE_CATEGORIES.map((name, index) => <option key={name} value={String(index)}>{name} · {index * 10 + 1}–{index * 10 + 10}</option>)}
      </select></label>
      <a className="btn sm ghost" href={poseSheetUrl(character)} download={`${characterInfo.name}-100포즈.png`}>100포즈 원본 ↓</a>
    </div>
    <div className="studio-pose-browser-body">
      <div className="studio-pose-grid" role="group" aria-label={`${characterInfo.name} 포즈 목록`}>
        {poses.map(pose => <button type="button" key={pose} disabled={disabled} className={`studio-pose-tile ${currentPose === pose ? "applied" : ""}`} aria-pressed={previewPose === pose} aria-label={`${poseLabel(character, pose)} 미리보기`} onClick={() => setPreviewPose(pose)}>
          <PoseThumbnail character={character} pose={pose} />
          <span className="studio-pose-number">{poseNumber(pose)}{currentPose === pose && <span aria-label="이 컷에 선택됨"> ✓</span>}</span>
        </button>)}
      </div>
      <aside className="studio-pose-preview" aria-label="선택할 포즈 미리보기">
        <PoseThumbnail character={character} pose={previewPose} className="large" />
        <strong>{characterInfo.name} · {poseNumber(previewPose)}</strong>
        <span className="small muted">{previewCategory}</span>
        <button type="button" className="btn primary" disabled={disabled || currentPose === previewPose} onClick={() => onApply({ character, pose: previewPose })}>{currentPose === previewPose ? "이 컷에 선택됨" : "이 컷에 적용"}</button>
      </aside>
    </div>
  </div>;
}

export function StudioPosePicker({ cast, value, onChange, disabled, panelIndex, imageMode }: {
  cast: StudioCharacter[]; value: PoseReference[]; onChange: (value: PoseReference[]) => void;
  disabled: boolean; panelIndex: number; imageMode: "chatgpt" | "api";
}) {
  const [open, setOpen] = useState(false);
  const [activeCharacter, setActiveCharacter] = useState<StudioCharacter | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listId = useId();
  const available = STUDIO_CHARACTERS.filter(character => cast.includes(character.id));
  const selected = available.flatMap(character => value.filter(reference => reference.character === character.id));
  const currentCharacter = available.find(character => character.id === activeCharacter)?.id ?? available[0]?.id;
  function apply(reference: PoseReference) {
    onChange([...selected.filter(item => item.character !== reference.character), reference].sort((a, b) => STUDIO_CHARACTERS.findIndex(c => c.id === a.character) - STUDIO_CHARACTERS.findIndex(c => c.id === b.character)));
    setAnnouncement(`${poseLabel(reference.character, reference.pose)}를 선택했습니다. 콘텐츠를 저장하면 이 컷에 유지됩니다.`);
  }
  function remove(reference: PoseReference) {
    onChange(selected.filter(item => item.character !== reference.character));
    setAnnouncement(`${poseLabel(reference.character, reference.pose)} 선택을 해제했습니다.`);
  }
  return <section className="studio-pose-picker" aria-label={`${panelIndex + 1}컷 캐릭터 포즈`}>
    <div className="studio-pose-picker-heading"><div><strong>캐릭터 포즈</strong><span className="small muted">인물마다 100개 · 이 컷의 표정과 동작 고르기</span></div><button type="button" className="btn sm" aria-expanded={open} aria-controls={listId} disabled={disabled || !available.length} onClick={() => setOpen(current => !current)}>{open ? "목록 접기" : selected.length ? "포즈 바꾸기" : "포즈 선택"}</button></div>
    {!available.length && <p className="small muted">위에서 등장인물을 먼저 선택해 주세요.</p>}
    {selected.length > 0 && <div className="studio-pose-selections">{selected.map(reference => <div className="studio-pose-selection" key={reference.character}>
      <PoseThumbnail character={reference.character} pose={reference.pose} />
      <div><strong>{poseLabel(reference.character, reference.pose)}</strong><a href={poseImageUrl(reference.character, reference.pose)} download={`${poseLabel(reference.character, reference.pose)}.png`}>참조 이미지 ↓</a></div>
      <button type="button" className="studio-pose-remove" aria-label={`${poseLabel(reference.character, reference.pose)} 선택 해제`} disabled={disabled} onClick={() => remove(reference)}>×</button>
    </div>)}</div>}
    {selected.length > 0 && <p className="studio-pose-help small muted">{imageMode === "api" ? "선택한 포즈와 가족 기준 그림이 이 컷의 API 생성에 함께 사용됩니다." : "ChatGPT에는 가족 기준 그림과 위 참조 이미지를 함께 첨부하세요. 선택한 포즈 설명은 프롬프트에 포함됩니다."}</p>}
    <div id={listId} hidden={!open || !currentCharacter}>
      <div className="studio-pose-character-tabs" role="group" aria-label={`${panelIndex + 1}컷 포즈를 고를 캐릭터`}>{available.map(character => <button type="button" key={character.id} disabled={disabled} aria-pressed={currentCharacter === character.id} onClick={() => setActiveCharacter(character.id)}><CharacterPortrait character={character.id} /><span>{character.name}<small>{character.age}살</small></span></button>)}</div>
      {open && currentCharacter && <PoseBrowser key={currentCharacter} character={currentCharacter} currentPose={selected.find(reference => reference.character === currentCharacter)?.pose} disabled={disabled} onApply={apply} />}
    </div>
    <span className="studio-pose-status small" role="status" aria-live="polite">{announcement}</span>
  </section>;
}

export function StudioCharacterArchive() {
  return <>
    <section className="panel studio-family-reference"><div><h1>캐릭터 · 100포즈 가이드</h1><p>펭펭, 펨펨, 김펭긴, 김펭키 순서로 모았어요. 각 캐릭터의 100개 포즈를 웹툰의 ‘그림 → 캐릭터 포즈’에서 선택할 수 있습니다.</p><a className="btn sm" href={STUDIO_FAMILY_REFERENCE_URL} download="우주펭귄상회-가족-기준그림.png">가족 기준 그림 ↓</a></div><img src={STUDIO_FAMILY_REFERENCE_URL} alt="확정된 우주펭귄상회 네 가족. 머스터드 숄을 두른 펨펨, 몸통이 큰 펭펭, 기타를 든 김펭키, 감자튀김과 큐브를 든 김펭긴." /></section>
    <section className="studio-character-archive">{STUDIO_CHARACTERS.map(character => <article className="panel studio-pose-archive-card" key={character.id}>
      <div className="studio-pose-archive-title"><CharacterPortrait character={character.id} /><div><h2>{character.name}<span>{character.age}살</span></h2><p className="small muted">{character.role}</p></div><span className="studio-pose-count">100포즈</span></div>
      <p>{character.detail}</p>
      <a href={poseSheetUrl(character.id)} target="_blank" rel="noopener noreferrer" className="studio-pose-sheet-link" aria-label={`${character.name} 100포즈 크게 보기`}><img src={poseSheetUrl(character.id)} alt={`${character.name}의 표정과 동작 100개를 10행 10열로 정리한 포즈 가이드`} loading="lazy" /></a>
      <div className="row"><a className="btn sm" href={poseSheetUrl(character.id)} download={`${character.name}-100포즈.png`}>100포즈 이미지 ↓</a><a className="btn sm ghost" href={poseSheetUrl(character.id)} target="_blank" rel="noopener noreferrer">크게 보기 ↗</a></div>
    </article>)}</section>
    <section className="panel studio-canon"><h2>공통 외형 기준</h2><p>작고 동그란 흰 점 눈, 길고 노란 부리, 목이 보이지 않는 투명 유리헬멧과 손으로 그린 듯한 검정 선을 유지합니다. 아빠는 듬직한 몸통, 엄마는 머스터드 숄과 초승달 목걸이·짧은 속눈썹, 정수리 꽁지는 막내에게만 있습니다.</p><p className="small muted">포즈는 동작과 표정 참고용입니다. 인물의 색상과 체형은 가족 기준 그림을 함께 참고합니다.</p></section>
  </>;
}
