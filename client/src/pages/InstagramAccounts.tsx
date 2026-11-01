import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expectedInstagramUsername, type InstagramAccountRow } from "@shared/channelInstagram";
import { api } from "../api";
import { ErrorBox, Loading } from "../ui";
import { isPrivateWorkroom } from "../workroom";

export function InstagramAccounts({ channelId, channel }: { channelId?: number; channel?: string }) {
  const workroom = isPrivateWorkroom();
  const expected = channel ? expectedInstagramUsername(channel) : null;
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api<{ accounts: InstagramAccountRow[] }>("/studio/instagram/accounts"), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["instagram-accounts"] }); qc.invalidateQueries({ queryKey: ["studio-publication"] }); qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["ch"] }); };
  return <section className="panel stack instagram-accounts" aria-label="채널별 인스타그램 연결">
    <div><h2>{workroom ? "게시 계정 확인" : "채널별 인스타그램 연결"}</h2><p className="muted small">{workroom ? "선택한 채널의 계정 주소와 실제 연결 상태를 확인하세요. 계정 연결 정보는 여기서 변경하지 않습니다." : "콘텐츠에서 고른 채널의 계정으로 발행합니다. 계정 주소와 발행 권한 연결 상태를 함께 확인하세요."}</p></div>
    {query.isLoading && <Loading lines={2} />}{query.error && <ErrorBox error={query.error} retry={() => query.refetch()} />}
    <div className="instagram-account-grid">{query.data?.accounts.filter(a => (!channelId || a.channelId === channelId) && (!channel || a.expectedUsername === expected)).map(a => <InstagramAccount key={a.channelId} account={a} onConnected={refresh} />)}</div>
    {channel && !expected && <p className="small muted">이 채널에는 지정된 인스타그램 계정이 없습니다.</p>}
  </section>;
}
function InstagramAccount({ account: a, onConnected }: { account: InstagramAccountRow; onConnected: () => void }) {
  const workroom = isPrivateWorkroom();
  const [connecting, setConnecting] = useState(false);
  const dest = a.destinations.find(d => d.enabled && d.configured);
  const check = useMutation({ mutationFn: () => api<{ username: string; checkedAt: string }>(`/studio/instagram/${a.channelId}/check`, { method: "POST", body: { destinationId: dest!.id } }) });
  return <article className="instagram-account stack">
    <strong>{a.channelName}</strong><a href={`https://www.instagram.com/${a.expectedUsername}/`} target="_blank" rel="noreferrer">@{a.expectedUsername}</a>
    <p className="small" role="status">{check.data ? `@${check.data.username} · 계정·게시 권한 확인 완료` : dest ? "연결 정보 저장됨 · 실제 계정 확인 필요" : workroom ? "저장된 계정 연결이 없습니다." : "발행 권한 연결 필요"}</p>
    {dest && <p className="small muted">저장된 연결 이름: {dest.label}</p>}
    <div className="row">{dest && <button className="btn sm" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "확인 중…" : "실제 계정 확인"}</button>}{!workroom && <button className="btn sm" aria-expanded={connecting} onClick={() => setConnecting(v => !v)}>{connecting ? "연결 입력 닫기" : dest ? "연결 정보 확인·갱신" : "이 계정 연결하기"}</button>}</div>
    {check.error && <ErrorBox error={check.error} />}
    {!workroom && connecting && <InstagramConnect channelId={a.channelId} defaultUsername={a.expectedUsername} onConnected={() => { setConnecting(false); check.reset(); onConnected(); }} />}
  </article>;
}

type InstagramConnectProps = { channelId: number; defaultUsername: string; onConnected: () => void };
export function InstagramConnect(props: InstagramConnectProps) {
  if (isPrivateWorkroom()) return <p className="small muted">비공개 작업실에서는 계정 연결 정보를 변경할 수 없어요.</p>;
  return <InstagramConnectForm {...props} />;
}
function InstagramConnectForm({ channelId, defaultUsername, onConnected }: InstagramConnectProps) {
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

