import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { StudioCharacter, StudioPanel } from "@shared/studio";
import { STUDIO_CHARACTERS, STUDIO_FAMILY_REFERENCE_URL, STUDIO_POSE_CATEGORIES, poseImageUrl, poseLabel } from "@shared/studioCharacters";
import { FINAL_POSE_VERSION, PREVIOUS_POSE_VERSION, type PoseAssetVersion, FINAL_STUDIO_ASSETS, FINAL_FACE_FILTERS, finalAssetUrl, finalPose } from "@shared/studioFinalAssets";

type PoseReference = NonNullable<StudioPanel["poseRefs"]>[number];
const poseNumber = (pose: number) => String(pose).padStart(3, "0");

const ArtworkContext = createContext<{ retry: number; failed: () => void } | null>(null);

/** Retry belongs to the group, never inside a character label or pose button. */
function ReferenceImages({ children }: { children: ReactNode }) {
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  return <ArtworkContext.Provider value={{ retry, failed: () => setFailed(true) }}>
    {failed && <div className="studio-reference-error" role="alert"><span>그림을 불러오지 못했어요. 다시 불러와 주세요.</span><button type="button" className="btn sm" onClick={() => { setFailed(false); setRetry(current => current + 1); }}>그림 다시 불러오기</button></div>}
    {children}
  </ArtworkContext.Provider>;
}

function useArtwork(source: string) {
  const group = useContext(ArtworkContext);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const src = group?.retry ? `${source}${source.includes("?") ? "&" : "?"}retry=${group.retry}` : source;
  return { src, failed: failedSource === src, onError: () => { setFailedSource(src); group?.failed(); } };
}

function ArtworkPreview({ source, alt, lazy = false }: { source: string; alt: string; lazy?: boolean }) {
  const artwork = useArtwork(source);
  return <span className="studio-registered-artwork"><img src={artwork.src} alt={alt} hidden={artwork.failed} onError={artwork.onError} loading={lazy ? "lazy" : "eager"} decoding="async" />{artwork.failed && <span className="studio-artwork-missing">그림 로딩 실패</span>}</span>;
}

export function CharacterPortrait({ character, className = "" }: { character: StudioCharacter; className?: string }) {
  const artwork = useArtwork(poseImageUrl(character, 1, FINAL_POSE_VERSION));
  const characterInfo = STUDIO_CHARACTERS.find(c => c.id === character)!;
  return <span className={`studio-character-portrait ${className}`}>
    <img src={artwork.src} alt={`${characterInfo.name} 기준 그림`} hidden={artwork.failed} onError={artwork.onError} decoding="async" />
    {artwork.failed && <span className="studio-artwork-missing">그림 로딩 실패</span>}
  </span>;
}

export function PoseThumbnail({ character, pose, assetVersion, className = "" }: { character: StudioCharacter; pose: number; assetVersion?: PoseAssetVersion; className?: string }) {
  // The packaged artwork has uneven cell margins. The authenticated image
  // endpoint uses measured bounds so helmets, feet and props stay intact.
  const artwork = useArtwork(poseImageUrl(character, pose, assetVersion));
  return <span className={`studio-pose-thumbnail ${className}`}>
    <img alt="" src={artwork.src} hidden={artwork.failed} onError={artwork.onError} loading="lazy" decoding="async" />
    {artwork.failed && <span className="studio-artwork-missing">그림 로딩 실패</span>}
  </span>;
}

