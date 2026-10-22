import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, apiBlob } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { ErrorBox, GuardedLink, Loading } from "../ui";
import { useToast } from "../toast";

import { studioKey } from "@shared/channelKeys";
import type { StudioChannel as Channel, StudioStage as Stage, StudioCharacter as Character, StudioFormat as Format, StudioPanel as Panel, StudioContent as CardInput, StudioCard as Card, StudioRevision as Revision, StudioJob as Job, StudioBoard as Board, StudioCardDetail as Detail } from "@shared/studio";
const stages: Array<{ id: Stage; label: string }> = [{ id: "idea", label: "아이디어" }, { id: "writing", label: "원고" }, { id: "making", label: "제작" }, { id: "review", label: "검토" }, { id: "done", label: "완료" }];
const formats: Format[] = ["웹툰", "카드뉴스", "릴스", "브랜드", "기타"];
function useStudioChannels() {
  const { channels } = useChannel();
  return channels.map(c => ({ id: studioKey(c.slug), name: c.name, role: c.description,
    image: (c.slug === "opportunities" ? "pempem" : c.slug === "current-dialogue" ? "pengpeng" : c.slug === "penguin" ? "pengki" : "penguin") as Character }));
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
const inputOf = (c: CardInput): CardInput => ({ title: c.title, channel: c.channel, format: c.format, stage: c.stage, dueDate: c.dueDate ?? "", memo: c.memo ?? "", script: c.script ?? "", caption: c.caption ?? "", panels: c.panels ?? Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), characters: c.characters ?? [], imagePath: c.imagePath ?? "" });

export function StudioPage({ cardId }: { cardId?: number }) {
  const [view, setView] = useState<"board" | "characters">("board");
  const guard = useDirtyGuard();
  if (cardId !== undefined) return Number.isSafeInteger(cardId) && cardId > 0 ? <StudioDetail key={cardId} id={cardId} /> : <div className="notice err">작업 주소를 확인해 주세요. <GuardedLink href="/">보드로</GuardedLink></div>;
  return <div className="studio">
    <header className="page-head studio-heading"><div><span className="studio-eyebrow">우주펭귄상회</span><h1>{view === "board" ? "Studio Board" : "캐릭터 원본"}</h1></div><div className="row"><button className="btn" onClick={() => guard.confirmLeave(() => setView(view === "board" ? "characters" : "board"))}>{view === "board" ? "캐릭터 원본" : "제작 보드"}</button><GuardedLink className="btn ghost" href="/settings">채널 관리</GuardedLink></div></header>
    {view === "board" ? <StudioBoard /> : <CharacterArchive />}
  </div>;
}

