import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { InstagramAccounts, useInstagramOAuthConfig } from "./InstagramAccounts";
import { SecretInput, useSecrets } from "./Connections";
import { SECRET_GROUPS } from "@shared/secretsCatalog";
import { api } from "../api";
import { useDirtyGuard } from "../state";
import { ErrorBox, Loading } from "../ui";
import { isPrivateWorkroom } from "../workroom";

const oauthMessages: Record<string, string> = {
  state: "이 브라우저에서 시작한 로그인 요청을 확인할 수 없습니다. 계정 카드에서 다시 연결해 주세요.",
  expired: "로그인 확인 시간이 지났습니다. 계정 카드에서 다시 연결해 주세요.",
  configuration: "로그인 버튼 설정이 아직 끝나지 않았습니다. 발급한 토큰으로 직접 연결하거나 아래 ‘로그인 버튼 설정 (선택)’을 확인해 주세요.",
  publishing_permission: "계정은 확인했지만 게시 권한을 확인하지 못했습니다. Meta 구성의 콘텐츠 게시 권한을 확인해 주세요.",
  exchange_failed: "Meta 로그인 응답을 확인하지 못했습니다. 앱 시크릿과 복귀 주소를 확인해 주세요.",
  denied: "계정 연결이 취소됐습니다. 준비되면 다시 연결해 주세요.",
  cancelled: "계정 연결이 취소됐습니다. 준비되면 다시 연결해 주세요.",
  invalid_state: "로그인 확인 시간이 지났거나 이 브라우저에서 시작한 요청이 아닙니다. 계정 카드에서 다시 연결해 주세요.",
  expired_state: "로그인 확인 시간이 지났습니다. 계정 카드에서 다시 연결해 주세요.",
  account_mismatch: "로그인한 계정이 선택한 채널과 다릅니다. 해당 채널의 Instagram 계정으로 다시 연결해 주세요.",
  not_configured: "로그인 버튼 설정이 아직 끝나지 않았습니다. 발급한 토큰으로 직접 연결하거나 아래 ‘로그인 버튼 설정 (선택)’을 확인해 주세요.",
};

export function InstagramConnectionsPage() {
  const workroom = isPrivateWorkroom();
  const [notice, setNotice] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("instagram") === "connected" ? { ok: true, text: "선택한 채널의 Instagram 계정과 게시 권한을 확인해 연결했습니다." } : q.get("instagram") === "error" ? { ok: false, text: oauthMessages[q.get("reason") ?? ""] ?? "Instagram 연결을 완료하지 못했습니다. 연결 설정과 선택한 계정을 확인하고 다시 시도해 주세요." } : null;
  });
  const [, navigate] = useLocation();
  const guard = useDirtyGuard();
  useEffect(() => { if (new URLSearchParams(window.location.search).has("instagram")) window.history.replaceState(null, "", window.location.pathname); }, []);
  return <div className="instagram-connections-page stack">
    <header className="page-head"><div><span className="studio-eyebrow">CONNECTED ACCOUNTS</span><h1>인스타그램 연결</h1><p className="muted">네 채널의 계정과 연결 상태를 한곳에서 관리하세요.</p></div><button className="btn ghost" onClick={() => guard.confirmLeave(() => navigate("/"))}>내 콘텐츠로 돌아가기</button></header>
    {notice && <div className={`notice ${notice.ok ? "ok" : "warn"} row between`} role="status"><span>{notice.text}</span><button className="btn ghost sm" aria-label="연결 결과 닫기" onClick={() => setNotice(null)}>닫기</button></div>}
    <InstagramAccounts />
    {workroom ? <p className="small muted">계정 연결은 <a href="https://spacepenguin.onrender.com/instagram" target="_blank" rel="noreferrer">운영 스튜디오의 인스타그램 연결</a>에서 진행하세요.</p> : <MetaConnectionSetup />}
  </div>;
}

