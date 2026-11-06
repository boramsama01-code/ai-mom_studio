import { useEffect, useMemo, useState, type SetStateAction } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, GuardedLink, Loading, Pager } from "../ui";
import type { Delivery } from "@shared/schema";
import type { PublicationOrphan } from "@shared/publicationReadiness";
import { deliveryState, PublicationRuntimeNotice, usePublicationRuntime } from "../publicationStatus";
import { DeliveryActions } from "../DeliveryActions";
import { WorkModeControl, type WorkMode } from "../WorkModeControl";
import { canOrganizePublication, publicationListLabels, publicationListState, publicationListStates, type PublicationListState } from "@shared/publicationList";
import { PublicationListActions, usePublicationOrganization } from "../PublicationListActions";
import "../publicationList.css";
import { useListContext, useListScroll } from "../useListContext";

type Row = { d: Delivery | null; dest: { label: string; platform: string } | null; ap: { id: number; scheduledAt: string; status: string; revisionId: number }; item: { id: number; title: string; channelId: number }; canonicalStudioCardId?: number | null; reason?: string };
type DeliveryRow = Row & { d: Delivery; dest: { label: string; platform: string } };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number; counts?: Record<string, number> };
type Orphan = PublicationOrphan & { canonicalStudioCardId?: number | null };
const PAGE_SIZE = 30;
const publishContextSchema = z.object({
  workMode: z.enum(["auto", "manual"]), view: z.enum(["calendar", "list"]), weekOffset: z.number().int().min(-52000).max(52000), page: z.number().int().positive(),
  statusFilter: z.enum(["", "attention", "orphan", "scheduled", "processing", "succeeded", "failed", "unknown", "cancelled", "dry_run"]),
  listView: z.enum(publicationListStates), from: z.string(), to: z.string(),
});
type PublishContext = z.infer<typeof publishContextSchema>;
const publishDefaults: PublishContext = { workMode: "auto", view: "list", weekOffset: 0, page: 1, statusFilter: "", listView: "active", from: "", to: "" };
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
  if (row.d) return deliveryState(row.d.status, row.ap.scheduledAt, Date.now(), row.d.outcomeSource, row.d.needsReconciliation);
  return row.ap.status === "active"
    ? { label: "승인 저장됨 · 전송 예약 없음", detail: row.reason ?? "게시 계정·목적지 없이 승인만 저장된 기록입니다. 계정을 연결한 뒤 해당 콘텐츠에서 다시 승인해야 합니다.", tone: "warn" as const }
    : { label: row.ap.status === "cancelled" ? "승인 취소됨 · 전송 내역 없음" : "이전 승인 · 전송 내역 없음", detail: "이 승인에는 연결된 전송 기록이 없습니다. 현재 승인 상태는 콘텐츠의 전송 내역에서 확인하세요.", tone: "" as const };
}
export function PublishPage() {
  const { selected } = useChannel();
  const context = useListContext("publish", selected, publishDefaults, value => {
    const parsed = publishContextSchema.safeParse(value); return parsed.success ? parsed.data : null;
  });
  const { workMode, view, weekOffset, page, statusFilter, listView, from, to } = context.value;
  const setWorkMode = (workMode: WorkMode) => context.update({ workMode });
  const setView = (view: PublishContext["view"]) => context.update({ view, page: 1 });
  const setWeekOffset = (change: SetStateAction<number>) => context.update(previous => ({ ...previous, weekOffset: typeof change === "function" ? change(previous.weekOffset) : change, page: 1 }));
  const setPage = (page: number) => context.update({ page });
  const setStatusFilter = (statusFilter: PublishContext["statusFilter"]) => context.update({ statusFilter });
  const setListView = (listView: PublicationListState) => context.update({ listView });
  const setFrom = (from: string) => context.update({ from });
  const setTo = (to: string) => context.update({ to });
  const [checked, setChecked] = useState<number[]>([]);
  const days = useMemo(() => {
    const start = new Date(Date.now() + weekOffset * 7 * 86400_000);
    return Array.from({ length: 7 }, (_, i) => kstYmd(new Date(start.getTime() + i * 86400_000)));
  }, [weekOffset]);
  const range = view === "calendar" ? { from: days[0], to: days[6] } : { from: from || undefined, to: to || undefined };
  const statusValue = statusFilter === "attention" ? "failed,unknown,dry_run" : statusFilter === "orphan" ? undefined : statusFilter || undefined;
  const status = usePublicationRuntime();
  const q = useQuery({ queryKey: ["ch", selected, "deliveries", listView, statusValue, range.from, range.to, page], queryFn: async () => pageResult(await api<Page<DeliveryRow> | DeliveryRow[]>(`/deliveries?${qs({ channelId: selected, page, pageSize: PAGE_SIZE, status: statusValue, view: listView, ...range })}`)), refetchInterval: query => query.state.data?.items.some(({ d }) => ["scheduled", "processing"].includes(d.status)) ? 5000 : false });
  const orphans = useQuery({ queryKey: ["ch", selected, "publication-orphans", range.from, range.to, statusFilter === "orphan" ? page : 1], queryFn: async () => pageResult(await api<Page<Orphan> | Orphan[]>(`/publication-orphans?${qs({ channelId: selected, page: statusFilter === "orphan" ? page : 1, pageSize: PAGE_SIZE, ...range })}`)), enabled: listView === "active" });
  useListScroll(context.key, q.isSuccess && (listView !== "active" || !orphans.isLoading));
  const rows = useMemo<Row[]>(() => statusFilter === "orphan" ? (orphans.data?.items ?? []).map(row => ({ ...row, d: null, dest: null })) : q.data?.items ?? [], [statusFilter, q.data, orphans.data]);
  const overdue = q.data?.counts?.overdue ?? q.data?.items.filter(r => r.d.status === "scheduled" && new Date(r.ap.scheduledAt).getTime() < Date.now() - 60_000).length ?? 0;
  const needsAttention = q.data?.counts?.needsAttention ?? q.data?.items.filter(r => r.d.needsReconciliation || ["failed", "unknown", "dry_run"].includes(r.d.status)).length ?? 0;
  const orphanCount = listView === "active" ? orphans.data?.total ?? 0 : 0;
  const total = statusFilter === "orphan" ? orphanCount : q.data?.total ?? 0;
  const refreshing = q.isFetching || orphans.isFetching || status.isFetching;
  const refresh = () => { q.refetch(); if (listView === "active") orphans.refetch(); status.refetch(); };
  const organization = usePublicationOrganization(() => setChecked([]));
  const selectable = rows.filter((row): row is DeliveryRow => !!row.d && !!row.dest && canOrganizePublication(row.d));
  const selectedRows = selectable.filter(row => checked.includes(row.d.id));
  useEffect(() => { setChecked([]); }, [context.scope, page, view, listView, statusFilter, from, to, weekOffset]);
  useEffect(() => { const loaded = statusFilter === "orphan" ? orphans.data && !orphans.isFetching : q.data && !q.isFetching; if (loaded && page > Math.max(1, Math.ceil(total / PAGE_SIZE))) setPage(Math.max(1, Math.ceil(total / PAGE_SIZE))); }, [q.data, q.isFetching, orphans.data, orphans.isFetching, statusFilter, page, total]);
  const hasFilters = !!statusFilter || !!from || !!to || view === "calendar";
  const resetFilters = () => { setView("list"); setStatusFilter(""); setFrom(""); setTo(""); setWeekOffset(0); setPage(1); };

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
          <p className="small muted" style={{ margin: 0 }}>게시 결과를 확인하고 완료된 기록을 보관하거나 삭제할 수 있어요. 삭제한 기록은 휴지통에서 복원할 수 있습니다.</p>
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
      <div className="tabs publication-folders" role="tablist" aria-label="발행 기록 보관 위치">
        {publicationListStates.map(value => <button key={value} role="tab" aria-selected={listView === value} disabled={organization.pending} onClick={() => { setListView(value); setStatusFilter(""); setPage(1); }}>{publicationListLabels[value]}</button>)}
      </div>
      <p className="small muted">보관·삭제는 스튜디오의 발행 목록에만 적용됩니다. Instagram 등 SNS의 게시물은 ‘게시물 보기’를 열어 직접 삭제하거나 보관해 주세요.</p>
      <WorkModeControl context="publish" mode={workMode} onChange={setWorkMode} />
      {workMode === "manual" && <section className="panel stack" aria-label="수동 게시 안내"><h2>이미지·캡션으로 직접 게시</h2><p className="small muted">게시 API 한도나 연결 문제일 때 콘텐츠 화면에서 완성 이미지와 저장한 캡션을 가져와 게시하세요. 남아 있는 예약은 먼저 취소하고, 전송 중·결과 확인 필요 건은 아래 내역에서 게시 여부를 확인하세요.</p><div className="row"><GuardedLink className="btn" href="/">내 콘텐츠에서 이미지·캡션 열기</GuardedLink><GuardedLink className="btn" href="/instagram">게시 계정 연결 복구</GuardedLink></div></section>}
      <div className="stack" style={{ marginBottom: 16 }}>
        {listView === "active" && <PublicationRuntimeNotice runtime={status.data} error={status.error} retry={() => status.refetch()} />}
        <div className="row between"><span className="small muted">조회 결과 총 {total}건 · 이 페이지 {rows.length}건 · 전송 예약 없음 {orphanCount}건 · 예약 시각 지난 대기 {overdue}건 · 실패·확인 필요·모의 실행 {needsAttention}건</span><button className="btn sm" disabled={refreshing} onClick={refresh}>{refreshing ? "상태 확인 중…" : "상태 새로고침"}</button></div>
        <div className="row publication-filters"><label className="field">전송 상태<select aria-label="전송 상태 필터" value={statusFilter} onChange={event => { setStatusFilter(event.target.value as PublishContext["statusFilter"]); setPage(1); }}><option value="">전체 전송</option><option value="attention">실패·결과 확인 필요·모의 실행</option>{listView === "active" && <><option value="scheduled">예약 대기</option><option value="processing">전송 중</option></>}<option value="succeeded">게시됨</option><option value="failed">실패</option>{listView === "active" && <option value="unknown">결과 확인 필요</option>}<option value="cancelled">취소</option><option value="dry_run">모의 실행</option>{listView === "active" && <option value="orphan">승인만 저장됨 · 전송 예약 없음</option>}</select></label>{view === "list" && <><label className="field">시작일 (한국 시간)<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label className="field">종료일 (한국 시간)<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></>}</div>
        {listView === "active" && needsAttention > 0 && statusFilter !== "attention" && <div className="notice warn"><strong>확인하거나 복구할 전송이 {needsAttention}건 있습니다.</strong><div><button className="btn sm" onClick={() => { setStatusFilter("attention"); setPage(1); }}>실패·확인 필요부터 보기</button></div></div>}
        {listView === "active" && orphans.error && <div><p className="small">승인만 저장된 기록을 불러오지 못했습니다.</p><ErrorBox error={orphans.error} retry={() => orphans.refetch()} /></div>}
        {orphanCount > 0 && <div className="notice warn"><strong>승인만 저장되고 전송 예약이 없는 콘텐츠가 {orphanCount}건 있습니다.</strong><p className="small">예약 시간이 지나도 자동 게시되지 않습니다. 게시 계정을 연결하고 해당 콘텐츠에서 다시 승인해 주세요.</p><GuardedLink href="/instagram">인스타그램 연결 확인 →</GuardedLink><button className="btn sm" onClick={() => { setView("list"); setStatusFilter("orphan"); setPage(1); }}>승인만 저장된 기록 보기</button></div>}
        {overdue > 0 && <div className="notice warn"><strong>예약 시각이 지났지만 아직 전송하지 않은 건이 {overdue}건 있습니다.</strong><p className="small">예약 시간이 지났다는 이유만으로 게시 완료가 되지 않습니다. 전송 상태에서 계정·권한 오류와 실행 상황을 확인하세요.</p><button className="btn sm" onClick={() => { setView("list"); setStatusFilter("scheduled"); setTo(today); setFrom(""); setPage(1); }}>지난 예약을 포함한 목록 보기</button></div>}
      </div>
      {organization.error && <div className="notice err" role="alert">{organization.error}</div>}
      {view === "list" && selectable.length > 0 && <div className="row publication-list-toolbar" aria-label="발행 기록 선택 관리">
        <label className="check publication-select-all"><input type="checkbox" aria-label="이 페이지에서 정리 가능한 기록 모두 선택" disabled={organization.pending} checked={selectedRows.length === selectable.length} onChange={event => setChecked(event.target.checked ? selectable.map(row => row.d.id) : [])} />이 페이지 선택 · {selectedRows.length}건</label>
        {listView !== "active" && <button className="btn sm" disabled={organization.pending || !selectedRows.length} onClick={() => void organization.move(selectedRows, "active")}>선택 복원</button>}
        {listView !== "archived" && <button className="btn sm" disabled={organization.pending || !selectedRows.length} onClick={() => void organization.move(selectedRows, "archived")}>선택 보관</button>}
        {listView !== "trashed" && <button className="btn sm" disabled={organization.pending || !selectedRows.length} onClick={() => void organization.move(selectedRows, "trashed")}>선택 삭제</button>}
        {organization.pending && <span className="small" role="status">목록 정리 중…</span>}
      </div>}
      {view === "calendar" && <div className="row between" aria-label="발행 주간 이동" style={{ marginBottom: 12 }}>
        <button className="btn sm" onClick={() => setWeekOffset(w => w - 1)}>← 이전 주</button>
        <strong className="small">{days[0]} ~ {days[6]}</strong>
        <button className="btn sm" onClick={() => setWeekOffset(w => w + 1)}>다음 주 →</button>
      </div>}
      {q.isLoading || listView === "active" && orphans.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !rows.length ? (
        <Empty>
          {listView !== "active" ? hasFilters ? "선택한 조건에 맞는 기록이 없습니다." : `${publicationListLabels[listView]}에 발행 기록이 없습니다.` : <>{orphans.error ? "전송 내역은 없으며, 승인만 저장된 기록은 아직 확인하지 못했습니다." : hasFilters ? "선택한 조건에 맞는 전송이 없습니다." : "선택한 채널에 전송 예약이 없습니다."} 게시 후 결과와 예약은 여기에 표시됩니다. 게시 계정은 <GuardedLink href="/instagram">인스타그램 연결</GuardedLink>에서 확인할 수 있습니다.</>}
          {hasFilters && <div><button className="btn sm" onClick={resetFilters}>필터 초기화</button></div>}
        </Empty>
      ) : view === "calendar" ? (
        <div className="stack">
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
              <div className="publication-record-head">
                {r.d && canOrganizePublication(r.d) && <label className="publication-record-select"><input type="checkbox" aria-label={`${r.item.title} 발행 기록 선택`} checked={checked.includes(r.d.id)} disabled={organization.pending} onChange={event => { const id = r.d!.id; setChecked(previous => event.target.checked ? [...new Set([...previous, id])] : previous.filter(value => value !== id)); }} /></label>}
                <GuardedLink href={contentHref(r)} className="title">{r.item.title}</GuardedLink>
              </div>
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
              {(!r.d || publicationListState(r.d) === "active") && <DeliveryActions channelId={r.item.channelId} approvalId={r.ap.id} approvalStatus={r.ap.status} delivery={r.d ?? undefined} contentHref={contentHref(r)} onChanged={refresh} />}
              {r.d && <PublicationListActions delivery={r.d} title={r.item.title} pending={organization.pending} move={target => void organization.move([{ d: r.d!, item: r.item }], target)} />}
              <GuardedLink className="small" href={contentHref(r)}>이 콘텐츠 전송 내역 보기 →</GuardedLink>
            </li>
          ); })}
        </ul>
      )}
      <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </>
  );
}
