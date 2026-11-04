import { useRef, useState } from "react";
import { api, ApiError } from "./api";

type Status = "running" | "uncertain" | "succeeded" | "failed" | "cancelled";
type Request = { path: string; body: Record<string, unknown>; requestId: string; status: Status };
const unresolved = (request: Request | null) => request?.status === "running" || request?.status === "uncertain";

/** Persist the request ID and submitted editing intent, never credentials.
 * A lost HTTP response is rechecked with the original ID after reloading.
 */
export function useGenerationRequest(channelId: number, itemId: number, kind: "draft" | "card-copy" | "card-render") {
  const key = `spacepenguin.generation:${channelId}:${itemId}:${kind}`;
  const read = (): Request | null => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Request | null;
      const expected = `/channels/${channelId}/items/${itemId}/${kind === "draft" ? "generate" : kind === "card-render" ? "card" : "card-copy/generate"}`;
      return value && value.path === expected && typeof value.requestId === "string" && value.body && unresolved(value) ? value : null;
    } catch { return null; }
  };
  const [stored, setStored] = useState(() => ({ key, request: read() }));
  const request = stored.key === key ? stored.request : read();
  const scope = useRef({ key, request });
  if (scope.current.key !== key) scope.current = { key, request };
  const cancelledIds = useRef(new Set<string>());
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null);
  const cancelling = cancellingKey === key;
  const cancelError = failure?.key === key ? failure.error : null;
  const put = (next: Request) => {
    if (scope.current.key === key) { scope.current.request = next; setStored({ key, request: next }); }
    try {
      if (unresolved(next)) sessionStorage.setItem(key, JSON.stringify(next));
      else sessionStorage.removeItem(key);
    } catch { /* The in-memory ID still protects retries if storage is disabled. */ }
  };
  async function run<T>(path: string, body: Record<string, unknown>): Promise<T> {
    // An unresolved previous attempt is a result lookup, even when the operator
    // has continued manual editing. Never silently start another paid request.
    const current = scope.current.key === key ? scope.current.request : read();
    const active = unresolved(current) ? current! : { path, body, requestId: crypto.randomUUID(), status: "running" as const };
    put({ ...active, status: "running" }); setFailure(null);
    try {
      const result = await api<T>(active.path, { method: "POST", body: { ...active.body, requestId: active.requestId } });
      if (cancelledIds.current.has(active.requestId)) throw new ApiError(409, "취소한 AI 결과는 현재 입력에 적용하지 않았습니다.", { jobStatus: "cancelled" });
      if (scope.current.key !== key || scope.current.request?.requestId === active.requestId) put({ ...active, status: "succeeded" });
      return result;
    } catch (error) {
      if (scope.current.key !== key || scope.current.request?.requestId === active.requestId) {
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
    const active = scope.current.key === key ? scope.current.request : null;
    if (!active || !unresolved(active) || cancelling) return;
    setCancellingKey(key); setFailure(null);
    try {
      const result = await api<{ cancelled: boolean; jobId?: number }>(`/channels/${channelId}/items/${itemId}/generation-cancel`, { method: "POST", body: { requestId: active.requestId } });
      if (!result.cancelled) throw new Error("작업 중단을 확인하지 못했습니다. 기존 작업 결과를 다시 확인해 주세요.");
      cancelledIds.current.add(active.requestId);
      if (scope.current.key !== key || scope.current.request?.requestId === active.requestId) put({ ...active, status: "cancelled" });
    } catch (error) { setFailure({ key, error: error as Error }); }
    finally { setCancellingKey(current => current === key ? null : current); }
  }
  return { run, cancel, cancelling, cancelError, unresolved: unresolved(request), cancelled: request?.status === "cancelled", requestId: request?.requestId };
}
