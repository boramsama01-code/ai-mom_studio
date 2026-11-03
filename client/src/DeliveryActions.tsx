import { useEffect, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { ErrorBox } from "./ui";
import { useToast } from "./toast";

type DeliveryActionsProps = {
  channelId: number;
  approvalId: number;
  approvalStatus: string;
  delivery?: { id: number; status: string };
  canRetry?: boolean;
  onChanged?: () => void;
};
type ActionResult = { message?: string; approvalCancelled?: boolean; workerStarted?: boolean };

/** Shared controls for the editor, finished-image publication and the publication list. */
export function DeliveryActions({ channelId, approvalId, approvalStatus, delivery, canRetry = true, onChanged }: DeliveryActionsProps) {
  const qc = useQueryClient(), toast = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const key = ["delivery-action", channelId, approvalId];
  const busy = useIsMutating({ mutationKey: key }) > 0;
  useEffect(() => setConfirmed(false), [delivery?.id, delivery?.status, approvalStatus]);
  const action = useMutation({
    mutationKey: key,
    mutationFn: (kind: "cancel" | "retry") => kind === "cancel"
      ? api<ActionResult>(`/channels/${channelId}/approvals/${approvalId}/cancel`, { method: "POST", body: {} })
      : api<ActionResult>(`/channels/${channelId}/deliveries/${delivery!.id}/retry`, { method: "POST", body: { confirmNotPosted: delivery?.status === "unknown" && confirmed } }),
    onSuccess: (result, kind) => {
      setConfirmed(false);
      if (kind === "cancel") toast(result.approvalCancelled === false ? "info" : "ok", result.message ?? "아직 시작하지 않은 전송을 취소했습니다.");
      else toast("info", result.workerStarted ? "다시 전송을 요청했습니다. 아래에서 실제 게시 결과를 확인해 주세요." : "다시 전송할 대기 목록에 넣었습니다. 전송 상태에서 실행 결과를 확인해 주세요.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["ch"] });
      qc.invalidateQueries({ queryKey: ["studio-publication"] });
      onChanged?.();
    },
  });
  const cancellable = approvalStatus === "active" && (!delivery || delivery.status === "scheduled");
  const retryable = approvalStatus === "active" && !!delivery && ["failed", "unknown", "dry_run"].includes(delivery.status);
  if (!cancellable && !retryable) return null;
  return <div className="stack" style={{ gap: 8 }}>
    {retryable && delivery?.status === "unknown" && <label className="check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />게시 계정에서 이 콘텐츠가 게시되지 않은 것을 확인했습니다.</label>}
    <div className="row">
      {cancellable && <button className="btn sm danger" disabled={busy} onClick={() => action.mutate("cancel")}>{action.isPending ? "취소 확인 중…" : "예약 취소"}</button>}
      {retryable && <button className="btn sm" disabled={busy || !canRetry || (delivery?.status === "unknown" && !confirmed)} onClick={() => action.mutate("retry")}>{action.isPending ? "전송 요청 중…" : "다시 전송"}</button>}
    </div>
    {action.error && <ErrorBox error={action.error} />}
  </div>;
}
