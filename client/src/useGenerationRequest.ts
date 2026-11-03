import { useRef, useState } from "react";
import { api, ApiError } from "./api";

type Status = "running" | "uncertain" | "succeeded" | "failed" | "cancelled";
type Request = { path: string; body: Record<string, unknown>; requestId: string; status: Status };
const unresolved = (request: Request | null) => request?.status === "running" || request?.status === "uncertain";

/** Persist only request metadata, not prompts or credentials. A lost HTTP
 * response is retried with the original ID even after reloading this tab.
 */
export function useGenerationRequest(channelId: number, itemId: number, kind: "draft" | "card-copy") {
  const key = `spacepenguin.generation:${channelId}:${itemId}:${kind}`;
  const [request, setRequest] = useState<Request | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Request | null;
      const expected = `/channels/${channelId}/items/${itemId}/${kind === "draft" ? "generate" : "card-copy/generate"}`;
      return value && value.path === expected && typeof value.requestId === "string" && value.body && unresolved(value) ? value : null;
    } catch { return null; }
  });
  const requestRef = useRef(request);
  const cancelledIds = useRef(new Set<string>());
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<Error | null>(null);
  const put = (next: Request) => {
    requestRef.current = next; setRequest(next);
    try {
      if (unresolved(next)) sessionStorage.setItem(key, JSON.stringify(next));
      else sessionStorage.removeItem(key);
    } catch { /* The in-memory ID still protects retries if storage is disabled. */ }
  };
  async function run<T>(path: string, body: Record<string, unknown>): Promise<T> {
    // An unresolved previous attempt is a result lookup, even when the operator
    // has continued manual editing. Never silently start another paid request.
    const active = unresolved(requestRef.current) ? requestRef.current! : { path, body, requestId: crypto.randomUUID(), status: "running" as const };
    put({ ...active, status: "running" }); setCancelError(null);
    try {
      const result = await api<T>(active.path, { method: "POST", body: { ...active.body, requestId: active.requestId } });
      if (cancelledIds.current.has(active.requestId)) throw new ApiError(409, "취소한 AI 결과는 현재 입력에 적용하지 않았습니다.", { jobStatus: "cancelled" });
      if (requestRef.current?.requestId === active.requestId) put({ ...active, status: "succeeded" });
      return result;
    } catch (error) {
      if (requestRef.current?.requestId === active.requestId) {
        const jobStatus = error instanceof ApiError ? error.body.jobStatus : undefined;
        const status: Status = cancelledIds.current.has(active.requestId) || jobStatus === "cancelled" ? "cancelled"
          : jobStatus === "failed" ? "failed" : jobStatus === "running" || jobStatus === "queued" ? "running"
          : error instanceof ApiError && [400, 401, 403, 404, 422].includes(error.status) ? "failed" : "uncertain";
        put({ ...active, status });
      }
      throw error;
    }
  }
  async function cancel() {
    const active = requestRef.current;
    if (!active || !unresolved(active) || cancelling) return;
    setCancelling(true); setCancelError(null);
    try {
      const result = await api<{ cancelled: boolean; jobId?: number }>(`/channels/${channelId}/items/${itemId}/generation-cancel`, { method: "POST", body: { requestId: active.requestId } });
      if (!result.cancelled) throw new Error("작업 중단을 확인하지 못했습니다. 기존 작업 결과를 다시 확인해 주세요.");
      cancelledIds.current.add(active.requestId);
      if (requestRef.current?.requestId === active.requestId) put({ ...active, status: "cancelled" });
    } catch (error) { setCancelError(error as Error); }
    finally { setCancelling(false); }
  }
  return { run, cancel, cancelling, cancelError, unresolved: unresolved(request), cancelled: request?.status === "cancelled", requestId: request?.requestId };
}
