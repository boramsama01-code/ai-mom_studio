import { InstagramAccounts } from "./InstagramAccounts";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { Badge, Empty, ErrorBox, GuardedLink, Loading } from "../ui";
import type { Channel, ChannelBudget, Destination } from "@shared/schema";
import { ChannelDirectory } from "./ChannelDirectory";
import { ConnectionsSection, SecretInput, useSecrets } from "./Connections";
import { StudioImport } from "./Studio";
import { channelCategories } from "@shared/channelCategories";
import { channelCategoriesSchema, channelContentTypes, channelContentTypeLabels, channelCreateSchema, type ChannelContentType } from "@shared/channelSettings";
import { useLocation } from "wouter";
import { channelAiSettingsSchema, defaultChannelAiSettings, type ChannelAiRuntime } from "@shared/channelAi";
import { ChannelAiFields } from "../ChannelAiFields";

type Status = { integrations: Record<string, boolean | Record<string, boolean>>; globalStop: boolean; workerConnected: boolean };
type DestView = Destination & { connection: { missing: string[]; invalid: string[]; ready: boolean } };

const INTEG: Array<[string, string, string]> = [
  ["database", "데이터베이스", "APP_DATABASE_URL"],
  ["auth", "운영자 인증", "ADMIN_USERNAME, ADMIN_PASSWORD_HASH, APP_SESSION_SECRET"],
  ["naver", "네이버 검색 API", "NAVER_CLIENT_ID, NAVER_CLIENT_SECRET"],
  ["gemini", "Gemini API", "GEMINI_API_KEY"],
  ["openai", "GPT · 이미지 생성", "OPENAI_API_KEY"],
  ["anthropic", "Claude API", "ANTHROPIC_API_KEY, ANTHROPIC_MODEL"],
  ["cloudinary", "Cloudinary(이미지 공개 URL)", "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"],
  ["telegramBot", "텔레그램 봇", "TELEGRAM_BOT_TOKEN"],
  ["telegramReview", "텔레그램 개인 검토 알림", "TELEGRAM_REVIEW_CHAT_ID"],
  ["instagramApiVersion", "인스타그램 API 버전", "INSTAGRAM_API_VERSION"],
];

