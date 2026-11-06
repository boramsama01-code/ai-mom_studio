import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expectedInstagramUsername, type InstagramAccountRow, type InstagramConnectionCheck, type InstagramOAuthConfig } from "@shared/channelInstagram";
import { api } from "../api";
import { ErrorBox, GuardedLink, Loading } from "../ui";
import { isPrivateWorkroom } from "../workroom";
import { useDirtyGuard } from "../state";
import { channelSlug } from "@shared/channelKeys";
import "../instagram-connections.css";

export function useInstagramOAuthConfig(enabled = true) {
  return useQuery({ queryKey: ["instagram-oauth-config"], queryFn: () => api<InstagramOAuthConfig>("/studio/instagram/oauth/config"), enabled, retry: false });
}

export function InstagramAccounts({ channelId, channel }: { channelId?: number; channel?: string }) {
  const workroom = isPrivateWorkroom();
  const expected = channel ? expectedInstagramUsername(channel) : null;
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api<{ accounts: InstagramAccountRow[] }>("/studio/instagram/accounts"), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["instagram-accounts"] }); qc.invalidateQueries({ queryKey: ["studio-publication"] }); qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["ch"] }); };
  const accounts = query.data?.accounts.filter(a => (!channelId || a.channelId === channelId) && (!channel || (a.channelSlug ? channelSlug(a.channelSlug) === channelSlug(channel) : !!expected && a.expectedUsername === expected))) ?? [];
  const configuredCount = accounts.filter(a => a.destinations.some(d => d.enabled && d.configured)).length;
  return <section className="panel stack instagram-accounts" aria-label="채널별 인스타그램 연결">
    <div className="instagram-section-heading"><div><h2>{workroom ? "게시 계정 확인" : "채널별 인스타그램 연결"}</h2><p className="muted small">{workroom ? "선택한 채널의 계정 주소와 실제 연결 상태를 확인하세요. 계정 연결 정보는 여기서 변경하지 않습니다." : "연결할 계정을 고르세요. 로그인 후 실제 계정과 게시 권한을 확인해 저장합니다."}</p></div>{!!accounts.length && <span className="instagram-summary">연결 정보 {configuredCount}/{accounts.length}</span>}</div>
    {query.isLoading && <Loading lines={2} />}{query.error && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    <div className="instagram-account-grid">{accounts.map(a => <InstagramAccount key={a.channelId} account={a} onConnected={refresh} />)}</div>
    {channel && !query.isLoading && !query.error && !accounts.length && <p className="small muted">이 채널의 게시 계정을 불러오지 못했습니다. 채널 설정에서 채널 상태를 확인해 주세요.</p>}
  </section>;
}

