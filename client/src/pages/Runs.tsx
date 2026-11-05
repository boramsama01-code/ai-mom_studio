import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, Loading, StatusBadge } from "../ui";
import type { Job, Run } from "@shared/schema";

type WorkerRun = { id: number; workerId: string; command: string; status: string; processed: number; failed: number; note: string; startedAt: string; finishedAt: string | null };
const jobLabels: Record<string, string> = { collect: "자료 수집", publish: "게시", studio_generate: "콘텐츠 AI 작성", source_generate: "원문 초안 AI 작성", card_copy_generate: "카드 문구 AI 제안", card_render: "카드 이미지 생성" };
const cancellableRunningJobs = new Set(["studio_generate", "source_generate", "card_copy_generate", "card_render"]);

function estimatedRunCost(run: Run): number | null {
  // Only an observed complete usage total and the admission-time prices can be estimated.
  // Historical rows without usageStatus must not turn a missing provider response into $0.
  if (run.llmUsage.usageStatus !== "known") return null;
  const snapshotChannel = run.snapshot.channel as { budget?: { llmInputTokenPriceUsdPerM?: number; llmOutputTokenPriceUsdPerM?: number } } | undefined;
  const input = snapshotChannel?.budget?.llmInputTokenPriceUsdPerM, output = snapshotChannel?.budget?.llmOutputTokenPriceUsdPerM;
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || typeof output !== "number" || !Number.isFinite(output) || output < 0) return null;
  return (run.llmUsage.inputTokens * input + run.llmUsage.outputTokens * output) / 1_000_000;
}