export function ChannelSettingsPage() {
  const { allChannels: channels, select, isLoading, error: channelError, refresh } = useChannel();
  const [, navigate] = useLocation();
  const guard = useDirtyGuard();
  const [tab, setTab] = useState(() => ["connections", "instagram"].includes(new URLSearchParams(location.search).get("tab") ?? "") ? new URLSearchParams(location.search).get("tab")! : "channels");
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const current = channels.find(c => c.id === editing);
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status") });
  const leave = (action: () => void) => guard.confirmLeave(action);
  return <div className="settings-page">
    <header className="page-head"><div><span className="studio-eyebrow">WORKSPACE</span><h1>설정</h1><p className="muted">내 채널과 제작 환경을 한곳에서 관리하세요.</p></div>
      {tab === "channels" && !creating && !current && <button className="btn primary" onClick={() => leave(() => { setCreatedName(null); setCreating(true); })}>＋ 새 채널 추가</button>}{current && <button className="btn" onClick={() => leave(() => { select(current.id); navigate("/"); })}>이 채널 콘텐츠 보기</button>}</header>
    <nav className="settings-tabs" aria-label="설정 메뉴">{[["channels", "내 채널"], ["instagram", "인스타그램 연결"], ["operations", "운영 설정"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => leave(() => { setTab(key); setEditing(null); setCreating(false); setCreatedName(null); })}>{label}</button>)}<GuardedLink className="btn ghost" href="/connections">API 키 관리 →</GuardedLink></nav>
    {tab === "channels" && <>
      {(creating || current) && <button className="btn ghost settings-back" onClick={() => leave(() => { setEditing(null); setCreating(false); setCreatedName(null); })}>← 내 채널 목록</button>}
      {createdName && current && <p className="notice ok" role="status">‘{createdName}’ 채널을 추가했습니다. 콘텐츠를 만들거나 아래에서 게시 계정을 연결하세요.</p>}
      {creating ? <NewChannel onCreated={ch => { setCreatedName(ch.name); setCreating(false); setEditing(ch.id); }} /> : current ? <><ChannelForm key={current.id} ch={current} onArchived={() => setEditing(null)} /><details className="panel settings-details"><summary>이 채널의 게시 계정</summary><InstagramAccounts channelId={current.id} /><p className="small muted">수집 콘텐츠와 직접 만든 콘텐츠가 같은 게시 계정을 사용합니다.</p><details className="settings-details"><summary>추가 목적지 · 텔레그램 설정</summary><Destinations cid={current.id} /></details></details></> : isLoading ? <Loading lines={3} label="채널 불러오는 중" /> : channelError ? <ErrorBox error={channelError} retry={refresh} /> : <>
        <ChannelDirectory channels={channels} onEdit={id => leave(() => { setCreatedName(null); setEditing(id); })} onCreate={() => leave(() => { setCreatedName(null); setCreating(true); })} />
      </>}
    </>}
    {tab === "instagram" && <InstagramAccounts />}
    {tab === "connections" && <ConnectionsSection />}
    {tab === "operations" && <><section className="panel stack"><h2>운영 상태</h2>{status.isLoading ? <Loading lines={2} /> : status.error ? <ErrorBox error={status.error} /> : status.data && <>
      <p className="small muted">{status.data.workerConnected ? "자동 발행 처리기가 최근 응답했습니다." : "자동 발행 처리기의 최근 응답이 없습니다. 실행 기록에서 상태를 확인해 주세요."}</p>
      <Flags flags={status.data.integrations.flags as Record<string, boolean>} /><GlobalStop on={status.data.globalStop} />
      <details className="settings-details"><summary>연결 진단</summary><table className="simple"><tbody>{INTEG.map(([k, label]) => <tr key={k}><td>{label}</td><td><Badge kind={status.data!.integrations[k] ? "ok" : "warn"}>{status.data!.integrations[k] ? "설정됨" : "미설정"}</Badge></td></tr>)}</tbody></table></details>
    </>}</section><StudioImport /></>}
  </div>;
}