function InstagramAccount({ account: a, onConnected }: { account: InstagramAccountRow; onConnected: () => void }) {
  const workroom = isPrivateWorkroom();
  const guard = useDirtyGuard();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectedUsername, setConnectedUsername] = useState<string | null>(null);
  const dest = a.destinations.find(d => d.enabled && d.configured);
  const check = useMutation({ mutationFn: () => api<InstagramConnectionCheck>(`/studio/instagram/${a.channelId}/check`, { method: "POST", body: { destinationId: dest!.id } }) });
  const verified = !check.isPending && !check.error && (check.isSuccess || connected);
  const status = check.isPending ? "확인 중" : check.error ? "재확인 필요" : verified ? "계정 확인 완료" : dest ? "확인 필요" : "연결 전";
  const displayUsername = check.data?.username || connectedUsername || a.expectedUsername;
  return <article className={`instagram-account stack ${verified ? "is-verified" : ""}`}>
    <div className="instagram-account-heading"><span className="instagram-channel-mark" aria-hidden>{a.channelName.slice(0, 1)}</span><div><strong>{a.channelName}</strong>{displayUsername ? <a href={`https://www.instagram.com/${encodeURIComponent(displayUsername)}/`} target="_blank" rel="noreferrer">@{displayUsername}</a> : <span className="small muted">게시할 계정을 연결해 주세요</span>}</div><span className={`instagram-state ${verified ? "is-ok" : check.error ? "is-error" : ""}`}>{status}</span></div>
    <p className="small instagram-account-status" role="status">{check.isPending ? "계정과 게시 권한을 확인하고 있어요…" : check.error ? "계정 연결을 확인하지 못했습니다. 아래 안내를 확인해 주세요." : verified ? `${displayUsername ? `@${displayUsername} · ` : ""}계정·게시 권한 확인 완료` : dest ? "연결 정보 저장됨 · 실제 계정 확인 필요" : workroom ? "저장된 계정 연결이 없습니다." : "게시할 계정으로 로그인하고 권한에 동의해 주세요."}</p>
    {dest && <p className="small muted">저장된 연결 이름: {dest.label}</p>}
    <div className="row instagram-account-actions">{dest && <button className="btn sm" disabled={check.isPending} onClick={() => { setConnected(false); check.reset(); check.mutate(); }}>{check.isPending ? "확인 중…" : "실제 계정 확인"}</button>}{!workroom && <button className={`btn sm ${dest ? "" : "primary"}`} aria-expanded={connecting} onClick={() => connecting ? guard.confirmLeave(() => setConnecting(false)) : setConnecting(true)}>{connecting ? "연결 입력 닫기" : dest ? "연결 정보 확인·갱신" : "이 계정 연결하기"}</button>}</div>
    {check.error && <ErrorBox error={check.error} />}
    {verified && check.data?.mediaHosting && !check.data.mediaHosting.ok && <div className="notice warn small">Instagram 계정은 확인했습니다. 이미지를 발행하려면 이미지 저장소 연결을 확인해 주세요. <GuardedLink href="/connections?service=cloudinary">이미지 저장소 설정</GuardedLink></div>}
    {verified && check.data?.checkedAt && <p className="small muted">마지막 확인 · {new Date(check.data.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}
    {!workroom && connecting && <InstagramConnect channelId={a.channelId} defaultUsername={a.expectedUsername} onConnected={result => { setConnectedUsername(result?.username ?? null); setConnecting(false); check.reset(); setConnected(true); onConnected(); }} />}
  </article>;
}

type InstagramConnectProps = { channelId: number; defaultUsername: string; onConnected: (result?: { username?: string }) => void };
export function InstagramConnect(props: InstagramConnectProps) {
  if (isPrivateWorkroom()) return <p className="small muted">비공개 작업실에서는 계정 연결 정보를 변경할 수 없어요.</p>;
  return <InstagramConnectForm {...props} />;
}

function InstagramConnectForm({ channelId, defaultUsername, onConnected }: InstagramConnectProps) {
  const config = useInstagramOAuthConfig();
  const guard = useDirtyGuard();
  const [username, setUsername] = useState(defaultUsername), [token, setToken] = useState("");
  const [authMode, setAuthMode] = useState<"facebook" | "instagram">("facebook");
  const [showToken, setShowToken] = useState<boolean | null>(null);
  const tokenFormOpen = showToken ?? (config.data?.configured === false || !!token.trim());
  const connect = useMutation({ mutationFn: () => api<{ username?: string }>(`/studio/instagram/${channelId}/connect`, { method: "POST", body: { username, token, authMode } }), onSuccess: result => { setToken(""); onConnected(result); } });
  const oauth = useMutation({ mutationFn: () => api<{ url: string }>(`/studio/instagram/${channelId}/oauth/start`, { method: "POST", body: !defaultUsername && username.trim() ? { username: username.trim().replace(/^@/, "") } : {} }), onSuccess: data => { window.location.assign(data.url); } });
  useEffect(() => { guard.setDirty(`instagram-token-${channelId}`, !!token.trim(), async () => { if (!token.trim() || !username) return false; try { await connect.mutateAsync(); return true; } catch { return false; } }); return () => guard.setDirty(`instagram-token-${channelId}`, false); }, [token, username, authMode, channelId, guard]);
  return <div className="studio-instagram-connect stack">
    <div className="instagram-connect-target"><span className="small muted">연결할 계정</span><strong>{defaultUsername || username ? `@${defaultUsername || username.replace(/^@/, "")}` : "로그인할 때 선택"}</strong></div>
    {!defaultUsername && <label className="field">연결할 인스타그램 계정<input value={username} autoComplete="off" placeholder="my.brand" disabled={connect.isPending || oauth.isPending} onChange={event => setUsername(event.target.value)} /><span className="hint">Meta에 연결된 계정이 여러 개라면 게시할 사용자 이름을 입력하세요. 로그인할 때 선택할 계정이 하나라면 비워 두어도 됩니다.</span></label>}
    {config.isLoading ? <p className="small muted">로그인 연결 준비 상태를 확인하고 있어요.</p> : config.data?.configured ? <><button className="btn primary" disabled={oauth.isPending || connect.isPending} onClick={() => guard.confirmLeave(() => oauth.mutate())}>{oauth.isPending ? "Instagram 여는 중…" : "Instagram으로 연결"}</button><p className="small muted">{defaultUsername ? "Meta 로그인 화면에서 위 계정을 선택해 주세요." : "Meta 로그인 화면에서 이 채널에 게시할 계정을 선택해 주세요."} 돌아오면 자동으로 연결을 확인합니다.</p></> : <p className="small muted">Meta에서 발급한 토큰을 아래에 넣으면 계정을 연결할 수 있어요. 앱 ID·시크릿·구성 ID는 필요하지 않아요.</p>}
    {config.error && <ErrorBox error={config.error} retry={() => config.refetch()} />}{oauth.error && <ErrorBox error={oauth.error} />}
    <button className="btn ghost sm instagram-token-toggle" aria-expanded={tokenFormOpen} onClick={() => setShowToken(!tokenFormOpen)}>{tokenFormOpen ? "토큰 입력 닫기" : "이미 발급한 토큰으로 연결"}</button>
    {tokenFormOpen && <form className="stack" onSubmit={e => { e.preventDefault(); if (token.trim() && username) connect.mutate(); }}>
      {defaultUsername && <label className="field">게시할 계정<input readOnly value={username} autoComplete="off" placeholder={defaultUsername} disabled={connect.isPending} /></label>}
      <label className="field">토큰 발급 방식<select value={authMode} disabled={connect.isPending} onChange={e => setAuthMode(e.target.value as typeof authMode)}><option value="facebook">Meta 통합 로그인</option><option value="instagram">Instagram 로그인 (이전 API)</option></select><span className="hint">{authMode === "facebook" ? "Meta 개발자 화면의 ‘통합된 로그인이 포함된 API 설정’에서 발급한 토큰에 사용합니다." : "Meta 개발자 화면의 ‘Instagram 로그인이 포함된 API 설정’에서 발급한 토큰에 사용합니다."}</span></label>
      <label className="field">Instagram 액세스 토큰<input type="password" value={token} autoComplete="off" spellCheck={false} disabled={connect.isPending} onChange={e => setToken(e.target.value)} /><span className="hint">토큰은 여기에만 입력하세요. 실제 계정과 게시 권한을 확인한 뒤 암호화해 저장합니다.</span></label>
      <button className="btn" disabled={connect.isPending || !username || !token.trim()}>{connect.isPending ? "계정 확인 중…" : "계정 확인하고 연결"}</button>
      {connect.error && <ErrorBox error={connect.error} />}
    </form>}
  </div>;
}