export function RunsPage() {
  const { selected, channels } = useChannel();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["ch", selected, "runs"], queryFn: () => api<{ runs: Run[]; workers: WorkerRun[] }>(`/runs?${qs({ channelId: selected })}`) });
  const jobs = useQuery({ queryKey: ["ch", selected, "jobs"], queryFn: () => api<Job[]>(`/jobs?${qs({ channelId: selected })}`), refetchInterval: query => query.state.data?.some(job => job.status === "running" || job.status === "queued") ? 5000 : false });
  const cancel = useMutation({ mutationFn: (id: number) => api(`/jobs/${id}/cancel`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ch", selected] }) });
  const chName = (id: number | null) => channels.find((c) => c.id === id)?.name ?? "—";
  return (
    <>
      <div className="page-head">
        <div>
          <h1>실행 기록</h1>
          <p className="small muted">정상 0건, 실패, 부분 실패, 중단을 구분해 보여줍니다.</p>
        </div>
      </div>
      <section className="panel stack">
        <h2>수집 실행</h2>
        {runs.isLoading ? <Loading /> : runs.error ? <ErrorBox error={runs.error} retry={() => runs.refetch()} /> : !runs.data!.runs.length ? <Empty>실행 기록이 없습니다.</Empty> : (
          <ul className="list">
            {runs.data!.runs.map((r) => {
              const cost = estimatedRunCost(r);
              return (
                <li key={r.id} className="list-item">
                  <div className="row between">
                    <div className="row">
                      <strong>#{r.id}</strong>
                      <StatusBadge type="run" value={r.status} />
                      {selected === "all" && <span className="small muted">{chName(r.channelId)}</span>}
                      <span className="small muted">{{ manual: "수동", worker: "워커", cli: "명령줄", schedule: "예약" }[r.trigger] ?? r.trigger}</span>
                    </div>
                    <span className="small muted">{fmtDate(r.startedAt as unknown as string)}{r.finishedAt ? ` → ${fmtDate(r.finishedAt as unknown as string).slice(11)}` : ""}</span>
                  </div>
                  <div className="meta">
                    <span>검색어 {r.counts.rules ?? 0}개{r.counts.rulesSkippedByBudget ? ` (한도로 ${r.counts.rulesSkippedByBudget}개 건너뜀)` : ""}</span>
                    <span>결과 {r.counts.results ?? 0} · 신규 {r.counts.newItems ?? 0} · 중복 {r.counts.duplicates ?? 0} · 제외 {r.counts.excluded ?? 0}</span>
                    <span>원문 성공 {r.counts.fetchedOk ?? 0} · 실패 {r.counts.fetchFailed ?? 0}</span>
                    <span>추출 {r.counts.extracted ?? 0} · 실패 {r.counts.extractFailed ?? 0}</span>
                  </div>
                  <div className="meta">
                    <span>검색 {r.actualCalls.search ?? r.actualCalls.naver ?? 0}회 · 공개 RSS 요청 {r.actualCalls.rss ?? 0}회 · 네이버 API {r.actualCalls.naver ?? 0}회 · 원문 {r.actualCalls.fetch ?? 0}/{r.plannedCalls.fetch ?? 0}회 · AI {r.actualCalls.llm ?? 0}/{r.plannedCalls.llm ?? 0}회</span>
                    <span>{r.llmUsage.usageStatus === "known" ? "토큰 입력" : "사용량 확인 필요 · 확인된 토큰 입력"} {r.llmUsage.inputTokens.toLocaleString()} · 출력 {r.llmUsage.outputTokens.toLocaleString()}{r.llmUsage.usageStatus !== "known" ? " · 비용 미확정" : cost !== null ? ` · 추정 비용 $${cost.toFixed(4)}(실행 당시 입력한 단가 기준)` : " · 비용 단가 미설정"}</span>
                  </div>
                  {r.unconnectedSources.length > 0 && <span className="small muted">미연결 공식 출처: {r.unconnectedSources.join(", ")}</span>}
                  {r.errors.length > 0 && (
                    <details>
                      <summary className="small">오류·건너뜀 {r.errors.length}건</summary>
                      <ul className="small">{r.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="panel stack">
        <h2>작업 대기열</h2>
        {jobs.isLoading ? <Loading lines={2} /> : jobs.error ? <ErrorBox error={jobs.error} /> : !jobs.data!.length ? <p className="muted small">작업이 없습니다.</p> : (
          <table className="simple">
            <thead><tr><th>#</th><th>유형</th><th>상태</th><th>요청</th><th>메모</th><th /></tr></thead>
            <tbody>
              {jobs.data!.map((j) => (
                <tr key={j.id}>
                  <td>{j.id}</td>
                  <td>{jobLabels[j.type] ?? j.type}{selected === "all" && <div className="small muted">{chName(j.channelId)}</div>}</td>
                  <td><StatusBadge type="job" value={j.status} />{j.attempts > 0 && <div className="small muted">시도 {j.attempts}회</div>}</td>
                  <td className="small">{fmtDate(j.createdAt as unknown as string)}</td>
                  <td className="small">{j.lastError ?? (j.status === "queued" ? "워커 실행을 기다리는 중" : "")}</td>
                  <td>{(j.status === "queued" || (j.status === "running" && cancellableRunningJobs.has(j.type))) && <button className="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(j.id)}>{cancel.isPending && cancel.variables === j.id ? "중단 확인 중…" : j.status === "running" ? "AI 작업 중단" : "취소"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cancel.error && <ErrorBox error={cancel.error} />}
      </section>
      <section className="panel stack">
        <h2>워커 실행</h2>
        {runs.data && !runs.data.workers.length ? <p className="muted small">워커가 아직 한 번도 실행되지 않았습니다(워커 미연결).</p> : (
          <table className="simple">
            <thead><tr><th>명령</th><th>상태</th><th>처리/실패</th><th>시작</th></tr></thead>
            <tbody>
              {runs.data?.workers.map((w) => (
                <tr key={w.id}>
                  <td>{w.command}<div className="small muted">{w.workerId}</div></td>
                  <td><Badge kind={w.status === "ok" ? "ok" : w.status === "running" ? "" : "warn"}>{{ ok: "정상", partial: "부분 실패", failed: "실패", running: "실행 중/중단" }[w.status] ?? w.status}</Badge></td>
                  <td>{w.processed}/{w.failed}</td>
                  <td className="small">{fmtDate(w.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