export function StudioRegisteredCharacters({ cast, onChange, disabled, onChoosePoses }: {
  cast: StudioCharacter[]; onChange: (character: StudioCharacter, checked: boolean) => void;
  disabled: boolean; onChoosePoses: () => void;
}) {
  return <section className="panel studio-registered-characters" aria-label="등록된 캐릭터와 포즈" data-testid="studio-registered-characters">
    <ReferenceImages>
      <div className="studio-registered-heading"><div><h2>등록된 캐릭터 · 400포즈</h2><p>함께 등장할 인물을 고르고, 각 컷에 사용할 포즈를 선택하세요.</p></div><button type="button" className="btn" disabled={disabled || !cast.length} onClick={onChoosePoses}>포즈 고르기</button></div>
      <fieldset className="studio-registered-cast" disabled={disabled}><legend>등장인물 · 나이순</legend><div className="studio-registered-grid">{STUDIO_CHARACTERS.map(character => <label key={character.id} className={`studio-registered-choice ${cast.includes(character.id) ? "selected" : ""}`}>
        <input type="checkbox" checked={cast.includes(character.id)} aria-label={`${character.name} 등장인물 선택`} onChange={event => onChange(character.id, event.target.checked)} />
        <CharacterPortrait character={character.id} />
        <span className="studio-registered-name"><strong>{character.name}</strong><small>{character.age}살</small><span className="studio-pose-count">100포즈</span></span>
      </label>)}</div></fieldset>
      <div className="studio-registered-footer"><span>{cast.length ? `${cast.length}명 선택됨 · 포즈는 컷마다 따로 적용됩니다.` : "등장인물을 먼저 선택하면 포즈를 고를 수 있어요."}</span><a href={STUDIO_FAMILY_REFERENCE_URL} target="_blank" rel="noopener noreferrer">가족 기준 그림 크게 보기 ↗</a></div>
    </ReferenceImages>
  </section>;
}

function ArtworkDialog({ source, title, onClose }: { source: string; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
  }, []);
  return <dialog ref={ref} className="studio-artwork-dialog" aria-label={title} onClose={onClose} onCancel={onClose}>
    <div className="studio-artwork-dialog-heading"><strong>{title}</strong><button type="button" className="btn" autoFocus onClick={onClose}>닫기</button></div>
    <ArtworkPreview source={source} alt={title} />
    <a className="btn" href={source} download={`${title}.png`}>투명 PNG 다운로드</a>
  </dialog>;
}

