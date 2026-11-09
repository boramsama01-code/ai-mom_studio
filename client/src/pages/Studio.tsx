import { WorkspaceSkeleton } from "../WorkspaceSkeleton";
import { StudioWorkingPreview } from "../StudioWorkingPreview";
import { ManualFamilyInitializer } from "../ManualFamilyInitializer";
import { StudioHistoryEntry } from "../StudioHistoryEntry";
import { emptyVideoProject } from "@shared/videoProject";
const VideoEditor = lazy(() => import("./VideoEditor").then(m => ({ default: m.VideoEditor })));
import { creativeProfileFor } from "@shared/creativeProfile";
import { useWorkspaceView } from "../useWorkspaceView";
import { QuickCapture } from "../QuickCapture";
import { SaveState } from "../SaveState";
import { CategorySelect } from "../CategorySelect";
import { categoryLabel, channelCategories, validSubcategory } from "@shared/channelCategories";
import { StudioZipImport } from "./StudioZipImport";
import { FinishedDeckEditor } from "./FinishedDeckEditor";
import { ExperienceEditor } from "./ExperienceEditor";
import { emptyExperience, experienceImageUrl } from "@shared/experience";
import { StudioTrashButton, StudioTrashView, TrashedStudioDetail } from "./StudioTrash";
import { SourceStudioCard } from "./SourceStudioCard";
import { aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { legacyChannelAiSettings, type ChannelAiRuntime } from "@shared/channelAi";
import { AiUsageGuide } from "../AiUsageGuide";
import { lazy, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, apiUpload } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { ErrorBox, GuardedLink, Loading } from "../ui";
import { useToast } from "../toast";
import { Icon } from "../icons";
import { z } from "zod";
import { useDraftRecovery } from "../useDraftRecovery";
import { RecoveryNotice } from "../RecoveryNotice";
import { WorkModeControl, type WorkMode } from "../WorkModeControl";
import { studioGenerationFeedback, studioImageProgress } from "@shared/studioGenerationFeedback";
import "../studioAutomation.css";

import { studioKey } from "@shared/channelKeys";
import { studioContentSchema, studioPanelSchema, studioOutputFormats, studioFormats, studioOutputDescription } from "@shared/studio";
import { studioCaptionDraft } from "@shared/studioWorkflow";
import type { StudioGeneration } from "@shared/studio";
import { StudioExport, StudioQuickExport } from "./StudioExport";
import { StudioPanelImport } from "./StudioPanelImport";
import { StudioCharacterArchive, StudioPosePicker, StudioRegisteredCharacters } from "./StudioPosePicker";
import { STUDIO_CHARACTERS, STUDIO_FAMILY_REFERENCE_URL } from "@shared/studioCharacters";
import { StudioPromptCopy, StudioTextImport } from "./StudioTextImport";
import { studioChatGptCaptionPrompt } from "@shared/studioTextImport";
import type { StudioChannel as Channel, StudioStage as Stage, StudioCharacter as Character, StudioFormat as Format, StudioPanel as Panel, StudioContent as CardInput, StudioCard as Card, StudioRevision as Revision, StudioJob as Job, StudioBoard as Board, StudioCardDetail as Detail } from "@shared/studio";
const stages: Array<{ id: Stage; label: string }> = [{ id: "idea", label: "아이디어" }, { id: "writing", label: "원고" }, { id: "making", label: "제작" }, { id: "review", label: "검토" }, { id: "done", label: "완료" }];
const formats: readonly Format[] = studioFormats;
function useStudioChannels(includeArchived = false) {
  const { allChannels } = useChannel();
  return allChannels.filter(c => (includeArchived || c.active) && !(c.slug === "science-dialogue" && allChannels.some(other => other.slug === "current-dialogue"))).map(c => ({ id: studioKey(c.slug), name: c.name, role: c.description, profile: creativeProfileFor(c), active: c.active, accent: c.accentColor, categories: c.categories, aiSettings: legacyChannelAiSettings(c.aiSettings), effectiveAiSettings: (c as typeof c & Partial<ChannelAiRuntime>).effectiveAiSettings }));
}
const characters = STUDIO_CHARACTERS;

const imageUrl = (id: number) => `/api/studio/images/${id}`;
const cardThumbnail = (card: Card): string | null => {
  if (card.experience?.coverId) return experienceImageUrl(card.experience.coverId);
  if (card.sourceOutput) return `/api/channels/${card.sourceOutput.channelId}/media/${card.sourceOutput.assetId}`;
  const imageId = card.finishedDeck?.pages[0]?.imageId ?? card.panels.find(panel => panel.imageId)?.imageId;
  return imageId ? imageUrl(imageId) : card.imagePath || null;
};
const dateTime = (v: string) => new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const activeJob = (j: Job) => ["queued", "running", "processing"].includes(j.status);
const inputOf = (c: CardInput): CardInput => ({ subcategory: c.subcategory ?? "", finishedDeck:c.finishedDeck??null, altTexts:c.altTexts??[], experience: c.experience ?? null, title: c.title, channel: c.channel, format: c.format, stage: c.stage, dueDate: c.dueDate ?? "", memo: c.memo ?? "", script: c.script ?? "", caption: c.caption ?? "", exportDesign: c.exportDesign ?? "editorial", sourceLabel: c.sourceLabel ?? "", panels: c.panels ?? Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), characters: c.characters ?? [], imagePath: c.imagePath ?? "" });
const recoveryContentSchema = studioContentSchema.safeExtend({
  title: z.string(), sourceLabel: z.string(), dueDate: z.string(), memo: z.string(), script: z.string(), caption: z.string(),
  altTexts: z.array(z.string()).max(10), panels: z.array(studioPanelSchema.safeExtend({ scene: z.string(), dialogue: z.string() })).length(4),
});
const parseRecoveryContent = (value: unknown): CardInput | null => { const parsed = recoveryContentSchema.safeParse(value); return parsed.success ? inputOf(parsed.data) : null; };
const parseRecoveryText = (value: unknown) => typeof value === "string" ? value : null;
const recoveryContentText = (value: CardInput) => [
  `제목\n${value.title}`, `기획·참고 자료\n${value.memo}`, `전체 원고\n${value.script}`,
  ...value.panels.map((panel, i) => `${i + 1}컷\n${panel.scene}\n${panel.dialogue}\n그림: ${panel.imageId ? `저장 이미지 ${panel.imageId}` : "없음"}\n참고 포즈: ${(panel.poseRefs ?? []).map(ref => `${ref.character} ${ref.pose}번`).join(", ") || "없음"}`),
  `게시물 캡션\n${value.caption}`, `대체텍스트\n${value.altTexts.join("\n")}`,
  `작업 설정\n채널: ${value.channel}\n분류: ${value.subcategory || "없음"}\n형식: ${value.format}\n단계: ${stages.find(stage => stage.id === value.stage)?.label ?? value.stage}\n작업 날짜: ${value.dueDate || "없음"}\n등장인물: ${value.characters.join(", ")}\n디자인: ${value.exportDesign}\n출처: ${value.sourceLabel || "없음"}\n기본 그림: ${value.imagePath || "없음"}`,
  ...(value.finishedDeck ? [`업로드한 카드\n${JSON.stringify(value.finishedDeck, null, 2)}`] : []),
  ...(value.experience ? [`사진·영상 후기\n${JSON.stringify(value.experience, null, 2)}`] : []),
].join("\n\n");