function MetaConnectionSetup() {
  const config = useInstagramOAuthConfig();
  const secrets = useSecrets();
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const [values, setValues] = useState<Record<string, string>>({});
  const group = SECRET_GROUPS.find(g => g.id === "meta-instagram")!;
  const fields = [...group.fields, ...SECRET_GROUPS.find(g => g.id === "instagram")!.fields];
  const dirty = Object.values(values).some(v => !!v.trim());
  const save = useMutation({ mutationFn: async () => {
    for (const field of fields) if (values[field.key]?.trim()) await api(`/secrets/${field.key}`, { method: "PUT", body: { value: values[field.key].trim() } });
  }, onSuccess: async () => { setValues({}); guard.setDirty("meta-instagram-setup", false); await Promise.all([qc.invalidateQueries({ queryKey: ["secrets"] }), qc.invalidateQueries({ queryKey: ["instagram-oauth-config"] })]); } });
  useEffect(() => { guard.setDirty("meta-instagram-setup", dirty, async () => { try { await save.mutateAsync(); return true; } catch { return false; } }); return () => guard.setDirty("meta-instagram-setup", false); }, [dirty, values]);
  const appId = config.data?.appId || secrets.data?.statuses.find(s => s.key === "META_APP_ID")?.value;
  const metaHref = appId && /^\d+$/.test(appId) ? `https://developers.facebook.com/apps/${appId}/instagram-business/Unified-Login-API-Setup/` : "https://developers.facebook.com/apps/";
  return <details id="setup" className="panel instagram-setup">
    <summary><strong>로그인 버튼 설정 (선택)</strong></summary>
    <div className="stack" style={{ marginTop: 16 }}>
    <div className="instagram-section-heading"><div><h2>로그인 버튼 연결 설정</h2><p className="small muted">‘Instagram으로 연결’ 버튼을 사용하고 싶을 때만 설정하세요. 발급받은 토큰으로 직접 연결할 때는 앱 ID·시크릿·구성 ID가 필요하지 않습니다.</p></div><span className={`instagram-state ${config.data?.configured ? "is-ok" : ""}`}>{config.data?.configured ? "로그인 준비 완료" : "선택 설정 전"}</span></div>
    <ol className="instagram-setup-steps"><li><span>1</span><div><strong>Instagram 초대 수락</strong><p>개발 모드라면 연결할 계정으로 로그인한 뒤, 설정 → 웹사이트 권한 → 앱 및 웹사이트 → 테스터 초대에서 수락하세요.</p><a href="https://www.instagram.com/accounts/manage_access/" target="_blank" rel="noreferrer">Instagram 초대 확인 ↗</a></div></li><li><span>2</span><div><strong>Meta 앱 연결 준비</strong><p>통합 로그인 구성을 선택하고 아래 복귀 주소를 등록하세요. 앱 ID·시크릿·구성 ID를 한 번 저장합니다.</p><a href={metaHref} target="_blank" rel="noreferrer">Meta 앱 설정 ↗</a></div></li><li><span>3</span><div><strong>계정 카드에서 연결</strong><p>로그인 화면에서 연결할 Instagram 계정을 고르면 스튜디오가 실제 계정을 확인해 저장합니다.</p></div></li></ol>
    {config.error && <ErrorBox error={config.error} retry={() => config.refetch()} />}
    {config.data?.redirectUri && <label className="field">Meta에 등록할 복귀 주소<input aria-label="Meta 복귀 주소" readOnly value={config.data.redirectUri} onFocus={e => e.target.select()} /><span className="hint">Meta 앱의 유효한 OAuth 리디렉션 URI에 그대로 등록하세요.</span></label>}
    <details className="instagram-app-details" open={config.data ? !config.data.configured || dirty : undefined}><summary>앱 설정 {config.data?.configured ? "확인·변경" : "입력"}</summary>
      {secrets.isLoading ? <Loading lines={2} /> : secrets.error ? <ErrorBox error={secrets.error} retry={() => secrets.refetch()} /> : <form className="stack" onSubmit={e => { e.preventDefault(); if (dirty) save.mutate(); }}>
        {fields.map(f => <SecretInput key={f.key} k={f.key} label={f.label} hint={f.hint} secret={f.secret} status={secrets.data?.statuses.find(s => s.key === f.key)} value={values[f.key] ?? ""} onChange={v => setValues(prev => ({ ...prev, [f.key]: v }))} />)}
        <div className="row"><button className="btn primary" disabled={!dirty || save.isPending}>{save.isPending ? "저장 중…" : "연결 준비 저장"}</button>{save.isSuccess && !dirty && <span className="small muted" role="status">저장했습니다.</span>}</div>{save.error && <ErrorBox error={save.error} />}
      </form>}
    </details>
    </div>
  </details>;
}