function PoseBrowser({ character, currentReference, disabled, onApply }: {
  character: StudioCharacter; currentReference?: PoseReference; disabled: boolean;
  onApply?: (reference: PoseReference) => void;
}) {
  const [previewPose, setPreviewPose] = useState(currentReference?.pose ?? 1);
  const [version, setVersion] = useState<string>(currentReference ? currentReference.assetVersion ?? "legacy" : FINAL_POSE_VERSION);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [enlarged, setEnlarged] = useState(false);
  const assetVersion: PoseAssetVersion | undefined = version === FINAL_POSE_VERSION ? FINAL_POSE_VERSION : version === PREVIOUS_POSE_VERSION ? PREVIOUS_POSE_VERSION : undefined;
  const characterInfo = STUDIO_CHARACTERS.find(c => c.id === character)!;
  const poses = Array.from({ length: 100 }, (_, index) => index + 1).filter(pose => {
    const asset = finalPose(character, pose, assetVersion)!;
    const categoryMatches = category === "all" || (assetVersion ? asset.comic_face_type === category : Math.floor((pose - 1) / 10) === Number(category));
    return categoryMatches && (!query.trim() || `${assetVersion ? `${asset.id} ${asset.title} ${asset.description}` : poseLabel(character, pose)} ${poseNumber(pose)}`.includes(query.trim()));
  });
  const preview = assetVersion ? finalPose(character, previewPose, assetVersion) : undefined;
  const label = poseLabel(character, previewPose, assetVersion);
  const source = poseImageUrl(character, previewPose, assetVersion);
  const isApplied = currentReference?.pose === previewPose && currentReference?.assetVersion === assetVersion;
  function changeVersion(next: string) { setVersion(next); setCategory("all"); setQuery(""); }
  return <div className="studio-pose-browser">
    <div className="studio-pose-browse-header">
      <label className="field small">그림 버전<select value={version} disabled={disabled} onChange={event => changeVersion(event.target.value)}><option value={FINAL_POSE_VERSION}>새 얼굴·단색 포즈 · 100개</option><option value={PREVIOUS_POSE_VERSION}>이전 완성본 · 100개</option><option value="legacy">이전 포즈 · 기존 선택 유지</option></select></label>
      <label className="field small">{assetVersion ? "표정 모아보기" : "동작 모아보기"}<select value={category} disabled={disabled} onChange={event => setCategory(event.target.value)}>
        {assetVersion ? FINAL_FACE_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>) : <><option value="all">전체 100개</option>{STUDIO_POSE_CATEGORIES.map((name, index) => <option key={name} value={String(index)}>{name} · {index * 10 + 1}–{index * 10 + 10}</option>)}</>}
      </select></label>
      <label className="field small">포즈 찾기<input value={query} disabled={disabled} placeholder="이름·설명·번호" onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {!assetVersion && <p className="small muted">이전에 저장한 포즈입니다. 최종 포즈로 바꾸려면 그림 버전을 선택한 뒤 이 컷에 적용해 주세요.</p>}
    <div className="studio-pose-browser-body">
      <div className="studio-pose-grid" role="group" aria-label={`${characterInfo.name} 포즈 목록`}>
        {poses.map(pose => <button type="button" key={pose} disabled={disabled} className={`studio-pose-tile ${currentReference?.pose === pose && currentReference?.assetVersion === assetVersion ? "applied" : ""}`} aria-pressed={previewPose === pose} aria-label={`${poseLabel(character, pose, assetVersion)} 미리보기`} onClick={() => setPreviewPose(pose)}>
          <PoseThumbnail character={character} pose={pose} assetVersion={assetVersion} />
          <span className="studio-pose-number">{assetVersion ? finalPose(character, pose, assetVersion)!.id : poseNumber(pose)}</span>
          {assetVersion && <span className="studio-pose-title">{finalPose(character, pose, assetVersion)!.title}</span>}
        </button>)}
        {!poses.length && <p className="small muted">조건에 맞는 포즈가 없습니다.</p>}
      </div>
      <aside className="studio-pose-preview" aria-label="선택할 포즈 미리보기">
        <PoseThumbnail character={character} pose={previewPose} assetVersion={assetVersion} className="large" />
        <strong>{label}</strong>
        <span className="small muted">{preview?.description ?? STUDIO_POSE_CATEGORIES[Math.floor((previewPose - 1) / 10)]}</span>
        <button type="button" className="btn" onClick={() => setEnlarged(true)}>크게 보기</button>
        <a className="btn sm ghost" href={source} download={`${label}.png`}>투명 PNG 다운로드</a>
        {assetVersion === FINAL_POSE_VERSION && <a className="btn sm ghost" href={`${source}&format=svg&download=1`} download={`${label}.svg`}>벡터 SVG 다운로드</a>}
        {onApply && <button type="button" className="btn primary" disabled={disabled || isApplied} onClick={() => onApply({ character, pose: previewPose, ...(assetVersion ? { assetVersion } : {}) })}>{isApplied ? "이 컷에 선택됨" : "이 컷에 적용"}</button>}
      </aside>
    </div>
    {enlarged && <ArtworkDialog source={source} title={label} onClose={() => setEnlarged(false)} />}
  </div>;
}

