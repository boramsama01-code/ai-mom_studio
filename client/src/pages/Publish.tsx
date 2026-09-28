import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useChannel } from "../state";
import { Badge, Empty, ErrorBox, fmtDate, GuardedLink, Loading } from "../ui";
import { PUBLISH_LABEL } from "@shared/domain";
import type { Delivery } from "@shared/schema";

type Row = { d: Delivery; dest: { label: string; platform: string }; ap: { id: number; scheduledAt: string; status: string; revisionId: number }; item: { id: number; title: string; channelId: number } };

export function PublishPage() {
  const { selected } = useChannel();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<{ integrations: { flags: Record<string, boolean> }; workerConnected: boolean }>("/status") });
  const q = useQuery({ queryKey: ["ch", selected, "deliveries"], queryFn: () => api<Row[]>(`/deliveries?${qs({ channelId: selected })}`) });
  const flags = status.data?.integrations.flags;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>발행함</h1>
          <p className="small muted">최종 승인된 콘텐츠의 목적지별 전송 상태입니다.</p>
        </div>
      </div>
      {flags && (
        <div className={`notice ${flags.dryRun || !flags.autoPublish ? "warn" : "ok"}`} style={{ marginBottom: 16 }}>
          {flags.dryRun
            ? "모의 실행(DRY_RUN) 중 — 모든 사전 검사를 하지만 실제로 게시하지 않습니다."
            : flags.autoPublish
              ? "실제 게시 사용 중(AUTO_PUBLISH=true)."
              : "실제 게시가 꺼져 있습니다(AUTO_PUBLISH=false)."}
          {status.data && !status.data.workerConnected && " 최근 워커 실행 기록이 없어 예약 건이 처리되지 않을 수 있습니다."}
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty>
          아직 승인·전송 기록이 없습니다. 콘텐츠를 검토 완료 → 카드 생성 → 최종 승인하면 여기에 나타납니다. 게시 목적지는 <GuardedLink href="/settings">채널 설정</GuardedLink>에서 연결합니다.
        </Empty>
      ) : (
        <ul className="list">
          {q.data.map((r) => (
            <li key={r.d.id} className="list-item">
              <GuardedLink href={`/items/${r.item.channelId}/${r.item.id}`} className="title">
                {r.item.title}
              </GuardedLink>
              <div className="row small">
                <span>{r.dest.label}</span>
                <Badge kind={r.d.status === "succeeded" ? "ok" : ["failed", "unknown"].includes(r.d.status) ? "err" : r.d.status === "dry_run" ? "warn" : ""}>{PUBLISH_LABEL[r.d.status] ?? r.d.status}</Badge>
                <span className="muted">예약 {fmtDate(r.ap.scheduledAt)}</span>
                {r.d.completedAt && <span className="muted">완료 {fmtDate(r.d.completedAt as unknown as string)}</span>}
                {r.d.externalUrl && (
                  <a href={r.d.externalUrl} target="_blank" rel="noopener noreferrer">
                    게시물 보기
                  </a>
                )}
              </div>
              {r.d.lastError && <span className="small muted">{r.d.lastError}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