function NewChannel({ onCreated }: { onCreated: (ch: Channel) => void }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accentColor, setColor] = useState("#51635A");
  const [contentType, setContentType] = useState<ChannelContentType>("current_dialogue");
  const [audience, setAudience] = useState("일반 독자");
  const [slug, setSlug] = useState("");
  const [categoryText, setCategoryText] = useState("");
  const request = useRef<Promise<Channel> | null>(null);
  const create = useMutation({ mutationFn: async () => {
    if (request.current) return request.current;
    const parsed = channelCreateSchema.safeParse({ name, description, accentColor, contentType, audience, categories: categoryText.split("\n").map(value => value.trim()).filter(Boolean), ...(slug.trim() ? { slug } : {}) });
    if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join(" "));
    const call = api<Channel>("/channels", { method: "POST", body: parsed.data }); request.current = call;
    try { return await call; } finally { request.current = null; }
  }, onSuccess: ch => {
    guard.setDirty("new-channel", false);
    qc.setQueryData<Channel[]>(["channels"], previous => [...(previous ?? []).filter(row => row.id !== ch.id), ch]);
    void qc.invalidateQueries({ queryKey: ["channels"] }); onCreated(ch);
  } });
  const dirty = !!name || !!description || !!slug || !!categoryText || accentColor !== "#51635A" || audience !== "일반 독자" || contentType !== "current_dialogue";
  useEffect(() => { guard.setDirty("new-channel", dirty || create.isPending, async () => { try { await create.mutateAsync(); return true; } catch { return false; } }, () => { setName(""); setDescription(""); setSlug(""); setCategoryText(""); setColor("#51635A"); setAudience("일반 독자"); setContentType("current_dialogue"); }); return () => guard.setDirty("new-channel", false); }, [name, description, slug, categoryText, accentColor, audience, contentType, dirty, create.isPending, guard]);
  return <form className="panel stack channel-editor" onSubmit={e => { e.preventDefault(); create.mutate(); }}><h2>새 채널 추가</h2><fieldset className="channel-form-fields stack" disabled={create.isPending}>
    <label className="field">채널명<input autoFocus required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="내 채널 이름" /></label>
    <label className="field">주로 만들 콘텐츠<select value={contentType} onChange={event => setContentType(event.target.value as ChannelContentType)}>{channelContentTypes.map(type => <option key={type} value={type}>{channelContentTypeLabels[type]}</option>)}</select><span className="hint">자료 수집과 자동 초안의 기본 형식입니다. 원고와 이미지는 직접 고칠 수 있습니다.</span></label>
    <label className="field">한 줄 소개<textarea rows={2} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} placeholder="어떤 이야기를 전하는 채널인가요?" /></label>
    <label className="field">소분류<textarea rows={3} value={categoryText} onChange={event => setCategoryText(event.target.value)} placeholder={"예: 동네 소식\n방문 후기\n행사 안내"} /><span className="hint">한 줄에 하나씩, 최대 30개를 입력하세요. 비워 두면 소분류 없이 시작합니다.</span></label>
    <label className="field">채널 색상<input type="color" value={accentColor} onChange={e => setColor(e.target.value)} /></label>
    <p className="small muted">AI 기본값은 Gemini 기사 요약 · GPT 카드 문구 · OpenAI 이미지입니다. 채널 추가 후 역할별 AI와 모델을 따로 변경할 수 있습니다.</p>
    <details className="settings-details"><summary>추가 설정 · 대상과 채널 주소</summary><div className="stack"><label className="field">대상 독자<input maxLength={60} value={audience} onChange={event => setAudience(event.target.value)} /></label><label className="field">채널 주소 <span className="small muted">선택</span><input value={slug} maxLength={48} autoComplete="off" spellCheck={false} onChange={event => setSlug(event.target.value)} placeholder="my-channel" /><span className="hint">비우면 자동으로 정합니다. 직접 정하려면 영문 소문자·숫자·하이픈을 쓰세요. 생성 후 주소는 바뀌지 않습니다.</span></label></div></details>
    <p className="small muted">추가 후 바로 콘텐츠를 만들 수 있습니다. 자료 수집은 검색어를 정한 뒤 시작하고, 실제 발행은 게시 계정을 연결한 뒤 승인합니다.</p></fieldset>
    {create.error && <ErrorBox error={create.error} />}<div className="savebar"><button className="btn primary" disabled={!name.trim() || create.isPending}>{create.isPending ? "추가 중…" : "채널 추가"}</button></div>
  </form>;
}

function Flags({ flags }: { flags: Record<string, boolean> }) {
  const L: Record<string, string> = { demoMode: "샘플 모드", dryRun: "모의 실행(DRY_RUN)", autoCollect: "예약 자동 수집", autoGenerate: "자동 초안 생성", autoPublish: "자동 게시" };
  return (
    <div className="row small">
      {Object.entries(flags).map(([k, v]) => (
        <Badge key={k} kind={v ? (k === "dryRun" ? "warn" : "ok") : ""}>
          {L[k] ?? k}: {v ? "켜짐" : "꺼짐"}
        </Badge>
      ))}
    </div>
  );
}

function GlobalStop({ on }: { on: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (stop: boolean) => api("/settings/global-stop", { method: "PUT", body: { stop } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }) });
  return (
    <div className="row">
      <button className={`btn ${on ? "primary" : "danger"}`} onClick={() => m.mutate(!on)} disabled={m.isPending}>
        {on ? "전역 정지 해제" : "전역 정지 (모든 수집·게시 중단)"}
      </button>
      {on && <Badge kind="err">현재 전역 정지 중</Badge>}
      {m.error && <ErrorBox error={m.error} />}
    </div>
  );
}