export function StudioPosePicker({ cast, value, onChange, disabled, panelIndex, imageMode }: {
  cast: StudioCharacter[]; value: PoseReference[]; onChange: (value: PoseReference[]) => void;
  disabled: boolean; panelIndex: number; imageMode: "chatgpt" | "api";
}) {
  const [open, setOpen] = useState(true);
  const [activeCharacter, setActiveCharacter] = useState<StudioCharacter | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listId = useId();
  const available = STUDIO_CHARACTERS.filter(character => cast.includes(character.id));
  const selected = available.flatMap(character => value.filter(reference => reference.character === character.id));
  const currentCharacter = available.find(character => character.id === activeCharacter)?.id ?? available[0]?.id;
  function apply(reference: PoseReference) {
    onChange([...selected.filter(item => item.character !== reference.character), reference].sort((a, b) => STUDIO_CHARACTERS.findIndex(c => c.id === a.character) - STUDIO_CHARACTERS.findIndex(c => c.id === b.character)));
    setAnnouncement(`${poseLabel(reference.character, reference.pose, reference.assetVersion)}를 선택했습니다. 콘텐츠를 저장하면 이 컷에 유지됩니다.`);
  }
  function remove(reference: PoseReference) {
    onChange(selected.filter(item => item.character !== reference.character));
    setAnnouncement(`${poseLabel(reference.character, reference.pose, reference.assetVersion)} 선택을 해제했습니다.`);
  }
  return <section className="studio-pose-picker" aria-label={`${panelIndex + 1}컷 캐릭터 포즈`}><ReferenceImages>
    <div className="studio-pose-picker-heading"><div><strong>캐릭터 포즈</strong><span className="small muted">인물마다 100개 · 이 컷의 표정과 동작 고르기</span></div><button type="button" className="btn sm" aria-expanded={open && !!currentCharacter} aria-controls={listId} disabled={disabled || !available.length} onClick={() => setOpen(current => !current)}>{open && currentCharacter ? "목록 접기" : selected.length ? "포즈 바꾸기" : "포즈 선택"}</button></div>
    {!available.length && <p className="small muted">위에서 등장인물을 먼저 선택해 주세요.</p>}
    {selected.length > 0 && <div className="studio-pose-selections">{selected.map(reference => <div className="studio-pose-selection" key={reference.character}>
      <PoseThumbnail character={reference.character} pose={reference.pose} assetVersion={reference.assetVersion} />
      <div><strong>{poseLabel(reference.character, reference.pose, reference.assetVersion)}</strong><a href={poseImageUrl(reference.character, reference.pose, reference.assetVersion)} download={`${poseLabel(reference.character, reference.pose, reference.assetVersion)}.png`}>참조 이미지 ↓</a></div>
      <button type="button" className="studio-pose-remove" aria-label={`${poseLabel(reference.character, reference.pose, reference.assetVersion)} 선택 해제`} disabled={disabled} onClick={() => remove(reference)}>×</button>
    </div>)}</div>}
    {selected.length > 0 && <p className="studio-pose-help small muted">{imageMode === "api" ? "선택한 포즈와 가족 기준 그림이 이 컷의 API 생성에 함께 사용됩니다." : "ChatGPT에는 가족 기준 그림과 위 참조 이미지를 함께 첨부하세요. 선택한 포즈 설명은 프롬프트에 포함됩니다."}</p>}
    <div id={listId} hidden={!open || !currentCharacter}>
      <div className="studio-pose-character-tabs" role="group" aria-label={`${panelIndex + 1}컷 포즈를 고를 캐릭터`}>{available.map(character => <button type="button" key={character.id} disabled={disabled} aria-pressed={currentCharacter === character.id} onClick={() => setActiveCharacter(character.id)}><CharacterPortrait character={character.id} /><span>{character.name}<small>{character.age}살</small></span></button>)}</div>
      {open && currentCharacter && <PoseBrowser key={currentCharacter} character={currentCharacter} currentReference={selected.find(reference => reference.character === currentCharacter)} disabled={disabled} onApply={apply} />}
    </div>
    <span className="studio-pose-status small" role="status" aria-live="polite">{announcement}</span>
  </ReferenceImages></section>;
}

