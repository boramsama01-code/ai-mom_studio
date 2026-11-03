import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, GuardedLink, Loading, Pager } from "../ui";
import type { Delivery } from "@shared/schema";
import type { PublicationOrphan } from "@shared/publicationReadiness";
import { deliveryState, PublicationRuntimeNotice, usePublicationRuntime } from "../publicationStatus";
import { DeliveryActions } from "../DeliveryActions";

type Row = { d: Delivery | null; dest: { label: string; platform: string } | null; ap: { id: number; scheduledAt: string; status: string; revisionId: number }; item: { id: number; title: string; channelId: number }; canonicalStudioCardId?: number | null; reason?: string };
type DeliveryRow = Row & { d: Delivery; dest: { label: string; platform: string } };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number; counts?: Record<string, number> };
type Orphan = PublicationOrphan & { canonicalStudioCardId?: number | null };
const PAGE_SIZE = 30;
function pageResult<T>(result: Page<T> | T[]): Page<T> {
  return Array.isArray(result) ? { items: result, total: result.length, page: 1, pageSize: PAGE_SIZE } : result;
}
function contentHref(row: Row) {
  return row.canonicalStudioCardId ? `/studio/${row.canonicalStudioCardId}?tab=delivery` : `/items/${row.item.channelId}/${row.item.id}?tab=delivery`;
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function kstYmd(d: Date) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
function rowState(row: Row) {
  if (row.d) return deliveryState(row.d.status, row.ap.scheduledAt, Date.now(), row.d.outcomeSource);
  return row.ap.status === "active"
    ? { label: "승인 저장됨 · 전송 예약 없음", detail: row.reason ?? "게시 계정·목적지 없이 승인만 저장된 기록입니다. 계정을 연결한 뒤 해당 콘텐츠에서 다시 승인해야 합니다.", tone: "warn" as const }
    : { label: row.ap.status === "cancelled" ? "승인 취소됨 · 전송 내역 없음" : "이전 승인 · 전송 내역 없음", detail: "이 승인에는 연결된 전송 기록이 없습니다. 현재 승인 상태는 콘텐츠의 전송 내역에서 확인하세요.", tone: "" as const };
}
export function PublishPage() {
  const { selected } = useChannel();
  const [view, setView] = useState<"calendar" | "list">("list");
  const [weekOffset, setWeekOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => { setPage(1); }, [selected, view, weekOffset]);
  const days = useMemo(() => {
    const start = new Date(Date.now() + weekOffset * 7 * 86400_000);
    return Array.from({ length: 7 }, (_, i) => kstYmd(new Date(start.getTime() + i * 86400_000)));
  }, [weekOffset]);
  const range = view === "calendar" ? { from: days[0], to: days[6] } : { from: from || undefined, to: to || undefined };
  const statusValue = statusFilter === "attention" ? "failed,unknown,dry_run" : statusFilter === "orphan" ? undefined : statusFilter || undefined;
  const status = usePublicationRuntime();
  const q = useQuery({ queryKey: ["ch", selected, "deliveries", statusValue, range.from, range.to, page], queryFn: async () => pageResult(await api<Page<DeliveryRow> | DeliveryRow[]>(`/deliveries?${qs({ channelId: selected, page, pageSize: PAGE_SIZE, status: statusValue, ...range })}`)), refetchInterval: query => query.state.data?.items.some(({ d }) => ["scheduled", "processing"].includes(d.status)) ? 5000 : false });
  const orphans = useQuery({ queryKey: ["ch", selected, "publication-orphans", range.from, range.to, statusFilter === "orphan" ? page : 1], queryFn: async () => pageResult(await api<Page<Orphan> | Orphan[]>(`/publication-orphans?${qs({ channelId: selected, page: statusFilter === "orphan" ? page : 1, pageSize: PAGE_SIZE, ...range })}`)) });
  const rows = useMemo<Row[]>(() => statusFilter === "orphan" ? (orphans.data?.items ?? []).map(row => ({ ...row, d: null, dest: null })) : q.data?.items ?? [], [statusFilter, q.data, orphans.data]);
  const overdue = q.data?.counts?.overdue ?? q.data?.items.filter(r => r.d.status === "scheduled" && new Date(r.ap.scheduledAt).getTime() < Date.now() - 60_000).length ?? 0;
  const needsAttention = q.data?.counts?.needsAttention ?? q.data?.items.filter(r => ["failed", "unknown", "dry_run"].includes(r.d.status)).length ?? 0;
  const orphanCount = orphans.data?.total ?? 0;
  const total = statusFilter === "orphan" ? orphanCount : q.data?.total ?? 0;
  const refreshing = q.isFetching || orphans.isFetching || status.isFetching;
  const refresh = () => { q.refetch(); orphans.refetch(); status.refetch(); };

  const today = kstYmd(new Date());
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = kstYmd(new Date(r.ap.scheduledAt));
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>발행함</h1>
          <p className="small muted" style={{ margin: 0 }}>바로 게시·예약 게시의 결과를 확인하고, 대기 건을 취소하거나 실패한 전송을 다시 보낼 수 있어요.</p>
        </div>
        <div className="tabs" role="tablist" style={{ margin: 0, border: 0 }}>
          <button role="tab" aria-selected={view === "calendar"} onClick={() => setView("calendar")}>
            주간 달력
          </button>
          <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")}>
            목록
          </button>
        </div>
      </div>
      <div className="stack" style={{ marginBottom: 16 }}>
        <PublicationRuntimeNotice runtime={status.data} error={status.error} retry={() => status.refetch()} />
        <div className="row between"><span className="small muted">조회 결과 총 {total}건 · 이 페이지 {rows.length}건 · 전송 예약 없음 {orphanCount}건 · 예약 시각 지난 대기 {overdue}건 · 실패·확인 필요·모의 실행 {needsAttention}건</span><button className="btn sm" disabled={refreshing} onClick={refresh}>{refreshing ? "상태 확인 중…" : "상태 새로고침"}</button></div>
        <div className="row publication-filters"><label className="field">전송 상태<select aria-label="전송 상태 필터" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="">전체 전송</option><option value="attention">실패·결과 확인 필요·모의 실행</option><option value="scheduled">예약 대기</option><option value="processing">전송 중</option><option value="succeeded">게시됨</option><option value="failed">실패</option><option value="unknown">결과 확인 필요</option><option value="cancelled">취소</option><option value="dry_run">모의 실행</option><option value="orphan">승인만 저장됨 · 전송 예약 없음</option></select></label>{view === "list" && <><label className="field">시작일 (한국 시간)<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label className="field">종료일 (한국 시간)<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></>}</div>
        {needsAttention > 0 && statusFilter !== "attention" && <div className="notice warn"><strong>확인하거나 복구할 전송이 {needsAttention}건 있습니다.</strong><div><button className="btn sm" onClick={() => { setStatusFilter("attention"); setPage(1); }}>실패·확인 필요부터 보기</button></div></div>}
        {orphans.error && <div><p className="small">승인만 저장된 기록을 불러오지 못했습니다.</p><ErrorBox error={orphans.error} retry={() => orphans.refetch()} /></div>}
        {orphanCount > 0 && <div className="notice warn"><strong>승인만 저장되고 전송 예약이 없는 콘텐츠가 {orphanCount}건 있습니다.</strong><p className="small">예약 시간이 지나도 자동 게시되지 않습니다. 게시 계정을 연결하고 해당 콘텐츠에서 다시 승인해 주세요.</p><GuardedLink href="/instagram">인스타그램 연결 확인 →</GuardedLink><button className="btn sm" onClick={() => { setView("list"); setStatusFilter("orphan"); setPage(1); }}>승인만 저장된 기록 보기</button></div>}
        {overdue > 0 && <div className="notice warn"><strong>예약 시각이 지났지만 아직 전송하지 않은 건이 {overdue}건 있습니다.</strong><p className="small">예약 시간이 지났다는 이유만으로 게시 완료가 되지 않습니다. 전송 상태에서 계정·권한 오류와 실행 상황을 확인하세요.</p><button className="btn sm" onClick={() => { setView("list"); setStatusFilter("scheduled"); setTo(today); setFrom(""); setPage(1); }}>지난 예약을 포함한 목록 보기</button></div>}
      </div>
      {q.isLoading || orphans.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !rows.length ? (
        <Empty>
          {orphans.error ? "전송 내역은 없으며, 승인만 저장된 기록은 아직 확인하지 못했습니다." : "선택한 채널에 전송 예약이 없습니다."} 게시 후 결과와 예약은 여기에 표시됩니다. 게시 계정은 <GuardedLink href="/instagram">인스타그램 연결</GuardedLink>에서 확인할 수 있습니다.
        </Empty>
      ) : view === "calendar" ? (
        <div className="stack">
          <div className="row between">
            <button className="btn sm" onClick={() => setWeekOffset((w) => w - 1)}>
              ← 이전 주
            </button>
            <strong className="small">
              {days[0]} ~ {days[6]}
            </strong>
            <button className="btn sm" onClick={() => setWeekOffset((w) => w + 1)}>
              다음 주 →
            </button>
          </div>
          <div className="cal">
            {days.map((day) => {
              const rows = byDay.get(day) ?? [];
              const wd = WD[new Date(`${day}T00:00:00Z`).getUTCDay()];
              return (
                <div key={day} className={`cal-day ${day === today ? "today" : ""}`}>
                  <h4>
                    <span>
                      {day.slice(5)} ({wd})
                    </span>
                    {day === today && <span style={{ color: "var(--accent)" }}>오늘</span>}
                  </h4>
                  {rows.length ? (
                    rows.map((r) => (
                      <GuardedLink key={r.d?.id ?? `approval-${r.ap.id}`} href={contentHref(r)} className="cal-ev">
                        <span className="small muted">{fmtDate(r.ap.scheduledAt).slice(11)} · {r.dest?.label ?? "전송 목적지 없음"}</span>
                        <br />
                        {r.item.title}
                        <br />
                        <Badge kind={rowState(r).tone}>{rowState(r).label}</Badge>
                      </GuardedLink>
                    ))
                  ) : (
                    <span className="small muted">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="list">
          {rows.map((r) => {
            const state = rowState(r);
            return (
            <li key={r.d?.id ?? `approval-${r.ap.id}`} className="list-item">
              <GuardedLink href={contentHref(r)} className="title">
                {r.item.title}
              </GuardedLink>
              <div className="row small">
                <span>{r.dest?.label ?? "전송 목적지 없음"}</span>
                <Badge kind={state.tone}>{state.label}</Badge>
                <span className="muted">전송 시각 {fmtDate(r.ap.scheduledAt)}</span>
                {r.d?.completedAt && <span className="muted">처리 기록 {fmtDate(r.d.completedAt as unknown as string)}</span>}
                {r.d?.externalUrl && (
                  <a href={r.d.externalUrl} target="_blank" rel="noopener noreferrer">
                    게시물 보기
                  </a>
                )}
              </div>
              <p className="small muted">{state.detail}</p>
              {r.d?.lastError && <p className="small" role={r.d.status === "failed" ? "alert" : undefined}><strong>처리 사유: </strong>{r.d.lastError}</p>}
              <DeliveryActions channelId={r.item.channelId} approvalId={r.ap.id} approvalStatus={r.ap.status} delivery={r.d ?? undefined} contentHref={contentHref(r)} onChanged={refresh} />
              <GuardedLink className="small" href={contentHref(r)}>이 콘텐츠 전송 내역 보기 →</GuardedLink>
            </li>
          ); })}
        </ul>
      )}
      <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </>
  );
}
