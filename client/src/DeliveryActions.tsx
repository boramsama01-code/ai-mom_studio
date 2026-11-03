import { useEffect, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { ErrorBox, GuardedLink } from "./ui";
import { useToast } from "./toast";

type DeliveryActionsProps = {
  channelId: number;
  approvalId: number;
  approvalStatus: string;
  delivery?: { id: number; status: string; errorKind?: string | null; needsReconciliation?: boolean; outcomeSource?: string | null };
  contentHref?: string;
  canRetry?: boolean;
  onChanged?: () => void;
};
type ActionResult = { message?: string; approvalCancelled?: boolean; workerStarted?: boolean; status?: string };
type Action = "cancel" | "retry" | "reconcile" | "confirm-posted" | "confirm-not-posted";

/** Shared controls for the editor, finished-image publication and the publication list. */
export function DeliveryActions({ channelId, approvalId, approvalStatus, delivery, contentHref, canRetry = true, onChanged }: DeliveryActionsProps) {
  const qc = useQueryClient(), toast = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [note, setNote] = useState("");
  const key = ["delivery-action", channelId, approvalId];
  const busy = useIsMutating({ mutationKey: key }) > 0;
  useEffect(() => { setConfirmed(false); setExternalUrl(""); setNote(""); }, [delivery?.id, delivery?.status, approvalStatus]);
  const action = useMutation({
    mutationKey: key,
    mutationFn: (kind: Action) => {
      if (kind === "cancel") return api<ActionResult>(`/channels/${channelId}/approvals/${approvalId}/cancel`, { method: "POST", body: {} });
      if (kind === "confirm-not-posted" && !confirmed) throw new Error("계정에서 게시되지 않은 것을 먼저 확인해 주세요.");
      if (kind === "confirm-posted" && !/^https:\/\//i.test(externalUrl.trim())) throw new Error("확인한 게시물의 https 주소를 입력해 주세요.");
      const body = kind === "retry" ? { confirmNotPosted: false } : kind === "confirm-posted" ? { externalUrl: externalUrl.trim(), note: note.trim() || undefined } : kind === "confirm-not-posted" ? { note: note.trim() || undefined } : {};
      return api<ActionResult>(`/channels/${channelId}/deliveries/${delivery!.id}/${kind}`, { method: "POST", body });
    },
    onSuccess: (result, kind) => {
      setConfirmed(false);
      if (kind === "cancel") toast(result.approvalCancelled === false ? "info" : "ok", result.message ?? "아직 시작하지 않은 전송을 취소했습니다.");
      else if (kind === "retry") toast("info", result.workerStarted ? "다시 전송을 요청했습니다. 아래에서 실제 게시 결과를 확인해 주세요." : "다시 전송할 대기 목록에 넣었습니다. 전송 상태에서 실행 결과를 확인해 주세요.");
      else toast("info", result.message ?? (kind === "reconcile" ? "게시 결과를 다시 확인했습니다. 아래 기록을 확인해 주세요." : kind === "confirm-posted" ? "운영자가 게시물을 확인한 기록을 저장했습니다. 새로 게시하지 않았습니다." : "미게시 확인을 기록했습니다. 필요한 경우 다시 전송을 요청할 수 있습니다."));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["ch"] });
      qc.invalidateQueries({ queryKey: ["studio-publication"] });
      onChanged?.();
    },
  });
  const cancellable = approvalStatus === "active" && (!delivery || delivery.status === "scheduled");
  const unresolved = !!delivery && (delivery.status === "unknown" || delivery.needsReconciliation === true);
  const requiresApproval = delivery?.errorKind === "approval_required";
  const retryable = approvalStatus === "active" && !!delivery && !unresolved && !requiresApproval && ["failed", "dry_run"].includes(delivery.status);
  if (!cancellable && !retryable && !unresolved && !requiresApproval) return null;
  return <div className="stack" style={{ gap: 8 }}>
    {requiresApproval && <div className="notice warn small">게시 대상 확인을 위해 재승인이 필요합니다. {contentHref && <GuardedLink href={contentHref}>콘텐츠에서 대상 확인·재승인 →</GuardedLink>}</div>}
    <div className="row">
      {cancellable && <button className="btn sm danger" disabled={busy} onClick={() => action.mutate("cancel")}>{action.isPending ? "취소 확인 중…" : "예약 취소"}</button>}
      {retryable && <button className="btn sm" disabled={busy || !canRetry} onClick={() => action.mutate("retry")}>{action.isPending ? "전송 요청 중…" : "다시 전송"}</button>}
      {unresolved && <button className="btn sm" disabled={busy} onClick={() => action.mutate("reconcile")}>{action.isPending ? "결과 확인 중…" : "게시 결과 다시 확인"}</button>}
    </div>
    {unresolved && <details className="content-options"><summary>게시 계정에서 확인한 결과 기록</summary><div className="stack"><p className="small muted">자동 확인으로 결과를 알 수 없으면 실제 계정에서 확인한 사실을 기록하세요. 이 단계에서는 새 게시 요청을 보내지 않습니다.</p><label className="field">확인 메모<input value={note} disabled={busy} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder="어떤 게시물을 언제 확인했는지 기록" /></label><label className="field">이미 게시된 게시물 주소<input type="url" value={externalUrl} disabled={busy} onChange={event => setExternalUrl(event.target.value)} placeholder="https://www.instagram.com/p/…" /></label><div><button className="btn sm" disabled={busy || !/^https:\/\//i.test(externalUrl.trim())} onClick={() => action.mutate("confirm-posted")}>이미 게시됨으로 기록</button></div><label className="check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />게시 계정에서 이 콘텐츠가 게시되지 않은 것을 확인했습니다.</label><div><button className="btn sm" disabled={busy || !confirmed} onClick={() => action.mutate("confirm-not-posted")}>미게시 확인 기록</button></div></div></details>}
    {action.error && <ErrorBox error={action.error} />}
  </div>;
}