function SupplementaryAssets() {
  const [group, setGroup] = useState("FA");
  const [selectedId, setSelectedId] = useState("FA001");
  const [enlarged, setEnlarged] = useState(false);
  const assets = FINAL_STUDIO_ASSETS.filter(asset => asset.id.startsWith(group));
  const selected = assets.find(asset => asset.id === selectedId) ?? assets[0];
  function selectGroup(value: string) { setGroup(value); setSelectedId(`${value}001`); }
  return <section className="panel studio-supplementary-assets"><h2>함께하는 장면 · 비언어 말풍선</h2>
    <div className="studio-pose-character-tabs" role="group" aria-label="함께하는 장면과 말풍선 종류">
      {[["FA", "네 가족 · 12개"], ["CP", "펭펭·펨펨 · 12개"], ["SB", "펭긴·펭키 · 12개"], ["FX", "말풍선 · 12개"]].map(([key, label]) => <button type="button" key={key} aria-pressed={key === group} onClick={() => selectGroup(key)}>{label}</button>)}
    </div>
    <div className="studio-pose-browser-body"><div className="studio-pose-grid" role="group" aria-label="함께하는 장면과 말풍선 목록">{assets.map(asset => <button type="button" key={asset.id} className="studio-pose-tile" aria-label={`${asset.id} ${asset.title} 미리보기`} aria-pressed={selected.id === asset.id} onClick={() => setSelectedId(asset.id)}><ArtworkPreview source={finalAssetUrl(asset.id)} alt={asset.title} lazy /><span className="studio-pose-number">{asset.id}</span><span className="studio-pose-title">{asset.title.replaceAll("_", " ")}</span></button>)}</div>
    <aside className="studio-pose-preview" aria-label="함께하는 장면과 말풍선 미리보기"><ArtworkPreview source={finalAssetUrl(selected.id)} alt={selected.title} /><strong>{selected.id} · {selected.title.replaceAll("_", " ")}</strong><span className="small muted">{selected.description}</span><button type="button" className="btn" onClick={() => setEnlarged(true)}>크게 보기</button><a className="btn sm" href={finalAssetUrl(selected.id)} download={`${selected.id}.png`}>투명 PNG 다운로드</a></aside></div>
    {enlarged && <ArtworkDialog source={finalAssetUrl(selected.id)} title={selected.title} onClose={() => setEnlarged(false)} />}
  </section>;
}

export function StudioCharacterArchive() {
  const [active, setActive] = useState<StudioCharacter>("pengpeng");
  return <ReferenceImages>
    <section className="panel studio-family-reference"><div><h1>캐릭터 · 최종 포즈 보관함</h1><p>개인 포즈 400개, 함께하는 장면 36개, 말풍선 12개와 가족 기본 모델을 모았어요. 포즈를 눌러 크게 보고 투명 PNG를 내려받을 수 있습니다.</p><a className="btn sm" href={STUDIO_FAMILY_REFERENCE_URL} download="우주펭귄상회-가족-최종기본모델.png">가족 기본 모델 ↓</a></div><ArtworkPreview source={STUDIO_FAMILY_REFERENCE_URL} alt="맑은 투명 헬멧의 최종 가족 모델. 펭펭, 펨펨, 펭긴, 펭키 순서." /></section>
    <section className="studio-character-archive">{STUDIO_CHARACTERS.map(character => <article className="panel studio-pose-archive-card" key={character.id}><div className="studio-pose-archive-title"><CharacterPortrait character={character.id} /><div><h2>{character.name}<span>{character.age}살</span></h2><p className="small muted">{character.role}</p></div><span className="studio-pose-count">100포즈</span></div><p>{character.detail}</p><button type="button" className="btn" aria-pressed={active === character.id} onClick={() => setActive(character.id)}>{character.name} 포즈 보기</button></article>)}</section>
    <section className="panel" aria-label="최종 개인 포즈 보관함"><PoseBrowser key={active} character={active} disabled={false} /></section>
    <SupplementaryAssets />
    <section className="panel studio-canon"><h2>공통 외형 기준</h2><p>작고 넓게 떨어진 흰 점눈, 노란 부리, 목이 보이지 않는 투명 유리헬멧, 매끈한 펜 윤곽과 무광 페인트 채색을 유지합니다. 볼 눌림·짝눈·찌글찌글한 놀람도 헬멧의 원형과 투명도를 유지합니다. 정수리 꽁지는 막내에게만 있습니다.</p><p>펭펭의 카메라는 한 대, 펨펨은 원인과 해결책부터 짚는 완전 T. 펭긴은 큐브, 펭키는 기타를 지닙니다.</p></section>
  </ReferenceImages>;
}
