import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstagramAccountRow } from "@shared/channelInstagram";
import { api } from "../api";
import { ErrorBox, Loading } from "../ui";

export function InstagramAccounts({ channelId }: { channelId?: number }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api<{ accounts: InstagramAccountRow[] }>("/studio/instagram/accounts"), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["instagram-accounts"] }); qc.invalidateQueries({ queryKey: ["studio-publication"] }); qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["ch"] }); };
  return <section className="panel stack instagram-accounts" aria-label="채널별 인스타그램 연결">
    <div><h2>채널별 인스타그램 연결</h2><p className="muted small">콘텐츠에서 고른 채널의 계정으로 발행합니다. 계정 주소와 발행 권한 연결 상태를 함께 확인하세요.</p></div>
    {query.isLoading && <Loading lines={2} />}{query.error && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    <div className="instagram-account-grid">{query.data?.accounts.filter(a => !channelId || a.channelId === channelId).map(a => <InstagramAccount key={a.channelId} account={a} onConnected={refresh} />)}</div>
  </section>;
}
function InstagramAccount({ account: a, onConnected }: { account: InstagramAccountRow; onConnected: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const dest = a.destinations.find(d => d.enabled && d.configured);
  const check = useMutation({ mutationFn: () => api<{ username: string; checkedAt: string }>(`/studio/instagram/${a.channelId}/check`, { method: "POST", body: { destinationId: dest!.id } }) });
  return <article className="instagram-account stack">
    <strong>{a.channelName}</strong><a href={`https://www.instagram.com/${a.expectedUsername}/`} target="_blank" rel="noreferrer">@{a.expectedUsername}</a>
    <p className="small" role="status">{check.data ? `@${check.data.username} · 계정·게시 권한 확인 완료` : dest ? "연결 정보 저장됨 · 실제 계정 확인 필요" : "발행 권한 연결 필요"}</p>
    {dest && <p className="small muted">저장된 연결 이름: {dest.label}</p>}
    <div className="row">{dest && <button className="btn sm" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "확인 중…" : "실제 계정 확인"}</button>}<button className="btn sm" aria-expanded={connecting} onClick={() => setConnecting(v => !v)}>{connecting ? "연결 입력 닫기" : dest ? "연결 정보 확인·갱신" : "이 계정 연결하기"}</button></div>
    {check.error && <ErrorBox error={check.error} />}
    {connecting && <InstagramConnect channelId={a.channelId} defaultUsername={a.expectedUsername} onConnected={() => { setConnecting(false); check.reset(); onConnected(); }} />}
  </article>;
}

export function InstagramConnect({ channelId, defaultUsername, onConnected }: { channelId: number; defaultUsername: string; onConnected: () => void }) {
  const [username, setUsername] = useState(defaultUsername), [token, setToken] = useState("");
  const [dailyLimit, setDailyLimit] = useState(3);
  const connect = useMutation({ mutationFn: () => api(`/studio/instagram/${channelId}/connect`, { method: "POST", body: { username, token, dailyLimit } }), onSuccess: () => { setToken(""); onConnected(); } });
  return <details className="studio-instagram-connect" open><summary>인스타그램 계정 연결</summary><div className="stack">
    <p className="small">프로페셔널 계정의 Instagram Login 토큰으로 연결합니다. 계정 ID는 자동으로 확인합니다.</p>
    <label className="field">게시할 계정<input readOnly={!!defaultUsername} value={username} autoComplete="off" placeholder="spacepenguin.co" disabled={connect.isPending} onChange={e => setUsername(e.target.value)} /></label>
    <label className="field">Instagram 액세스 토큰<input type="password" value={token} autoComplete="off" disabled={connect.isPending} onChange={e => setToken(e.target.value)} /><span className="hint">Meta 앱에서 instagram_business_basic · instagram_business_content_publish 권한으로 발급한 값을 이 입력칸에만 넣으세요. 저장 후에는 표시하지 않습니다.</span></label>
    <label className="field">하루 발행 한도<input type="number" min={1} max={25} value={dailyLimit} disabled={connect.isPending} onChange={e => setDailyLimit(Number(e.target.value))} /></label>
    <button className="btn" disabled={connect.isPending || !username || !token || dailyLimit < 1} onClick={() => connect.mutate()}>{connect.isPending ? "계정 확인 중…" : "계정 확인하고 연결"}</button>
    {connect.error && <ErrorBox error={connect.error} />}
  </div></details>;
}

