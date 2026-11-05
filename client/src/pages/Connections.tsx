import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { api } from "../api";
import { useDirtyGuard } from "../state";
import { Badge, ErrorBox, fmtDate, GuardedLink, Loading } from "../ui";
import { AiUsageGuide } from "../AiUsageGuide";
import { aiProviderLabels, type AiProvider } from "@shared/aiProviders";
import type { SecretField, SecretGroup } from "@shared/secretsCatalog";

type Status = { key: string; source: "environment" | "screen" | "none" | "unreadable"; updatedAt: string | null; valueLength: number | null; secret: boolean; value: string | null };
type Resp = { groups: SecretGroup[]; statuses: Status[]; tests: Record<string, { ok: boolean; message: string; at: string }> };

export function useSecrets() {
  return useQuery({ queryKey: ["secrets"], queryFn: () => api<Resp>("/secrets") });
}

export function SourceBadge({ s }: { s: Status | undefined }) {
  if (!s || s.source === "none") return <Badge>아직 입력 안 함</Badge>;
  if (s.source === "environment") return <Badge>서버에서 관리</Badge>;
  if (s.source === "unreadable") return <Badge kind="err">다시 입력 필요</Badge>;
  return <Badge kind="ok">입력됨{s.updatedAt ? ` · ${fmtDate(s.updatedAt)}` : ""}</Badge>;
}

