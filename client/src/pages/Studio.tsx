import { SourceStudioCard } from "./SourceStudioCard";
import { aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import { AiUsageGuide } from "../AiUsageGuide";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, apiUpload } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { ErrorBox, GuardedLink, Loading } from "../ui";
import { useToast } from "../toast";
import { Icon } from "../icons";

import { studioKey } from "@shared/channelKeys";
import { studioOutputFormats, studioOutputDescription } from "@shared/studio";
import { studioCaptionDraft } from "@shared/studioWorkflow";
import type { StudioGeneration } from "@shared/studio";
import { StudioExport, StudioQuickExport } from "./StudioExport";
import { StudioPanelImport } from "./StudioPanelImport";
import { StudioPromptCopy, StudioTextImport } from "./StudioTextImport";
import { studioChatGptCaptionPrompt } from "@shared/studioTextImport";
import type { StudioChannel as Channel, StudioStage as Stage, StudioCharacter as Character, StudioFormat as Format, StudioPanel as Panel, StudioContent as CardInput, StudioCard as Card, StudioRevision as Revision, StudioJob as Job, StudioBoard as Board, StudioCardDetail as Detail } from "@shared/studio";
const stages: Array<{ id: Stage; label: string }> = [{ id: "idea", label: "아이디어" }, { id: "writing", label: "원고" }, { id: "making", label: "제작" }, { id: "review", label: "검토" }, { id: "done", label: "완료" }];
const formats: readonly Format[] = studioOutputFormats;
function useStudioChannels(includeArchived = false) {
  const { allChannels } = useChannel();
  return allChannels.filter(c => includeArchived || c.active).map(c => ({ id: studioKey(c.slug), name: c.name, role: c.description, active: c.active, accent: c.accentColor,
    image: (c.slug === "opportunities" ? "pempem" : c.slug === "current-dialogue" ? "pengpeng" : c.slug === "penguin" ? "pengki" : c.slug === "fryday" ? "penguin" : null) as Character | null }));
}
const characters: Array<{ id: Character; name: string; role: string; detail: string }> = [
  { id: "pengpeng", name: "펭펭", role: "아빠 · 지구 특파원", detail: "펼친 신문. 현장에서 보고 들은 지구의 이야기를 전합니다." },
  { id: "pempem", name: "펨펨", role: "엄마 · 전 우주기관 연구원", detail: "학사모, 연필, 분홍 볼터치. Highway의 안내자입니다." },
  { id: "penguin", name: "김펭귄", role: "첫째 · 식품공학 대학원생", detail: "흰 용기에 담긴 노란 감자튀김. 최고의 감자튀김을 고향에 전하려 합니다." },
  { id: "pengki", name: "김펭키", role: "둘째 · 탐사 과학자를 꿈꾸는 학생", detail: "작은 체구와 노란 가방. 가족에게 새로운 질문을 건넵니다." },
];

const imageUrl = (id: number) => `/api/studio/images/${id}`;
const dateTime = (v: string) => new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const activeJob = (j: Job) => ["queued", "running", "processing"].includes(j.status);
const inputOf = (c: CardInput): CardInput => ({ title: c.title, channel: c.channel, format: c.format, stage: c.stage, dueDate: c.dueDate ?? "", memo: c.memo ?? "", script: c.script ?? "", caption: c.caption ?? "", exportDesign: c.exportDesign ?? "editorial", sourceLabel: c.sourceLabel ?? "", panels: c.panels ?? Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), characters: c.characters ?? [], imagePath: c.imagePath ?? "" });

