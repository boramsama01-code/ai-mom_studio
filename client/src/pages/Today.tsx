import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useChannel } from "../state";
import { useToast } from "../toast";
import { Empty, ErrorBox, fmtDate, GuardedLink, Loading, StatusBadge } from "../ui";
import type { Job, Run } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HotTopics, type DiscoveredRow } from "../discovery";
import type { DiscoverySettings } from "@shared/domain";

type Today = {
  counts: { pendingReview: number; needsEvidence: number; draftsReady: number };
  next: { id: number; title: string; reviewStatus: string } | null;
  lastRun: Run | null;
  pendingJobs: Job[];
  discovered: DiscoveredRow[];
  discovery: DiscoverySettings | null;
};
type Status = { workerConnected: boolean; queuedJobs: number; autoCollect: boolean; autoCollectFromEnv: boolean; inlineWorker: boolean; integrations: Record<string, unknown> & { flags: Record<string, boolean> }; worker: { startedAt: string; command: string; status: string } | null };

/** 처음 설정 순서 — 실제 상태로 완료 여부를 판단 */
function SetupChecklist({ status, cid, discovery }: { status: Status; cid: number; discovery: DiscoverySettings | null }) {
  const rules = useQuery({ queryKey: ["ch", cid, "rules", false], queryFn: () => api<{ estimate: { activeRules: number } }>(`/channels/${cid}/rules`) });
  const dests = useQuery({ queryKey: ["ch", cid, "destinations"], queryFn: () => api<{ items: Array<{ enabled: boolean; connection: { ready: boolean } }> }>(`/channels/${cid}/destinations`) });
  const i = status.integrations as Record<string, boolean>;
  const steps = [
    { done: !!i.naver, title: "네이버 검색 API 키 입력", desc: "수집에 꼭 필요합니다.", href: "/connections?service=naver" },
    discovery
      ? { done: discovery.enabled, title: "자동 화제 발굴 확인", desc: "검색어 없이 뉴스를 훑어 화제를 찾습니다. 탐색 주제를 바꿀 수 있습니다.", href: "/rules" }
      : { done: (rules.data?.estimate.activeRules ?? 0) > 0, title: "검색어 확인", desc: "켜 둔 검색어로만 수집합니다.", href: "/rules" },
    { done: !!i.aiConfigured, title: "GPT 또는 Claude API 키 입력", desc: "원문에서 일정·대상을 자동 정리합니다(선택이지만 권장).", href: "/connections" },
    { done: status.workerConnected, title: "자동 수집 예약 연결(선택)", desc: "'지금 수집'은 바로 됩니다. 매일 정해진 시각에 자동으로 수집·게시하려면 GitHub Actions 연결이 필요합니다(README 7단계).", href: "/runs" },
    { done: !!i.telegramReview, title: "텔레그램 검토 알림(선택)", desc: "새 자료가 모이면 휴대폰으로 알려줍니다.", href: "/connections?service=telegram" },
    { done: (dests.data?.items ?? []).some((d) => d.enabled && d.connection.ready), title: "게시 목적지 연결(선택)", desc: "텔레그램 채널·인스타그램 계정.", href: "/settings" },
  ];
  const doneN = steps.filter((s) => s.done).length;
  if (doneN === steps.length) return null;
  return (
    <section className="panel stack" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>시작하기</h2>
        <span className="small muted">
          {doneN} / {steps.length} 완료
        </span>
      </div>
      <div className="progress" aria-hidden>
        <span style={{ width: `${(doneN / steps.length) * 100}%` }} />
      </div>
      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.title} className={s.done ? "done" : ""}>
            <span className="mark" aria-hidden>
              {s.done ? "✓" : ""}
            </span>
            <span className="grow" style={{ flex: 1 }}>
              <span className="ttl">{s.title}</span>
              <span className="sr-only">{s.done ? " (완료)" : " (미완료)"}</span>
              <br />
              <span className="small muted">{s.desc}</span>
            </span>
            {!s.done && (
              <GuardedLink href={s.href} className="btn sm">
                설정하기
              </GuardedLink>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TodayPage() {
  const { current, selected } = useChannel();
  const qc = useQueryClient();
  const toast = useToast();
  const today = useQuery({
    queryKey: ["ch", selected, "today"],
    queryFn: () => api<Today>(`/channels/${selected}/today`),
    enabled: selected !== "all",
    // 수집 중이면 5초마다 새로 고침
    refetchInterval: (q) => (q.state.data && (q.state.data.pendingJobs.length || q.state.data.lastRun?.status === "running") ? 5000 : false),
  });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status") });
  const collect = useMutation({
    mutationFn: () => api<{ duplicate: boolean; inline: boolean }>(`/channels/${selected}/jobs/collect`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      toast("ok", r.duplicate ? "이미 진행 중인 수집이 있습니다." : r.inline ? "수집을 시작했습니다. 보통 1~3분 걸리고, 끝나면 이 화면에 결과가 나타납니다." : "수집 요청을 등록했습니다.");
      qc.invalidateQueries({ queryKey: ["ch", selected] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const autoCollect = useMutation({
    mutationFn: (enabled: boolean) => api(`/settings/auto-collect`, { method: "PUT", body: { enabled } }),
    onSuccess: (_r, enabled) => {
      toast("ok", enabled ? "자동 수집을 켰습니다(매일 07시·19시 무렵)." : "자동 수집을 껐습니다.");
      qc.invalidateQueries({ queryKey: ["status"] });
    },
    onError: (e) => toast("err", (e as Error).message),
  });
  const collecting = !!today.data && (today.data.pendingJobs.length > 0 || today.data.lastRun?.status === "running");

  if (selected === "all")
    return (
      <>
        <h1>오늘의 작업</h1>
        <Empty>오늘의 작업은 채널별로 확인합니다. 왼쪽에서 채널을 하나 선택하세요.</Empty>
      </>
    );

  const hour = new Date().getHours();
  const greet = hour < 12 ? "좋은 아침입니다" : hour < 18 ? "좋은 오후입니다" : "오늘도 수고 많으셨습니다";
  return (
    <>
      <div className="page-head">
        <div>
          <p className="small muted" style={{ margin: 0 }}>{greet}</p>
          <h1>오늘의 작업</h1>
          <span className="channel-chip">
            <span className="dot" style={{ background: current?.accentColor }} aria-hidden /> {current?.name}
          </span>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
          <button className="btn primary" onClick={() => collect.mutate()} disabled={collect.isPending || collecting || !current?.active}>
            {collect.isPending ? "요청 중…" : collecting ? "수집 중…" : "지금 수집"}
          </button>
          {status.data && (
            <label className="check small" title="GitHub Actions 연결 후 매일 07시·19시 무렵 모든 채널을 수집합니다">
              <input
                type="checkbox"
                checked={status.data.autoCollect}
                disabled={status.data.autoCollectFromEnv || autoCollect.isPending}
                onChange={(e) => autoCollect.mutate(e.target.checked)}
              />
              매일 자동 수집
            </label>
          )}
        </div>
      </div>
      {collect.isSuccess && status.data && !status.data.inlineWorker && !status.data.workerConnected && (
        <div className="notice warn" role="status" style={{ marginBottom: 16 }}>
          요청은 등록됐지만 최근 워커 실행 기록이 없습니다. GitHub Actions의 <b>process</b> 워크플로가 실행되어야 처리됩니다.
        </div>
      )}
      {status.data?.autoCollect && !status.data.workerConnected && (
        <div className="notice warn" role="status" style={{ marginBottom: 16 }}>
          자동 수집이 켜져 있지만 GitHub Actions가 아직 연결되지 않아 예약 실행이 되지 않습니다. README 7단계(Secrets 2개 등록)를 마치면 매일 실행됩니다.
        </div>
      )}
      {status.data && <SetupChecklist status={status.data} cid={selected} discovery={today.data?.discovery ?? null} />}

      {today.isLoading ? (
        <Loading />
      ) : today.error ? (
        <ErrorBox error={today.error} retry={() => today.refetch()} />
      ) : today.data ? (
        <>
          <div className="grid grid-3">
            <Stat label="검토 대기" value={today.data.counts.pendingReview} hint="수집함에서 확인" href="/inbox?review=pending,review_required" />
            <Stat label="근거 확인 필요" value={today.data.counts.needsEvidence} hint="원문 실패·충돌 포함" href="/inbox?evidence=needs_review,fetch_failed,conflict" />
            <Stat label="발행 준비" value={today.data.counts.draftsReady} hint="검토 완료 · 승인 전" href="/drafts" />
          </div>
          <HotTopics cid={selected} rows={today.data.discovered} settings={today.data.discovery} />
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <section className="panel stack">
              <h2 style={{ margin: 0 }}>다음 검토 항목</h2>
              {today.data.next ? (
                <>
                  <GuardedLink href={`/items/${selected}/${today.data.next.id}`} className="title-link">
                    {today.data.next.title}
                  </GuardedLink>
                  <div>
                    <StatusBadge type="review" value={today.data.next.reviewStatus} />
                  </div>
                  <div>
                    <GuardedLink href={`/items/${selected}/${today.data.next.id}`} className="btn primary sm">
                      검토 시작
                    </GuardedLink>
                  </div>
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>검토할 항목이 없습니다.</p>
              )}
            </section>
            <section className="panel stack">
              <h2 style={{ margin: 0 }}>마지막 실행</h2>
              {today.data.lastRun ? (
                <>
                  <div className="row">
                    <StatusBadge type="run" value={today.data.lastRun.status} />
                    <span className="small muted">{fmtDate(today.data.lastRun.startedAt as unknown as string)}</span>
                  </div>
                  <div className="small">
                    신규 {today.data.lastRun.counts.newItems ?? 0}건 · 중복 {today.data.lastRun.counts.duplicates ?? 0}건 · 제외 {today.data.lastRun.counts.excluded ?? 0}건
                  </div>
                  {today.data.lastRun.counts.discoveryArticles !== undefined && (
                    <div className="small muted">
                      화제 발굴: 기사 {today.data.lastRun.counts.discoveryArticles}건 훑음 · 화제 후보 {today.data.lastRun.counts.discoveryHot ?? 0}개 · 선정 {today.data.lastRun.counts.discoveryPicked ?? 0}건
                      {today.data.lastRun.counts.drafted !== undefined && ` · 초안 ${today.data.lastRun.counts.drafted}건`}
                      {!!today.data.lastRun.counts.draftSkippedNoClaude && " · 초안은 AI 연결 후 자동 생성"}
                    </div>
                  )}
                  {today.data.lastRun.errors.length > 0 && (
                    <div className="notice warn small">
                      {today.data.lastRun.errors[0].message}
                      {today.data.lastRun.errors.length > 1 && ` 외 ${today.data.lastRun.errors.length - 1}건`}
                      <div style={{ marginTop: 6 }}>
                        <GuardedLink href="/settings">연결 상태 확인</GuardedLink> · <GuardedLink href="/runs">실행 기록 보기</GuardedLink>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>아직 실행 기록이 없습니다.</p>
              )}
              {today.data.pendingJobs.length > 0 && (
                <p className="small" style={{ margin: 0 }}>
                  대기/처리 중 작업 {today.data.pendingJobs.length}건
                  {status.data && !status.data.workerConnected && <span className="badge warn" style={{ marginLeft: 6 }}>워커 미연결</span>}
                </p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}

function Stat({ label, value, href, hint }: { label: string; value: number; href: string; hint: string }) {
  return (
    <GuardedLink href={href} className="panel stat-card">
      <span className="small muted" style={{ fontWeight: 600 }}>{label}</span>
      <span className="stat" style={{ color: value ? "var(--text)" : "var(--muted)" }}>{value}</span>
      <span className="trend">{hint} →</span>
    </GuardedLink>
  );
}

