import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { ErrorBox, fmtDate, GuardedLink } from "./ui";

export type PublicationRuntime = {
  integrations?: { flags?: { dryRun?: boolean; autoPublish?: boolean } };
  globalStop?: boolean;
  workerConnected?: boolean;
  inlinePublishing?: boolean;
  publisherHealth?: {
    connected: boolean; status: string; mode: string; lastSeenAt: string | null;
    lastSweepAt: string | null; ageSeconds: number | null; lastError: string | null;
    staleAfterSeconds: number; overdueCount: number; unknownCount: number;
    processingCount: number; oldestPendingAt: string | null;
  };
};

export function usePublicationRuntime() {
  return useQuery({ queryKey: ["status"], queryFn: () => api<PublicationRuntime>("/status"), refetchInterval: 30_000 });
}

export function publicationMode(runtime?: PublicationRuntime): { title: string; detail: string; tone: "" | "ok" | "warn"; blocked: boolean } {
  const flags = runtime?.integrations?.flags;
  if (runtime?.globalStop) return { title: "전체 발행 일시 정지", detail: "승인·예약 기록은 유지되지만 정지를 해제하기 전에는 전송하지 않습니다.", tone: "warn", blocked: true };
  if (flags?.dryRun) return { title: "모의 실행 · 실제 게시 안 함", detail: "예약 시간이 지나도 Instagram에 올라가지 않습니다. 실행 결과는 모의 실행으로 기록되며, 실제 게시 설정과 계정 연결을 확인해야 합니다.", tone: "warn", blocked: true };
  if (flags?.autoPublish === false) return { title: "실제 게시 꺼짐", detail: "승인을 저장해도 자동 전송하지 않습니다. 서버의 실제 게시 설정을 켜야 예약 건을 처리할 수 있습니다.", tone: "warn", blocked: true };
  if (flags?.dryRun === false && flags.autoPublish === true) {
    if (runtime?.workerConnected === false) return { title: "게시 실행기 확인 필요", detail: "실제 게시 설정은 켜져 있지만 최근 실행 기록이 없습니다. 예약 시각이 지난 대기 건은 실행 기록에서 원인을 확인하세요.", tone: "warn", blocked: false };
    return { title: "실제 게시 사용 중", detail: "승인 저장 후 게시 계정과 전송 조건을 확인해 처리합니다. 목적지별 ‘게시 성공’과 게시물 링크로 완료 여부를 확인하세요.", tone: "ok", blocked: false };
  }
  return { title: "게시 설정 확인 중", detail: "현재 실행 모드를 확인하기 전에는 실제 게시 여부를 확정할 수 없습니다.", tone: "", blocked: false };
}

export function PublicationRuntimeNotice({ runtime, error, retry }: { runtime?: PublicationRuntime; error?: unknown; retry?: () => void }) {
  if (error) return <div className="stack"><p className="small muted">게시 설정을 불러오지 못했습니다. 아래 전송 기록에서 개별 결과를 확인하세요.</p><ErrorBox error={error} retry={retry} /></div>;
  const mode = publicationMode(runtime);
  const health = runtime?.publisherHealth;
  return <div className={`notice ${mode.tone}`} role="status"><strong>{mode.title}</strong><p className="small" style={{ marginBottom: 0 }}>{mode.detail}</p>{health && <p className="small muted">최근 발행기 동작 {health.lastSeenAt ? fmtDate(health.lastSeenAt) : "아직 확인되지 않음"} · 예약 지연 {health.overdueCount}건 · 결과 확인 필요 {health.unknownCount}건{health.oldestPendingAt && <> · 가장 오래된 대기 {fmtDate(health.oldestPendingAt)}</>}</p>}{runtime?.inlinePublishing && <p className="small muted">예약 시각 이후 처리됩니다. 서버 휴면·재시작 시 지연될 수 있으며 발행함에서 실제 결과를 확인하세요.</p>}{runtime?.workerConnected === false && <GuardedLink className="small" href="/runs">실행 기록 확인 →</GuardedLink>}</div>;
}

export function deliveryState(status: string, scheduledAt?: string | Date | null, now = Date.now(), outcomeSource?: string | null): { label: string; detail: string; tone: "" | "ok" | "warn" | "err" } {
  if (status === "succeeded" && outcomeSource === "operator_confirmed") return { label: "게시됨 · 운영자 확인", detail: "운영자가 실제 계정의 게시물을 확인해 기록했습니다. 외부 API의 완료 응답으로 확인한 결과와 구분됩니다.", tone: "ok" };
  if (status === "succeeded") return { label: "게시 성공", detail: "목적지에서 게시 완료 응답을 받았습니다.", tone: "ok" };
  if (status === "dry_run") return { label: "모의 실행 완료 · 실제 게시 안 함", detail: "검사만 실행한 기록입니다. Instagram 게시물은 생성되지 않았습니다.", tone: "warn" };
  if (status === "failed") return { label: "전송 실패", detail: "아래 오류를 확인하고 계정·권한 또는 연결 문제를 해결한 뒤 재시도하세요.", tone: "err" };
  if (status === "unknown") return { label: "게시 여부 확인 필요", detail: "완료 응답을 확인하지 못했습니다. 계정에 실제 게시물이 있는지 먼저 확인하세요. 바로 재시도하면 중복 게시될 수 있습니다.", tone: "warn" };
  if (status === "cancelled") return { label: "전송 취소됨", detail: "이 전송 건은 처리하지 않습니다. 취소 사유를 확인하세요.", tone: "" };
  if (status === "processing") return { label: "전송 처리 중", detail: "게시 완료 응답을 기다리고 있습니다. 아직 게시 성공으로 확정되지 않았습니다.", tone: "" };
  if (status === "scheduled" || status === "waiting") {
    const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
    const due = scheduledTime <= now;
    if (due && now - scheduledTime <= 60_000) return { label: "전송 대기 · 게시 요청됨", detail: "게시 요청이 저장되었습니다. 전송이 시작되면 진행 상황과 실제 게시 결과가 여기에 표시됩니다.", tone: "" };
    return due
      ? { label: "예약 시각 지남 · 전송 대기", detail: "예약 시간이 지났지만 전송이 시작되지 않았습니다. 현재 게시 설정, 계정 연결, 실행 기록을 확인하세요.", tone: "warn" }
      : { label: "예약 대기 · 아직 게시 안 됨", detail: "승인과 예약이 저장되었습니다. 예약 시각 이후 전송 결과가 여기에 표시됩니다.", tone: "" };
  }
  return { label: status, detail: "전송 기록의 상태를 확인하세요.", tone: "" };
}

export function deliverySummary(deliveries: Array<{ status: string }>) {
  const counts = new Map<string, number>();
  for (const delivery of deliveries) counts.set(delivery.status, (counts.get(delivery.status) ?? 0) + 1);
  return [["succeeded", "게시됨"], ["failed", "실패"], ["unknown", "결과 확인 필요"], ["cancelled", "취소"], ["scheduled", "대기"], ["processing", "전송 중"], ["dry_run", "모의 실행"]]
    .filter(([status]) => counts.has(status)).map(([status, label]) => `${label} ${counts.get(status)}건`).join(" · ");
}