const channelFields = (ch: Channel) => ({ name: ch.name, description: ch.description, audience: ch.audience, accentColor: ch.accentColor, editorialGuide: ch.editorialGuide, budget: ch.budget, contentType: ch.contentType as ChannelContentType, categoryText: channelCategories(ch.slug, ch.categories).join("\n"), categoriesDefault: ch.categories == null, aiSettings: ch.aiSettings ?? defaultChannelAiSettings() });
function ChannelForm({ ch, onArchived }: { ch: Channel; onArchived: () => void }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const [base, setBase] = useState(ch), baseRef = useRef(ch);
  const [f, setF] = useState(() => channelFields(ch)), formRef = useRef(f); formRef.current = f;
  const [conflict, setConflict] = useState<Channel | null>(null);
  const submitted = useRef(f);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(channelFields(base));
  const accept = (value: Channel) => { baseRef.current = value; setBase(value); setF(channelFields(value)); setConflict(null); };
  const updateCache = (value: Channel) => qc.setQueryData<Channel[]>(["channels"], rows => (rows ?? []).map(row => row.id === value.id ? value : row));
  useEffect(() => { if (ch.version > base.version) { if (dirty) setConflict(ch); else accept(ch); } }, [ch.version, base.version, dirty]);
  const m = useMutation({
    mutationFn: () => {
      const snapshot = formRef.current;
      const categories = channelCategoriesSchema.safeParse(snapshot.categoriesDefault ? null : snapshot.categoryText.split("\n").map(value => value.trim()).filter(Boolean));
      if (!categories.success) throw new Error(categories.error.issues.map(issue => issue.message).join(" "));
      if (!snapshot.name.trim() || !snapshot.audience.trim()) throw new Error("채널명과 대상 독자를 입력해 주세요.");
      const ai = channelAiSettingsSchema.safeParse(snapshot.aiSettings);
      if (!ai.success) throw new Error(ai.error.issues.map(issue => issue.message).join(" "));
      submitted.current = snapshot;
      const { categoryText: _text, categoriesDefault: _defaults, ...fields } = snapshot;
      return api<Channel>(`/channels/${ch.id}`, { method: "PATCH", body: { version: baseRef.current.version, ...fields, categories: categories.data, aiSettings: ai.data } });
    },
    onSuccess: saved => { if (JSON.stringify(formRef.current) === JSON.stringify(submitted.current)) accept(saved); else { baseRef.current = saved; setBase(saved); setConflict(null); } updateCache(saved); void qc.invalidateQueries({ queryKey: ["channels"] }); },
    onError: async error => { if (error instanceof ApiError && error.status === 409) { try { const rows = await api<Channel[]>("/channels"); qc.setQueryData(["channels"], rows); const latest = rows.find(row => row.id === ch.id); if (latest && latest.version > baseRef.current.version) setConflict(latest); } catch { /* Keep the original save error and input. */ } } },
  });
  const archive = useMutation({ mutationFn: () => api<Channel>(`/channels/${ch.id}`, { method: "PATCH", body: { version: baseRef.current.version, active: false } }), onSuccess: async saved => {
    guard.setDirty("channel-form", false);
    updateCache(saved);
    await Promise.all([qc.invalidateQueries({ queryKey: ["channels"] }), qc.invalidateQueries({ queryKey: ["studio"] })]);
    onArchived();
  } });
  useEffect(() => {
    guard.setDirty("channel-form", dirty || m.isPending || archive.isPending, async () => {
      if (conflict || archive.isPending) return false;
      try {
        await m.mutateAsync();
        return true;
      } catch {
        return false;
      }
    }, () => { setF(channelFields(baseRef.current)); setConflict(null); });
    return () => guard.setDirty("channel-form", false);
  }, [dirty, f, base.version, conflict, m.isPending, archive.isPending]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = (k: keyof ChannelBudget, label: string, max: number) => (
    <label className="field">
      {label}
      <input type="number" min={0} max={max} value={(f.budget[k] as number | null) ?? 0} onChange={(e) => setF({ ...f, budget: { ...f.budget, [k]: Number(e.target.value) } })} />
    </label>
  );
  return (
    <form className="panel stack channel-editor" onSubmit={(e) => { e.preventDefault(); if (!conflict) m.mutate(); }}>
      <h2>{base.name}</h2>
      {conflict && <div className="notice warn stack channel-settings-conflict" role="alert"><strong>다른 곳에서 바꾼 채널 설정이 있습니다. 입력은 유지했습니다.</strong><details open><summary>최신 설정과 비교</summary><div className="draft-recovery-compare"><div><h3>최신 저장본</h3><pre>{`${conflict.name}\n${conflict.description}\n대상: ${conflict.audience}\n자료 유형: ${channelContentTypeLabels[conflict.contentType as ChannelContentType] ?? conflict.contentType}\n소분류: ${channelCategories(conflict.slug, conflict.categories).join(", ")}\n강조색: ${conflict.accentColor}\n편집 기준: ${conflict.editorialGuide}\n역할별 AI: ${JSON.stringify(conflict.aiSettings ?? defaultChannelAiSettings(), null, 2)}\n실행 한도·비용: ${JSON.stringify(conflict.budget, null, 2)}`}</pre></div><div><h3>현재 입력</h3><pre>{`${f.name}\n${f.description}\n대상: ${f.audience}\n자료 유형: ${channelContentTypeLabels[f.contentType]}\n소분류: ${f.categoryText}\n강조색: ${f.accentColor}\n편집 기준: ${f.editorialGuide}\n역할별 AI: ${JSON.stringify(f.aiSettings, null, 2)}\n실행 한도·비용: ${JSON.stringify(f.budget, null, 2)}`}</pre></div></div><div className="row"><button type="button" className="btn" disabled={m.isPending} onClick={() => { accept(conflict); m.reset(); }}>최신 설정 사용</button><button type="button" className="btn" disabled={m.isPending} onClick={() => { baseRef.current = conflict; setBase(conflict); setConflict(null); m.mutate(); }}>현재 입력으로 다시 저장</button></div></details></div>}
      <fieldset className="channel-form-fields stack" disabled={m.isPending || archive.isPending}>
      <div className="grid grid-2">
        <label className="field">
          채널명
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} required />
        </label>
        <label className="field">
          대상
          <input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} maxLength={60} required />
        </label>
      </div>
      <label className="field">주로 만들 콘텐츠<select value={f.contentType} onChange={event => setF({ ...f, contentType: event.target.value as ChannelContentType })}>{channelContentTypes.map(type => <option key={type} value={type}>{channelContentTypeLabels[type]}</option>)}</select><span className="hint">앞으로 수집·작성하는 초안의 기본 형식입니다. 이미 만든 원고의 형식은 유지됩니다.</span></label>
      <label className="field">
        설명
        <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <label className="field">소분류<textarea rows={4} value={f.categoryText} onChange={event => setF({ ...f, categoryText: event.target.value, categoriesDefault: false })} /><span className="hint">한 줄에 하나씩, 최대 30개입니다. 사용 중인 분류는 해당 콘텐츠의 분류를 먼저 바꾼 뒤 제거할 수 있습니다.</span></label>
      <div><button type="button" className="btn sm ghost" onClick={() => setF({ ...f, categoryText: channelCategories(base.slug).join("\n"), categoriesDefault: true })}>기본 분류로 되돌리기</button></div>
      <div className="grid grid-2">
        <label className="field">
          강조색
          <input type="color" value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} pattern="#[0-9A-Fa-f]{6}" />
        </label>
        <p className="small muted">{ch.active ? "사용 중인 채널" : "보관된 채널 · 기존 콘텐츠는 보존됩니다"}</p>
      </div>
      <label className="field">
        편집 기준
        <textarea rows={4} value={f.editorialGuide} onChange={(e) => setF({ ...f, editorialGuide: e.target.value })} />
      </label>
      <ChannelAiFields value={f.aiSettings} onChange={aiSettings => setF({ ...f, aiSettings })} runtime={base as Channel & Partial<ChannelAiRuntime>} />
      <details className="settings-details">
        <summary>고급 설정 · 실행 한도와 비용</summary><div className="stack">
        <div className="grid grid-3">
          {b("naverCallsPerRun", "검색 실행 한도", 100)}
          {b("resultsPerRun", "결과 수", 500)}
          {b("fetchTargetsPerRun", "원문 확보 대상", 100)}
          {b("fetchCallsPerRun", "원문 호출", 200)}
          {b("llmCallsPerRun", "AI 호출", 100)}
          {b("dailyPublishLimit", "하루 게시 한도", 25)}
        </div>
        <p className="small muted">AI 비용은 실제 토큰 사용량 × 아래 단가로 계산한 추정치입니다(단가는 직접 입력).</p>
        <div className="grid grid-2">
          <label className="field">
            입력 단가 (USD / 100만 토큰)
            <input type="number" step="0.01" min={0} value={f.budget.llmInputTokenPriceUsdPerM ?? ""} onChange={(e) => setF({ ...f, budget: { ...f.budget, llmInputTokenPriceUsdPerM: e.target.value === "" ? null : Number(e.target.value) } })} />
          </label>
          <label className="field">
            출력 단가 (USD / 100만 토큰)
            <input type="number" step="0.01" min={0} value={f.budget.llmOutputTokenPriceUsdPerM ?? ""} onChange={(e) => setF({ ...f, budget: { ...f.budget, llmOutputTokenPriceUsdPerM: e.target.value === "" ? null : Number(e.target.value) } })} />
          </label>
        </div>
      </div></details>
      {m.error && <ErrorBox error={m.error} />}
      <div className="savebar">
        {m.isSuccess && !dirty && <span className="small muted" style={{ marginRight: "auto" }} role="status">채널 설정 저장됨</span>}
        <button type="button" className="btn" disabled={!dirty} onClick={() => { accept(conflict ?? baseRef.current); m.reset(); }}>수정 취소</button>
        <button className="btn primary" disabled={!dirty || !!conflict || m.isPending}>채널 설정 저장</button>
      </div>
    </fieldset>
    {ch.active && <details className="settings-details channel-archive"><summary>채널 보관</summary><p className="small muted">채널 목록과 새 작업에서 숨기고 자동 수집·게시를 중지합니다. 기존 콘텐츠는 그대로 남으며 언제든 복원할 수 있습니다. 이미 실행 중인 요청은 완료될 수 있습니다.</p>
      {dirty && <p className="small muted">변경사항을 저장하거나 되돌린 뒤 보관하세요.</p>}
      {confirmArchive ? <div className="row"><span>‘{ch.name}’ 채널을 보관할까요?</span><button type="button" className="btn" onClick={() => setConfirmArchive(false)} disabled={archive.isPending}>취소</button><button type="button" className="btn danger" disabled={dirty || m.isPending || archive.isPending} onClick={() => archive.mutate()}>{archive.isPending ? "보관 중…" : "보관하기"}</button></div> : <button type="button" className="btn" disabled={dirty || m.isPending} onClick={() => setConfirmArchive(true)}>이 채널 보관하기</button>}
      {archive.error && <ErrorBox error={archive.error} />}
    </details>}
    </form>
  );
}

