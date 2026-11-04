import { InstagramAccounts, InstagramConnect } from "./InstagramAccounts";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudioCard } from "@shared/studio";
import type { StudioPublishPreview, StudioPublishStatus } from "@shared/studioPublish";
import { api } from "../api";
import { Badge, ErrorBox, fmtDate, GuardedLink } from "../ui";
import { useToast } from "../toast";
import { isPrivateWorkroom } from "../workroom";
import { deliveryState, publicationMode, PublicationRuntimeNotice, usePublicationRuntime, type PublicationRuntime } from "../publicationStatus";
import { DeliveryActions } from "../DeliveryActions";
import { usePublicationRequestId } from "../usePublicationRequestId";
import { useStudioPublicationDraft } from "../usePublicationDraft";
import { PublicationDraftControls } from "../PublicationDraftControls";
import { publicationKstDate } from "@shared/publicationDraft";

type StudioPublishProps = { base: StudioCard; dirty: boolean; busy: boolean; save: () => Promise<StudioCard>; onBusyChange?: (busy: boolean) => void };
export function StudioPublish(props: StudioPublishProps) {
  if (isPrivateWorkroom()) return <section className="stack studio-workroom" aria-label="비공개 초안 작업실">
    <div className="notice"><strong>초안 작업실</strong><p className="small">이미지·캡션·대체텍스트를 편집하고 저장할 수 있어요. 외부 발행은 잠겨 있으며, 아래에서 게시 계정과 연결 상태를 확인할 수 있어요.</p></div>
    <InstagramAccounts channel={props.base.channel} />
  </section>;
  return <PublicationEditor {...props} />;
}
function PublicationEditor({ base, dirty, busy, save, onBusyChange }: StudioPublishProps) {
  const qc = useQueryClient(), toast = useToast();
  const latest = useRef({ base, dirty, save }); latest.current = { base, dirty, save };
  const [preview, setPreview] = useState<StudioPublishPreview | null>(null);
  const [page, setPage] = useState(0), [reviewed, setReviewed] = useState(false);
  const runtime = usePublicationRuntime();
  const publicationRequestId = usePublicationRequestId();
  const status = useQuery({ queryKey: ["studio-publication", base.id, base.channel], queryFn: () => api<StudioPublishStatus>(`/studio/cards/${base.id}/publication`), refetchInterval: query => query.state.data?.deliveries.some(d => ["scheduled", "processing"].includes(d.status)) ? 5000 : false });
  const availableDestinations = status.data?.destinations.filter(d => d.enabled && d.configured) ?? [];
  const preparation = useStudioPublicationDraft(base.id, base.channel, status.data?.publicationDraft ?? { version: 0 }, {
    destinationIds: availableDestinations.length === 1 ? [availableDestinations[0].id] : [], timing: "now", scheduledAtKst: "",
  }, !!status.data);
  const { timing, scheduledAtKst: schedule, destinationIds } = preparation.options;
  const destinationId = destinationIds[0] ?? 0;
  const setDestinationId = (id: number) => preparation.setOptions({ ...preparation.options, destinationIds: id ? [id] : [] });
  const setTiming = (value: "now" | "later") => preparation.setOptions({ ...preparation.options, timing: value });
  const setSchedule = (value: string) => preparation.setOptions({ ...preparation.options, scheduledAtKst: value });
  const unavailableDestination = destinationIds.length > 1 || (destinationId > 0 && !availableDestinations.some(d => d.id === destinationId));
  const scheduleDate = publicationKstDate(schedule);
  const futureSchedule = timing === "now" || (!!scheduleDate && scheduleDate.getTime() > Date.now());
  const deliveryRegion = useRef<HTMLDivElement>(null);
  const openedDeliveryFor = useRef<number | null>(null);
  const unresolved = status.data?.deliveries.some(delivery => delivery.status === "processing" || delivery.status === "unknown" || delivery.needsReconciliation);
  useEffect(() => {
    if (status.data && openedDeliveryFor.current !== base.id && new URLSearchParams(window.location.search).get("tab") === "delivery") {
      openedDeliveryFor.current = base.id;
      deliveryRegion.current?.scrollIntoView({ block: "start" });
    }
  }, [base.id, status.data]);
  const publicationRuntime: PublicationRuntime | undefined = status.data ? { ...runtime.data, integrations: { flags: { dryRun: status.data.dryRun, autoPublish: status.data.autoPublish } } } : runtime.data;
  useEffect(() => setReviewed(false), [dirty, base.version, destinationId, timing, schedule, preparation.version, preparation.dirty, preparation.recovery.pending]);
  const prepare = useMutation({ mutationFn: async () => {
    if (!status.data) throw new Error("게시 설정을 불러온 뒤 다시 시도해 주세요.");
    await preparation.save();
    const saved = await latest.current.save();
    return api<StudioPublishPreview>(`/studio/cards/${base.id}/publication/prepare`, { method: "POST", body: { version: saved.version } });
  }, onSuccess: p => { setPreview(p); setPage(0); setReviewed(false); qc.invalidateQueries({ queryKey: ["studio"] }); } });
  const check = useMutation({ mutationFn: () => api<{ username: string; checkedAt: string }>(`/studio/instagram/${status.data!.channelId}/check`, { method: "POST", body: { destinationId } }) });
  useEffect(() => { check.reset(); }, [base.channel, destinationId]);
  const approve = useMutation({ mutationFn: async () => {
    if (!preview || latest.current.dirty || preview.version !== latest.current.base.version || !reviewed) throw new Error("최신 이미지와 캡션을 확인해 주세요.");
    if (preparation.needsSave || preparation.saving || preparation.conflict || preparation.recovery.pending || unavailableDestination || !futureSchedule) throw new Error("게시 준비를 저장하고 선택한 계정과 시각을 다시 확인해 주세요.");
    if (unresolved) throw new Error("이 콘텐츠의 이전 전송 결과를 먼저 확인해 주세요.");
    // The approval endpoint verifies the account and saved version under its own
    // transaction. Do not await a duplicate client check with a stale edit snapshot.
    const intent = { version: preview.version, assetId: preview.assetId, destinationId, publicationDraftVersion: preparation.version, timing, scheduledAt: timing === "later" ? scheduleDate!.toISOString() : undefined };
    return api<{ timing: "now" | "later"; workerStarted: boolean }>(`/studio/cards/${base.id}/publication/approve`, { method: "POST", body: { ...intent, requestId: publicationRequestId({ ...intent, cancelledDeliveries: status.data?.deliveries.filter(delivery => delivery.status === "cancelled").map(delivery => delivery.id).sort((a, b) => a - b) ?? [] }) } });
  }, onSuccess: result => { publicationRequestId.complete(); setReviewed(false); toast("info", result.timing === "later" ? "예약을 저장했습니다. 예약 시각 이후 전송 결과를 확인해 주세요." : result.workerStarted ? "바로 게시를 요청했습니다. 아래에서 실제 게시 결과를 확인해 주세요." : "게시 요청을 저장했습니다. 전송 대기 상태이며 실행기에서 처리한 결과가 아래에 표시됩니다."); status.refetch(); qc.invalidateQueries({ queryKey: ["ch"] }); } });
  const stale = dirty || preview?.version !== base.version;
  useEffect(() => { onBusyChange?.(prepare.isPending || approve.isPending); }, [prepare.isPending, approve.isPending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const disabled = busy || !status.data || prepare.isPending || approve.isPending || preparation.saving || !!preparation.recovery.pending;
  return <section className="panel stack studio-publication" aria-label="인스타그램 발행">
    <div><span className="studio-eyebrow">PUBLISH</span><h2>인스타그램에 게시</h2><p className="small muted">이미지와 캡션을 확인한 뒤 바로 게시하거나 원하는 시간에 예약하세요.</p></div>
    {status.error && <ErrorBox error={status.error} retry={() => status.refetch()} />}
    {status.data && <>
      <p className="notice studio-account-route"><strong>{status.data.channelName}</strong> → {status.data.expectedUsername ? <a href={`https://www.instagram.com/${status.data.expectedUsername}/`} target="_blank" rel="noreferrer">@{status.data.expectedUsername}</a> : "게시 계정을 선택하세요"}<br/><GuardedLink className="small" href="/instagram">채널별 인스타그램 연결 관리 →</GuardedLink></p>
      <PublicationRuntimeNotice runtime={publicationRuntime} />
      {!!status.data.blockers.length && <div className="notice warn"><ul>{status.data.blockers.map(b => <li key={b}>{b}</li>)}</ul><GuardedLink href="/connections">API 키 관리</GuardedLink></div>}
      {!status.data.destinations.some(d => d.enabled && d.configured) && <InstagramConnect key={status.data.channelId} channelId={status.data.channelId} defaultUsername={status.data.expectedUsername ?? ""} onConnected={() => { status.refetch(); qc.invalidateQueries({ queryKey: ["instagram-accounts"] }); qc.invalidateQueries({ queryKey: ["secrets"] }); }} />}
      <label className="field">게시 계정<select value={destinationId} disabled={disabled} onChange={e => { setDestinationId(Number(e.target.value)); check.reset(); }}><option value={0}>계정을 선택하세요</option>{unavailableDestination && <option value={destinationId}>저장한 계정 #{destinationId} · 연결 확인 필요</option>}{availableDestinations.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      {unavailableDestination && <p className="notice warn small">저장한 게시 계정을 사용할 수 없습니다. 계정을 다시 연결하거나 다른 계정을 선택해 저장해 주세요.</p>}
      {destinationId > 0 && <div className="row"><button className="btn sm" disabled={disabled || check.isPending} onClick={() => check.mutate()}>계정·연결 확인</button>{check.isSuccess && check.data && <span className="small">@{check.data.username} 확인됨</span>}</div>}
      {check.error && <ErrorBox error={check.error} />}
    </>}
    <div className="row" role="group" aria-label="게시 시점"><button type="button" className={`btn${timing === "now" ? " primary" : ""}`} aria-pressed={timing === "now"} disabled={disabled} onClick={() => setTiming("now")}>바로 게시</button><button type="button" className={`btn${timing === "later" ? " primary" : ""}`} aria-pressed={timing === "later"} disabled={disabled} onClick={() => setTiming("later")}>예약 게시</button></div>
    {timing === "later" && <label className="field">예약 시간 (한국 시간)<input type="datetime-local" value={schedule} disabled={disabled} onChange={e => setSchedule(e.target.value)} /><span className="hint">예약 시각 이후 작업 실행 시 발행됩니다. 서버가 쉬는 동안에는 정기 실행 시점까지 늦어질 수 있습니다.</span>{!futureSchedule && <span className="card-copy-error">예약을 요청할 때는 현재보다 뒤의 시간을 선택해 주세요. 입력 중인 시각도 초안으로 저장할 수 있습니다.</span>}</label>}
    {preparation.dirty && status.data?.deliveries.some(d => d.status === "scheduled") && <p className="notice warn small">게시 준비를 저장하면 기존 대기 예약이 해제됩니다. 저장한 내용을 확인한 뒤 다시 승인해 주세요.</p>}
    <PublicationDraftControls draft={preparation} destinations={status.data?.destinations ?? []} disabled={busy || prepare.isPending || approve.isPending || !status.data} />
    <button className="btn" disabled={disabled || !status.data || !!preparation.conflict} onClick={() => prepare.mutate()}>{prepare.isPending ? "최종 이미지 준비 중…" : "저장하고 발행 미리보기"}</button>
    {prepare.error && <ErrorBox error={prepare.error} />}
    {preview && (stale ? <p className="notice warn">수정한 내용이 있습니다. 발행 미리보기를 다시 준비하세요.</p> : <>
      <div className="studio-publish-preview"><img src={`/api/channels/${preview.channelId}/media/${preview.pages[page]?.id}`} alt={preview.pages[page]?.altText || `${page + 1}페이지`} /><div className="row"><button className="btn sm" disabled={!page} onClick={() => setPage(p => p - 1)}>← 이전</button><div className="page-dots" role="group" aria-label="페이지 선택">{preview.pages.map((p,i)=><button key={p.id} className={i<=page?"filled":""} aria-label={`${i+1}페이지`} aria-current={i===page?"step":undefined} onClick={()=>setPage(i)} />)}</div><button className="btn sm" disabled={page === preview.pages.length - 1} onClick={() => setPage(p => p + 1)}>다음 →</button></div></div>
      <div className="studio-caption-proof"><strong>게시할 캡션</strong><p>{preview.caption}</p></div>
      {preparation.needsSave && <p className="notice warn small">게시 계정·시각을 바꿨습니다. 게시 준비를 저장한 뒤 최종 확인해 주세요.</p>}
      <label className="check"><input type="checkbox" checked={reviewed} disabled={disabled || preparation.needsSave || !!preparation.conflict || unavailableDestination} onChange={e => setReviewed(e.target.checked)} />{preview.pages.length}장 전체와 순서, 캡션, 게시 계정을 확인했습니다.</label>
      {unresolved && <p className="notice warn">이 콘텐츠의 이전 전송 결과를 먼저 확인해 주세요. 초안은 계속 편집할 수 있습니다.</p>}
      <button className="btn primary" disabled={disabled || unresolved || !reviewed || preparation.needsSave || !!preparation.conflict || unavailableDestination || !status.data?.ready || publicationMode(publicationRuntime).blocked || !destinationId || !futureSchedule} onClick={() => approve.mutate()}>{approve.isPending ? "계정 확인·게시 요청 중…" : timing === "later" ? "확인한 내용 예약 게시" : "확인한 내용 바로 게시"}</button>
      {approve.error && <ErrorBox error={approve.error} />}
    </>)}
    <div className="stack" ref={deliveryRegion} aria-live="polite" aria-label="전송 상태"><div className="row between"><h3>전송 상태</h3><button className="btn sm" disabled={status.isFetching || runtime.isFetching} onClick={() => { status.refetch(); runtime.refetch(); }}>상태 새로고침</button></div>{status.data?.deliveries.length ? status.data.deliveries.map(d => { const state = deliveryState(d.status, d.scheduledAt, Date.now(), d.outcomeSource, d.needsReconciliation); return <div className={`notice ${state.tone}`} key={d.id}><Badge kind={state.tone}>{state.label}</Badge><p className="small muted">전송 시각 {fmtDate(d.scheduledAt)} (한국 시간)</p><p className="small">{state.detail}</p>{d.lastError && <p className="small" role={d.status === "failed" ? "alert" : undefined}><strong>처리 사유: </strong>{d.lastError}</p>}{d.externalUrl && <a href={d.externalUrl} target="_blank" rel="noreferrer">인스타그램 게시물 보기 ↗</a>}<DeliveryActions channelId={status.data!.channelId} approvalId={d.approvalId} approvalStatus={d.approvalStatus} delivery={d} contentHref={`/studio/${base.id}`} canRetry={status.data?.ready && !publicationMode(publicationRuntime).blocked} onChanged={() => status.refetch()} /></div>; }) : <p className="small muted">아직 게시 요청이 없습니다. 바로 게시하거나 예약하면 이곳에서 실제 게시 결과를 확인할 수 있습니다.</p>}<GuardedLink href="/publish">발행함 전체 보기 →</GuardedLink></div>
  </section>;
}
