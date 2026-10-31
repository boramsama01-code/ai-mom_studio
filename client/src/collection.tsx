import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, qs } from "./api";
import { useChannel } from "./state";
import { useToast } from "./toast";
import { Icon } from "./icons";
import { ErrorBox, fmtDate, GuardedLink, Loading, StatusBadge } from "./ui";
import { kstDay, type CollectionOverview } from "@shared/collection";

export function useKstToday() {
  const [today, setToday] = useState(kstDay());
  useEffect(() => { const timer = setInterval(() => setToday(kstDay()), 60_000); return () => clearInterval(timer); }, []);
  return today;
}

export function CollectionPanel({ date, detailed = false }: { date?: string; detailed?: boolean }) {
  const { selected, select, current } = useChannel();
  const qc = useQueryClient(), toast = useToast();
  const [, navigate] = useLocation();
  const today = useKstToday();
  const [localDate, setLocalDate] = useState<string | null>(null);
  const day = date || localDate || today;
  const query = useQuery({ queryKey: ["collection", selected, day], queryFn: () => api<CollectionOverview>(`/collection/overview?${qs({ channelId: selected, date: day })}`),
    refetchInterval: q => q.state.data?.channels.some(c => c.jobs.some(j => !j.stale)) ? 5000 : 60_000 });
  const finished = query.data?.channels.map(c => c.lastRun?.finishedAt ?? "").join("|");
  useEffect(() => { if (finished) qc.invalidateQueries({ queryKey: ["ch"] }); }, [finished, qc]);
  const collect = useMutation({ mutationFn: () => api<{ inline: boolean; requested: unknown[] }>("/collection/collect", { method: "POST", body: { channelId: selected } }),
    onSuccess: r => { toast("ok", r.inline ? `${r.requested.length}개 채널의 수집을 시작했습니다. 결과는 자동으로 갱신됩니다.` : "요청을 등록했습니다. 다음 워커 실행을 기다립니다."); qc.invalidateQueries({ queryKey: ["collection"] }); }, onError: e => toast("err", (e as Error).message) });
  const auto = useMutation({ mutationFn: (enabled: boolean) => api("/settings/auto-collect", { method: "PUT", body: { enabled } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collection"] }); qc.invalidateQueries({ queryKey: ["status"] }); }, onError: e => toast("err", (e as Error).message) });
  const profile = useMutation({ mutationFn: (c: CollectionOverview["channels"][number]) => api<{ added: number }>(`/channels/${c.id}/collection-profile`, { method: "POST", body: { version: c.version } }),
    onSuccess: r => { toast("ok", `추천 검색어 ${r.added}개를 추가했습니다. 기존 검색어는 보존했습니다.`); qc.invalidateQueries({ queryKey: ["collection"] }); qc.invalidateQueries({ queryKey: ["ch"] }); qc.invalidateQueries({ queryKey: ["channels"] }); }, onError: e => toast("err", (e as Error).message) });
  if (query.isLoading) return <Loading label="수집 현황 확인 중" />;
  if (query.error) return <ErrorBox error={query.error} retry={() => query.refetch()} />;
  const d = query.data!;
  const totals = d.channels.reduce((a, c) => ({ newItems: a.newItems + c.newItems, pending: a.pending + c.pending }), { newItems: 0, pending: 0 });
  const busy = d.channels.some(c => c.jobs.some(j => j.status === "running" && !j.stale));
  const queued = d.channels.some(c => c.jobs.length);
  const searchAuthFailed = d.sourceMode !== "public_rss" && d.channels.some(c => c.lastRun?.status === "failed" && c.lastRun.errors.some(e =>
    (e.scope === "discovery" || e.scope.startsWith("rule:")) && /인증\/권한 오류 \(HTTP (401|403)\)/.test(e.message)));
  const showItems = (id: number) => { select(id); navigate(`/inbox?collectedOn=${day}`); };
  if (!detailed) return <section className="panel collection-compact" aria-label="날짜별 수집 현황">
    <div className="collection-compact-head"><div><span className="collection-kicker">COLLECTION</span><h2>{day === today ? "오늘의 수집" : `${day} 수집 결과`}</h2></div><div className="row"><button className="btn ghost icon" aria-label="수집 현황 새로고침" onClick={() => query.refetch()} disabled={query.isFetching}><Icon name="refresh" size={18} /></button><button className="btn primary" onClick={() => collect.mutate()} disabled={collect.isPending || busy || d.globalStop || !(d.searchReady ?? d.naverReady)}>{collect.isPending ? "요청 중…" : busy ? "수집 중…" : queued ? "대기 수집 재개" : selected === "all" ? "전체 채널 지금 수집" : "지금 수집"}</button></div></div>
    <div className="collection-compact-metrics"><div><span>새로 모은 자료</span><strong>{totals.newItems}<small>건</small></strong></div><div><span>검토를 기다리는 자료</span><strong>{totals.pending}<small>건</small></strong></div><div className="collection-compact-next"><span>다음 자동 수집</span><strong>{d.nextAt ? fmtDate(d.nextAt) : d.globalStop ? "전체 정지" : "자동 수집 꺼짐"}</strong></div></div>
    {d.globalStop && <p className="notice warn">전역 정지 중이므로 수집이 실행되지 않습니다.</p>}
    {!(d.searchReady ?? d.naverReady) && <p className="notice warn">검색 연결을 확인해 주세요. <GuardedLink href="/connections?service=naver">연결 설정</GuardedLink></p>}
    {searchAuthFailed && <p className="notice err" role="alert">최근 수집이 네이버 인증 단계에서 멈췄습니다. <GuardedLink href="/connections?service=naver">네이버 키 확인·수정 →</GuardedLink></p>}
    {d.channels.some(c => c.lastRun?.errors.length || c.jobs.some(j => j.stale)) && <p className="notice warn">최근 수집에 확인할 내용이 있습니다. <GuardedLink href="/today">실행 결과 확인 →</GuardedLink></p>}
    <div className="collection-compact-foot"><span>{d.lastScheduledAt ? `최근 예약 수집 ${fmtDate(d.lastScheduledAt)}` : "예약 수집 기록이 아직 없습니다"}</span><GuardedLink href="/today">자동 수집 설정·상세 기록 <Icon name="chevron" size={13} /></GuardedLink></div>
  </section>;
  return <section className="panel stack collection-summary" aria-label="날짜별 수집 현황">
    <div className="row between">
      <div><h2 style={{ margin: 0 }}>{day === kstDay() ? "오늘 들어온 자료" : `${day} 수집 결과`}</h2><span className="small muted">한국 시간 · 새로 저장된 자료 기준</span></div>
      <div className="row">
        {detailed && <><button className="btn sm" onClick={() => setLocalDate(null)}>오늘</button><label className="field"><span className="sr-only">수집일</span><input type="date" aria-label="수집일" value={day} onChange={e => e.target.value && setLocalDate(e.target.value)} /></label></>}
        <button className="btn sm" onClick={() => query.refetch()} disabled={query.isFetching}>새로고침</button>
        <button className="btn primary" onClick={() => collect.mutate()} disabled={collect.isPending || busy || d.globalStop || !(d.searchReady ?? d.naverReady)}>{collect.isPending ? "요청 중…" : busy ? "수집 중…" : queued ? "대기 수집 재개" : selected === "all" ? "전체 채널 지금 수집" : "지금 수집"}</button>
      </div>
    </div>
    <div className="collection-metrics">
      <div><span>신규 자료</span><strong>{totals.newItems}<small>건</small></strong></div>
      <div><span>검토 대기</span><strong>{totals.pending}<small>건</small></strong></div>
      <div><span>다음 예약</span><strong className="collection-next">{d.nextAt ? fmtDate(d.nextAt) : d.globalStop ? "전체 정지" : "자동 수집 꺼짐"}</strong></div>
    </div>
    <div className="row between small">
      <label className="check"><input type="checkbox" checked={d.autoCollect} disabled={auto.isPending} onChange={e => auto.mutate(e.target.checked)} />매일 자동 수집</label>
      <span className="muted">05:13 · 07:13 · 19:13 예약 / GitHub 실행 지연 가능</span>
    </div>
    {d.sourceMode === "public_rss" && <div className="small muted">최근 7일 뉴스 · Google 뉴스 RSS + 언론사 RSS {d.publicFeeds?.length ?? 0}곳 · 뉴스 수집은 API 키 없이 이용</div>}
    {current?.contentType === "notice" && <div className="small muted">공식 모집 게시판부터 확인하고, 뉴스는 모집·접수 단어로 좁혀 검색합니다. 사후 홍보·대상 외 모집은 새로 저장하지 않습니다.</div>}
    {!d.naverReady && d.sourceMode !== "public_rss" && <div className="notice warn">네이버 검색 연결이 필요합니다. <GuardedLink href="/connections?service=naver">연결 확인</GuardedLink></div>}
    {searchAuthFailed && <div className="notice err" role="alert"><strong>최근 수집이 네이버 인증 단계에서 멈췄습니다.</strong><p style={{ margin: "6px 0" }}>저장된 Client ID·Client Secret 또는 검색 API 권한을 확인해 주세요. 신규 0건은 검색할 자료가 없다는 뜻이 아닙니다.</p><GuardedLink href="/connections?service=naver">네이버 키 확인·수정 →</GuardedLink><span className="small"> 키 저장 → 연결 확인 → 지금 수집 순서로 재개할 수 있습니다.</span></div>}
    {d.globalStop && <div className="notice warn">전역 정지 중이므로 수집이 실행되지 않습니다.</div>}
    <p className="small muted" style={{ margin: 0 }}>{d.lastScheduledAt ? `최근 실제 예약 수집: ${fmtDate(d.lastScheduledAt)}` : "실제 예약 수집 기록이 아직 없습니다. 연결 검사 성공과 자료 수집 완료는 별개입니다."}</p>
    {detailed ? <div className="collection-channels">{d.channels.map(c => <article key={c.id} className="collection-channel">
      <div className="row between"><h3>{c.name}</h3><strong>{c.newItems}건</strong></div>
      <p className="small muted">검색어 {c.queries}개 · 화제 탐색 {c.discoveryQueries}개 · 연결된 공식 게시판 {c.boards}개</p>
      {!!((c.noticeCandidates ?? 0) + (c.noticeUncertain ?? 0) + (c.noticeReports ?? 0)) && <p className="small"><strong>모집·접수 후보 {c.noticeCandidates ?? 0}건</strong> · 확인 필요 {c.noticeUncertain ?? 0}건 · 사후·대상 외·마감 {c.noticeReports ?? 0}건</p>}
      <div className="row small">{c.lastRun ? <><StatusBadge type="run" value={c.lastRun.status} /><span>{fmtDate(c.lastRun.startedAt)}</span><span>신규 {c.lastRun.counts.newItems ?? 0} · 중복 {c.lastRun.counts.duplicates ?? 0}</span></> : <span>아직 수집을 실행하지 않았습니다.</span>}</div>
      {c.lastRun && c.lastRun.counts.rssRequests !== undefined && <p className="small muted">공개 RSS {c.lastRun.counts.rssRequests}회 확인 · 언론사 피드 {c.lastRun.counts.rssFeedOk ?? 0}곳 응답 · Google 검색 {c.lastRun.counts.googleQueries ?? 0}회</p>}
      {!!c.lastRun?.counts.noticeReportsSkipped && <p className="small muted">사후 홍보·대상 외 모집 {c.lastRun.counts.noticeReportsSkipped}건은 신규 저장에서 제외했습니다.</p>}
      {!!c.lastRun?.errors.length && <details className="small"><summary>최근 실행에서 확인할 내용 {c.lastRun.errors.length}개</summary><ul>{c.lastRun.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></details>}
      {c.jobs.some(j => j.stale) && <p className="notice warn small">오래 대기하거나 중단된 요청이 있습니다. 위의 ‘대기 수집 재개’로 다시 처리할 수 있습니다.</p>}
      <div className="row"><button className="btn sm" onClick={() => showItems(c.id)}>이 날짜 자료 보기</button><button className="btn sm ghost" onClick={() => { select(c.id); navigate("/rules"); }}>검색어 관리</button></div>
      {c.profile && <details className="small collection-preset"><summary>추천 검색어 · {c.profile.label}</summary><p>추천 {c.profile.count}개를 추가하고 수집 한도를 맞춥니다. 기존 검색어와 일시정지는 유지하며, 유료 AI 자동 작성은 끕니다.</p><button className="btn sm" disabled={profile.isPending} onClick={() => profile.mutate(c)}>추천 검색어 {c.profile.count}개 적용</button></details>}
      {!c.queries && !c.discoveryQueries && !c.boards && !c.profile && <p className="small muted">직접 창작하는 채널입니다. 외부 자료가 필요하면 검색어를 추가하세요.</p>}
    </article>)}</div> : <GuardedLink href="/today" className="small">채널별 실행 결과·검색어 확인 →</GuardedLink>}
    <details className="small"><summary>무엇을 어떻게 수집하나요?</summary><p>뉴스 검색어로 Google 뉴스 RSS와 언론사 직접 RSS의 최근 7일 자료를 모읍니다. 한 경로가 실패해도 다른 경로는 계속 처리하고, URL 및 같은 언론사·제목·날짜의 중복을 제외합니다. 블로그 검색에는 선택적으로 네이버 키를 사용합니다. 과학·시사는 여러 언론의 보도를 주제별로 묶어 화제도 함께 찾습니다. 한도를 넘는 검색어는 다음 수집에서 먼저 처리합니다.</p><p>‘오늘’은 오늘 처음 저장한 날짜입니다. 원문의 게시일과 다를 수 있습니다. 일부 RSS가 중단되거나 결과 상한에 닿으면 부분 수집으로 표시합니다. 원문 확보 실패·출처 미확인은 자료별로 표시하며, 연결되지 않은 공식 게시판은 자동 수집하지 않습니다. 이 화면의 수집 버튼은 AI 생성·알림 전송·SNS 게시를 실행하지 않습니다.</p>{d.publicFeeds && <p>직접 RSS: {d.publicFeeds.join(" · ")}</p>}</details>
  </section>;
}

