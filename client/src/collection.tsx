import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, qs } from "./api";
import { useChannel } from "./state";
import { useToast } from "./toast";
import { Icon } from "./icons";
import { ErrorBox, fmtDate, GuardedLink, Loading, StatusBadge } from "./ui";
import { kstDay, type CollectionOverview } from "@shared/collection";
import { isPrivateWorkroom } from "./workroom";

export function useKstToday() {
  const [today, setToday] = useState(kstDay());
  useEffect(() => { const timer = setInterval(() => setToday(kstDay()), 60_000); return () => clearInterval(timer); }, []);
  return today;
}

export function CollectionPanel({ date, detailed = false, subcategory = "" }: { date?: string; detailed?: boolean; subcategory?: string }) {
  const workroom = isPrivateWorkroom();
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
  const collect = useMutation({ mutationFn: (channelId: number | "all" = selected) => api<{ inline: boolean; requested: unknown[] }>("/collection/collect", { method: "POST", body: { channelId, ...(subcategory && subcategory !== "미분류" && channelId !== "all" ? { subcategory } : {}) } }),
    onSuccess: r => { toast("ok", r.inline ? `${r.requested.length}개 채널의 수집을 시작했습니다. 결과는 자동으로 갱신됩니다.` : "요청을 등록했습니다. 다음 워커 실행을 기다립니다."); qc.invalidateQueries({ queryKey: ["collection"] }); }, onError: e => toast("err", (e as Error).message) });
  const auto = useMutation({ mutationFn: (enabled: boolean) => api("/settings/auto-collect", { method: "PUT", body: { enabled } }),
    onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["collection"] }), qc.invalidateQueries({ queryKey: ["status"] })]); }, onError: e => toast("err", (e as Error).message) });
  const profile = useMutation({ mutationFn: (c: CollectionOverview["channels"][number]) => api<{ added: number }>(`/channels/${c.id}/collection-profile`, { method: "POST", body: { version: c.version } }),
    onSuccess: r => { toast(r.added ? "ok" : "info", r.added ? `새 추천 검색어 ${r.added}개를 추가했습니다. ‘이 채널 지금 수집’으로 자료를 모으세요.` : "추천 검색어가 이미 모두 등록되어 있습니다. ‘이 채널 지금 수집’을 눌러 자료를 모으세요."); qc.invalidateQueries({ queryKey: ["collection"] }); qc.invalidateQueries({ queryKey: ["ch"] }); qc.invalidateQueries({ queryKey: ["channels"] }); }, onError: e => { toast("err", (e as Error).message); qc.invalidateQueries({ queryKey: ["collection"] }); } });
  if (query.isLoading) return <Loading label="수집 현황 확인 중" />;
  if (query.error) return <ErrorBox error={query.error} retry={() => query.refetch()} />;
  const d = query.data!;
  const nextCollection = d.nextAt ? fmtDate(d.nextAt) : d.globalStop ? "전체 정지" : d.autoCollect ? "예약 실행 설정 필요" : "자동 수집 꺼짐";
  const totals = d.channels.reduce((a, c) => ({ newItems: a.newItems + c.newItems, pending: a.pending + c.pending }), { newItems: 0, pending: 0 });
  const busy = d.channels.some(c => c.jobs.some(j => j.status === "running" && !j.stale));
  const queued = d.channels.some(c => c.jobs.length);
  const authFailedRuns = d.sourceMode === "public_rss" ? [] : d.channels.flatMap(c => c.lastRun && c.lastRun.errors.some(e =>
    (e.scope === "naver" || e.scope === "discovery" || e.scope.startsWith("rule:")) && /인증\/권한 오류 \(HTTP (401|403)\)/.test(e.message)) ? [c.lastRun] : []);
  const laterConnectionPassed = d.naverReady && d.naverConnectionTest?.ok === true && authFailedRuns.every(run =>
    run.finishedAt && new Date(d.naverConnectionTest!.at).getTime() > new Date(run.finishedAt).getTime());
  const searchAuthFailed = authFailedRuns.length > 0 && !laterConnectionPassed;
  const recoveredSearchAuth = authFailedRuns.length > 0 && laterConnectionPassed;
  const recoveredNotice = recoveredSearchAuth && <p className="notice" role="status">이전 수집에서 네이버 인증에 실패했지만, 이후 연결 검사는 성공했습니다({fmtDate(d.naverConnectionTest!.at)}). 이 채널의 다음 수집 결과는 아직 확인하지 않았습니다. <GuardedLink href="/today">이전 실행 기록 확인 →</GuardedLink></p>;
  const showItems = (id: number, subcategory = "") => { select(id); navigate(`/inbox?collectedOn=${day}${subcategory ? `&subcategory=${encodeURIComponent(subcategory)}` : ""}`); };
  if (!detailed) return <section className="panel collection-compact" aria-label="날짜별 수집 현황">
    <div className="collection-compact-head"><div><span className="collection-kicker">COLLECTION</span><h2>{day === today ? "오늘의 수집" : `${day} 수집 결과`}</h2></div><div className="row"><button className="btn ghost icon" aria-label="수집 현황 새로고침" onClick={() => query.refetch()} disabled={query.isFetching}><Icon name="refresh" size={18} /></button><button className="btn primary" onClick={() => collect.mutate(selected)} disabled={subcategory === "미분류" || (!!subcategory && selected === "all") || collect.isPending || busy || d.globalStop || !(d.searchReady ?? d.naverReady)}>{collect.isPending ? "요청 중…" : busy ? "수집 중…" : subcategory ? `${subcategory} 수집` : queued ? "대기 수집 재개" : selected === "all" ? "전체 채널 지금 수집" : "지금 수집"}</button></div></div>
    {subcategory && <p className="small muted">선택한 소분류의 공식 출처와 활성 키워드를 수집합니다. 아래 현황 수치는 채널 전체 기준입니다.</p>}
    <div className="collection-compact-metrics"><div><span>새로 모은 자료</span><strong>{totals.newItems}<small>건</small></strong></div><div><span>검토를 기다리는 자료</span><strong>{totals.pending}<small>건</small></strong></div><div className="collection-compact-next"><span>다음 자동 수집</span><strong>{nextCollection}</strong></div></div>
    {d.globalStop && <p className="notice warn">전역 정지 중이므로 수집이 실행되지 않습니다.</p>}
    {!(d.searchReady ?? d.naverReady) && <p className="notice warn">검색 연결을 확인해 주세요. <GuardedLink href="/connections?service=naver">연결 설정</GuardedLink></p>}
    {searchAuthFailed && <p className="notice err" role="alert">최근 수집에서 네이버 검색 인증에 실패했습니다. <GuardedLink href="/connections?service=naver">네이버 키 확인·수정 →</GuardedLink></p>}
    {recoveredNotice}
    {d.channels.some(c => c.lastRun?.errors.length || c.jobs.some(j => j.stale)) && <p className="notice warn">최근 수집에 확인할 내용이 있습니다. <GuardedLink href="/today">실행 결과 확인 →</GuardedLink></p>}
    <div className="collection-compact-foot"><span>{d.lastScheduledAt ? `최근 예약 수집 ${fmtDate(d.lastScheduledAt)}` : "예약 수집 기록이 아직 없습니다"}</span><GuardedLink href="/today">{workroom ? "자동 수집 현황·상세 기록" : "자동 수집 설정·상세 기록"} <Icon name="chevron" size={13} /></GuardedLink></div>
  </section>;
  return <section className="panel stack collection-summary" aria-label="날짜별 수집 현황">
    <div className="collection-summary-head">
      <div><h2 style={{ margin: 0 }}>{day === kstDay() ? "오늘 들어온 자료" : `${day} 수집 결과`}</h2><span className="small muted">한국 시간 · 새로 저장된 자료 기준</span></div>
      <div className="collection-toolbar" role="group" aria-label="수집 날짜와 실행">
        <button className="btn sm collection-today" onClick={() => setLocalDate(null)}>오늘</button><label className="field collection-date"><span className="sr-only">수집일</span><input type="date" aria-label="수집일" value={day} onChange={e => e.target.value && setLocalDate(e.target.value)} /></label>
        <button className="btn sm collection-refresh" onClick={() => query.refetch()} disabled={query.isFetching}>{query.isFetching ? "확인 중…" : "새로고침"}</button>
        <button className="btn primary collection-run" onClick={() => collect.mutate(selected)} disabled={collect.isPending || busy || d.globalStop || !(d.searchReady ?? d.naverReady)}>{collect.isPending ? "요청 중…" : busy ? "수집 중…" : queued ? "대기 수집 재개" : selected === "all" ? "전체 채널 지금 수집" : "지금 수집"}</button>
      </div>
    </div>
    <div className="collection-metrics">
      <div><span>신규 자료</span><strong>{totals.newItems}<small>건</small></strong></div>
      <div><span>검토 대기</span><strong>{totals.pending}<small>건</small></strong></div>
      <div><span>다음 예약</span><strong className="collection-next">{nextCollection}</strong></div>
    </div>
    <div className="row between small">
      <label className="check"><input type="checkbox" checked={auto.isPending ? auto.variables ?? d.autoCollect : d.autoCollect} disabled={workroom || auto.isPending} aria-describedby={workroom ? "workroom-auto-collect-note" : undefined} onChange={e => { if (!workroom) auto.mutate(e.target.checked); }} />자동 수집 허용</label>
      <span className="muted">자동 수집에는 별도 예약 실행 설정이 필요합니다. 필요한 때 ‘지금 수집’을 사용할 수 있습니다.</span>
    </div>
    {workroom && <p id="workroom-auto-collect-note" className="small muted">비공개 작업실에서는 예약 수집 설정을 바꿀 수 없어요. ‘지금 수집’은 바로 사용할 수 있어요.</p>}
    {(d.sourceMode === "public_rss" || d.sourceMode === "official_naver") && <div className="small muted">학교·기관 공지와 청소년 활동 목록 우선 · 네이버 뉴스·웹문서로 보완</div>}
    {current?.contentType === "notice" && <div className="small muted">공식 모집 게시판과 청소년 공모전 목록부터 확인하고, 네이버 검색으로 보완합니다. 사후 홍보·대상 외 모집은 새로 저장하지 않습니다.</div>}
    {!d.naverReady && d.sourceMode !== "public_rss" && <div className="notice warn">네이버가 미연결 상태입니다. 학교·기관 공지는 직접 읽고 뉴스는 공개 RSS로 보완합니다. 웹문서·블로그 검색은 연결 후 사용할 수 있습니다. <GuardedLink href="/connections?service=naver">연결 확인</GuardedLink></div>}
    {searchAuthFailed && <div className="notice err" role="alert"><strong>최근 수집에서 네이버 검색 인증에 실패했습니다.</strong><p style={{ margin: "6px 0" }}>학교·기관 공지는 계속 확인합니다. 저장된 Client ID·Client Secret 또는 검색 API 권한을 확인해 주세요.</p><GuardedLink href="/connections?service=naver">네이버 키 확인·수정 →</GuardedLink><span className="small"> 키 저장 → 연결 확인 → 지금 수집 순서로 재개할 수 있습니다.</span></div>}
    {recoveredNotice}
    {d.globalStop && <div className="notice warn">전역 정지 중이므로 수집이 실행되지 않습니다.</div>}
    <p className="small muted" style={{ margin: 0 }}>{d.lastScheduledAt ? `최근 실제 예약 수집: ${fmtDate(d.lastScheduledAt)}` : "실제 예약 수집 기록이 아직 없습니다. 연결 검사 성공과 자료 수집 완료는 별개입니다."}</p>
    {detailed ? <div className="collection-channels">{d.channels.map(c => <article key={c.id} className="collection-channel">
      <div className="row between"><h3>{c.name}</h3><strong>{c.newItems}건</strong></div>
      <div className="row" aria-label={`${c.name} 소분류별 저장 자료`}>{c.categories?.map(category => <button key={category.label} className="btn sm" onClick={() => showItems(c.id, category.label)}>{category.label} · {category.newItems}건</button>)}</div>
      <p className="small muted">소분류 수치는 선택한 날짜에 저장된 자료입니다. 중복·실행 상태는 채널 단위로 표시합니다.</p>
      <p className="small muted">검색어 {c.queries}개 · 화제 탐색 {c.discoveryQueries}개 · 연결된 게시판·활동 목록 {c.boards}개</p>
      {!!((c.noticeCandidates ?? 0) + (c.noticeUncertain ?? 0) + (c.noticeReports ?? 0)) && <p className="small"><strong>모집·접수 후보 {c.noticeCandidates ?? 0}건</strong> · 확인 필요 {c.noticeUncertain ?? 0}건 · 사후·대상 외·마감 {c.noticeReports ?? 0}건</p>}
      <div className="row small">{c.lastRun ? <><span>최근 실행 · {c.lastRun.subcategory || "채널 전체"}</span><StatusBadge type="run" value={c.lastRun.status} /><span>{fmtDate(c.lastRun.startedAt)}</span><span>신규 {c.lastRun.counts.newItems ?? 0} · 중복 {c.lastRun.counts.duplicates ?? 0}</span></> : <span>아직 수집을 실행하지 않았습니다.</span>}</div>
      {c.lastRun && c.lastRun.counts.officialChecked !== undefined && <p className="small muted">게시판·활동 목록 {c.lastRun.counts.officialChecked}곳 확인 · 정상 {c.lastRun.counts.officialSucceeded ?? 0} · 실패 {c.lastRun.counts.officialFailed ?? 0} · 신규 {c.lastRun.counts.officialNew ?? 0}건 · 중복 {c.lastRun.counts.officialDuplicates ?? 0}건</p>}
      {c.lastRun && c.lastRun.counts.rssRequests !== undefined && <p className="small muted">공개 RSS {c.lastRun.counts.rssRequests}회 확인 · 언론사 피드 {c.lastRun.counts.rssFeedOk ?? 0}곳 응답 · Google 검색 {c.lastRun.counts.googleQueries ?? 0}회</p>}
      {!!c.lastRun?.counts.noticeReportsSkipped && <p className="small muted">사후 홍보·대상 외 모집 {c.lastRun.counts.noticeReportsSkipped}건은 신규 저장에서 제외했습니다.</p>}
      {!!c.lastRun?.errors.length && <details className="small"><summary>최근 실행에서 확인할 내용 {c.lastRun.errors.length}개</summary><ul>{c.lastRun.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></details>}
      {c.jobs.some(j => j.stale) && <p className="notice warn small">오래 대기하거나 중단된 요청이 있습니다. 위의 ‘대기 수집 재개’로 다시 처리할 수 있습니다.</p>}
      <div className="row"><button className="btn sm" onClick={() => showItems(c.id)}>이 날짜 자료 보기</button><button className="btn sm ghost" onClick={() => { select(c.id); navigate("/rules"); }}>검색어 관리</button></div>
      {c.profile && <details className="small collection-preset"><summary>추천 검색어 · {c.profile.label}</summary>
        <p>{c.profile.missing === 0 ? "추천 검색어가 모두 등록되어 있어요." : `새로 추가할 수 있는 추천 검색어 ${c.profile.missing ?? c.profile.count}개가 있어요.`} 등록과 자료 수집은 별도로 실행됩니다.</p>
        <p className="muted">사용 중 {c.profile.active ?? 0}개 · 일시정지 {c.profile.paused ?? 0}개 · 삭제됨 {c.profile.removed ?? 0}개</p>
        <div className="collection-preset-actions">{c.profile.missing !== 0 && <button className="btn sm" disabled={profile.isPending} onClick={() => profile.mutate(c)}>{profile.isPending ? "추가 중…" : `새 검색어 ${c.profile.missing ?? c.profile.count}개 추가`}</button>}
          <button className="btn sm primary" disabled={collect.isPending || c.jobs.some(j=>j.status==="running"&&!j.stale) || d.globalStop || !(d.searchReady ?? d.naverReady) || (!c.queries&&!c.discoveryQueries&&!c.boards)} onClick={()=>collect.mutate(c.id)}>{collect.isPending ? "요청 중…" : "이 채널 지금 수집"}</button>
          <button className="btn sm" onClick={()=>{select(c.id);navigate("/rules");}}>등록한 검색어 수정·재개</button></div>
        {!!c.profile.rules?.length && <ul className="collection-preset-terms">{c.profile.rules.map(r=><li key={`${r.endpoint}:${r.query}`}><span>{r.query}</span><small>{r.endpoint==="blog"?"블로그 · ":""}{{missing:"미등록",active:"사용 중",paused:"일시정지",removed:"삭제됨"}[r.state]}</small></li>)}</ul>}
        {c.profile.missing !== 0 && <p className="muted">새 검색어 추가 시 수집 한도를 맞춥니다. 기존 검색어·일시정지는 유지하고 유료 AI 자동 작성은 끕니다.</p>}
      </details>}
      {!c.queries && !c.discoveryQueries && !c.boards && !c.profile && <p className="small muted">직접 창작하는 채널입니다. 외부 자료가 필요하면 검색어를 추가하세요.</p>}
    </article>)}</div> : <GuardedLink href="/today" className="small">채널별 실행 결과·검색어 확인 →</GuardedLink>}
    <details className="small"><summary>무엇을 어떻게 수집하나요?</summary><p>학교·영재교육원·GED·기관의 공개 게시판과 공식 RSS를 먼저 확인합니다. ‘지금 수집’은 선택한 채널·소분류의 활성 검색어와 연결된 공식 출처를 처리합니다. 기관 발표와 언론 보도는 각각 원문을 확인해 비교합니다. 한 경로가 실패해도 다른 경로는 계속 처리하고, URL 및 같은 언론사·제목·날짜의 중복을 제외합니다. 보완 검색은 네이버 뉴스·웹문서·블로그를 사용합니다. 네이버 장애 시 뉴스만 언론사 RSS·Google RSS로 보완하며 웹문서·블로그 오류는 표시합니다. 과학·시사는 여러 언론의 보도를 주제별로 묶어 화제도 함께 찾습니다. 공식 목록은 제공된 최신 목록 범위만 확인하며 과거 공고 전체를 보장하지 않습니다.</p><p>‘오늘’은 오늘 처음 저장한 날짜입니다. 원문의 게시일과 다를 수 있습니다. 일부 RSS가 중단되거나 출처에서 제공하는 결과 범위에 닿으면 부분 수집으로 표시합니다. 원문 확보 실패·출처 미확인은 자료별로 표시하며, 연결되지 않은 공식 게시판은 수집하지 않습니다. 이 화면의 수집 버튼은 AI 생성·알림 전송·SNS 게시를 실행하지 않습니다.</p>{d.publicFeeds && <p>직접 RSS: {d.publicFeeds.join(" · ")}</p>}</details>
  </section>;
}


