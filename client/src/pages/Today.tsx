import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useChannel } from "../state";
import { Empty, ErrorBox, fmtDate, GuardedLink, Loading, StatusBadge } from "../ui";
import type { Job, Run } from "@shared/schema";

type Today = { counts: { pendingReview: number; needsEvidence: number; draftsReady: number }; next: { id: number; title: string; reviewStatus: string } | null; lastRun: Run | null; pendingJobs: Job[] };
type Status = { workerConnected: boolean; queuedJobs: number; integrations: Record<string, unknown> & { flags: Record<string, boolean> }; worker: { startedAt: string; command: string; status: string } | null };

export function TodayPage() {
  const { current, selected } = useChannel();
  const qc = useQueryClient();
  const today = useQuery({ queryKey: ["ch", selected, "today"], queryFn: () => api<Today>(`/channels/${selected}/today`), enabled: selected !== "all" });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("/status") });
  const collect = useMutation({
    mutationFn: () => api<{ duplicate: boolean }>(`/channels/${selected}/jobs/collect`, { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ch", selected] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });

  if (selected === "all")
    return (
      <>
        <h1>오늘의 작업</h1>
        <Empty>오늘의 작업은 채널별로 확인합니다. 왼쪽에서 채널을 하나 선택하세요.</Empty>
      </>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>오늘의 작업</h1>
          <span className="channel-chip">
            <span className="dot" style={{ background: current?.accentColor }} aria-hidden /> {current?.name}
          </span>
        </div>
        <button className="btn primary" onClick={() => collect.mutate()} disabled={collect.isPending || !current?.active}>
          {collect.isPending ? "요청 중…" : "수집 요청"}
        </button>
      </div>
      {collect.isSuccess && (
        <div className="notice warn" role="status" style={{ marginBottom: 16 }}>
          {collect.data.duplicate ? "이미 대기 중인 수집 요청이 있습니다." : "수집 요청을 등록했습니다."} 워커가 실행되어야 처리됩니다
          {status.data && !status.data.workerConnected ? " — 현재 최근 워커 실행 기록이 없습니다(워커 미연결). README의 'GitHub Actions 워커' 단계를 확인하세요." : "."}
        </div>
      )}
      {collect.error && <ErrorBox error={collect.error} />}

      {today.isLoading ? (
        <Loading />
      ) : today.error ? (
        <ErrorBox error={today.error} retry={() => today.refetch()} />
      ) : today.data ? (
        <>
          <div className="grid grid-3">
            <Stat label="검토 대기" value={today.data.counts.pendingReview} href="/inbox?review=pending,review_required" />
            <Stat label="근거 확인 필요" value={today.data.counts.needsEvidence} href="/inbox?evidence=needs_review,fetch_failed,conflict" />
            <Stat label="발행 준비(검토 완료)" value={today.data.counts.draftsReady} href="/drafts" />
          </div>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <section className="panel">
              <h2>다음 검토 항목</h2>
              {today.data.next ? (
                <div className="stack">
                  <GuardedLink href={`/items/${selected}/${today.data.next.id}`}>{today.data.next.title}</GuardedLink>
                  <div>
                    <StatusBadge type="review" value={today.data.next.reviewStatus} />
                  </div>
                </div>
              ) : (
                <p className="muted">검토할 항목이 없습니다.</p>
              )}
            </section>
            <section className="panel">
              <h2>마지막 실행</h2>
              {today.data.lastRun ? (
                <div className="stack">
                  <div className="row">
                    <StatusBadge type="run" value={today.data.lastRun.status} />
                    <span className="small muted">{fmtDate(today.data.lastRun.startedAt as unknown as string)}</span>
                  </div>
                  <div className="small">
                    신규 {today.data.lastRun.counts.newItems ?? 0}건 · 중복 {today.data.lastRun.counts.duplicates ?? 0}건 · 제외 {today.data.lastRun.counts.excluded ?? 0}건
                  </div>
                  {today.data.lastRun.errors.length > 0 && (
                    <div className="notice warn small">
                      {today.data.lastRun.errors[0].message}
                      {today.data.lastRun.errors.length > 1 && ` 외 ${today.data.lastRun.errors.length - 1}건`}
                      <div style={{ marginTop: 6 }}>
                        복구: <GuardedLink href="/settings">연결 상태 확인</GuardedLink> · <GuardedLink href="/runs">실행 기록 보기</GuardedLink>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="muted">아직 실행 기록이 없습니다. 검색 설정을 확인한 뒤 수집을 요청하세요.</p>
              )}
              {today.data.pendingJobs.length > 0 && (
                <p className="small" style={{ marginTop: 12 }}>
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

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <GuardedLink href={href} className="panel" >
      <div className="small muted">{label}</div>
      <div className="stat" style={{ color: "var(--text)" }}>{value}</div>
    </GuardedLink>
  );
}