function Destinations({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ch", cid, "destinations"], queryFn: () => api<{ items: DestView[]; defaults: Record<string, Record<string, string>> }>(`/channels/${cid}/destinations`) });
  const [platform, setPlatform] = useState<"instagram" | "telegram_channel">("telegram_channel");
  const [label, setLabel] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/channels/${cid}/destinations`, { method: "POST", body: { platform, label } }),
    onSuccess: () => { setLabel(""); qc.invalidateQueries({ queryKey: ["ch", cid, "destinations"] }); },
  });
  const toggle = useMutation({
    mutationFn: (d: DestView) => api(`/channels/${cid}/destinations/${d.id}`, { method: "PATCH", body: { version: d.version, enabled: !d.enabled } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ch", cid, "destinations"] }),
  });
  return (
    <section className="panel stack">
      <h2>게시 목적지</h2>
      <p className="small muted">SNS 계정 연결과 권한 부여는 직접 해야 합니다. 여기에는 토큰 값이 아니라 환경변수 “이름”만 저장합니다.</p>
      {q.isLoading ? <Loading lines={2} /> : q.error ? <ErrorBox error={q.error} /> : (
        <>
          {!q.data!.items.length && <p className="muted small">연결된 목적지가 없습니다.</p>}
          <ul className="list">
            {q.data!.items.map((d) => (
              <li key={d.id} className="list-item">
                <div className="row between">
                  <span>
                    <strong>{d.label}</strong> <Badge>{d.platform === "instagram" ? "인스타그램" : "텔레그램 채널"}</Badge>
                  </span>
                  <button className="btn sm" onClick={() => toggle.mutate(d)} disabled={toggle.isPending}>
                    {d.enabled ? "사용 중지" : "사용"}
                  </button>
                </div>
                <div className="row small">
                  <Badge kind={d.enabled ? "ok" : ""}>{d.enabled ? "사용" : "사용 안 함"}</Badge>
                  <Badge kind={d.connection.ready ? "ok" : "warn"}>{d.connection.ready ? "환경변수 설정됨" : `필요: ${d.connection.missing.join(", ") || d.connection.invalid.join(", ")}`}</Badge>
                </div>
                <DestinationKeys d={d} />
              </li>
            ))}
          </ul>
          <form className="row" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} style={{ width: "auto" }} aria-label="플랫폼">
              <option value="telegram_channel">텔레그램 채널</option>
              <option value="instagram">인스타그램</option>
            </select>
            <input placeholder="이름 (예: 공개 텔레그램 채널)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: "1 1 200px", width: "auto" }} required aria-label="목적지 이름" />
            <button className="btn" disabled={add.isPending}>목적지 추가</button>
          </form>
          <p className="small muted">추가 시 사용할 환경변수: {Object.values(q.data!.defaults[platform] ?? {}).join(", ")}</p>
          {(add.error || toggle.error) && <ErrorBox error={add.error || toggle.error} />}
        </>
      )}
    </section>
  );
}

const REF_LABEL: Record<string, string> = { accessToken: "액세스 토큰", userId: "인스타그램 사용자 ID", chatId: "채널 ID (@채널아이디 또는 숫자)" };

function DestinationKeys({ d }: { d: DestView }) {
  const qc = useQueryClient();
  const sec = useSecrets();
  const [vals, setVals] = useState<Record<string, string>>({});
  const changed = Object.entries(vals).filter(([, v]) => v.trim());
  const save = useMutation({
    mutationFn: async () => {
      for (const [k, v] of changed) await api(`/secrets/${k}`, { method: "PUT", body: { value: v.trim() } });
    },
    onSuccess: () => {
      setVals({});
      qc.invalidateQueries({ queryKey: ["secrets"] });
      qc.invalidateQueries({ queryKey: ["ch"] });
    },
  });
  const tokenKey = d.secretRefs.accessToken;
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; message: string }>(`/secrets/test/instagram:${tokenKey}`, { method: "POST", body: {} }) });
  if (sec.isLoading) return <Loading lines={1} />;
  const st = (k: string) => sec.data?.statuses.find((s) => s.key === k);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {Object.entries(d.secretRefs).map(([field, key]) => (
        <SecretInput key={key} k={key} label={REF_LABEL[field] ?? field} status={st(key)} value={vals[key] ?? ""} onChange={(v) => setVals({ ...vals, [key]: v })} />
      ))}
      <div className="row">
        <button className="btn sm primary" disabled={!changed.length || save.isPending}>저장</button>
        {d.platform === "instagram" && tokenKey && (
          <button type="button" className="btn sm" onClick={() => test.mutate()} disabled={test.isPending || changed.length > 0}>계정 연결 확인</button>
        )}
      </div>
      {save.error && <ErrorBox error={save.error} />}
      {test.data && <div className={`notice small ${test.data.ok ? "ok" : "err"}`}>{test.data.message}</div>}
      {d.platform === "telegram_channel" && <p className="small muted" style={{ margin: 0 }}>봇을 이 채널의 관리자(메시지 게시 권한)로 추가해야 게시할 수 있습니다.</p>}
    </form>
  );
}