/** 하나의 키 입력칸 — 비밀값은 저장 후 다시 보여주지 않음 */
export function SecretInput({ k, label, hint, placeholder, options, secret, status, value, onChange }: { k: string; label: string; hint?: string; placeholder?: string; options?: SecretField["options"]; secret?: boolean; status: Status | undefined; value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const del = useMutation({ mutationFn: () => api(`/secrets/${k}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["secrets"] }); qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["studio"] }); qc.invalidateQueries({ queryKey: ["channels"] }); } });
  const envOwned = status?.source === "environment";
  const has = status && status.source !== "none";
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between">
        <label htmlFor={`sec-${k}`} style={{ fontWeight: 600, fontSize: 14 }}>
          {label}
        </label>
        <SourceBadge s={status} />
      </div>
      {hint && <span className="small muted">{hint}</span>}
      {envOwned ? (
        <details className="small muted"><summary>서버에서 관리하는 값입니다</summary>Render의 Environment에 등록된 {k} 설정이 우선합니다. 화면에서 관리하려면 서버의 해당 설정을 제거해야 합니다.</details>
      ) : (
        <div className="row">
          {options ? (
            <select id={`sec-${k}`} value={value || status?.value || "auto"} onChange={(e) => onChange(e.target.value)} style={{ flex: "1 1 220px" }}>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : <input
            id={`sec-${k}`}
            type={(secret ?? status?.secret) ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            style={{ flex: "1 1 220px", width: "auto" }}
            placeholder={has && status?.secret ? "저장됨 — 바꾸려면 새 값을 붙여 넣으세요" : placeholder ?? (status?.value ? "" : "값을 붙여 넣으세요")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />}
          {has && status?.source !== "environment" && (
            <button type="button" className="btn sm danger" onClick={() => confirm(`${label} 값을 지울까요?`) && del.mutate()} disabled={del.isPending}>
              지우기
            </button>
          )}
        </div>
      )}
      {!status?.secret && status?.value && <span className="small muted">현재 값: {status.value}</span>}
      {del.error && <ErrorBox error={del.error} />}
    </div>
  );
}

type AiStatus = { integrations: { aiProvider: AiProvider; aiConfigured: boolean; openai: boolean } };

function AiProviderPanel({ data }: { data: Resp }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const status = data.statuses.find(s => s.key === "AI_PROVIDER");
  const current = status?.value || "auto";
  const envOwned = status?.source === "environment";
  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? current;
  const changed = !envOwned && choice !== null && (choice !== current || status?.source === "unreadable");
  const actual = useQuery({ queryKey: ["status"], queryFn: () => api<AiStatus>("/status") });
  const save = useMutation({
    mutationFn: () => api("/secrets/AI_PROVIDER", { method: "PUT", body: { value: selected } }),
    onSuccess: async () => {
      guard.setDirty("ai-provider", false);
      await Promise.all([qc.invalidateQueries({ queryKey: ["secrets"] }), qc.invalidateQueries({ queryKey: ["status"] }), qc.invalidateQueries({ queryKey: ["studio"] }), qc.invalidateQueries({ queryKey: ["channels"] })]);
      setChoice(null);
    },
  });
  useEffect(() => {
    guard.setDirty("ai-provider", changed, async () => { try { await save.mutateAsync(); return true; } catch { return false; } });
    return () => guard.setDirty("ai-provider", false);
  }, [changed, selected]);
  return <form className="panel stack" onSubmit={e => { e.preventDefault(); if (changed) save.mutate(); }}>
    <div className="row between"><h3 style={{ margin: 0 }}>공통 AI 연결과 기본값</h3><Badge kind={status?.source === "unreadable" ? "warn" : ""}>{envOwned ? "서버에서 설정" : status?.source === "unreadable" ? "다시 선택 필요" : status?.source === "screen" ? "저장됨" : "기본값 사용"}</Badge></div>
    <p className="small muted" style={{ margin: 0 }}>API 키는 이 화면에서 연결합니다. 기사 요약·카드 문구·그림에 쓸 AI와 모델은 <GuardedLink href="/settings">설정 → 내 채널 → 역할별 AI</GuardedLink>에서 채널마다 정하세요.</p>
    <label className="field" htmlFor="ai-provider-choice">기타 도구의 기본 AI
      <select id="ai-provider-choice" value={selected} disabled={envOwned || save.isPending} onChange={e => setChoice(e.target.value)} aria-describedby="ai-provider-help">
        <option value="auto">자동 선택 · Gemini 우선</option><option value="gemini">Gemini · Google</option><option value="openai">GPT · OpenAI</option><option value="anthropic">Claude · Anthropic</option>
      </select>
    </label>
    <p id="ai-provider-help" className="small muted" style={{ margin: 0 }}>별도 역할 설정이 없는 도구의 기본값입니다. 채널별 요약·문구·이미지 설정은 바뀌지 않습니다. 자동 선택은 등록된 키 중 Gemini → GPT → Claude 순서이며, 한도·오류가 나면 다른 AI로 전환하지 않습니다.</p>
    {actual.data && <div className="ai-readiness" aria-live="polite"><div><strong>글쓰기 · {aiProviderLabels[actual.data.integrations.aiProvider]}</strong><Badge kind={actual.data.integrations.aiConfigured ? "ok" : ""}>{actual.data.integrations.aiConfigured ? "키 등록됨" : "키 등록 필요"}</Badge></div><div><strong>그림 · OpenAI</strong><Badge kind={actual.data.integrations.openai ? "ok" : ""}>{actual.data.integrations.openai ? "키 등록됨" : "키 등록 필요"}</Badge></div><small className="muted">키 등록 상태입니다. 실제 연결은 각 서비스에서 확인하세요.</small></div>}
    {actual.error && <ErrorBox error={actual.error} retry={() => actual.refetch()} />}
    <div className="row"><GuardedLink className="btn sm" href="/connections?service=gemini">Gemini 키 입력</GuardedLink><GuardedLink className="btn sm" href="/connections?service=openai">OpenAI 키 입력</GuardedLink><GuardedLink className="btn sm" href="/connections?service=anthropic">Claude 키 입력</GuardedLink></div>
    {envOwned ? <p className="small muted" style={{ margin: 0 }}>서버의 AI_PROVIDER 설정이 우선 적용되어 선택이 잠겨 있습니다. 화면에서 변경하려면 Render의 Environment에서 해당 항목을 제거한 뒤 재배포하세요.</p> : <div className="row"><button className="btn primary" disabled={!changed || save.isPending}>{save.isPending ? "저장 중…" : "선택 저장"}</button>{changed && <span className="small muted">저장하면 적용됩니다.</span>}</div>}
    {save.error && <ErrorBox error={save.error} />}
    {save.isSuccess && !changed && <div className="notice ok small" role="status">공통 AI 기본값을 저장했습니다.</div>}
  </form>;
}

function GroupPanel({ g, data }: { g: SecretGroup; data: Resp }) {
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const [vals, setVals] = useState<Record<string, string>>({});
  const changed = Object.entries(vals).filter(([, v]) => v.trim());
  const save = useMutation({
    mutationFn: async () => {
      for (const [k, v] of changed) await api(`/secrets/${k}`, { method: "PUT", body: { value: v.trim() } });
    },
    onSuccess: () => {
      setVals({});
      guard.setDirty(`connection-${g.id}`, false);
      qc.invalidateQueries({ queryKey: ["secrets"] });
      qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["studio"] }); qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>(`/secrets/test/${g.id}`, { method: "POST", body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["secrets"] }),
  });
  const last = currentTest(g, data);
  const st = (k: string) => data.statuses.find((s) => s.key === k);
  useEffect(() => {
    guard.setDirty(`connection-${g.id}`, changed.length > 0, async () => { try { await save.mutateAsync(); return true; } catch { return false; } });
    return () => guard.setDirty(`connection-${g.id}`, false);
  }, [vals, g.id]);
  const sendsMessage = g.id === "telegram" && !!st("TELEGRAM_REVIEW_CHAT_ID")?.value;
  const paidTest = g.id === "anthropic";
  const info = SERVICE_INFO[g.id];
  const input = (f: SecretField) => <SecretInput key={f.key} k={f.key} label={f.key === "OPENAI_API_KEY" ? "API 키 · Secret key" : f.label} hint={f.key === "OPENAI_API_KEY" ? "발급 시 표시된 Secret key 전체를 붙여 넣으세요. Tracking ID나 가려진 값(•••)은 사용할 수 없습니다." : f.hint} placeholder={f.placeholder} options={f.options} secret={f.secret} status={st(f.key)} value={vals[f.key] ?? ""} onChange={(v) => { save.reset(); setVals(prev => ({ ...prev, [f.key]: v })); }} />;
  const modelFields = g.fields.filter(f => f.key.endsWith("_MODEL"));
  return (
    <form id={`connection-${g.id}`} tabIndex={-1} className="panel stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{info?.title ?? g.title} 키 설정</h2>
        {g.docs && (
          <a href={g.docs} target="_blank" rel="noopener noreferrer" className="small">
            키 발급 페이지 ↗
          </a>
        )}
      </div>
      {(g.id === "gemini" || g.id === "openai") && <AiUsageGuide provider={g.id} setup />}
      {g.id === "openai" && <p className="connection-help">아래 API 키 칸에 붙여 넣고 <strong>키 저장 → 연결 확인</strong> 순서로 누르세요.</p>}
      {g.id === "naver" && <p className="connection-help">네이버 뉴스·웹문서·블로그 검색에는 키가 필요합니다. NAVER API HUB → Application → 인증 정보에서 발급된 두 값을 입력한 뒤 <strong>키 저장 → 연결 확인</strong>을 누르세요. 키가 없어도 학교·기관 공지는 직접 수집하고 뉴스는 공개 RSS로 보완합니다.</p>}
      {last && <div className={`notice small ${last.ok ? "ok" : "err"}`} role="status"><strong>{last.ok ? "최근 연결 확인 성공" : "연결 확인 실패"}</strong><p style={{ margin: "6px 0" }}>{last.message}</p><span className="muted">{fmtDate(last.at)}</span></div>}
      {g.fields.filter(f => !f.key.endsWith("_MODEL")).map(input)}
      {!!modelFields.length && <details className="settings-details"><summary>모델 설정 · 선택 사항</summary><div className="stack" style={{ marginTop: 12 }}>{modelFields.map(input)}</div></details>}
      <div className="row">
        <button className="btn primary" disabled={!changed.length || save.isPending}>
          {save.isPending ? "저장 중…" : "키 저장"}
        </button>
        {g.testable && (
          <button type="button" className="btn" onClick={() => test.mutate()} disabled={test.isPending || save.isPending || changed.length > 0} title={changed.length ? "먼저 키를 저장하세요" : undefined}>
            {test.isPending ? "확인 중…" : sendsMessage ? "확인 메시지 보내기" : paidTest ? "테스트 호출 (유료)" : (g.id === "openai" || g.id === "gemini") ? "연결 확인 · 생성 비용 없음" : "연결 확인"}
          </button>
        )}
      </div>
      {g.id === "canva" && <div className="notice stack small"><p>Client ID는 Canva 개발자 앱에서 발급한 값입니다. 앱 이름이나 Canva 계정 이름을 넣으면 연결되지 않습니다. 앱의 인증 리디렉션 주소는 <code>{window.location.origin}/api/canva/callback</code>로 설정해 주세요.</p><div className="row"><a className="btn sm" href="https://www.canva.dev/docs/apps/rest-apis/authentication/" target="_blank" rel="noopener noreferrer">Canva 앱 연결 안내 ↗</a><GuardedLink className="btn" href="/design">Canva 계정 연결·디자인 관리 →</GuardedLink></div></div>}
      {g.id === "instagram" && <GuardedLink href="/settings">채널별 게시 계정·토큰 관리 →</GuardedLink>}
      {sendsMessage && <p className="small muted">검토 알림 채팅방에 메시지 1건을 보냅니다.</p>}
      {paidTest && <p className="small muted">짧은 글 생성 요청 1회를 보내며 API 사용료가 발생합니다.</p>}
      <details className="settings-details small"><summary>발급·사용 안내</summary><p>{g.description}</p><dl>{g.fields.map(f => <div key={f.key}><dt>{f.label}</dt><dd><code>{f.key}</code></dd></div>)}</dl></details>
      {save.error && <ErrorBox error={save.error} />}
      {test.error && <ErrorBox error={test.error} />}
      {save.isSuccess && <div className="notice ok small" role="status">키를 저장했습니다.{g.testable ? " 연결 확인을 실행해 주세요." : ""}</div>}
    </form>
  );
}

const SERVICE_INFO: Record<string, { title: string; use: string; mark: string; keys: string[] }> = {
  gemini: { title: "Gemini", use: "글쓰기 · 무료 등급 지원", mark: "G", keys: ["GEMINI_API_KEY"] },
  openai: { title: "OpenAI", use: "GPT 글쓰기 · 웹툰 이미지", mark: "O", keys: ["OPENAI_API_KEY"] },
  anthropic: { title: "Claude", use: "글쓰기 · 원고 다듬기", mark: "A", keys: ["ANTHROPIC_API_KEY"] },
  canva: { title: "Canva", use: "브랜드 템플릿 · 디자인", mark: "C", keys: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"] },
  naver: { title: "네이버", use: "뉴스 · 웹문서 · 블로그 검색", mark: "N", keys: ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"] },
  telegram: { title: "텔레그램", use: "검토 알림 · 채널 전송", mark: "T", keys: ["TELEGRAM_BOT_TOKEN"] },
  cloudinary: { title: "Cloudinary", use: "게시용 이미지 주소", mark: "C", keys: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] },
  instagram: { title: "Instagram", use: "게시 API 버전", mark: "I", keys: ["INSTAGRAM_API_VERSION"] },
  ai: { title: "공통 AI 기본값", use: "기타 도구의 AI 변경", mark: "✎", keys: [] },
};

// A saved key is not proof of a working connection; old tests don't validate replacement keys.
function currentTest(g: SecretGroup, data: Resp) {
  const last = data.tests[g.id];
  if (!last || SERVICE_INFO[g.id]?.keys.some(k => !["screen", "environment"].includes(data.statuses.find(s => s.key === k)?.source ?? "none"))) return undefined;
  if (g.fields.some(f => { const updated = data.statuses.find(s => s.key === f.key)?.updatedAt; return updated && Date.parse(updated) > Date.parse(last.at); })) return undefined;
  return last;
}

function ConnectionBoard({ data }: { data: Resp }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const guard = useDirtyGuard();
  const selected = new URLSearchParams(search).get("service") ?? "openai";
  const group = data.groups.find(g => g.id === selected) ?? data.groups.find(g => g.id === "openai") ?? data.groups[0];
  const groups = Object.keys(SERVICE_INFO).map(id => data.groups.find(g => g.id === id)).filter((g): g is SecretGroup => !!g);
  const choose = (id: string) => guard.confirmLeave(() => navigate(`/connections?service=${id}`));
  useEffect(() => { document.getElementById("connection-editor")?.focus({ preventScroll: true }); }, [group?.id]);
  if (!group) return <p className="notice">관리할 서비스가 없습니다.</p>;
  return <div className="connection-layout">
    <nav className="connection-services" aria-label="API 서비스 선택">{groups.map(g => {
      const info = SERVICE_INFO[g.id];
      const states = info.keys.map(k => data.statuses.find(s => s.key === k)?.source ?? "none");
      const last = currentTest(g, data);
      const registered = states.length > 0 && states.every(s => s === "screen" || s === "environment");
      const label = states.includes("unreadable") ? "재입력 필요" : last ? last.ok ? "최근 확인 성공" : "연결 확인 실패" : registered ? "등록됨 · 확인 필요" : states.some(s => s === "screen" || s === "environment") ? "일부 입력됨" : "미등록";
      return <button key={g.id} className="connection-service" aria-current={group.id === g.id ? "page" : undefined} onClick={() => choose(g.id)}>
        <span className={`connection-mark service-${g.id}`} aria-hidden>{info.mark}</span><span className="connection-service-copy"><strong>{info.title}</strong><span className="small muted">{info.use}</span>{g.id !== "ai" && <span className={`connection-state ${label.includes("실패") || label === "재입력 필요" ? "error" : ""}`}>{!g.testable && registered ? "설정 등록됨" : label}</span>}</span><span aria-hidden>→</span>
      </button>;
    })}</nav>
    <section id="connection-editor" tabIndex={-1} className="connection-editor" aria-label={`${SERVICE_INFO[group.id]?.title ?? group.title} 설정`}>
      {group.id === "ai" ? <AiProviderPanel data={data} /> : <GroupPanel key={group.id} g={group} data={data} />}
      <p className="small muted connection-footnote">모든 채널에서 함께 사용합니다. 키는 암호화해 저장하며, 저장한 비밀값은 다시 표시하지 않습니다.</p>
    </section>
  </div>;
}

export function ConnectionsSection() {
  const q = useSecrets();
  return q.isLoading ? <Loading lines={2} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <ConnectionBoard data={q.data!} />;
}

export function ConnectionsPage() {
  return <div className="connections-page"><header className="page-head"><div><span className="studio-eyebrow">WORKSPACE</span><h1>API 키 관리</h1><p className="muted">서비스를 고르고, 키를 저장하고, 연결을 확인하세요.</p></div><GuardedLink className="btn" href="/">제작 보드로</GuardedLink></header><ConnectionsSection /></div>;
}