export function StudioPage({ cardId }: { cardId?: number }) {
  const [view, setView] = useState<"board" | "characters" | "trash">("board");
  const guard = useDirtyGuard();
  if (cardId !== undefined) return Number.isSafeInteger(cardId) && cardId > 0 ? <StudioDetail key={cardId} id={cardId} /> : <div className="notice err">작업 주소를 확인해 주세요. <GuardedLink href="/">보드로</GuardedLink></div>;
  return <div className="studio">
    <header className="studio-home-top"><span className="studio-eyebrow">MY STUDIO <span className="studio-today">{new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" })}</span></span>{view !== "trash" && <button className="btn sm ghost" onClick={() => guard.confirmLeave(() => setView(view === "board" ? "characters" : "board"))}>{view === "board" ? "캐릭터 · 100포즈 ↗" : "← 내 콘텐츠"}</button>}</header>
    {view === "trash" ? <StudioTrashView onBack={() => setView("board")} /> : view === "board" ? <StudioBoard onTrash={() => guard.confirmLeave(() => setView("trash"))} /> : <StudioCharacterArchive />}
  </div>;
}

function StudioBoard({ onTrash }: { onTrash: () => void }) {
  const channels = useStudioChannels(true);
  const { current, selected, select } = useChannel();
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const q = useQuery({ queryKey: ["studio", "cards"], queryFn: () => api<Board>("/studio/cards"), refetchOnWindowFocus: true, refetchOnReconnect: true });
  const filter: Channel | "all" = selected === "all" || !current ? "all" : studioKey(current.slug);
  const viewState = useWorkspaceView(selected, q.isSuccess);
  const { subcategory, search, archived, layout, status: statusFilter } = viewState.value;
  const setSubcategory = (value: string) => viewState.update({ subcategory: value });
  const setSearch = (value: string) => viewState.update({ search: value });
  const setArchived = (value: boolean) => viewState.update({ archived: value });
  const setLayout = (value: "list" | "board") => viewState.update({ layout: value });
  const setStatusFilter = (value: "active" | "review" | "done" | "all") => viewState.update({ status: value });
  const [capturing, setCapturing] = useState(false);
  const [entry] = useState(() => new URLSearchParams(window.location.search));
  const [entryChannel, setEntryChannel] = useState(() => entry.get("channel") ?? "");
  const [importingZip, setImportingZip] = useState(false);
  const [creating, setCreating] = useState(() => ["experience", "free", "finished"].includes(entry.get("start") ?? ""));
  const [newMode, setNewMode] = useState<"experience"|"finished"|"free">(() => {
    const start = entry.get("start");
    return start === "experience" || start === "finished" ? start : "free";
  });
  const [newStage, setNewStage] = useState<Stage>("idea");
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useDirtyGuard();
  const [, navigate] = useLocation();
  const cards = q.data?.cards ?? [];
  const visibleChannels = channels.filter(ch => archived ? !ch.active : ch.active);
  const visibleKeys = new Set(visibleChannels.map(ch => ch.id));
  const scoped = cards.filter(c => visibleKeys.has(c.channel) && (filter === "all" || c.channel === filter) && (!subcategory || categoryLabel(c.subcategory) === subcategory));
  const filtered = scoped.filter(c => (layout === "board" || statusFilter === "all" || (statusFilter === "done" ? c.stage === "done" : statusFilter === "review" ? c.stage === "review" : c.stage !== "done")) && `${c.title} ${c.memo} ${c.script}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  const latest = scoped.filter(c => c.stage !== "done").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0];
  const reviews = scoped.filter(c => c.stage === "review");
  const reviewCount = reviews.length;
  const resetFilters = () => guard.confirmLeave(() => { viewState.update({ search:"", subcategory:"", status:"active", archived:false }, "all"); select("all"); });
  const move = useMutation({ mutationFn: ({ card, stage }: { card: Card; stage: Stage }) => api(`/studio/cards/${card.id}`, { method: "PATCH", body: { version: card.version, stage } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }), onError: (e) => toast("err", e.message) });
  const openHighscoop = () => guard.confirmLeave(() => navigate(`/inbox?subcategory=${encodeURIComponent(subcategory)}`));
  function newCard(stage: Stage = "idea", mode: "free"|"experience"|"finished" = "free") { if (archived || !visibleChannels.length) return; setEntryChannel(""); setNewStage(stage); setNewMode(mode); setCreating(true); }
  return <>
    <header className="studio-home-heading"><div><h1>내 콘텐츠</h1><p>모은 자료와 직접 찍은 순간을 콘텐츠로 완성하세요.</p></div><div className="studio-home-actions"><button className="btn capture-trigger" disabled={archived || !visibleChannels.length} onClick={() => setCapturing(true)}><Icon name="link" size={17} />링크 저장</button><details className="studio-tools-menu"><summary className="btn">가져오기·관리</summary><div className="stack"><GuardedLink className="btn" href="/notion">노션 원고 가져오기</GuardedLink><button className="btn" disabled={archived || !visibleChannels.length} onClick={() => setImportingZip(true)}>카드뉴스 ZIP 가져오기</button><button className="btn" disabled={archived || !visibleChannels.length} onClick={() => newCard("making","finished")}>완성 이미지 가져오기</button><button className="btn" disabled={archived || !visibleChannels.length} onClick={() => newCard("idea","experience")}>사진·영상 후기</button><button className="btn ghost" onClick={onTrash}><Icon name="trash" size={17} />휴지통{q.data?.trashCount ? <span className="studio-trash-count">{q.data.trashCount}</span> : null}</button></div></details><button className="btn primary studio-create" disabled={archived || !visibleChannels.length} onClick={() => newCard()}><Icon name="plus" size={18} />새 콘텐츠</button></div></header>
    <div className="creative-overview">
      {q.error && !q.data ? <div className="studio-load-error"><ErrorBox error={q.error} retry={() => q.refetch()} /></div> : <>
      <section className="creative-resume" aria-label="최근 작업 이어하기">
        <div className="creative-resume-copy"><span className="section-kicker">CONTINUE CREATING</span><p className="creative-overline">최근 작업</p><h2>{q.isLoading ? "작업을 불러오는 중" : q.error && !q.data ? "작업을 다시 불러와 주세요" : latest?.title ?? "첫 콘텐츠를 시작하세요"}</h2>
          <p className="muted">{latest ? `${channelName(latest.channel)} · ${latest.format} · ${stages.find(stage => stage.id === latest.stage)?.label}` : "아이디어, 저장한 링크, 촬영한 장면에서 시작할 수 있습니다."}</p>
          {latest ? <GuardedLink href={`/studio/${latest.id}`} className="btn primary">이어서 편집 <Icon name="arrow" size={17}/></GuardedLink> : <button className="btn primary" disabled={archived || !visibleChannels.length || q.isLoading || !!q.error} onClick={() => newCard()}>콘텐츠 만들기 <Icon name="plus" size={17}/></button>}
          <span className="creative-saved-note">{q.isFetching ? "최신 저장 상태 확인 중…" : latest ? `${q.error ? "마지막으로 확인한 저장본" : "서버 저장본"} · ${dateTime(latest.updatedAt)}` : "원고와 결과물을 같은 작업에 보관"}</span>
        </div>
        {latest && cardThumbnail(latest) ? <GuardedLink href={`/studio/${latest.id}`} className="creative-resume-art"><img src={cardThumbnail(latest)!} alt={`${latest.title} 저장된 미리보기`}/><span>{latest.format}</span></GuardedLink> : <div className="creative-resume-placeholder" aria-hidden="true"><Icon name="pen" size={40}/><span>YOUR NEXT STORY</span></div>}
      </section>
      <section className="creative-review" aria-label="검토할 콘텐츠"><header><div><span className="section-kicker">READY FOR YOUR EYE</span><h2>검토할 콘텐츠 <span>{q.data ? reviewCount : "—"}</span></h2></div><button className="btn ghost icon" aria-label="검토 단계 콘텐츠 모두 보기" onClick={() => viewState.update({ layout: "list", status: "review" })}><Icon name="arrow" size={18}/></button></header>
        {reviews.length ? <div className="creative-review-list">{reviews.slice(0,3).map(card => <GuardedLink href={`/studio/${card.id}`} className="creative-review-item" key={card.id}><span className="creative-review-art">{cardThumbnail(card) ? <img src={cardThumbnail(card)!} alt="" loading="lazy"/> : <Icon name="design" size={22}/>}</span><span><strong>{card.title}</strong><small>{channelName(card.channel)} · {card.format}</small></span><Icon name="chevron" size={15}/></GuardedLink>)}</div> : <div className="creative-review-empty"><Icon name="check" size={20}/><p>{q.error ? "목록을 불러온 뒤 확인할 수 있습니다." : "검토 단계의 콘텐츠가 여기에 모입니다."}</p><GuardedLink href="/publish">발행 일정·기록 보기 <Icon name="arrow" size={14}/></GuardedLink></div>}
      </section>
      </>}
    </div>
    <section className="studio-workspace" aria-label="내 작업">
    <div className="studio-workspace-head"><div className="studio-status-filters" role="group" aria-label="작업 상태">{layout === "list" ? ([['active', '진행 중'], ['review', '검토'], ['done', '완료'], ['all', '전체']] as const).map(([value, label]) => <button key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}<span>{q.data ? scoped.filter(c => value === "all" || (value === "done" ? c.stage === "done" : value === "review" ? c.stage === "review" : c.stage !== "done")).length : "—"}</span></button>) : <h2>단계별 진행 상황</h2>}</div><div className="studio-view-switch" role="group" aria-label="작업 보기"><button aria-pressed={layout === "list"} onClick={() => setLayout("list")}><Icon name="grid" size={16} />갤러리</button><button aria-pressed={layout === "board"} onClick={() => setLayout("board")}><Icon name="board" size={16} />단계 보드</button></div></div>
    <div className="studio-home-filters"><label className="studio-home-search"><Icon name="search" size={18} /><span className="sr-only">작업 검색</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="제목이나 원고로 검색" /></label><CategorySelect channel={filter} categories={filter === "all" ? [...new Set(visibleChannels.flatMap(c => channelCategories(c.id, c.categories)))] : channels.find(c => c.id === filter)?.categories} value={subcategory} onChange={setSubcategory} filter /><span className="studio-scope-label"><Icon name="channels" size={15} /><strong>{filter === "all" ? archived ? "보관 채널 전체" : "모든 채널" : channelName(filter)}</strong>에서 보기</span>{channels.some(ch => !ch.active) && <button className="btn sm ghost" aria-pressed={archived} onClick={() => guard.confirmLeave(() => { viewState.update({ archived:!archived, subcategory:"" }, "all"); select("all"); })}>{archived ? "보관 보기 종료" : "보관 채널"}</button>}</div>
    {!visibleChannels.length && <p className="notice">{archived ? "보관된 채널이 없습니다." : <>사용 중인 채널이 없습니다. <GuardedLink href="/settings">채널 추가·복원 →</GuardedLink></>}</p>}
    {archived && <p className="notice">이전 작업은 열어서 편집하고 내려받을 수 있습니다. 새 작업과 AI 생성은 채널을 복원한 뒤 사용할 수 있습니다.</p>}
    {q.error && q.data && <ErrorBox error={q.error} retry={() => q.refetch()} />}
    {q.isLoading ? <WorkspaceSkeleton /> : q.error && !q.data ? null : layout === "list" ? <>
      {filtered.length ? <div className="studio-content-grid">{filtered.map(c => {
        const channel = channels.find(ch => ch.id === c.channel);
        const thumbnail = c.finishedDeck?.pages[0]?.imageId ?? c.panels.find(p => p.imageId)?.imageId;
        const experienceThumbnail = c.experience?.coverId ? experienceImageUrl(c.experience.coverId) : null;
        const sourceThumbnail = experienceThumbnail ?? (c.sourceOutput ? `/api/channels/${c.sourceOutput.channelId}/media/${c.sourceOutput.assetId}` : null);
        return <article key={c.id} className="studio-content-card" style={{ "--channel-accent": channel?.accent ?? "#285f6a" } as CSSProperties}>
          <GuardedLink href={`/studio/${c.id}`} className="studio-content-open">
            <div className={`studio-content-art ${sourceThumbnail || thumbnail || c.imagePath ? "has-image" : ""}`}>{sourceThumbnail ? <img src={sourceThumbnail} alt="" loading="lazy" /> : thumbnail ? <img src={imageUrl(thumbnail)} alt="" loading="lazy" /> : c.imagePath ? <img src={c.imagePath} alt="" loading="lazy" /> : <><span className={`studio-format-art ${c.format === "웹툰" ? "comic" : "slides"}`} aria-hidden="true"><i /><i /><i /><i /></span><span className="studio-art-label">{c.format} · {stages.find(s => s.id === c.stage)?.label}</span></>}</div>
            <div className="studio-content-copy"><span className="studio-content-channel"><i aria-hidden="true" />{channelName(c.channel)} · {categoryLabel(c.subcategory)}</span><h2>{c.title}</h2><span className="studio-content-meta">{c.finishedDeck ? `완성 카드뉴스 · ${c.finishedDeck.pages.length}장` : c.experience ? `참여·방문 후기 · ${c.experience.pages.length ? `${c.experience.pages.length+1}장` : "자료 정리 중"}` : c.format}{c.sourceOutput && ` · ${c.sourceOutput.pages.length}장${c.sourceOutput.stale ? " · 재생성 필요" : ""}`}{c.dueDate && <> · <time dateTime={c.dueDate}>{c.dueDate.slice(5).replace("-", "/")} 예정</time></>}</span><div className="studio-content-bottom"><span className={`studio-stage-pill stage-${c.stage}`}>{stages.find(s => s.id === c.stage)?.label}</span><span className="card-open-label">{c.sourceOutput ? "카드뉴스 보기" : c.stage === "done" ? "결과 확인" : "이어서 편집"} <Icon name="arrow" size={15} /></span></div></div>
          </GuardedLink>
          <div className="studio-card-actions"><StudioTrashButton card={c} disabled={move.isPending} /></div>
          {(c.stage === "done" || c.sourceOutput) && <StudioQuickExport card={c} />}
        </article>;
      })}</div> : <div className="studio-home-empty"><span aria-hidden="true">✧</span><h2>{search ? "검색한 작업이 없어요" : statusFilter === "done" ? "완료한 콘텐츠가 여기에 모여요" : "새 이야기를 시작해 보세요"}</h2><p>{search ? "검색어를 바꾸거나 필터를 초기화해 보세요." : statusFilter === "done" ? "제작을 마치면 이미지와 캡션을 바로 꺼낼 수 있습니다." : "제목 하나면 충분해요. 원고와 그림은 차근차근 채워갑니다."}</p>{(search || filter !== "all" || statusFilter !== "active" || archived) ? <button className="btn" onClick={resetFilters}>필터 초기화</button> : <button className="btn primary" disabled={!visibleChannels.length} onClick={() => newCard()}>첫 콘텐츠 만들기</button>}</div>}
    </> : <div className="studio-board">{stages.map((stage) => <section key={stage.id} className={`studio-column stage-${stage.id}`} aria-label={stage.label} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const card = filtered.find((c) => String(c.id) === e.dataTransfer.getData("text/studio-card")); if (!archived && card && card.stage !== stage.id && !move.isPending) move.mutate({ card, stage: stage.id }); }}><div className="studio-column-head"><h2>{stage.label}<span>{filtered.filter((c) => c.stage === stage.id).length}</span></h2><button className="studio-add" disabled={archived || !visibleChannels.length} aria-label={`${stage.label} 작업 추가`} onClick={() => newCard(stage.id)}>＋</button></div><div className="studio-task-list">{filtered.filter((c) => c.stage === stage.id).map((c) => <article key={c.id} className="studio-task" draggable={!move.isPending && !archived} onDragStart={(e) => e.dataTransfer.setData("text/studio-card", String(c.id))}><span className={`studio-channel-tag ${c.channel}`}>{channelName(c.channel)}</span><GuardedLink href={`/studio/${c.id}`} className="studio-task-open">{cardThumbnail(c) && <img className="studio-task-preview" src={cardThumbnail(c)!} alt={`${c.title} 저장된 그림`} loading="lazy" />}<h3>{c.title}</h3></GuardedLink><div className="studio-task-meta"><span>{c.format}</span>{c.dueDate && <time dateTime={c.dueDate}>{c.dueDate.slice(5).replace("-", ".")}</time>}</div><select aria-label={`${c.title} 제작 단계`} value={c.stage} disabled={move.isPending || archived} onChange={(e) => move.mutate({ card: c, stage: e.target.value as Stage })}>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select><div className="studio-card-actions"><StudioTrashButton card={c} disabled={move.isPending} /></div>{stage.id === "done" && <StudioQuickExport card={c} />}</article>)}{!filtered.some((c) => c.stage === stage.id) && <p className="studio-column-hint">작업 없음</p>}</div></section>)}</div>}
    </section>
    <div className="studio-home-footer"><button className="btn sm ghost" onClick={openHighscoop}>수집한 자료에서 시작 ↗</button><GuardedLink className="btn sm ghost" href="/settings">채널 관리 ↗</GuardedLink><span>완성 이미지를 모아 인스타그램 발행까지 이어갈 수 있어요.</span></div>
    {capturing && <QuickCapture onClose={() => setCapturing(false)} />}
    {q.data && <StudioNotes data={q.data} />}
    {importingZip && <StudioZipImport channels={visibleChannels} initialChannel={filter !== "all" && visibleKeys.has(filter) ? filter : ""} onClose={() => setImportingZip(false)} />}
    {creating && <NewCard initialSubcategory={subcategory === "미분류" ? "" : subcategory} channel={entryChannel && visibleKeys.has(entryChannel) ? entryChannel : filter !== "all" && visibleKeys.has(filter) ? filter : ""} stage={newStage} initialMode={newMode} onClose={() => { setCreating(false); if(entry.get("start")) navigate("/",{replace:true}); }} />}
  </>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog className="studio-dialog" ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}><div className="row between"><h2>{title}</h2><button type="button" className="btn ghost" aria-label="닫기" onClick={onClose}>✕</button></div>{children}</dialog>;
}

function NewCard({ channel, stage, initialMode, onClose, initialSubcategory = "" }: { initialSubcategory?: string; channel: Channel; stage: Stage; initialMode: "experience"|"finished"|"free"; onClose: () => void }) {
  const channels = useStudioChannels();
  const [workMode, setWorkMode] = useState<WorkMode>(() => initialMode === "finished" || new URLSearchParams(window.location.search).get("mode") === "manual" ? "manual" : "auto");
  const { channels: sourceChannels, select } = useChannel();
  const [mode, setMode] = useState<"experience" | "finished" | "free">(() => initialMode !== "free" ? initialMode : channels.find(c => c.id === channel)?.profile.defaultRoute === "media" ? "experience" : channels.find(c => c.id === channel)?.profile.defaultRoute === "upload" ? "finished" : "free");
  const [title, setTitle] = useState("");
  const [manualFamily, setManualFamily] = useState(false);
  const [ch, setCh] = useState(channel);
  const [subcategory, setSubcategory] = useState(validSubcategory(channel, initialSubcategory, channels.find(c => c.id === channel)?.categories) ? initialSubcategory : "");
  const [format, setFormat] = useState<Format>(() => channels.find(c => c.id === channel)?.profile.defaultFormat ?? "카드뉴스");
  const creationRequest = useRef<string>(crypto.randomUUID());
  const [route, setRoute] = useState<"writing" | "source" | "media" | "upload">(() => initialMode === "experience" ? "media" : initialMode === "finished" ? "upload" : channels.find(c => c.id === channel)?.profile.defaultRoute ?? "writing");
  const guard = useDirtyGuard(), [, navigate] = useLocation(), qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => {
      if (!ch || !channels.some(c => c.id === ch)) throw new Error("이 콘텐츠를 만들 채널을 선택해 주세요.");
      const outputFormat = mode === "finished" ? "카드뉴스" : mode === "experience" && format !== "릴스" ? "카드뉴스" : format;
      return api<Card>("/studio/cards", { method: "POST", body: {
        requestId: creationRequest.current,
        title: title.trim() || (mode === "experience" ? "새 방문 후기" : "새 콘텐츠"), channel: ch, subcategory,
        format: outputFormat, stage, finishedDeck: mode === "finished" ? { pages: [] } : null,
        exportDesign: outputFormat === "카드뉴스" ? channels.find(c => c.id === ch)?.profile.defaultTemplate ?? "editorial" : "editorial",
        experience: mode === "experience" || outputFormat === "릴스" ? emptyExperience() : null,
        videoProject: outputFormat === "릴스" ? emptyVideoProject() : null,
        characters: mode === "experience" ? [] : channels.find(c => c.id === ch)?.profile.characters ?? [],
      } });
    },
    onSuccess: d => { qc.invalidateQueries({ queryKey: ["studio"] }); onClose(); guard.confirmLeave(() => navigate(`/studio/${d.id}${workMode === "manual" ? "?mode=manual" : ""}`)); },
  });
  const changeChannel = (next: string) => {
    setCh(next);
    setSubcategory("");
    setFormat(channels.find(c => c.id === next)?.profile.defaultFormat ?? "카드뉴스");
    if (initialMode === "free") { const nextRoute = channels.find(c => c.id === next)?.profile.defaultRoute ?? "writing"; setRoute(nextRoute); setMode(nextRoute === "media" ? "experience" : nextRoute === "upload" ? "finished" : "free"); if(nextRoute === "upload") setWorkMode("manual"); }
    creationRequest.current = crypto.randomUUID();
  };
  const startFromInbox = () => guard.confirmLeave(() => {
    const source = sourceChannels.find(c => studioKey(c.slug) === ch);
    select(source?.id ?? "all");
    onClose();
    navigate(`/inbox?subcategory=${encodeURIComponent(subcategory)}`);
  });
  const changeWorkMode = (next: WorkMode) => {
    setWorkMode(next);
    if (next === "auto" && mode === "finished") { setMode("free"); setRoute("writing"); }
  };
  const createLabel = mode === "experience" ? "사진·영상 올리러 가기 →" : mode === "finished" ? "이미지 가져오기 편집기 열기" : workMode === "auto" ? "자동 제작 편집기 열기" : "직접 작성 편집기 열기";
  const manualChannel = sourceChannels.find(value => studioKey(value.slug) === ch && value.contentType === "current_dialogue" && value.active);
  if (manualFamily && manualChannel) return <Dialog title="AI 없이 8장 원고 직접 작성" onClose={() => guard.confirmLeave(onClose)}><ManualFamilyInitializer channelId={manualChannel.id} channelName={manualChannel.name} initialTitle={title} templateKey={channels.find(value => value.id === ch)?.profile.defaultTemplate} logoAssetId={channels.find(value => value.id === ch)?.profile.logoAssetId} onBack={() => setManualFamily(false)} onSaved={receipt => { onClose(); select(manualChannel.id); navigate(`/studio/${receipt.studioCardId}?mode=manual`); }} /></Dialog>;
  return <Dialog title={mode === "finished" ? "완성 이미지 가져오기" : mode === "experience" ? "사진·영상으로 후기 만들기" : workMode === "auto" ? "새 콘텐츠 자동 제작" : "새 콘텐츠 직접 작성"} onClose={() => !create.isPending && onClose()}>
    <form className="stack studio-create-form" onSubmit={event => { event.preventDefault(); if (route === "source") startFromInbox(); else create.mutate(); }}>
      <div className="creative-start-routes" role="group" aria-label="콘텐츠 시작 방식">{([["writing","pen","아이디어·원고","직접 쓰거나 AI로 구체화"],["source","link","뉴스·자료","링크를 모으고 원문 확인"],["media","video","사진·영상","촬영 자료부터 정리"],["upload","design","완성 이미지","순서·캡션을 확인해 발행"]] as const).map(([key,icon,label,description]) => <button type="button" key={key} aria-pressed={route === key} disabled={create.isPending} onClick={() => { setRoute(key); if (key === "media") setMode("experience"); else if (key === "upload") { setMode("finished"); setWorkMode("manual"); } else setMode("free"); }}><Icon name={icon} size={20}/><strong>{label}</strong><small>{description}</small></button>)}</div>
      {route === "writing" && <WorkModeControl mode={workMode} onChange={changeWorkMode} disabled={create.isPending} />}
      <div className="studio-create-channel">
        <label className="field">제작 채널<select aria-label="제작 채널" required value={ch} disabled={create.isPending} onChange={event => changeChannel(event.target.value)}>
          <option value="" disabled>이 콘텐츠의 채널을 선택하세요</option>
          {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <p>{ch ? `${channels.find(c => c.id === ch)?.name}에 저장할 콘텐츠입니다.` : "모든 채널을 보고 있어요. 새 콘텐츠를 저장할 채널을 여기서 정해 주세요."}</p>
      </div>
      {workMode === "manual" && <div className="studio-start-options" role="group" aria-label="수동 제작 방식">
        <button type="button" disabled={create.isPending} aria-pressed={mode === "free"} onClick={() => setMode("free")}><Icon name="pen" size={22} /><strong>직접 원고 작성</strong><p>직접 쓴 문구와 외부에서 만든 결과를 편집</p></button>
        <button type="button" disabled={create.isPending} aria-pressed={mode === "finished"} onClick={() => setMode("finished")}><Icon name="design" size={22} /><strong>완성 이미지 가져오기</strong><p>여러 장을 묶어 순서·캡션 확인 후 발행</p></button>
      </div>}
      {workMode === "manual" && route === "writing" && manualChannel && <div className="notice small stack"><strong>가족 대화 8장을 직접 쓰려면</strong><p>제공 자료·근거 구절과 8장 문구를 직접 입력합니다. AI 없이 기존 8장 편집기와 Canva 사본 가져오기로 이어갑니다.</p><button type="button" className="btn" disabled={create.isPending} onClick={() => setManualFamily(true)}>AI 없이 8장 원고 직접 작성</button></div>}
      <p className="small muted">{mode === "experience" ? "먼저 사진을 모으세요. 제목과 글은 나중에 다듬을 수 있습니다." : mode === "finished" ? "이미지 한 묶음이 게시물 한 건입니다. 1~10장을 가져와 순서를 정하세요." : workMode === "auto" ? "제목을 정하고 편집기를 여세요. 원고·컷 구성 자동 작성 버튼을 눌렀을 때 AI가 시작됩니다." : "직접 원고를 쓰거나 외부에서 만든 초안과 그림을 가져오세요. 입력을 유지한 채 자동으로 돌아갈 수 있습니다."}</p>
      <CategorySelect channel={ch} categories={channels.find(c => c.id === ch)?.categories} value={subcategory} onChange={setSubcategory} disabled={create.isPending || !ch} />
      <label className="field">{mode === "experience" ? "작업 제목 (나중에 입력 가능)" : "제목"}<input autoFocus required={mode !== "experience" && route !== "source"} disabled={create.isPending} value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder={mode === "experience" ? "예: 과학관에 다녀온 날" : "어떤 이야기를 만들까요?"} /></label>
      {mode !== "finished" && route !== "source" && <label className="field">형식<select aria-label="제작 형식" value={format} disabled={create.isPending} onChange={event => setFormat(event.target.value as Format)}>{formats.filter(value => !ch || (channels.find(c => c.id === ch)?.profile.formats ?? formats).includes(value)).map(f => <option key={f}>{f}</option>)}</select></label>}
      {create.error && <ErrorBox error={create.error} />}
      <button className="btn primary" disabled={create.isPending || !ch || (mode !== "experience" && route !== "source" && !title.trim())}>{create.isPending ? "작업을 여는 중…" : route === "source" ? "자료 수집함 열기" : createLabel}</button>
      <p className="small muted">편집기를 여는 것만으로는 AI를 호출하지 않습니다. 원고와 그림 생성은 다음 화면의 생성 버튼에서 시작합니다.</p>
      <details className="studio-more"><summary>수집 자료·사진 후기에서 시작하기</summary><div className="row">
        <button type="button" className="btn" disabled={create.isPending} onClick={startFromInbox}><Icon name="inbox" size={16} />수집한 자료로 만들기</button>
        <button type="button" className="btn" disabled={create.isPending} onClick={() => setMode("experience")}><Icon name="grid" size={16} />사진·영상 후기</button>
        {mode === "experience" && <button type="button" className="btn ghost" disabled={create.isPending} onClick={() => setMode("free")}>제목으로 제작하기</button>}
      </div></details>
    </form>
  </Dialog>;
}

function StudioNotes({ data }: { data: Board }) {
  const [notes, setNotes] = useState(data.notes);
  const [version, setVersion] = useState(data.notesVersion);
  const [baseline, setBaseline] = useState(data.notes);
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const dirty = notes !== baseline;
  const recovery = useDraftRecovery({ recoveryKey: "studio:board:notes", label: "운영 메모", version, serverValue: baseline, value: notes, dirty, parse: parseRecoveryText, onRestore: setNotes });
  const save = useMutation({ mutationFn: () => api("/studio/notes", { method: "PATCH", body: { version, notes } }), onSuccess: () => { recovery.clear(); setBaseline(notes); setVersion((v) => v + 1); qc.invalidateQueries({ queryKey: ["studio", "cards"] }); } });
  useEffect(() => { if (!dirty) { setNotes(data.notes); setBaseline(data.notes); setVersion(data.notesVersion); } }, [data.notes, data.notesVersion]);
  useEffect(() => { guard.setDirty("studio-notes", dirty || !!recovery.pending, async () => { if (recovery.pending) return false; try { await save.mutateAsync(); return true; } catch { return false; } }, () => { recovery.clear(); setNotes(baseline); }); return () => guard.setDirty("studio-notes", false); }, [dirty, notes, version, recovery.pending]);
  return <details className="panel studio-notes" open={recovery.pending ? true : undefined}><summary>운영 메모</summary><div className="stack"><RecoveryNotice recovery={recovery} /><textarea disabled={save.isPending || !!recovery.pending} aria-label="운영 메모" rows={5} value={notes} maxLength={20000} onChange={(e) => setNotes(e.target.value)} /><div className="row"><button className="btn sm" disabled={!dirty || save.isPending || !!recovery.pending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "메모 저장"}</button>{save.isSuccess && !dirty && <span className="small muted">저장됨</span>}</div>{save.error && <ErrorBox error={save.error} />}</div></details>;
}

export function StudioImport() {
  const [file, setFile] = useState<File | null>(null);
  const qc = useQueryClient();
  const migrate = useMutation({ mutationFn: async () => {
    if (!file) throw new Error("백업 파일을 선택해 주세요.");
    if (file.size > 450_000) throw new Error("450KB 이하의 Studio Board 백업을 선택해 주세요.");
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { throw new Error("JSON 백업 파일을 읽을 수 없습니다."); }
    return api<{ imported: number; skipped: number; notesImported: boolean }>("/studio/import", { method: "POST", body: data });
  }, onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }) });
  return <details className="panel studio-notes"><summary>기존 Studio Board 가져오기</summary><div className="stack"><p className="small muted">기존 보드의 ‘백업’에서 내려받은 JSON 파일을 선택하세요. 이미 가져온 카드는 중복 생성하지 않습니다.</p><label className="field">백업 JSON<input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><div><button className="btn sm" disabled={!file || migrate.isPending} onClick={() => migrate.mutate()}>{migrate.isPending ? "가져오는 중…" : "가져오기"}</button></div>{migrate.error && <ErrorBox error={migrate.error} />}{migrate.data && <p className="notice ok" role="status">{migrate.data.imported}개 가져옴 · 중복 {migrate.data.skipped}개{migrate.data.notesImported ? " · 운영 메모 가져옴" : ""}</p>}</div></details>;
}

function StudioDetail({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["studio", "card", id], refetchOnWindowFocus: true, refetchOnReconnect: true, queryFn: () => api<Detail>(`/studio/cards/${id}`), refetchInterval: (query) => query.state.data?.jobs.some(activeJob) ? 3000 : false });
  if (q.isLoading) return <Loading lines={5} />;
  if (!q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.data.card.trashedAt) return <TrashedStudioDetail card={q.data.card} />;
  const history = !q.data.card.sourceReference && <StudioHistoryEntry card={q.data.card}/>;
  if (q.data.card.format === "릴스") return <>{history}<VideoEditor key={q.data.card.id} data={q.data} /></>;
  if (q.data.card.finishedDeck) return <>{history}<FinishedDeckEditor key={q.data.card.id} data={q.data} /></>;
  if (q.data.card.experience) return <>{history}<ExperienceEditor key={q.data.card.id} data={q.data} refresh={() => q.refetch()} /></>;
  if (q.data.card.sourceReference && !q.data.card.script && !q.data.card.panels.some(p => p.dialogue || p.scene || p.imageId) && !q.data.card.imagePath) return <><SourceStudioCard key={q.data.card.id} card={q.data.card} /><SourceBoardNotes card={q.data.card} /></>;
  // A background polling failure must not unmount the editor and discard unsaved work.
  return <>{history}{q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}<StudioEditor key={q.data.card.id} data={q.data} refresh={() => q.refetch()} /></>;
}

function SourceBoardNotes({ card }: { card: Card }) {
  const [memo, setMemo] = useState(card.memo ?? "");
  const [baseline, setBaseline] = useState(card.memo ?? "");
  const [version, setVersion] = useState(card.version);
  const qc = useQueryClient(), guard = useDirtyGuard();
  const dirty = memo !== baseline;
  const recovery = useDraftRecovery({ recoveryKey: `studio:${card.id}:source-memo`, label: "작업 메모", version, serverValue: baseline, value: memo, dirty, parse: parseRecoveryText, onRestore: setMemo });
  useEffect(() => { if (!dirty && card.version > version) { setMemo(card.memo ?? ""); setBaseline(card.memo ?? ""); setVersion(card.version); } }, [card.version, dirty, version]);
  const save = useMutation({ mutationFn: () => api<Card>(`/studio/cards/${card.id}`, { method: "PATCH", body: { version, memo } }), onSuccess: result => { recovery.clear(); setBaseline(result.memo ?? ""); setVersion(result.version); void qc.invalidateQueries({ queryKey: ["studio"] }); } });
  useEffect(() => { const key = `source-board-note-${card.id}`; guard.setDirty(key, dirty || !!recovery.pending, async () => { if (recovery.pending) return false; try { await save.mutateAsync(); return true; } catch { return false; } }, () => { recovery.clear(); setMemo(baseline); }); return () => guard.setDirty(key, false); }, [dirty, memo, version, card.id, recovery.pending]);
  return <details className="content-drawer source-board-notes" open={recovery.pending ? true : undefined}><summary><strong>작업 메모</strong><span>{dirty ? "저장 전 변경사항" : "선택"}</span></summary><div className="content-drawer-body stack"><RecoveryNotice recovery={recovery} /><textarea aria-label="작업 메모" rows={3} value={memo} maxLength={12000} disabled={save.isPending || !!recovery.pending} onChange={event => setMemo(event.target.value)} /><div><button className="btn" disabled={!dirty || save.isPending || !!recovery.pending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "메모 저장"}</button></div>{save.error && <ErrorBox error={save.error} />}</div></details>;
}

type GenerationAction = Pick<StudioGeneration, "kind"> & Partial<Pick<StudioGeneration, "textTarget" | "panelIndex" | "panelIndexes" | "instruction">>;

function StudioEditor({ data, refresh }: { data: Detail; refresh: () => unknown }) {
  const channels = useStudioChannels(true);
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const settings = useQuery({ queryKey: ["studio", "cards"], queryFn: () => api<Board>("/studio/cards") });
  const [base, setBase] = useState(data.card);
  const baseRef = useRef(data.card);
  const [form, setForm] = useState(() => inputOf(data.card));
  const formRef = useRef(form); formRef.current = form;
  const savingSnapshot = useRef<CardInput | null>(null);
  const [instruction, setInstruction] = useState("");
  const [panelInstructions, setPanelInstructions] = useState(["", "", "", ""]);
  const [imageMode, setImageMode] = useState<"chatgpt" | "api">(() => new URLSearchParams(window.location.search).get("mode") === "manual" ? "chatgpt" : "api");
  const [textMode, setTextMode] = useState<"chatgpt" | "api">(() => new URLSearchParams(window.location.search).get("mode") === "manual" ? "chatgpt" : "api");
  const [editorStep, setEditorStep] = useState<"story" | "images" | "finish">(() => data.card.stage === "done" || data.card.stage === "review" ? "finish" : data.card.stage === "making" ? "images" : "story");
  const [selectedPanel, setSelectedPanel] = useState(0);
  const [selectedImages, setSelectedImages] = useState<number[]>([]);
  const [posePickerRequest, setPosePickerRequest] = useState(0);
  const posePickerTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!posePickerRequest) return;
    const drawer = posePickerTarget.current?.closest("details");
    if (drawer) drawer.open = true;
    posePickerTarget.current?.scrollIntoView?.({ block: "start" });
    posePickerTarget.current?.focus({ preventScroll: true });
  }, [posePickerRequest]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const uploadingRef = useRef(false);
  const [providerOverride, setProviderOverride] = useState<{ channel: string; provider: AiProvider } | null>(null);
  const channelAi = channels.find(channel => channel.id === form.channel);
  const provider = providerOverride?.channel === form.channel ? providerOverride.provider : channelAi?.aiSettings.copy.provider ?? "openai";
  const [tab, setTab] = useState<"content" | "history">("content");
  const [compareId, setCompareId] = useState<number | null>(null);
  const [awaitingJob, setAwaitingJob] = useState<number | null>(null);
  const guard = useDirtyGuard();
  const qc = useQueryClient();
  const toast = useToast();
  const [, navigate] = useLocation();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  useEffect(() => { if (awaitingJob && data.jobs.some(j => j.id === awaitingJob)) setAwaitingJob(null); }, [data.jobs, awaitingJob]);
  const dirty = JSON.stringify(form) !== JSON.stringify(inputOf(base));
  const newer = data.card.version > base.version;
  const working = awaitingJob !== null || data.jobs.some(activeJob);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["studio"] });
  const accept = (c: Card) => { baseRef.current = c; setBase(c); setForm(inputOf(c)); };
  const recovery = useDraftRecovery<CardInput>({ recoveryKey: `studio:${base.id}:content`, label: "원고", version: base.version, serverValue: inputOf(base), value: form, dirty, parse: parseRecoveryContent, onRestore: setForm });
  useEffect(() => { if (!dirty && data.card.version > base.version) accept(data.card); }, [data.card.version, dirty, base.version]);
  const save = useMutation({
    mutationFn: (next?: CardInput) => { if (recovery.pending) throw new Error("기기 복구본을 먼저 불러오거나 버려 주세요."); savingSnapshot.current = next ?? formRef.current; return api<Card | { card: Card }>(`/studio/cards/${base.id}`, { method: "PATCH", body: { ...savingSnapshot.current, version: base.version } }); },
    onSuccess: (d) => { const saved = "card" in d ? d.card : d; if (JSON.stringify(formRef.current) === JSON.stringify(savingSnapshot.current)) { recovery.clear(); accept(saved); } else { baseRef.current = saved; setBase(saved); } invalidate(); },
  });
  const saveCurrent = useCallback(async (): Promise<Card> => { if (recovery.pending) throw new Error("기기 복구본을 먼저 불러오거나 버려 주세요."); if (!dirty) return base; const d = await save.mutateAsync(); return "card" in d ? d.card : d; }, [dirty, base, form, recovery.pending]);
  useEffect(() => { guard.setDirty("studio-card", dirty || !!recovery.pending, async () => { if (recovery.pending) return false; try { await saveCurrent(); return true; } catch { return false; } }, () => { recovery.clear(); setForm(inputOf(baseRef.current)); }); return () => guard.setDirty("studio-card", false); }, [dirty, saveCurrent, recovery.pending]);
  const generate = useMutation({
    retry: false,
    mutationFn: async (action: GenerationAction) => {
      const current = await saveCurrent();
      const input = { version: current.version, kind: action.kind, ...(action.kind === "image" ? { provider: "openai" } : providerOverride?.channel === current.channel ? { provider: providerOverride.provider } : {}),
        instruction: action.instruction ?? "", textTarget: action.textTarget ?? "rewrite",
        ...(action.kind === "image" ? action.panelIndexes ? { panelIndexes: action.panelIndexes } : { panelIndex: action.panelIndex } : action.textTarget === "panel" ? { panelIndex: action.panelIndex } : {}) };
      const signature = JSON.stringify(input);
      if (!request.current || request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      return api<{ job: Job; duplicate: boolean }>(`/studio/cards/${base.id}/generate`, {
        method: "POST", body: { ...input, requestId: request.current.id },
      });
    },
    onSuccess: ({ job }) => {
      request.current = null; setAwaitingJob(job.id); invalidate();
      toast("ok", "작성 내용을 저장하고 생성을 시작했습니다.");
    },
    onError: () => { void invalidate(); },
    onSettled: () => { submitting.current = false; },
  });
  const cancelGeneration = useMutation({
    retry: false, mutationFn: (jobId: number) => api(`/jobs/${jobId}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => { setAwaitingJob(null); void invalidate(); toast("ok", "생성을 중단했습니다. 완료한 그림과 기존 입력은 유지됩니다."); },
    onError: () => { void invalidate(); },
  });
  const testConnection = useMutation({
    retry: false, mutationFn: () => api<{ ok: boolean; message: string }>("/secrets/test/openai", { method: "POST", body: {} }),
  });
  const restore = useMutation({
    mutationFn: (revisionId: number) => api<Card | { card: Card }>(`/studio/cards/${baseRef.current.id}/restore`, { method: "POST", body: { version: baseRef.current.version, revisionId } }),
    onSuccess: (d) => { recovery.clear(); accept("card" in d ? d.card : d); invalidate(); setTab("content"); toast("ok", "선택한 버전을 새 버전으로 복원했습니다."); },
  });
  function change<K extends keyof CardInput>(key: K, value: CardInput[K]) { setForm(f => ({ ...f, [key]: value })); }
  function changePanel(i: number, key: "scene" | "dialogue", value: string) { change("panels", form.panels.map((p, n) => n === i ? { ...p, [key]: value } : p)); }
  function changeCast(character: Character, selected: boolean) {
    setForm(current => {
      const cast = characters.filter(c => c.id === character ? selected : current.characters.includes(c.id)).map(c => c.id);
      return { ...current, characters: cast, panels: current.panels.map(panel => ({ ...panel, poseRefs: (panel.poseRefs ?? []).filter(reference => cast.includes(reference.character)) })) };
    });
  }
  const ownBusy = !!recovery.pending || save.isPending || generate.isPending || restore.isPending || uploading !== null;
  const busy = ownBusy || publicationBusy;
  const archivedChannel = !channels.find(c => c.id === form.channel)?.active;
  const canGenerate = !busy && !working && !newer && !archivedChannel && !!form.title.trim();
  const canWrite = canGenerate && settings.data?.ai.text[provider] === true;
  const canDraw = canGenerate && settings.data?.ai.image === true;
  const hasBlanks = !form.script.trim() || !form.caption.trim() || form.panels.some(p => !p.scene.trim() || !p.dialogue.trim());
  const captionProposal = !form.caption.trim() ? studioCaptionDraft(form) : "";
  const compared = data.revisions.find(r => r.id === compareId);
  const latestJob = data.jobs[0];
  const runningJob = data.jobs.find(activeJob);
  const imageProgress = studioImageProgress(latestJob?.result);
  const failureMessage = generate.error?.message ?? latestJob?.lastError ?? "";
  const feedback = studioGenerationFeedback(failureMessage, latestJob?.status);
  const missingImages = form.panels.flatMap((p, i) => !p.imageId && (p.scene.trim() || p.dialogue.trim()) ? [i] : []);
  const selectedImagesReady = selectedImages.length > 0 && selectedImages.every(i => !!(form.panels[i].scene.trim() || form.panels[i].dialogue.trim()));
  async function uploadImage(file: File, panelIndex: number) {
    if (uploadingRef.current || busy || working || newer) throw new Error("다른 저장·생성이 끝난 뒤 다시 시도해 주세요. 서버에 새 버전이 있으면 먼저 불러와 주세요.");
    uploadingRef.current = true; setUploading(panelIndex);
    try {
      const current = await saveCurrent();
      const saved = await apiUpload<Card>(`/studio/cards/${current.id}/panels/${panelIndex}/image?version=${current.version}`, file);
      accept(saved); invalidate(); toast("ok", `${panelIndex + 1}컷 이미지를 저장했습니다.`);
    } catch (e) { invalidate(); throw e; }
    finally { uploadingRef.current = false; setUploading(null); }
  }
  function run(action: GenerationAction) {
    if (submitting.current || !canGenerate) return;
    submitting.current = true;
    generate.mutate(action);
  }
  const copyCaption = async () => { try { await navigator.clipboard.writeText(form.caption); toast("ok", "캡션을 복사했습니다."); } catch { toast("err", "캡션을 직접 선택해 복사해 주세요."); } };
  return <div className="studio studio-detail" style={{ "--channel-accent": channels.find(c => c.id === form.channel)?.accent ?? "#285f6a" } as CSSProperties}>
    <GuardedLink href="/" className="studio-back">← 내 콘텐츠</GuardedLink>
    <header className="page-head">
      <div><span className="studio-channel-tag">{channelName(form.channel)}</span><h1>{base.title}</h1><SaveState version={base.version} dirty={dirty} saving={save.isPending} error={save.error} local={recovery.status === "saved"}/></div>
      <div className="row"><StudioTrashButton card={base} disabled={busy} prepare={saveCurrent} leave /><button className="btn primary" onClick={() => save.mutate()} disabled={!dirty || busy || !form.title.trim()}>{save.isPending ? "저장 중…" : "저장"}</button></div>
    </header>
    <RecoveryNotice recovery={recovery} formatValue={recoveryContentText} />
    {newer && dirty && <div className="notice warn row between"><span>서버에 새 버전이 있습니다. 현재 입력은 유지했습니다.</span><button className="btn sm" onClick={() => guard.confirmLeave(() => accept(data.card))}>새 버전 불러오기</button></div>}
    {(save.error || restore.error) && <ErrorBox error={save.error || restore.error} />}
    {(data.card.sourceReference || data.card.sourceOutput) && <details className="content-drawer"><summary><strong>자료에서 만든 카드</strong><span>원문·카드 문구 확인</span></summary><SourceStudioCard key={data.card.id} card={data.card} embedded /></details>}
    <div className="tabs" role="tablist" aria-label="콘텐츠 편집">
      <button role="tab" aria-selected={tab === "content"} onClick={() => setTab("content")}>콘텐츠 편집</button>
      <button role="tab" aria-selected={tab === "history"} onClick={() => guard.confirmLeave(() => setTab("history"))}>버전 기록 {data.revisions.length}</button>
    </div>
    {(working || generate.error || latestJob?.status === "failed" || latestJob?.status === "cancelled" || imageProgress || latestJob?.result?.applied === false) && <details className="panel studio-work-status" open={working || !!generate.error || latestJob?.status === "failed" || latestJob?.status === "cancelled" || latestJob?.result?.applied === false}><summary>{working ? "자동 생성 진행 상황" : imageProgress ? `그림 ${imageProgress.completedPanels.filter(p => p.applied).length}/${imageProgress.panelIndexes.length}컷 저장` : "이전 자동 생성 결과"}</summary><div className="stack">
      {working && <p role="status">{imageProgress?.activePanelIndex != null ? `${imageProgress.activePanelIndex + 1}컷을 만들고 있습니다. 완료한 그림은 컷마다 저장합니다.` : "AI가 작업 중입니다. 완료되면 여기에 반영됩니다."} 화면을 닫아도 요청은 보관됩니다.</p>}
      {imageProgress && <p className="small" role="status">저장 완료 {imageProgress.completedPanels.filter(p => p.applied).length}/{imageProgress.panelIndexes.length}컷{imageProgress.remainingPanelIndexes.length > 0 && ` · 남은 컷 ${imageProgress.remainingPanelIndexes.map(i => i + 1).join(", ")}`}. {imageProgress.message}</p>}
      {generate.error && <ErrorBox error={generate.error} />}
      {!working && latestJob?.status === "failed" && <div role="alert" className="notice err"><strong>생성을 완료하지 못했습니다.</strong><p>{latestJob.lastError}</p></div>}
      {!working && latestJob?.status === "cancelled" && <p className="notice">생성이 중단되었습니다. 저장한 그림과 원고는 유지됩니다.</p>}
      {!working && (generate.error || latestJob?.status === "failed" || latestJob?.status === "cancelled") && <div className="notice small" data-error-kind={feedback.kind}><p>{feedback.guidance}</p>{feedback.manualFallback && <button className="btn sm" disabled={busy} onClick={() => { setImageMode("chatgpt"); setTextMode("chatgpt"); }}>수동으로 계속하기</button>}</div>}
      {!working && latestJob?.result?.applied === false && latestJob.result?.revisionId != null && <p className="notice warn">생성 중 수정한 내용은 유지했습니다. <button className="btn sm" onClick={() => { setTab("history"); setCompareId(Number(latestJob.result?.revisionId)); }}>새 결과를 버전 기록에서 확인</button></p>}
      <div className="row">{runningJob && <button className="btn sm" disabled={cancelGeneration.isPending} onClick={() => cancelGeneration.mutate(runningJob.id)}>{cancelGeneration.isPending ? "중단 중…" : "생성 중단 · 완료한 그림 유지"}</button>}<button className="btn sm" onClick={() => refresh()}>상태 새로고침</button><GuardedLink href="/connections?service=openai" className="btn sm ghost">OpenAI 키 입력·수정</GuardedLink><button className="btn sm ghost" disabled={working || testConnection.isPending} onClick={() => testConnection.mutate()}>{testConnection.isPending ? "확인 중…" : "OpenAI 연결 확인 · 생성 비용 없음"}</button></div>
      {cancelGeneration.error && <ErrorBox error={cancelGeneration.error} />}
      {testConnection.data && <p role="status" className={testConnection.data.ok ? "notice ok" : "notice warn"}>{testConnection.data.message}</p>}
      {testConnection.error && <ErrorBox error={testConnection.error} />}
    </div></details>}
    {latestJob?.status === "succeeded" && latestJob.result?.applied === true && Array.isArray(latestJob.result.changedFields) && latestJob.result.changedFields.length > 0 && <p className="notice ok small" role="status">작성 완료: {latestJob.result.changedFields.filter((f): f is string => typeof f === "string").join(" · ")}</p>}
    {tab === "content" ? <div className={`studio-editor-layout studio-guided-editor${editorStep !== "finish" ? " has-working-preview" : ""}`}>
      <nav className="studio-editor-steps" aria-label="제작 순서">{([['story','01','이야기'],['images','02','그림'],['finish','03','완성']] as const).map(([id, number, label]) => <button key={id} aria-current={editorStep === id ? "step" : undefined} onClick={() => setEditorStep(id)}><span>{number}</span><strong>{label}</strong></button>)}</nav>
      <details className="content-options"><summary>캐릭터·포즈 설정</summary><StudioRegisteredCharacters cast={form.characters} onChange={changeCast} disabled={busy || working || newer} onChoosePoses={() => { setEditorStep("images"); setPosePickerRequest(current => current + 1); }} /></details>
      <section className="panel stack" id="studio-story" hidden={editorStep !== "story"}>
        <div className="studio-section-heading"><div><h2>어떤 이야기를 만들까요?</h2></div><span className="small muted">아이디어에서 자동 초안을 만들고 필요한 부분을 직접 다듬으세요.</span></div>
        <label className="field">제목<input id="studio-title" disabled={busy} value={form.title} maxLength={160} onChange={e => change("title", e.target.value)} /></label>
        <label className="field">기획·참고 자료<textarea disabled={busy} value={form.memo} rows={3} maxLength={12000} onChange={e => change("memo", e.target.value)} placeholder="이야기의 핵심이나 확인한 자료를 적어 주세요. 이미 컷을 썼다면 비워 두어도 됩니다." /></label>
        <label className="field">형식<select id="studio-format" disabled={busy} value={form.format} onChange={e => change("format", e.target.value as Format)}>{!formats.includes(form.format) && <option value={form.format}>{form.format} · 기획용</option>}{formats.map(f => <option key={f}>{f}</option>)}</select></label>
        <label className="field">전체 원고<textarea aria-label="전체 원고" disabled={busy} value={form.script} rows={8} maxLength={24000} onChange={e => change("script", e.target.value)} placeholder="전체 원고가 없어도 장면·대사에서 바로 그림을 만들 수 있습니다." /></label>
        <WorkModeControl mode={textMode === "api" ? "auto" : "manual"} onChange={mode => setTextMode(mode === "auto" ? "api" : "chatgpt")} disabled={busy} automaticUnavailable={settings.data?.ai.text[provider] === false ? `${aiProviderLabels[provider]} 연결이 필요합니다. 연결 후 앱 안에서 원고를 만들 수 있습니다.` : null} onConfigure={() => guard.confirmLeave(() => navigate(`/connections?service=${provider}`))} />
        <div className="stack" hidden={textMode !== "api"} data-testid="studio-api-writing">
          <label className="field">작성 AI<select value={provider} disabled={busy || working} onChange={e => setProviderOverride({ channel: form.channel, provider: e.target.value as AiProvider })}><option value="gemini">Gemini</option><option value="openai">GPT · OpenAI</option><option value="anthropic">Claude</option></select><span className="hint">{providerOverride?.channel === form.channel ? "이 작업에서 선택한 AI입니다. 채널 기본값은 설정에서 바꿀 수 있습니다." : `채널의 카드 문구 AI를 사용합니다${channelAi?.effectiveAiSettings?.copy.model ? ` · ${channelAi.effectiveAiSettings.copy.model}` : ""}.`}</span></label>
          {providerOverride?.channel === form.channel && <button type="button" className="btn sm ghost" disabled={busy || working} onClick={() => setProviderOverride(null)}>채널 AI 설정 사용</button>}
          <p className="small muted">원고·컷 구성·캡션의 빈칸을 작성합니다.</p><AiUsageGuide provider={provider} />
          <button className="btn primary" disabled={!canWrite || !hasBlanks} onClick={() => run({ kind: "text", textTarget: "fill" })}>원고·컷 구성 자동 작성</button>
        </div>
        <div hidden={textMode !== "chatgpt"}><StudioTextImport content={form} channelName={channelName(form.channel)} disabled={busy || working || newer} apply={setForm} /></div>
        {archivedChannel && <p className="notice warn small">보관된 채널입니다. 새 AI 생성은 <GuardedLink href="/settings">채널 복원</GuardedLink> 후 사용할 수 있습니다.</p>}
        <details className="studio-more"><summary>채널·분류·작업 정보</summary><div className="stack">
          <div className="studio-form-grid">
            <label className="field">채널<select disabled={busy} value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value, subcategory: "" }))}>{channels.filter(c => c.active || c.id === form.channel).map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (보관됨)"}</option>)}</select></label>
            <CategorySelect channel={form.channel} categories={channels.find(c => c.id === form.channel)?.categories} value={form.subcategory ?? ""} onChange={v => change("subcategory", v)} disabled={busy} />
            <label className="field">단계<select disabled={busy} value={form.stage} onChange={e => change("stage", e.target.value as Stage)}>{stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            <label className="field">예정일<input type="date" disabled={busy} value={form.dueDate} onChange={e => change("dueDate", e.target.value)} /></label>
          </div>
        </div></details>
        <div className="studio-next-step"><button className="btn" onClick={() => setEditorStep("images")}>컷 구성과 그림으로 →</button></div>
      </section>
      <section className="panel stack" id="studio-composition" hidden={editorStep !== "images"}>
        <div className="studio-section-heading"><div><span className="studio-step">02 · 그림 제작</span><h2>{form.format === "카드뉴스" ? "본문 4장" : "네컷 구성"}</h2></div><span className="small muted">{form.panels.filter(p => p.imageId).length} / 4 그림</span></div>
        <WorkModeControl mode={imageMode === "api" ? "auto" : "manual"} onChange={mode => guard.confirmLeave(() => setImageMode(mode === "auto" ? "api" : "chatgpt"), form.panels.map((_, i) => `studio-image-${i}`))} disabled={busy} automaticUnavailable={settings.data?.ai.image === false ? "OpenAI 연결이 필요합니다. 연결 후 앱 안에서 그림을 만들고 바로 확인할 수 있습니다." : null} onConfigure={() => guard.confirmLeave(() => navigate("/connections?service=openai"))} />
        <p className="small muted">{imageMode === "chatgpt" ? "직접 만든 그림을 붙여넣거나 파일로 가져올 수 있습니다. 필요하면 외부 ChatGPT용 프롬프트를 복사하세요." : "장면과 문구를 수정한 뒤 원하는 컷만 다시 만들 수 있습니다. 한 번에 최대 4컷을 차례로 생성하며 컷마다 API 사용료가 발생합니다."}</p>
        {imageMode === "api" && <div className="studio-batch-actions">
          <button className="btn primary" disabled={!canDraw || !missingImages.length} onClick={() => run({ kind: "image", panelIndexes: missingImages })}>빈 그림 {missingImages.length}컷 자동 생성</button>
          <button className="btn" disabled={!canDraw || !selectedImagesReady} onClick={() => run({ kind: "image", panelIndexes: [...selectedImages].sort((a, b) => a - b) })}>선택한 {selectedImages.length || ""}컷 다시 생성</button>
          <span className="small muted">이미 있는 그림은 그대로 두며, 실패하면 남은 요청을 멈춥니다. 장면이나 문구가 있는 빈 컷만 자동 생성합니다.</span>
        </div>}
        {imageMode === "chatgpt" && form.characters.length > 0 && <div className="studio-reference-downloads"><span className="small muted">가족 기준 그림과 이 컷에서 고른 포즈 이미지를 ChatGPT에 함께 첨부하세요.</span><div className="row"><a className="btn sm" href={STUDIO_FAMILY_REFERENCE_URL} download="우주펭귄상회-가족-기준그림.png">가족 기준 그림 ↓</a></div></div>}
        {form.imagePath && <details className="studio-original"><summary>이전 웹툰 시안 보기</summary><img src={form.imagePath} alt="이전 네컷 웹툰 시안" /></details>}
        <div className="studio-panel-selector studio-panel-thumbnail-selector" role="group" aria-label="편집할 컷">{form.panels.map((p, i) => <div key={i}><button aria-pressed={selectedPanel === i} onClick={() => setSelectedPanel(i)}>{p.imageId ? <img src={imageUrl(p.imageId)} alt={`${i + 1}컷 저장된 그림`} /> : <span className="studio-panel-thumb-empty" aria-hidden="true">{i + 1}</span>}<strong>{i + 1}{form.format === "카드뉴스" ? "번째 본문" : "컷"}</strong><span>{p.imageId ? "그림 있음" : p.scene || p.dialogue ? "구성 있음" : "비어 있음"}</span></button>{imageMode === "api" && <label className="studio-panel-batch-select"><input type="checkbox" aria-label={`${i + 1}컷 다시 생성 선택`} checked={selectedImages.includes(i)} disabled={busy || working} onChange={event => setSelectedImages(current => event.target.checked ? [...current, i] : current.filter(n => n !== i))} />다시 생성</label>}</div>)}</div>
        <div className="studio-panels studio-focused-panel">{form.panels.map((p, i) => <article className="studio-comic-panel" key={i} hidden={selectedPanel !== i}>
          <div className="row between"><h3>{i + 1}{form.format === "카드뉴스" ? "번째 본문" : "컷"}</h3><span className="small muted">{p.imageId ? "그림 있음" : "구성 중"}</span></div>
          <label className="field small">장면<textarea disabled={busy} aria-label={panelLabel(i, "장면")} rows={3} value={p.scene} maxLength={4000} onChange={e => changePanel(i, "scene", e.target.value)} placeholder="등장인물, 표정, 배경, 소품" /></label>
          <label className="field small">{form.format === "카드뉴스" ? "본문" : "대사"}<textarea id={panelField(i)} disabled={busy} aria-label={panelLabel(i, "대사")} rows={2} value={p.dialogue} maxLength={3000} onChange={e => changePanel(i, "dialogue", e.target.value)} placeholder="그림 아래에 표시할 글" /></label>
          {editorStep === "images" && selectedPanel === i && <details className="content-options"><summary>이 컷의 캐릭터 포즈 · 선택</summary><div ref={posePickerTarget} tabIndex={-1} aria-label="현재 컷의 포즈 선택"><StudioPosePicker key={`${i}:${posePickerRequest}`} cast={form.characters} value={p.poseRefs ?? []} onChange={poseRefs => change("panels", form.panels.map((panel, index) => index === i ? { ...panel, poseRefs } : panel))} disabled={busy || working || newer} panelIndex={i} imageMode={imageMode} /></div></details>}
          {imageMode === "chatgpt" ? <StudioPanelImport content={form} index={i} channelName={channelName(form.channel)} instruction={panelInstructions[i]} disabled={busy || working || newer || !form.title.trim()} upload={uploadImage} /> : <>
            <div className="studio-panel-picture">{p.imageId ? <a href={imageUrl(p.imageId)} target="_blank" rel="noopener noreferrer"><img src={imageUrl(p.imageId)} alt={panelLabel(i, "그림")} /></a> : <div className="studio-picture-empty">{i + 1}<span>위에 쓴 내용이 그림으로 이어집니다.</span></div>}</div>
            <button className="btn primary" aria-label={panelLabel(i, p.imageId ? "다시 그리기" : "그리기")} disabled={!canDraw || (!p.scene.trim() && !p.dialogue.trim() && !panelInstructions[i].trim())} onClick={() => run({ kind: "image", panelIndex: i, instruction: panelInstructions[i] })}>{generate.isPending && generate.variables?.kind === "image" && generate.variables.panelIndex === i ? "요청 중…" : p.imageId ? "이 컷 다시 그리기" : "이 컷 그리기"}</button>
          </>}
          <details className="studio-more" open={imageMode === "api" ? true : undefined}><summary>이 컷의 세부 수정 지시</summary><div className="stack">
            <label className="field small">수정할 내용<textarea aria-label={panelLabel(i, "그림 추가 요청")} disabled={busy} rows={2} maxLength={6000} value={panelInstructions[i]} onChange={e => setPanelInstructions(current => current.map((v, n) => n === i ? e.target.value : v))} placeholder="예: 배경은 유지하고 표정만 놀라게. 문구는 짧고 다정하게." /></label>
            {imageMode === "api" && <><button className="btn" disabled={!canWrite || (!p.scene.trim() && !p.dialogue.trim() && !panelInstructions[i].trim())} onClick={() => run({ kind: "text", textTarget: "panel", panelIndex: i, instruction: panelInstructions[i] })}>이 컷 장면·문구만 자동 수정</button><p className="small muted">문구를 바꿔도 기존 그림과 다른 컷은 유지합니다. 그림에 반영하려면 이 컷 다시 그리기를 누르세요.</p></>}
            {p.imageId && <><p className="small muted">다시 그려도 이전 그림은 버전 기록에 남습니다.</p><button className="btn sm ghost" disabled={busy} onClick={() => change("panels", form.panels.map((panel, n) => n === i ? { ...panel, imageId: null } : panel))}>그림 빼고 글로 구성</button></>}
          </div></details>
        </article>)}</div>
        <div className="studio-next-step"><button className="btn ghost" onClick={() => setEditorStep("story")}>← 이야기</button><button className="btn" onClick={() => setEditorStep("finish")}>캡션과 최종 이미지 →</button></div>
      </section>
      <div className="stack" hidden={editorStep !== "finish"}>
      <section className="panel stack" id="studio-caption">
        <div className="studio-section-heading"><div><h2>게시용 캡션</h2></div></div>
        {captionProposal && <div className="studio-caption-proposal"><span className="small muted">작성한 글에서 만든 기본 초안 · AI 사용 없음</span><p>{captionProposal}</p><button className="btn sm" disabled={busy} onClick={() => change("caption", captionProposal)}>이 초안 사용</button></div>}
        <label className="field">게시용 캡션<textarea disabled={busy} rows={5} value={form.caption} maxLength={8000} onChange={e => change("caption", e.target.value)} placeholder="대사나 원고를 쓰면 기본 초안이 자동으로 제안됩니다." /></label>
        <div className="row"><button className="btn" onClick={copyCaption} disabled={!form.caption.trim()}>캡션 복사</button></div>
        <div className="row"><button className="btn" disabled={!canWrite || (!form.caption.trim() && !studioCaptionDraft(form) && !form.memo.trim())} onClick={() => run({ kind: "text", textTarget: "caption" })}>캡션만 자동 작성·수정</button></div><details className="studio-more"><summary>수동 캡션 작성 도움 · API 한도·연결 문제일 때</summary><div className="stack"><StudioPromptCopy prompt={studioChatGptCaptionPrompt(form, channelName(form.channel))} label="ChatGPT 캡션 프롬프트 복사" /><p className="small muted">받은 답변을 위 캡션 칸에 붙여넣으세요.</p><AiUsageGuide provider={provider} /><button className="btn" disabled={!canWrite || (!form.caption.trim() && !studioCaptionDraft(form) && !form.memo.trim())} onClick={() => run({ kind: "text", textTarget: "caption" })}>{aiProviderLabels[provider]}로 캡션 작성</button></div></details>
      </section>
      <StudioExport form={form} base={base} dirty={dirty} busy={ownBusy} active={editorStep === "finish"} change={change} save={saveCurrent} onPublicationBusyChange={setPublicationBusy} onFieldFocus={field => {
        const panel = /^panels\.(\d+)\./.exec(field);
        if (panel) { setEditorStep("images"); setSelectedPanel(Number(panel[1])); }
        else if (field === "title" || field === "format") setEditorStep("story");
      }} />
      <div className="studio-next-step"><button className="btn ghost" onClick={() => setEditorStep("images")}>← 그림 편집</button>{form.stage === "done" ? <span className="studio-stage-pill stage-done">제작 완료{dirty ? " · 저장 전 변경사항 있음" : ""}</span> : <button className="btn" disabled={busy || working || newer || !form.title.trim()} onClick={() => save.mutate({ ...form, stage: "done" })}>저장하고 제작 완료</button>}</div>
      </div>
      <details className="panel studio-more" hidden={editorStep !== "story" || textMode !== "api"}><summary>전체 원고를 API로 수정하기</summary><div className="stack">
        <p className="small muted">제목·원고·컷 구성·캡션을 함께 변경합니다. 장면이 바뀐 컷의 그림은 분리되며, 이전 내용은 버전 기록에 남습니다.</p>
        <label className="field">바꿀 내용<textarea disabled={busy} rows={3} maxLength={6000} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="예: 마지막 반전은 유지하고 전체 흐름을 더 짧게 바꿔줘." /></label>
        <AiUsageGuide provider={provider} /><button className="btn" disabled={!canWrite || !instruction.trim()} onClick={() => run({ kind: "text", textTarget: "rewrite", instruction })}>전체 원고 수정 · {aiProviderLabels[provider]}</button>
      </div></details>
      {editorStep !== "finish" && <StudioWorkingPreview form={form} base={base} selected={selectedPanel} onSelect={setSelectedPanel} onEdit={() => setEditorStep("images")} />}
    </div> : <section className="panel stack">
      <div className="row between"><h2>버전 기록</h2><span className="small muted">복원해도 이전 기록은 유지됩니다.</span></div>
      {!data.revisions.length ? <p className="muted">저장한 버전이 없습니다.</p> : <div className="studio-history-layout">
        <div className="studio-revision-list">{data.revisions.map(r => <button key={r.id} className={compareId === r.id ? "selected" : ""} onClick={() => setCompareId(r.id)}><strong>버전 {r.version}{!r.applied ? " · 미적용 결과" : ""}</strong><span>{r.provider === "gemini" ? "Gemini" : r.provider === "openai" ? "GPT" : r.provider === "anthropic" ? "Claude" : "직접 편집"} · {dateTime(r.createdAt)}</span><small>{r.instruction || "작업 저장"}</small></button>)}</div>
        <div>{compared ? <><div className="row between"><h3>버전 {compared.version} 비교</h3><button className="btn sm" disabled={busy || working} onClick={() => guard.confirmLeave(() => restore.mutate(compared.id))}>이 버전으로 복원</button></div><div className="studio-compare"><Snapshot title="현재 작업" card={form} /><Snapshot title={revisionLabel(compared.version)} card={compared.snapshot} /></div></> : <div className="studio-history-empty">왼쪽에서 비교할 버전을 선택하세요.</div>}</div>
      </div>}
    </section>}
  </div>;
}

const panelLabel = (i: number, label: string) => (i + 1) + "컷 " + label;
const panelField = (i: number) => "studio-panels." + i + ".dialogue";
const revisionLabel = (version: number) => "버전 " + version;

function Snapshot({ title, card }: { title: string; card: CardInput }) {
  return <article className="studio-snapshot"><h4>{title}</h4><strong>{card.title}</strong><p>{card.script || card.memo || "원고 없음"}</p>{card.panels?.map((p, i) => <div className="studio-snapshot-panel" key={i}><b>{i + 1}컷</b>{p.imageId && <img src={imageUrl(p.imageId)} alt={`${title} ${i + 1}컷`} />}<p>{p.scene}</p><blockquote>{p.dialogue}</blockquote></div>)}<h4>캡션</h4><p>{card.caption || "캡션 없음"}</p></article>;
}