function StudioBoard() {
  const channels = useStudioChannels();
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const q = useQuery({ queryKey: ["studio", "cards"], queryFn: () => api<Board>("/studio/cards") });
  const [filter, setFilter] = useState<Channel | "all">("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newStage, setNewStage] = useState<Stage>("idea");
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useDirtyGuard();
  const [, navigate] = useLocation();
  const cards = q.data?.cards ?? [];
  const filtered = useMemo(() => cards.filter((c) => (filter === "all" || c.channel === filter) && `${c.title} ${c.memo} ${c.script}`.toLowerCase().includes(search.toLowerCase())), [cards, filter, search]);
  const move = useMutation({ mutationFn: ({ card, stage }: { card: Card; stage: Stage }) => api(`/studio/cards/${card.id}`, { method: "PATCH", body: { version: card.version, stage } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }), onError: (e) => toast("err", e.message) });
  const { channels: legacyChannels, select } = useChannel();
  const highway = legacyChannels.find((c) => c.slug === "opportunities");
  const openHighway = () => guard.confirmLeave(() => { if (highway) select(highway.id); navigate("/inbox"); });
  function newCard(stage: Stage = "idea") { setNewStage(stage); setCreating(true); }
  return <>
    <section className="studio-brands" aria-label="채널 필터">{channels.map((ch) => <button key={ch.id} className={`studio-brand ${ch.id}`} aria-pressed={filter === ch.id} onClick={() => setFilter(filter === ch.id ? "all" : ch.id)}><span><strong>{ch.name}</strong><small>{ch.role}</small><span className="studio-brand-count">{q.data ? cards.filter((c) => c.channel === ch.id && c.stage !== "done").length : "—"}개 진행 중</span></span><img src={`/studio-assets/${ch.image}.png`} alt="" /></button>)}</section>
    <div className="studio-board-actions"><div className="row"><button className={`btn sm ${filter === "all" ? "primary" : ""}`} onClick={() => setFilter("all")}>전체</button><span className="small muted">{filter === "all" ? "모든 채널" : channelName(filter)} · {filtered.length}개</span></div><div className="row"><button className="btn sm" onClick={openHighway}>수집함 ↗</button><button className="btn primary" onClick={() => newCard()}>＋ 새 작업</button></div></div>
    <label className="studio-search"><span className="sr-only">작업 검색</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="제목·원고·메모 검색" /></label>
    {q.isLoading ? <Loading lines={3} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <div className="studio-board">{stages.map((stage) => <section key={stage.id} className={`studio-column stage-${stage.id}`} aria-label={stage.label} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const card = cards.find((c) => String(c.id) === e.dataTransfer.getData("text/studio-card")); if (card && card.stage !== stage.id && !move.isPending) move.mutate({ card, stage: stage.id }); }}><div className="studio-column-head"><h2>{stage.label}<span>{filtered.filter((c) => c.stage === stage.id).length}</span></h2><button className="studio-add" aria-label={`${stage.label} 작업 추가`} onClick={() => newCard(stage.id)}>＋</button></div><div className="studio-task-list">{filtered.filter((c) => c.stage === stage.id).map((c) => <article key={c.id} className="studio-task" draggable={!move.isPending} onDragStart={(e) => e.dataTransfer.setData("text/studio-card", String(c.id))}><span className={`studio-channel-tag ${c.channel}`}>{channelName(c.channel)}</span><GuardedLink href={`/studio/${c.id}`} className="studio-task-open">{c.panels?.find((p) => p.imageId)?.imageId ? <img className="studio-task-thumb" src={imageUrl(c.panels.find((p) => p.imageId)!.imageId!)} alt="콘텐츠 미리보기" loading="lazy" /> : c.imagePath ? <img className="studio-task-thumb" src={c.imagePath} alt="이전 웹툰 시안" loading="lazy" /> : null}<h3>{c.title}</h3><p>{c.memo || c.script || "원고와 제작 지시를 작성하세요."}</p></GuardedLink><div className="studio-task-meta"><span>{c.format}</span>{c.dueDate && <time dateTime={c.dueDate}>{c.dueDate.slice(5).replace("-", ".")}</time>}</div><select aria-label={`${c.title} 제작 단계`} value={c.stage} disabled={move.isPending} onChange={(e) => move.mutate({ card: c, stage: e.target.value as Stage })}>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></article>)}{!filtered.some((c) => c.stage === stage.id) && <button className="studio-empty-column" onClick={() => newCard(stage.id)}>{search ? "검색 결과 없음" : "＋ 작업 추가"}</button>}</div></section>)}</div>}
    <p className="small muted studio-board-foot">완성한 네컷은 PNG로 내려받고, 캡션은 복사해 검토 후 게시하세요.</p>
    {q.data && <StudioNotes data={q.data} />}<StudioImport />
    {creating && <NewCard channel={filter === "all" ? "penguin" : filter} stage={newStage} onClose={() => setCreating(false)} />}
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
  const create = useMutation({ mutationFn: () => api<{ card: Card } | Card>("/studio/cards", { method: "POST", body: { title, channel: ch, format, stage, dueDate: "", memo: "", script: "", caption: "", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), characters: ch === "highway" ? ["pempem"] : ch === "fryday" ? ["penguin"] : ch === "news" ? ["pengpeng"] : characters.map((c) => c.id) } }), onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["studio"] }); onClose(); guard.confirmLeave(() => navigate(`/studio/${"card" in d ? d.card.id : d.id}`)); } });
  return <Dialog title="새 작업" onClose={() => !create.isPending && onClose()}><form className="stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}><label className="field">제목<input autoFocus required value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="어떤 이야기를 만들까요?" /></label><div className="grid grid-2"><label className="field">채널<select value={ch} onChange={(e) => setCh(e.target.value as Channel)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field">형식<select value={format} onChange={(e) => setFormat(e.target.value as Format)}>{formats.map((f) => <option key={f}>{f}</option>)}</select></label></div>{create.error && <ErrorBox error={create.error} />}<button className="btn primary" disabled={!title.trim() || create.isPending}>{create.isPending ? "만드는 중…" : "작업 만들기"}</button></form></Dialog>;
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

