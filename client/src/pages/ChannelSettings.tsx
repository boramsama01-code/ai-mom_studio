import { InstagramAccounts } from "./InstagramAccounts";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useChannel, useDirtyGuard } from "../state";
import { Badge, Empty, ErrorBox, GuardedLink, Loading } from "../ui";
import type { Channel, ChannelBudget, Destination } from "@shared/schema";
import { ChannelDirectory } from "./ChannelDirectory";
import { ConnectionsSection, SecretInput, useSecrets } from "./Connections";
import { StudioImport } from "./Studio";

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
  const { allChannels: channels } = useChannel();
  const guard = useDirtyGuard();
  const [tab, setTab] = useState(() => ["connections", "instagram"].includes(new URLSearchParams(location.search).get("tab") ?? "") ? new URLSearchParams(location.search).get("tab")! : "channels");
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const current = channels.find(c => c.id === editing);
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status") });
  const leave = (action: () => void) => guard.confirmLeave(action);
  return <div className="settings-page">
    <header className="page-head"><div><span className="studio-eyebrow">WORKSPACE</span><h1>설정</h1><p className="muted">내 채널과 제작 환경을 한곳에서 관리하세요.</p></div>
      {tab === "channels" && !creating && !current && <button className="btn primary" onClick={() => leave(() => setCreating(true))}>＋ 새 채널</button>}</header>
    <nav className="settings-tabs" aria-label="설정 메뉴">{[["channels", "내 채널"], ["instagram", "인스타그램 연결"], ["operations", "운영 설정"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => leave(() => { setTab(key); setEditing(null); setCreating(false); })}>{label}</button>)}<GuardedLink className="btn ghost" href="/connections">API 키 관리 →</GuardedLink></nav>
    {tab === "channels" && <>
      {(creating || current) && <button className="btn ghost settings-back" onClick={() => leave(() => { setEditing(null); setCreating(false); })}>← 내 채널 목록</button>}
      {creating ? <NewChannel onCreated={ch => { setCreating(false); setEditing(ch.id); }} /> : current ? <><ChannelForm key={current.id} ch={current} onArchived={() => setEditing(null)} /><details className="panel settings-details"><summary>이 채널의 게시 계정</summary><InstagramAccounts channelId={current.id} /><p className="small muted">수집 콘텐츠와 제작보드 콘텐츠는 같은 채널의 게시 계정을 사용합니다. 아래는 추가 목적지·텔레그램 설정입니다.</p><Destinations cid={current.id} /></details></> : <>
        <ChannelDirectory channels={channels} onEdit={id => leave(() => setEditing(id))} onCreate={() => leave(() => setCreating(true))} />
      </>}
    </>}
    {tab === "instagram" && <InstagramAccounts />}
    {tab === "connections" && <ConnectionsSection />}
    {tab === "operations" && <><section className="panel stack"><h2>운영 상태</h2>{status.isLoading ? <Loading lines={2} /> : status.error ? <ErrorBox error={status.error} /> : status.data && <>
      <p className="small muted">{status.data.workerConnected ? "최근 자동 작업 실행 기록이 있습니다." : "최근 6시간 자동 작업 실행 기록이 없습니다."}</p>
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
  const create = useMutation({ mutationFn: () => api<Channel>("/channels", { method: "POST", body: { name, description, accentColor } }), onSuccess: async ch => {
    guard.setDirty("new-channel", false); await qc.invalidateQueries({ queryKey: ["channels"] }); onCreated(ch);
  } });
  useEffect(() => { guard.setDirty("new-channel", !!name || !!description); return () => guard.setDirty("new-channel", false); }, [name, description, guard]);
  return <form className="panel stack channel-editor" onSubmit={e => { e.preventDefault(); create.mutate(); }}><h2>새 채널</h2>
    <label className="field">채널명<input autoFocus required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="내 채널 이름" /></label>
    <label className="field">한 줄 소개<textarea rows={2} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} placeholder="어떤 이야기를 전하는 채널인가요?" /></label>
    <label className="field">채널 색상<input type="color" value={accentColor} onChange={e => setColor(e.target.value)} /></label>
    <p className="small muted">추가 후 바로 콘텐츠를 만들 수 있습니다. 자동 수집·게시 설정은 꺼져 있습니다.</p>
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

function ChannelForm({ ch, onArchived }: { ch: Channel; onArchived: () => void }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const init = { name: ch.name, description: ch.description, audience: ch.audience, accentColor: ch.accentColor, active: ch.active, editorialGuide: ch.editorialGuide, budget: ch.budget };
  const [f, setF] = useState(init);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const m = useMutation({
    mutationFn: () => api<Channel>(`/channels/${ch.id}`, { method: "PATCH", body: { version: ch.version, ...f } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });
  const archive = useMutation({ mutationFn: () => api(`/channels/${ch.id}`, { method: "PATCH", body: { version: ch.version, active: false } }), onSuccess: async () => {
    guard.setDirty("channel-form", false);
    await Promise.all([qc.invalidateQueries({ queryKey: ["channels"] }), qc.invalidateQueries({ queryKey: ["studio"] })]);
    onArchived();
  } });
  useEffect(() => {
    guard.setDirty("channel-form", dirty, async () => {
      try {
        await m.mutateAsync();
        return true;
      } catch {
        return false;
      }
    });
    return () => guard.setDirty("channel-form", false);
  }, [dirty, f, ch.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = (k: keyof ChannelBudget, label: string, max: number) => (
    <label className="field">
      {label}
      <input type="number" min={0} max={max} value={(f.budget[k] as number | null) ?? 0} onChange={(e) => setF({ ...f, budget: { ...f.budget, [k]: Number(e.target.value) } })} />
    </label>
  );
  return (
    <form className="panel stack channel-editor" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <h2>{ch.name}</h2><fieldset className="channel-form-fields stack" disabled={m.isPending || archive.isPending}>
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
      <label className="field">
        설명
        <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
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
        {m.isSuccess && !dirty && <span className="small muted" style={{ marginRight: "auto" }}>저장됨</span>}
        <button type="button" className="btn" disabled={!dirty} onClick={() => setF(init)}>되돌리기</button>
        <button className="btn primary" disabled={!dirty || m.isPending}>저장</button>
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