export function StudioPage({ cardId }: { cardId?: number }) {
  const [view, setView] = useState<"board" | "characters">("board");
  const guard = useDirtyGuard();
  if (cardId !== undefined) return Number.isSafeInteger(cardId) && cardId > 0 ? <StudioDetail key={cardId} id={cardId} /> : <div className="notice err">작업 주소를 확인해 주세요. <GuardedLink href="/">보드로</GuardedLink></div>;
  return <div className="studio">
    <header className="studio-home-top"><span className="studio-eyebrow">MY STUDIO <span className="studio-today">{new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" })}</span></span><button className="btn sm ghost" onClick={() => guard.confirmLeave(() => setView(view === "board" ? "characters" : "board"))}>{view === "board" ? "캐릭터 원본 ↗" : "← 내 콘텐츠"}</button></header>
    {view === "board" ? <StudioBoard /> : <CharacterArchive />}
  </div>;
}

function StudioBoard() {
  const channels = useStudioChannels(true);
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const q = useQuery({ queryKey: ["studio", "cards"], queryFn: () => api<Board>("/studio/cards") });
  const [filter, setFilter] = useState<Channel | "all">("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const [newStage, setNewStage] = useState<Stage>("idea");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [statusFilter, setStatusFilter] = useState<"active" | "done" | "all">("active");
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useDirtyGuard();
  const [, navigate] = useLocation();
  const cards = q.data?.cards ?? [];
  const visibleChannels = channels.filter(ch => archived ? !ch.active : ch.active);
  const visibleKeys = new Set(visibleChannels.map(ch => ch.id));
  const scoped = cards.filter(c => visibleKeys.has(c.channel) && (filter === "all" || c.channel === filter));
  const filtered = scoped.filter(c => (layout === "board" || statusFilter === "all" || (statusFilter === "done" ? c.stage === "done" : c.stage !== "done")) && `${c.title} ${c.memo} ${c.script}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  const latest = scoped.filter(c => c.stage !== "done").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0];
  const reviewCount = scoped.filter(c => c.stage === "review").length;
  const resetFilters = () => { setSearch(""); setFilter("all"); setStatusFilter("active"); setArchived(false); };
  const move = useMutation({ mutationFn: ({ card, stage }: { card: Card; stage: Stage }) => api(`/studio/cards/${card.id}`, { method: "PATCH", body: { version: card.version, stage } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }), onError: (e) => toast("err", e.message) });
  const { channels: legacyChannels, select } = useChannel();
  const openHighway = () => guard.confirmLeave(() => { const channel = legacyChannels.find(c => studioKey(c.slug) === filter); if (channel) select(channel.id); navigate("/inbox"); });
  function newCard(stage: Stage = "idea") { if (archived || !visibleChannels.length) return; setNewStage(stage); setCreating(true); }
  return <>
    <header className="studio-home-heading"><div><h1>내 콘텐츠</h1><p>생각을 모으고, 나다운 콘텐츠로 완성하는 곳.</p></div><button className="btn primary studio-create" disabled={archived || !visibleChannels.length} onClick={() => newCard()}><Icon name="plus" size={18} />새 콘텐츠 만들기</button></header>
    <div className="studio-overview">
      <section className="studio-resume" aria-label="최근 작업 이어하기">
        <div className="studio-resume-label"><span className="resume-indicator" />{latest ? "이어서 만들어 볼까요?" : "다음 이야기를 기다리는 중"}</div>
        <h2>{q.isLoading ? "작업을 불러오고 있어요" : q.error ? "작업을 불러오지 못했어요" : latest?.title ?? "작은 아이디어부터 시작해요"}</h2>
        <div className="studio-resume-bottom"><span>{latest ? `${channelName(latest.channel)} · ${latest.format}` : "원고부터 그림까지, 한곳에서"}</span>{latest ? <GuardedLink href={`/studio/${latest.id}`} className="resume-link">작업 열기 <Icon name="arrow" size={17} /></GuardedLink> : <button className="resume-link" disabled={archived || !visibleChannels.length || q.isLoading || !!q.error} onClick={() => newCard()}>시작하기 <Icon name="arrow" size={17} /></button>}</div>
      </section>
      <section className="studio-at-a-glance" aria-label="콘텐츠 현황"><span className="overview-label">{filter === "all" ? archived ? "보관 채널" : "전체 채널" : channelName(filter)} 작업 현황</span><div className="overview-numbers"><div><strong>{q.data ? scoped.filter(c => c.stage !== "done").length : "—"}</strong><span>진행 중</span></div><div><strong>{q.data ? reviewCount : "—"}</strong><span>검토 단계</span></div><div><strong>{q.data ? scoped.filter(c => c.stage === "done").length : "—"}</strong><span>제작 완료</span></div></div><button className="overview-source" onClick={openHighway}><Icon name="inbox" size={16} /> 수집한 자료에서 아이디어 찾기 <Icon name="arrow" size={16} /></button></section>
    </div>
    <section className="studio-workspace" aria-label="내 작업">
    <div className="studio-workspace-head"><div className="studio-status-filters" role="group" aria-label="작업 상태">{layout === "list" ? ([['active', '진행 중'], ['done', '완료'], ['all', '전체']] as const).map(([value, label]) => <button key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}<span>{q.data ? scoped.filter(c => value === "all" || (value === "done" ? c.stage === "done" : c.stage !== "done")).length : "—"}</span></button>) : <h2>단계별 진행 상황</h2>}</div><div className="studio-view-switch" role="group" aria-label="작업 보기"><button aria-pressed={layout === "list"} onClick={() => setLayout("list")}><Icon name="grid" size={16} />갤러리</button><button aria-pressed={layout === "board"} onClick={() => setLayout("board")}><Icon name="board" size={16} />단계 보드</button></div></div>
    <div className="studio-home-filters"><label className="studio-home-search"><Icon name="search" size={18} /><span className="sr-only">작업 검색</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="제목이나 원고로 검색" /></label><label><span className="sr-only">채널 필터</span><select aria-label="채널 필터" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">모든 {archived ? "보관 " : ""}채널</option>{visibleChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{channels.some(ch => !ch.active) && <button className="btn sm ghost" aria-pressed={archived} onClick={() => { setArchived(!archived); setFilter("all"); }}>{archived ? "보관 보기 종료" : "보관 채널"}</button>}</div>
    {!visibleChannels.length && <p className="notice">{archived ? "보관된 채널이 없습니다." : <>사용 중인 채널이 없습니다. <GuardedLink href="/settings">채널 추가·복원 →</GuardedLink></>}</p>}
    {archived && <p className="notice">이전 작업은 열어서 편집하고 내려받을 수 있습니다. 새 작업과 AI 생성은 채널을 복원한 뒤 사용할 수 있습니다.</p>}
    {q.isLoading ? <Loading lines={3} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : layout === "list" ? <>
      {filtered.length ? <div className="studio-content-grid">{filtered.map(c => {
        const channel = channels.find(ch => ch.id === c.channel);
        const thumbnail = c.panels.find(p => p.imageId)?.imageId;
        const sourceThumbnail = c.sourceOutput ? `/api/channels/${c.sourceOutput.channelId}/media/${c.sourceOutput.assetId}` : null;
        return <article key={c.id} className="studio-content-card" style={{ "--channel-accent": channel?.accent ?? "#285f6a" } as CSSProperties}>
          <GuardedLink href={`/studio/${c.id}`} className="studio-content-open">
            <div className={`studio-content-art ${sourceThumbnail || thumbnail || c.imagePath ? "has-image" : ""}`}>{sourceThumbnail ? <img src={sourceThumbnail} alt="" loading="lazy" /> : thumbnail ? <img src={imageUrl(thumbnail)} alt="" loading="lazy" /> : c.imagePath ? <img src={c.imagePath} alt="" loading="lazy" /> : <><span className={`studio-format-art ${c.format === "웹툰" ? "comic" : "slides"}`} aria-hidden="true"><i /><i /><i /><i /></span><span className="studio-art-label">{c.format} · {stages.find(s => s.id === c.stage)?.label}</span></>}</div>
            <div className="studio-content-copy"><span className="studio-content-channel"><i aria-hidden="true" />{channelName(c.channel)}</span><h2>{c.title}</h2><span className="studio-content-meta">{c.format}{c.sourceOutput && ` · ${c.sourceOutput.pages.length}장${c.sourceOutput.stale ? " · 재생성 필요" : ""}`}{c.dueDate && <> · <time dateTime={c.dueDate}>{c.dueDate.slice(5).replace("-", "/")} 예정</time></>}</span><div className="studio-content-bottom"><span className={`studio-stage-pill stage-${c.stage}`}>{stages.find(s => s.id === c.stage)?.label}</span><span className="card-open-label">{c.sourceOutput ? "카드뉴스 보기" : c.stage === "done" ? "결과 확인" : "이어서 편집"} <Icon name="arrow" size={15} /></span></div></div>
          </GuardedLink>
          {(c.stage === "done" || c.sourceOutput) && <StudioQuickExport card={c} />}
        </article>;
      })}</div> : <div className="studio-home-empty"><span aria-hidden="true">✧</span><h2>{search ? "검색한 작업이 없어요" : statusFilter === "done" ? "완료한 콘텐츠가 여기에 모여요" : "새 이야기를 시작해 보세요"}</h2><p>{search ? "검색어를 바꾸거나 필터를 초기화해 보세요." : statusFilter === "done" ? "제작을 마치면 이미지와 캡션을 바로 꺼낼 수 있습니다." : "제목 하나면 충분해요. 원고와 그림은 차근차근 채워갑니다."}</p>{(search || filter !== "all" || statusFilter !== "active" || archived) ? <button className="btn" onClick={resetFilters}>필터 초기화</button> : <button className="btn primary" disabled={!visibleChannels.length} onClick={() => newCard()}>첫 콘텐츠 만들기</button>}</div>}
    </> : <div className="studio-board">{stages.map((stage) => <section key={stage.id} className={`studio-column stage-${stage.id}`} aria-label={stage.label} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const card = filtered.find((c) => String(c.id) === e.dataTransfer.getData("text/studio-card")); if (!archived && card && card.stage !== stage.id && !move.isPending) move.mutate({ card, stage: stage.id }); }}><div className="studio-column-head"><h2>{stage.label}<span>{filtered.filter((c) => c.stage === stage.id).length}</span></h2><button className="studio-add" disabled={archived || !visibleChannels.length} aria-label={`${stage.label} 작업 추가`} onClick={() => newCard(stage.id)}>＋</button></div><div className="studio-task-list">{filtered.filter((c) => c.stage === stage.id).map((c) => <article key={c.id} className="studio-task" draggable={!move.isPending && !archived} onDragStart={(e) => e.dataTransfer.setData("text/studio-card", String(c.id))}><span className={`studio-channel-tag ${c.channel}`}>{channelName(c.channel)}</span><GuardedLink href={`/studio/${c.id}`} className="studio-task-open">{c.sourceOutput && <img className="studio-task-preview" src={`/api/channels/${c.sourceOutput.channelId}/media/${c.sourceOutput.assetId}`} alt={`${c.sourceOutput.pages.length}장 카드뉴스 표지`} loading="lazy" />}<h3>{c.title}</h3></GuardedLink><div className="studio-task-meta"><span>{c.format}</span>{c.dueDate && <time dateTime={c.dueDate}>{c.dueDate.slice(5).replace("-", ".")}</time>}</div><select aria-label={`${c.title} 제작 단계`} value={c.stage} disabled={move.isPending || archived} onChange={(e) => move.mutate({ card: c, stage: e.target.value as Stage })}>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>{stage.id === "done" && <StudioQuickExport card={c} />}</article>)}{!filtered.some((c) => c.stage === stage.id) && <p className="studio-column-hint">작업 없음</p>}</div></section>)}</div>}
    </section>
    <div className="studio-home-footer"><button className="btn sm ghost" onClick={openHighway}>수집한 자료에서 시작 ↗</button><GuardedLink className="btn sm ghost" href="/settings">채널 관리 ↗</GuardedLink><span>완료한 파일은 내려받아 SNS에 직접 게시할 수 있어요.</span></div>
    {q.data && <StudioNotes data={q.data} />}
    {creating && <NewCard channel={filter === "all" || !visibleKeys.has(filter) ? visibleChannels[0]?.id : filter} stage={newStage} onClose={() => setCreating(false)} />}
  </>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog className="studio-dialog" ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}><div className="row between"><h2>{title}</h2><button type="button" className="btn ghost" aria-label="닫기" onClick={onClose}>✕</button></div>{children}</dialog>;
}

function NewCard({ channel, stage, onClose }: { channel: Channel; stage: Stage; onClose: () => void }) {
  const channels = useStudioChannels();
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const [title, setTitle] = useState("");
  const [ch, setCh] = useState(channel);
  const [format, setFormat] = useState<Format>(channel === "penguin" ? "웹툰" : "카드뉴스");
  const guard = useDirtyGuard();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const create = useMutation({ mutationFn: () => api<{ card: Card } | Card>("/studio/cards", { method: "POST", body: { title, channel: ch, format, stage, dueDate: "", memo: "", script: "", caption: "", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), characters: ch === "highway" ? ["pempem"] : ch === "fryday" ? ["penguin"] : ch === "news" ? ["pengpeng"] : ch === "penguin" ? ["pengki"] : [] } }), onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["studio"] }); onClose(); guard.confirmLeave(() => navigate(`/studio/${"card" in d ? d.card.id : d.id}`)); } });
  return <Dialog title="새 작업" onClose={() => !create.isPending && onClose()}><form className="stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}><label className="field">제목<input autoFocus required value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="어떤 이야기를 만들까요?" /></label><div className="grid grid-2"><label className="field">채널<select value={ch} onChange={(e) => setCh(e.target.value as Channel)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field">형식<select value={format} onChange={(e) => setFormat(e.target.value as Format)}>{formats.map((f) => <option key={f}>{f}</option>)}</select></label></div><p className="small muted">{studioOutputDescription(format)}</p>{create.error && <ErrorBox error={create.error} />}<button className="btn primary" disabled={!title.trim() || create.isPending}>{create.isPending ? "만드는 중…" : "작업 만들기"}</button></form></Dialog>;
}

function StudioNotes({ data }: { data: Board }) {
  const [notes, setNotes] = useState(data.notes);
  const [version, setVersion] = useState(data.notesVersion);
  const [baseline, setBaseline] = useState(data.notes);
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const dirty = notes !== baseline;
  const save = useMutation({ mutationFn: () => api("/studio/notes", { method: "PATCH", body: { version, notes } }), onSuccess: () => { setBaseline(notes); setVersion((v) => v + 1); qc.invalidateQueries({ queryKey: ["studio", "cards"] }); } });
  useEffect(() => { if (!dirty) { setNotes(data.notes); setBaseline(data.notes); setVersion(data.notesVersion); } }, [data.notes, data.notesVersion]);
  useEffect(() => { guard.setDirty("studio-notes", dirty, async () => { try { await save.mutateAsync(); return true; } catch { return false; } }); return () => guard.setDirty("studio-notes", false); }, [dirty, notes, version]);
  return <details className="panel studio-notes"><summary>운영 메모</summary><div className="stack"><textarea disabled={save.isPending} aria-label="운영 메모" rows={5} value={notes} maxLength={20000} onChange={(e) => setNotes(e.target.value)} /><div className="row"><button className="btn sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "메모 저장"}</button>{save.isSuccess && !dirty && <span className="small muted">저장됨</span>}</div>{save.error && <ErrorBox error={save.error} />}</div></details>;
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
  const q = useQuery({ queryKey: ["studio", "card", id], queryFn: () => api<Detail>(`/studio/cards/${id}`), refetchInterval: (query) => query.state.data?.jobs.some(activeJob) ? 3000 : false });
  if (q.isLoading) return <Loading lines={5} />;
  if (!q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.data.card.sourceOutput && !q.data.card.script && !q.data.card.panels.some(p => p.dialogue || p.scene || p.imageId) && !q.data.card.imagePath) return <SourceStudioCard card={q.data.card} />;
  // A background polling failure must not unmount the editor and discard unsaved work.
  return <>{q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}<StudioEditor key={q.data.card.id} data={q.data} refresh={() => q.refetch()} /></>;
}

type GenerationAction = Pick<StudioGeneration, "kind"> & Partial<Pick<StudioGeneration, "textTarget" | "panelIndex" | "instruction">>;

function StudioEditor({ data, refresh }: { data: Detail; refresh: () => unknown }) {
  const channels = useStudioChannels(true);
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const settings = useQuery({ queryKey: ["studio", "cards"], queryFn: () => api<Board>("/studio/cards") });
  const [base, setBase] = useState(data.card);
  const baseRef = useRef(data.card);
  const [form, setForm] = useState(() => inputOf(data.card));
  const [instruction, setInstruction] = useState("");
  const [panelInstructions, setPanelInstructions] = useState(["", "", "", ""]);
  const [imageMode, setImageMode] = useState<"chatgpt" | "api">("chatgpt");
  const [textMode, setTextMode] = useState<"chatgpt" | "api">("api");
  const [editorStep, setEditorStep] = useState<"story" | "images" | "finish">(() => data.card.stage === "done" || data.card.stage === "review" ? "finish" : data.card.stage === "making" ? "images" : "story");
  const [selectedPanel, setSelectedPanel] = useState(0);
  const [uploading, setUploading] = useState<number | null>(null);
  const uploadingRef = useRef(false);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [tab, setTab] = useState<"content" | "history">("content");
  const [compareId, setCompareId] = useState<number | null>(null);
  const [awaitingJob, setAwaitingJob] = useState<number | null>(null);
  const guard = useDirtyGuard();
  const qc = useQueryClient();
  const toast = useToast();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  const providerInitialized = useRef(false);
  useEffect(() => { if (settings.data && !providerInitialized.current) { setProvider(settings.data.ai.defaultProvider); providerInitialized.current = true; } }, [settings.data]);
  useEffect(() => { if (awaitingJob && data.jobs.some(j => j.id === awaitingJob)) setAwaitingJob(null); }, [data.jobs, awaitingJob]);
  const dirty = JSON.stringify(form) !== JSON.stringify(inputOf(base));
  const newer = data.card.version > base.version;
  const working = awaitingJob !== null || data.jobs.some(activeJob);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["studio"] });
  const accept = (c: Card) => { baseRef.current = c; setBase(c); setForm(inputOf(c)); };
  useEffect(() => { if (!dirty && data.card.version > base.version) accept(data.card); }, [data.card.version, dirty, base.version]);
  const save = useMutation({
    mutationFn: (next?: CardInput) => api<Card | { card: Card }>(`/studio/cards/${base.id}`, { method: "PATCH", body: { ...(next ?? form), version: base.version } }),
    onSuccess: (d) => { accept("card" in d ? d.card : d); invalidate(); },
  });
  const saveCurrent = useCallback(async (): Promise<Card> => { if (!dirty) return base; const d = await save.mutateAsync(); return "card" in d ? d.card : d; }, [dirty, base, form]);
  useEffect(() => { guard.setDirty("studio-card", dirty, async () => { try { await saveCurrent(); return true; } catch { return false; } }); return () => guard.setDirty("studio-card", false); }, [dirty, saveCurrent]);
  const generate = useMutation({
    retry: false,
    mutationFn: async (action: GenerationAction) => {
      const current = await saveCurrent();
      const input = { version: current.version, kind: action.kind, provider: action.kind === "image" ? "openai" : provider,
        instruction: action.instruction ?? "", textTarget: action.textTarget ?? "rewrite",
        ...(action.kind === "image" ? { panelIndex: action.panelIndex } : {}) };
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
    onSettled: () => { submitting.current = false; },
  });
  const testConnection = useMutation({
    retry: false, mutationFn: () => api<{ ok: boolean; message: string }>("/secrets/test/openai", { method: "POST", body: {} }),
  });
  const restore = useMutation({
    mutationFn: (revisionId: number) => api<Card | { card: Card }>(`/studio/cards/${baseRef.current.id}/restore`, { method: "POST", body: { version: baseRef.current.version, revisionId } }),
    onSuccess: (d) => { accept("card" in d ? d.card : d); invalidate(); setTab("content"); toast("ok", "선택한 버전을 새 버전으로 복원했습니다."); },
  });
  function change<K extends keyof CardInput>(key: K, value: CardInput[K]) { setForm(f => ({ ...f, [key]: value })); }
  function changePanel(i: number, key: "scene" | "dialogue", value: string) { change("panels", form.panels.map((p, n) => n === i ? { ...p, [key]: value } : p)); }
  const busy = save.isPending || generate.isPending || restore.isPending || uploading !== null;
  const archivedChannel = !channels.find(c => c.id === form.channel)?.active;
  const canGenerate = !busy && !working && !newer && !archivedChannel && !!form.title.trim();
  const canWrite = canGenerate && settings.data?.ai.text[provider] === true;
  const canDraw = canGenerate && settings.data?.ai.image === true;
  const hasBlanks = !form.script.trim() || !form.caption.trim() || form.panels.some(p => !p.scene.trim() || !p.dialogue.trim());
  const captionProposal = !form.caption.trim() ? studioCaptionDraft(form) : "";
  const compared = data.revisions.find(r => r.id === compareId);
  const latestJob = data.jobs[0];
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
      <div><span className="studio-channel-tag">{channelName(form.channel)}</span><h1>{base.title}</h1><span className="small muted">버전 {base.version} · {dirty ? "저장 전 변경사항" : "저장됨"}</span></div>
      <button className="btn primary" onClick={() => save.mutate()} disabled={!dirty || busy || !form.title.trim()}>{save.isPending ? "저장 중…" : "저장"}</button>
    </header>
    {newer && dirty && <div className="notice warn row between"><span>서버에 새 버전이 있습니다. 현재 입력은 유지했습니다.</span><button className="btn sm" onClick={() => guard.confirmLeave(() => accept(data.card))}>새 버전 불러오기</button></div>}
    {(save.error || restore.error) && <ErrorBox error={save.error || restore.error} />}
    {data.card.sourceOutput && <SourceStudioCard card={data.card} embedded />}
    <div className="tabs" role="tablist" aria-label="콘텐츠 편집">
      <button role="tab" aria-selected={tab === "content"} onClick={() => setTab("content")}>콘텐츠 편집</button>
      <button role="tab" aria-selected={tab === "history"} onClick={() => guard.confirmLeave(() => setTab("history"))}>버전 기록 {data.revisions.length}</button>
    </div>
    {(working || generate.error || latestJob?.status === "failed" || latestJob?.result?.applied === false) && <details className="panel studio-work-status" open={working || !!generate.error || latestJob?.status === "failed" || latestJob?.result?.applied === false}><summary>{working ? "API로 생성 중" : "이전 API 요청 결과"}</summary><div className="stack">
      {working && <p role="status">AI가 작업 중입니다. 완료되면 여기에 반영됩니다. 화면을 닫아도 요청은 보관됩니다.</p>}
      {generate.error && <ErrorBox error={generate.error} />}
      {!working && latestJob?.status === "failed" && <div role="alert" className="notice err"><strong>생성을 완료하지 못했습니다.</strong><p>{latestJob.lastError}</p></div>}
      {!working && latestJob?.result?.applied === false && <p className="notice warn">생성 중 수정한 내용은 유지했습니다. <button className="btn sm" onClick={() => { setTab("history"); setCompareId(Number(latestJob.result?.revisionId)); }}>새 결과를 버전 기록에서 확인</button></p>}
      <div className="row"><button className="btn sm" onClick={() => refresh()}>상태 새로고침</button><GuardedLink href="/connections?service=openai" className="btn sm ghost">OpenAI 키 입력·수정</GuardedLink><button className="btn sm ghost" disabled={working || testConnection.isPending} onClick={() => testConnection.mutate()}>{testConnection.isPending ? "확인 중…" : "OpenAI 연결 확인 · 생성 비용 없음"}</button></div>
      {testConnection.data && <p role="status" className={testConnection.data.ok ? "notice ok" : "notice warn"}>{testConnection.data.message}</p>}
      {testConnection.error && <ErrorBox error={testConnection.error} />}
    </div></details>}
    {tab === "content" ? <div className="studio-editor-layout studio-guided-editor">
      <nav className="studio-editor-steps" aria-label="제작 순서">{([['story','01','이야기'],['images','02','그림'],['finish','03','완성']] as const).map(([id, number, label]) => <button key={id} aria-current={editorStep === id ? "step" : undefined} onClick={() => setEditorStep(id)}><span>{number}</span><strong>{label}</strong></button>)}</nav>
      <section className="panel stack" id="studio-story" hidden={editorStep !== "story"}>
        <div className="studio-section-heading"><div><h2>어떤 이야기를 만들까요?</h2></div><span className="small muted">API로 자동 작성하거나 ChatGPT 초안을 가져오세요.</span></div>
        <label className="field">제목<input id="studio-title" disabled={busy} value={form.title} maxLength={160} onChange={e => change("title", e.target.value)} /></label>
        <label className="field">기획·참고 자료<textarea disabled={busy} value={form.memo} rows={3} maxLength={12000} onChange={e => change("memo", e.target.value)} placeholder="이야기의 핵심이나 확인한 자료를 적어 주세요. 이미 컷을 썼다면 비워 두어도 됩니다." /></label>
        <label className="field">형식<select id="studio-format" disabled={busy} value={form.format} onChange={e => change("format", e.target.value as Format)}>{!formats.includes(form.format) && <option value={form.format}>{form.format} · 기획용</option>}{formats.map(f => <option key={f}>{f}</option>)}</select></label>
        <div className="studio-image-mode" role="group" aria-label="초안 작성 방법"><button aria-pressed={textMode === "api"} onClick={() => setTextMode("api")}>API 자동 작성</button><button aria-pressed={textMode === "chatgpt"} onClick={() => setTextMode("chatgpt")}>ChatGPT로 초안 만들기</button></div>
        <div className="stack" hidden={textMode !== "api"} data-testid="studio-api-writing">
          <label className="field">작성 AI<select value={provider} disabled={busy || working} onChange={e => { providerInitialized.current = true; setProvider(e.target.value as typeof provider); }}><option value="gemini">Gemini · 무료 등급 지원</option><option value="openai">GPT · OpenAI</option><option value="anthropic">Claude</option></select></label>
          <p className="small muted">원고·컷 구성·캡션의 빈칸을 작성합니다.</p><AiUsageGuide provider={provider} />
          {settings.data?.ai.text[provider] === false && <p className="notice warn small">작성 AI의 키가 없습니다. <GuardedLink href={`/connections?service=${provider}`}>API 키 입력 →</GuardedLink></p>}
          <button className="btn" disabled={!canWrite || !hasBlanks} onClick={() => run({ kind: "text", textTarget: "fill" })}>빈칸 초안 채우기 · API</button>
        </div>
        <div hidden={textMode !== "chatgpt"}><StudioTextImport content={form} channelName={channelName(form.channel)} disabled={busy || working || newer} apply={setForm} /></div>
        {archivedChannel && <p className="notice warn small">보관된 채널입니다. 새 AI 생성은 <GuardedLink href="/settings">채널 복원</GuardedLink> 후 사용할 수 있습니다.</p>}
        <details className="studio-more" open={!!form.script || undefined}><summary>전체 원고·작업 정보</summary><div className="stack">
          <label className="field">전체 원고<textarea disabled={busy} value={form.script} rows={6} maxLength={24000} onChange={e => change("script", e.target.value)} placeholder="전체 원고가 없어도 장면·대사에서 바로 그림을 만들 수 있습니다." /></label>
          <div className="studio-form-grid">
            <label className="field">채널<select disabled={busy} value={form.channel} onChange={e => change("channel", e.target.value)}>{channels.filter(c => c.active || c.id === form.channel).map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (보관됨)"}</option>)}</select></label>
            <label className="field">단계<select disabled={busy} value={form.stage} onChange={e => change("stage", e.target.value as Stage)}>{stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            <label className="field">예정일<input type="date" disabled={busy} value={form.dueDate} onChange={e => change("dueDate", e.target.value)} /></label>
          </div>
        </div></details>
        <div className="studio-next-step"><button className="btn" onClick={() => setEditorStep("images")}>컷 구성과 그림으로 →</button></div>
      </section>
      <section className="panel stack" id="studio-composition" hidden={editorStep !== "images"}>
        <div className="studio-section-heading"><div><span className="studio-step">02 · 그림 제작</span><h2>{form.format === "카드뉴스" ? "본문 4장" : "네컷 구성"}</h2></div><span className="small muted">{form.panels.filter(p => p.imageId).length} / 4 그림</span></div>
        <div className="studio-image-mode" role="group" aria-label="그림 제작 방법"><button aria-pressed={imageMode === "chatgpt"} disabled={busy} onClick={() => guard.confirmLeave(() => setImageMode("chatgpt"))}>ChatGPT로 만들기</button><button aria-pressed={imageMode === "api"} disabled={busy} onClick={() => guard.confirmLeave(() => setImageMode("api"))}>API로 자동 생성</button></div>
        <p className="small muted">{imageMode === "chatgpt" ? "프롬프트 복사 → ChatGPT에서 이미지 생성 → 해당 컷에 붙여넣기. 스튜디오 API 사용료 없이 저장합니다." : "장면·대사를 사용해 한 번에 한 컷을 생성합니다. 이미지 API 사용료가 발생합니다."}</p>
        <fieldset className="studio-cast"><legend>등장인물 · 그림 기준</legend><div className="studio-character-picks">{characters.map(c => <label key={c.id} className={form.characters.includes(c.id) ? "selected" : ""}><input type="checkbox" disabled={busy} checked={form.characters.includes(c.id)} onChange={e => change("characters", e.target.checked ? [...form.characters, c.id] : form.characters.filter(id => id !== c.id))} /><img src={getCharacterImage(c.id)} alt="" /><span>{c.name}</span></label>)}</div></fieldset>
        {imageMode === "chatgpt" && form.characters.length > 0 && <div className="studio-reference-downloads"><span className="small muted">처음 만들 때 캐릭터 원본도 ChatGPT에 첨부하세요.</span><div className="row">{characters.filter(c => form.characters.includes(c.id)).map(c => <a key={c.id} className="btn sm" href={getCharacterImage(c.id)} download={`${c.name}-원본.png`}>{c.name} 원본 ↓</a>)}</div></div>}
        {imageMode === "api" && settings.data?.ai.image === false && <p className="notice warn small">API 자동 생성에는 OpenAI 키가 필요합니다. <GuardedLink href="/connections?service=openai">OpenAI 키 입력 →</GuardedLink></p>}
        {form.imagePath && <details className="studio-original"><summary>이전 웹툰 시안 보기</summary><img src={form.imagePath} alt="이전 네컷 웹툰 시안" /></details>}
        <div className="studio-panel-selector" role="group" aria-label="편집할 컷">{form.panels.map((p, i) => <button key={i} aria-pressed={selectedPanel === i} onClick={() => setSelectedPanel(i)}><strong>{i + 1}{form.format === "카드뉴스" ? "번째 본문" : "컷"}</strong><span>{p.imageId ? "그림 있음" : p.scene || p.dialogue ? "구성 있음" : "비어 있음"}</span></button>)}</div>
        <div className="studio-panels studio-focused-panel">{form.panels.map((p, i) => <article className="studio-comic-panel" key={i} hidden={selectedPanel !== i}>
          <div className="row between"><h3>{i + 1}{form.format === "카드뉴스" ? "번째 본문" : "컷"}</h3><span className="small muted">{p.imageId ? "그림 있음" : "구성 중"}</span></div>
          <label className="field small">장면<textarea disabled={busy} aria-label={panelLabel(i, "장면")} rows={3} value={p.scene} maxLength={4000} onChange={e => changePanel(i, "scene", e.target.value)} placeholder="등장인물, 표정, 배경, 소품" /></label>
          <label className="field small">{form.format === "카드뉴스" ? "본문" : "대사"}<textarea id={panelField(i)} disabled={busy} aria-label={panelLabel(i, "대사")} rows={2} value={p.dialogue} maxLength={3000} onChange={e => changePanel(i, "dialogue", e.target.value)} placeholder="그림 아래에 표시할 글" /></label>
          {imageMode === "chatgpt" ? <StudioPanelImport content={form} index={i} channelName={channelName(form.channel)} instruction={panelInstructions[i]} disabled={busy || working || newer || !form.title.trim()} upload={uploadImage} /> : <>
            <div className="studio-panel-picture">{p.imageId ? <a href={imageUrl(p.imageId)} target="_blank" rel="noopener noreferrer"><img src={imageUrl(p.imageId)} alt={panelLabel(i, "그림")} /></a> : <div className="studio-picture-empty">{i + 1}<span>위에 쓴 내용이 그림으로 이어집니다.</span></div>}</div>
            <button className="btn primary" aria-label={panelLabel(i, p.imageId ? "다시 그리기" : "그리기")} disabled={!canDraw || (!p.scene.trim() && !p.dialogue.trim() && !panelInstructions[i].trim())} onClick={() => run({ kind: "image", panelIndex: i, instruction: panelInstructions[i] })}>{generate.isPending && generate.variables?.kind === "image" && generate.variables.panelIndex === i ? "요청 중…" : p.imageId ? "이 컷 다시 그리기" : "이 컷 그리기"}</button>
          </>}
          <details className="studio-more"><summary>그림 추가 요청 · 선택</summary><div className="stack">
            <label className="field small">추가 요청<textarea aria-label={panelLabel(i, "그림 추가 요청")} disabled={busy} rows={2} maxLength={6000} value={panelInstructions[i]} onChange={e => setPanelInstructions(current => current.map((v, n) => n === i ? e.target.value : v))} placeholder="예: 배경은 유지하고 표정만 놀라게. 비워 두어도 됩니다." /></label>
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
        <details className="studio-more"><summary>캡션 작성 도움받기</summary><div className="stack"><StudioPromptCopy prompt={studioChatGptCaptionPrompt(form, channelName(form.channel))} label="ChatGPT 캡션 프롬프트 복사" /><p className="small muted">받은 답변을 위 캡션 칸에 붙여넣으세요.</p><AiUsageGuide provider={provider} /><button className="btn" disabled={!canWrite || (!form.caption.trim() && !studioCaptionDraft(form) && !form.memo.trim())} onClick={() => run({ kind: "text", textTarget: "caption" })}>{aiProviderLabels[provider]}로 캡션 작성</button></div></details>
      </section>
      <StudioExport form={form} base={base} dirty={dirty} busy={busy} change={change} save={saveCurrent} onFieldFocus={field => {
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
    </div> : <section className="panel stack">
      <div className="row between"><h2>버전 기록</h2><span className="small muted">복원해도 이전 기록은 유지됩니다.</span></div>
      {!data.revisions.length ? <p className="muted">저장한 버전이 없습니다.</p> : <div className="studio-history-layout">
        <div className="studio-revision-list">{data.revisions.map(r => <button key={r.id} className={compareId === r.id ? "selected" : ""} onClick={() => setCompareId(r.id)}><strong>버전 {r.version}{!r.applied ? " · 미적용 결과" : ""}</strong><span>{r.provider === "gemini" ? "Gemini" : r.provider === "openai" ? "GPT" : r.provider === "anthropic" ? "Claude" : "직접 편집"} · {dateTime(r.createdAt)}</span><small>{r.instruction || "작업 저장"}</small></button>)}</div>
        <div>{compared ? <><div className="row between"><h3>버전 {compared.version} 비교</h3><button className="btn sm" disabled={busy || working} onClick={() => guard.confirmLeave(() => restore.mutate(compared.id))}>이 버전으로 복원</button></div><div className="studio-compare"><Snapshot title="현재 작업" card={form} /><Snapshot title={revisionLabel(compared.version)} card={compared.snapshot} /></div></> : <div className="studio-history-empty">왼쪽에서 비교할 버전을 선택하세요.</div>}</div>
      </div>}
    </section>}
  </div>;
}

const getCharacterImage = (id: Character) => "/studio-assets/" + id + ".png";
const panelLabel = (i: number, label: string) => (i + 1) + "컷 " + label;
const panelField = (i: number) => "studio-panels." + i + ".dialogue";
const revisionLabel = (version: number) => "버전 " + version;

function Snapshot({ title, card }: { title: string; card: CardInput }) {
  return <article className="studio-snapshot"><h4>{title}</h4><strong>{card.title}</strong><p>{card.script || card.memo || "원고 없음"}</p>{card.panels?.map((p, i) => <div className="studio-snapshot-panel" key={i}><b>{i + 1}컷</b>{p.imageId && <img src={imageUrl(p.imageId)} alt={`${title} ${i + 1}컷`} />}<p>{p.scene}</p><blockquote>{p.dialogue}</blockquote></div>)}<h4>캡션</h4><p>{card.caption || "캡션 없음"}</p></article>;
}

function CharacterArchive() {
  return <><section className="studio-character-archive">{characters.map((c) => <article className="panel" key={c.id}><div className="studio-character-art"><img src={`/studio-assets/${c.id}.png`} alt={`${c.name} 캐릭터 원본`} /></div><h2>{c.name}</h2><p className="small muted">{c.role}</p><p>{c.detail}</p><a className="btn sm" href={`/studio-assets/${c.id}.png`} download={`${c.name}.png`}>원본 다운로드</a></article>)}</section><section className="panel studio-canon"><h2>세계관·외형 기준</h2><p>남극성-09에서 온 네 가족. 둥근 우주 헬멧, 옆모습 중심, 뾰족한 검은 부리, 작은 흰 점 눈, 길쭉한 검정·흰색 몸과 일정한 굵기의 선을 유지합니다.</p><p className="small muted">시사 채널 이름은 아직 미정입니다. ‘지구 통신실’은 세계관 속 장소입니다.</p></section></>;
}

