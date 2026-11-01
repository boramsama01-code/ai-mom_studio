import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudioCard } from "@shared/studio";
import type { StudioPublishPreview, StudioPublishStatus } from "@shared/studioPublish";
import { api } from "../api";
import { ErrorBox, GuardedLink } from "../ui";
import { useToast } from "../toast";

const deliveryLabel: Record<string, string> = { scheduled: "발행 대기", processing: "인스타그램 처리 중", succeeded: "발행 완료", failed: "발행 실패", unknown: "게시 여부 확인 필요", cancelled: "취소됨", dry_run: "모의 실행" };
export function StudioPublish({ base, dirty, busy, save }: { base: StudioCard; dirty: boolean; busy: boolean; save: () => Promise<StudioCard> }) {
  const qc = useQueryClient(), toast = useToast();
  const [preview, setPreview] = useState<StudioPublishPreview | null>(null);
  const [page, setPage] = useState(0), [destinationId, setDestinationId] = useState(0);
  const [reviewed, setReviewed] = useState(false), [schedule, setSchedule] = useState("");
  const [timing, setTiming] = useState<"now" | "later">("now");
  const status = useQuery({ queryKey: ["studio-publication", base.id], queryFn: () => api<StudioPublishStatus>(`/studio/cards/${base.id}/publication`), refetchInterval: query => query.state.data?.deliveries.some(d => ["scheduled", "processing"].includes(d.status)) ? 5000 : false });
  useEffect(() => { if (!destinationId) setDestinationId(status.data?.destinations.find(d => d.enabled && d.configured)?.id ?? 0); }, [status.data, destinationId]);
  useEffect(() => setReviewed(false), [dirty, base.version, destinationId, timing, schedule]);
  const prepare = useMutation({ mutationFn: async () => {
    const saved = await save();
    return api<StudioPublishPreview>(`/studio/cards/${base.id}/publication/prepare`, { method: "POST", body: { version: saved.version } });
  }, onSuccess: p => { setPreview(p); setPage(0); setReviewed(false); qc.invalidateQueries({ queryKey: ["studio"] }); } });
  const check = useMutation({ mutationFn: () => api<{ username: string; checkedAt: string }>(`/studio/instagram/${status.data!.channelId}/check`, { method: "POST", body: { destinationId } }) });
  const approve = useMutation({ mutationFn: async () => {
    if (!preview || dirty || preview.version !== base.version || !reviewed) throw new Error("최신 이미지와 캡션을 확인해 주세요.");
    // Re-check credentials/identity immediately before creating the approval.
    await check.mutateAsync();
    return api(`/studio/cards/${base.id}/publication/approve`, { method: "POST", body: { version: preview.version, assetId: preview.assetId, destinationId, scheduledAt: timing === "later" ? new Date(`${schedule}:00+09:00`).toISOString() : new Date().toISOString() } });
  }, onSuccess: () => { setReviewed(false); toast("ok", timing === "later" ? "예약했습니다. 발행 상태를 아래에서 확인하세요." : "발행을 요청했습니다. 완료되면 게시물 링크가 표시됩니다."); status.refetch(); qc.invalidateQueries({ queryKey: ["ch"] }); } });
  const stale = dirty || preview?.version !== base.version;
  const disabled = busy || prepare.isPending || approve.isPending;
  return <section className="panel stack studio-publication" aria-label="인스타그램 발행">
    <div><span className="studio-eyebrow">PUBLISH</span><h2>인스타그램에 발행</h2><p className="small muted">이미지·순서·캡션을 확인하고 승인하면 하나의 게시물로 올립니다.</p></div>
    {status.error && <ErrorBox error={status.error} retry={() => status.refetch()} />}
    {status.data && <>
      {!!status.data.blockers.length && <div className="notice warn"><ul>{status.data.blockers.map(b => <li key={b}>{b}</li>)}</ul><GuardedLink href="/connections">API 키 관리</GuardedLink></div>}
      {!status.data.destinations.some(d => d.enabled && d.configured) && <InstagramConnect channelId={status.data.channelId} defaultUsername={base.channel === "penguin" ? "spacepenguin.co" : ""} onConnected={() => { status.refetch(); qc.invalidateQueries({ queryKey: ["secrets"] }); }} />}
      <label className="field">게시 계정<select value={destinationId} disabled={disabled} onChange={e => { setDestinationId(Number(e.target.value)); check.reset(); }}><option value={0}>계정을 선택하세요</option>{status.data.destinations.filter(d => d.enabled && d.configured).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      {destinationId > 0 && <div className="row"><button className="btn sm" disabled={disabled || check.isPending} onClick={() => check.mutate()}>계정·연결 확인</button>{check.data && <span className="small">@{check.data.username} 확인됨</span>}</div>}
      {check.error && <ErrorBox error={check.error} />}
    </>}
    <button className="btn" disabled={disabled} onClick={() => prepare.mutate()}>{prepare.isPending ? "최종 이미지 준비 중…" : "저장하고 발행 미리보기"}</button>
    {prepare.error && <ErrorBox error={prepare.error} />}
    {preview && (stale ? <p className="notice warn">수정한 내용이 있습니다. 발행 미리보기를 다시 준비하세요.</p> : <>
      <div className="studio-publish-preview"><img src={`/api/channels/${preview.channelId}/media/${preview.pages[page]?.id}`} alt={preview.pages[page]?.altText || `${page + 1}페이지`} /><div className="row"><button className="btn sm" disabled={!page} onClick={() => setPage(p => p - 1)}>← 이전</button><div className="page-dots" role="group" aria-label="페이지 선택">{preview.pages.map((p,i)=><button key={p.id} className={i<=page?"filled":""} aria-label={`${i+1}페이지`} aria-current={i===page?"step":undefined} onClick={()=>setPage(i)} />)}</div><button className="btn sm" disabled={page === preview.pages.length - 1} onClick={() => setPage(p => p + 1)}>다음 →</button></div></div>
      <div className="studio-caption-proof"><strong>게시할 캡션</strong><p>{preview.caption}</p></div>
      <label className="field">발행 시점<select value={timing} disabled={disabled} onChange={e => setTiming(e.target.value as "now" | "later")}><option value="now">승인 후 바로 발행</option><option value="later">예약 발행</option></select></label>
      {timing === "later" && <label className="field">예약 시간 (한국 시간)<input type="datetime-local" value={schedule} disabled={disabled} onChange={e => setSchedule(e.target.value)} /><span className="hint">예약 시각 이후 작업 실행 시 발행됩니다. 서버가 쉬는 동안에는 정기 실행 시점까지 늦어질 수 있습니다.</span></label>}
      <label className="row"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={e => setReviewed(e.target.checked)} />{preview.pages.length}장 전체와 순서, 캡션, 게시 계정을 확인했습니다.</label>
      <button className="btn primary" disabled={disabled || !reviewed || !status.data?.ready || !destinationId || (timing === "later" && !schedule)} onClick={() => approve.mutate()}>{approve.isPending ? "계정 확인·발행 요청 중…" : timing === "later" ? "이 이미지와 캡션으로 예약 승인" : "이 이미지와 캡션으로 발행 승인"}</button>
      {approve.error && <ErrorBox error={approve.error} />}
    </>)}
    {!!status.data?.deliveries.length && <div className="stack" aria-live="polite"><h3>발행 상태</h3>{status.data.deliveries.map(d => <div className="notice" key={d.id}><strong>{deliveryLabel[d.status] ?? d.status}</strong>{d.lastError && <p className="small">{d.lastError}</p>}{d.externalUrl && <a href={d.externalUrl} target="_blank" rel="noreferrer">인스타그램 게시물 보기 ↗</a>}</div>)}<GuardedLink href="/publish">발행함 전체 보기 →</GuardedLink></div>}
  </section>;
}

function InstagramConnect({ channelId, defaultUsername, onConnected }: { channelId: number; defaultUsername: string; onConnected: () => void }) {
  const [username, setUsername] = useState(defaultUsername), [token, setToken] = useState("");
  const [dailyLimit, setDailyLimit] = useState(3);
  const connect = useMutation({ mutationFn: () => api(`/studio/instagram/${channelId}/connect`, { method: "POST", body: { username, token, dailyLimit } }), onSuccess: () => { setToken(""); onConnected(); } });
  return <details className="studio-instagram-connect" open><summary>인스타그램 계정 연결</summary><div className="stack">
    <p className="small">프로페셔널 계정의 Instagram Login 토큰으로 연결합니다. 계정 ID는 자동으로 확인합니다.</p>
    <label className="field">게시할 계정<input value={username} autoComplete="off" placeholder="spacepenguin.co" disabled={connect.isPending} onChange={e => setUsername(e.target.value)} /></label>
    <label className="field">Instagram 액세스 토큰<input type="password" value={token} autoComplete="off" disabled={connect.isPending} onChange={e => setToken(e.target.value)} /><span className="hint">Meta 앱에서 instagram_business_basic · instagram_business_content_publish 권한으로 발급한 값을 이 입력칸에만 넣으세요. 저장 후에는 표시하지 않습니다.</span></label>
    <label className="field">하루 발행 한도<input type="number" min={1} max={25} value={dailyLimit} disabled={connect.isPending} onChange={e => setDailyLimit(Number(e.target.value))} /></label>
    <button className="btn" disabled={connect.isPending || !username || !token || dailyLimit < 1} onClick={() => connect.mutate()}>{connect.isPending ? "계정 확인 중…" : "계정 확인하고 연결"}</button>
    {connect.error && <ErrorBox error={connect.error} />}
  </div></details>;
}