function StudioImport() {
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
  // A background polling failure must not unmount the editor and discard unsaved work.
  return <>{q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}<StudioEditor key={q.data.card.id} data={q.data} refresh={() => q.refetch()} /></>;
}

function StudioEditor({ data, refresh }: { data: Detail; refresh: () => unknown }) {
  const channels = useStudioChannels();
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? id;
  const settings = useQuery({ queryKey: ["studio", "cards"], queryFn: () => api<Board>("/studio/cards") });
  const [base, setBase] = useState(data.card);
  const baseRef = useRef(data.card);
  const [form, setForm] = useState(() => inputOf(data.card));
  const [instruction, setInstruction] = useState("");
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [kind, setKind] = useState<"text" | "image">("text");
  const [panelIndex, setPanelIndex] = useState(0);
  const [tab, setTab] = useState<"content" | "history">("content");
  const [compareId, setCompareId] = useState<number | null>(null);
  const [localError, setLocalError] = useState("");
  const guard = useDirtyGuard();
  const qc = useQueryClient();
  const toast = useToast();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const providerInitialized = useRef(false);
  useEffect(() => { if (settings.data && !providerInitialized.current) { setProvider(settings.data.ai.defaultProvider); providerInitialized.current = true; } }, [settings.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(inputOf(base));
  const newer = data.card.version !== base.version;
  const working = data.jobs.some(activeJob);
  const configured = kind === "image" ? settings.data?.ai.image : settings.data?.ai.text[provider];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["studio"] });
  const accept = (c: Card) => { baseRef.current = c; setBase(c); setForm(inputOf(c)); };
  useEffect(() => { if (!dirty && data.card.version !== base.version) accept(data.card); }, [data.card.version]);
  const save = useMutation({ mutationFn: () => api<Card | { card: Card }>(`/studio/cards/${base.id}`, { method: "PATCH", body: { ...form, version: base.version } }), onSuccess: (d) => { accept("card" in d ? d.card : d); invalidate(); } });
  const saveCurrent = useCallback(async (): Promise<Card> => { if (!dirty) return base; const d = await save.mutateAsync(); return "card" in d ? d.card : d; }, [dirty, base, form]);
  useEffect(() => { guard.setDirty("studio-card", dirty, async () => { try { await saveCurrent(); return true; } catch { return false; } }); return () => guard.setDirty("studio-card", false); }, [dirty, saveCurrent]);
  const generate = useMutation({ retry: false, mutationFn: async () => {
    setLocalError("");
    const current = await saveCurrent();
    const signature = JSON.stringify({ version: current.version, kind, provider, instruction, panelIndex });
    if (!request.current || request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    return api<{ job: Job; duplicate: boolean }>(`/studio/cards/${base.id}/generate`, { method: "POST", body: { version: current.version, kind, provider: kind === "image" ? "openai" : provider, instruction, ...(kind === "image" ? { panelIndex } : {}), requestId: request.current.id } });
  }, onSuccess: () => { request.current = null; invalidate(); toast("ok", "생성 요청을 등록했습니다. 결과는 이 작업에 저장됩니다."); } });
  const restore = useMutation({ mutationFn: (revisionId: number) => api<Card | { card: Card }>(`/studio/cards/${baseRef.current.id}/restore`, { method: "POST", body: { version: baseRef.current.version, revisionId } }), onSuccess: (d) => { accept("card" in d ? d.card : d); invalidate(); setTab("content"); toast("ok", "선택한 버전을 새 버전으로 복원했습니다."); } });
  const download = useMutation({ retry: false, mutationFn: () => apiBlob(`/studio/cards/${base.id}/export.png`, "image/png"), onSuccess: (blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `studio-${base.id}-v${base.version}.png`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, onError: (error) => toast("err", error.message) });
  function change<K extends keyof CardInput>(key: K, value: CardInput[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function changePanel(i: number, key: "scene" | "dialogue", value: string) { change("panels", form.panels.map((p, n) => n === i ? { ...p, [key]: value } : p)); }
  const busy = save.isPending || generate.isPending || restore.isPending;
  const compared = data.revisions.find((r) => r.id === compareId);
  return <div className="studio studio-detail">
    <GuardedLink href="/" className="studio-back">← Studio Board</GuardedLink>
    <header className="page-head"><div><span className={`studio-channel-tag ${form.channel}`}>{channelName(form.channel)}</span><h1>{base.title}</h1><span className="small muted">버전 {base.version} · {dateTime(base.updatedAt)}{dirty ? " · 저장 전 변경사항" : " · 저장됨"}</span></div><button className="btn primary" onClick={() => save.mutate()} disabled={!dirty || busy || !form.title.trim()}>{save.isPending ? "저장 중…" : "저장"}</button></header>
    {newer && dirty && <div className="notice warn row between"><span>서버에 새 버전이 있습니다. 현재 입력은 유지했습니다.</span><button className="btn sm" onClick={() => guard.confirmLeave(() => accept(data.card))}>새 버전 불러오기</button></div>}
    {(save.error || restore.error) && <ErrorBox error={save.error || restore.error} />}
    <div className="tabs" role="tablist" aria-label="콘텐츠 편집"><button role="tab" aria-selected={tab === "content"} onClick={() => setTab("content")}>원고·네컷</button><button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>버전 기록 <span className="small">{data.revisions.length}</span></button></div>
    {tab === "content" ? <div className="studio-editor-layout"><div className="stack"><section className="panel stack"><label className="field">제목<input disabled={busy} value={form.title} maxLength={160} onChange={(e) => change("title", e.target.value)} /></label><div className="studio-form-grid"><label className="field">채널<select disabled={busy} value={form.channel} onChange={(e) => change("channel", e.target.value as Channel)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field">형식<select disabled={busy} value={form.format} onChange={(e) => change("format", e.target.value as Format)}>{formats.map((f) => <option key={f}>{f}</option>)}</select></label><label className="field">단계<select disabled={busy} value={form.stage} onChange={(e) => change("stage", e.target.value as Stage)}>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label className="field">예정일<input type="date" disabled={busy} value={form.dueDate} onChange={(e) => change("dueDate", e.target.value)} /></label></div><label className="field">기획·참고 자료<textarea disabled={busy} value={form.memo} rows={4} maxLength={12000} onChange={(e) => change("memo", e.target.value)} placeholder="만들고 싶은 이야기, 유지할 설정, 확인한 원문 내용을 적어 주세요." /></label><label className="field">원고<textarea disabled={busy} value={form.script} rows={8} maxLength={24000} onChange={(e) => change("script", e.target.value)} placeholder="직접 쓰거나 오른쪽에서 AI에 제작을 지시하세요." /></label></section>
      <section className="panel stack"><div className="row between"><h2>네컷 구성</h2><div className="row"><span className="small muted">대사와 그림을 따로 편집</span>{form.panels.every((p) => p.imageId) && !dirty && <button className="btn sm" disabled={busy || download.isPending} onClick={() => download.mutate()}>{download.isPending ? "만드는 중…" : "네컷 PNG"}</button>}</div></div>{form.imagePath && <details className="studio-original"><summary>이전 웹툰 시안 보기</summary><img src={form.imagePath} alt="이전 네컷 웹툰 시안" /></details>}<div className="studio-panels">{form.panels.map((p, i) => <article className={`studio-comic-panel ${kind === "image" && panelIndex === i ? "selected" : ""}`} key={i}><div className="row between"><h3>{i + 1}컷</h3><button className="btn sm ghost" onClick={() => { setKind("image"); setPanelIndex(i); document.getElementById("studio-instruction")?.focus(); }}>{p.imageId ? "다시 그리기" : "그림 만들기"}</button></div><div className="studio-panel-picture">{p.imageId ? <a href={imageUrl(p.imageId)} target="_blank" rel="noopener noreferrer"><img src={imageUrl(p.imageId)} alt={`${i + 1}컷 그림`} /></a> : <div className="studio-picture-empty">{i + 1}<span>장면을 적고 그림을 만들어 주세요.</span></div>}</div><label className="field small">장면<textarea disabled={busy} aria-label={`${i + 1}컷 장면`} rows={3} value={p.scene} maxLength={4000} onChange={(e) => changePanel(i, "scene", e.target.value)} placeholder="등장인물, 표정, 배경, 소품" /></label><label className="field small">대사<textarea disabled={busy} aria-label={`${i + 1}컷 대사`} rows={2} value={p.dialogue} maxLength={2000} onChange={(e) => changePanel(i, "dialogue", e.target.value)} placeholder="말풍선에 넣을 대사" /></label></article>)}</div></section>
      <section className="panel stack"><label className="field">게시용 캡션<textarea disabled={busy} rows={5} value={form.caption} maxLength={8000} onChange={(e) => change("caption", e.target.value)} /></label><div className="row"><button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(form.caption); toast("ok", "캡션을 복사했습니다."); } catch { toast("err", "복사하지 못했습니다. 캡션을 직접 선택해 복사해 주세요."); } }} disabled={!form.caption}>캡션 복사</button></div></section>
    </div><aside className="studio-command"><section className="panel stack"><h2>AI 제작·수정</h2><div className="studio-segment" aria-label="생성할 콘텐츠"><button disabled={busy} aria-pressed={kind === "text"} onClick={() => setKind("text")}>원고</button><button disabled={busy} aria-pressed={kind === "image"} onClick={() => setKind("image")}>컷 그림</button></div>{kind === "text" ? <label className="field">작성 AI<select value={provider} disabled={busy} onChange={(e) => { providerInitialized.current = true; setProvider(e.target.value as typeof provider); }}><option value="openai">GPT</option><option value="anthropic">Claude</option></select></label> : <label className="field">수정할 컷<select disabled={busy} value={panelIndex} onChange={(e) => setPanelIndex(Number(e.target.value))}>{form.panels.map((_, i) => <option value={i} key={i}>{i + 1}컷</option>)}</select><span className="hint">OpenAI 이미지 모델 · 선택한 컷만 생성</span></label>}<fieldset><legend>등장인물·그림 기준</legend><div className="studio-character-picks">{characters.map((c) => <label key={c.id} className={form.characters.includes(c.id) ? "selected" : ""}><input type="checkbox" disabled={busy} checked={form.characters.includes(c.id)} onChange={(e) => change("characters", e.target.checked ? [...form.characters, c.id] : form.characters.filter((id) => id !== c.id))} /><img src={`/studio-assets/${c.id}.png`} alt="" /><span>{c.name}</span></label>)}</div></fieldset><label className="field" htmlFor="studio-instruction">제작·수정 지시<textarea disabled={busy} id="studio-instruction" rows={6} maxLength={6000} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={kind === "text" ? "예: 네컷의 마지막 반전을 더 재밌게. 펨펨의 대사는 짧게 바꿔줘." : "예: 빈 감자튀김 용기는 하나만. 캐릭터의 외형과 배경은 유지해줘."} /></label><button className="btn primary" disabled={busy || working || configured === false || !instruction.trim() || !form.title.trim()} onClick={() => generate.mutate()}>{busy ? "요청 중…" : working ? "생성 진행 중…" : kind === "text" ? "원고 생성·수정" : `${panelIndex + 1}컷 ${form.panels[panelIndex]?.imageId ? "다시 그리기" : "생성"}`}</button>{configured === false && <div className="notice warn small">{kind === "image" || provider === "openai" ? "OpenAI" : "Claude"} 연결이 필요합니다. <GuardedLink href="/settings">API 설정 →</GuardedLink></div>}<p className="small muted">수정 내용을 저장한 뒤 생성합니다. API 사용료가 발생하며, 이전 결과는 버전 기록에 남습니다.</p>{generate.error && <><ErrorBox error={generate.error} /><GuardedLink href="/settings" className="small">API 설정 확인 →</GuardedLink></>}{localError && <div role="alert" className="notice err">{localError}</div>}{working && <div className="notice" role="status">AI가 작업 중입니다. 화면을 닫아도 요청은 보관됩니다.</div>}{data.jobs.slice(0, 3).map((j) => <div key={j.id} className={`studio-job ${j.status === "failed" ? "failed" : ""}`}><span>{({ queued: "대기 중", running: "생성 중", processing: "생성 중", succeeded: "생성 완료", failed: "생성 실패", cancelled: "취소됨" } as Record<string, string>)[j.status] ?? j.status}</span>{j.lastError && <p>{j.lastError}</p>}</div>)}<button className="btn sm ghost" onClick={() => refresh()}>결과 새로고침</button></section><p className="small muted">다른 AI로 다시 만들면 버전 기록에서 결과를 비교할 수 있습니다.</p></aside></div> : <section className="panel stack"><div className="row between"><h2>버전 기록</h2><span className="small muted">복원해도 이전 기록은 유지됩니다.</span></div>{!data.revisions.length ? <p className="muted">저장한 버전이 없습니다.</p> : <div className="studio-history-layout"><div className="studio-revision-list">{data.revisions.map((r) => <button key={r.id} className={compareId === r.id ? "selected" : ""} onClick={() => setCompareId(r.id)}><strong>버전 {r.version}{!r.applied ? " · 미적용 결과" : ""}</strong><span>{r.provider === "openai" ? "GPT" : r.provider === "anthropic" ? "Claude" : "직접 편집"} · {dateTime(r.createdAt)}</span><small>{r.instruction || "작업 저장"}</small></button>)}</div><div>{compared ? <><div className="row between"><h3>버전 {compared.version} 비교</h3><button className="btn sm" disabled={busy || working} onClick={() => guard.confirmLeave(() => restore.mutate(compared.id))}>이 버전으로 복원</button></div><div className="studio-compare"><Snapshot title="현재 작업" card={form} /><Snapshot title={`버전 ${compared.version}`} card={compared.snapshot} /></div></> : <div className="studio-history-empty">왼쪽에서 비교할 버전을 선택하세요.</div>}</div></div>}{restore.error && <ErrorBox error={restore.error} />}</section>}
  </div>;
}

function Snapshot({ title, card }: { title: string; card: CardInput }) {
  return <article className="studio-snapshot"><h4>{title}</h4><strong>{card.title}</strong><p>{card.script || card.memo || "원고 없음"}</p>{card.panels?.map((p, i) => <div className="studio-snapshot-panel" key={i}><b>{i + 1}컷</b>{p.imageId && <img src={imageUrl(p.imageId)} alt={`${title} ${i + 1}컷`} />}<p>{p.scene}</p><blockquote>{p.dialogue}</blockquote></div>)}<h4>캡션</h4><p>{card.caption || "캡션 없음"}</p></article>;
}

function CharacterArchive() {
  return <><section className="studio-character-archive">{characters.map((c) => <article className="panel" key={c.id}><div className="studio-character-art"><img src={`/studio-assets/${c.id}.png`} alt={`${c.name} 캐릭터 원본`} /></div><h2>{c.name}</h2><p className="small muted">{c.role}</p><p>{c.detail}</p><a className="btn sm" href={`/studio-assets/${c.id}.png`} download={`${c.name}.png`}>원본 다운로드</a></article>)}</section><section className="panel studio-canon"><h2>세계관·외형 기준</h2><p>남극성-09에서 온 네 가족. 둥근 우주 헬멧, 옆모습 중심, 뾰족한 검은 부리, 작은 흰 점 눈, 길쭉한 검정·흰색 몸과 일정한 굵기의 선을 유지합니다.</p><p className="small muted">시사 채널 이름은 아직 미정입니다. ‘지구 통신실’은 세계관 속 장소입니다.</p></section></>;
}
