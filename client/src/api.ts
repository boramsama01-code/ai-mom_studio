/** API 클라이언트 — 변경 요청에는 CSRF 토큰을 붙인다 */
let csrf: string | null = null;
export function setCsrf(t: string | null) {
  csrf = t;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: "same-origin", signal: opts.signal });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json().catch(() => ({})) : {};
  opts.signal?.throwIfAborted();
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error || `요청 실패 (HTTP ${res.status})`, body as Record<string, unknown>);
  return body as T;
}

export const qs = (o: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

/** Keep download failures in the editor instead of navigating away to a JSON error. */
export async function apiBlob(path: string, expectedType: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Blob> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: "same-origin", signal: opts.signal });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }
  const type = res.headers.get("content-type")?.split(";")[0].trim();
  if (!res.ok) {
    const body = type === "application/json" ? await res.json().catch(() => ({})) : {};
    throw new ApiError(res.status, body.error || `파일 요청 실패 (HTTP ${res.status})`, body);
  }
  if (type !== expectedType) throw new ApiError(502, "파일 응답을 확인할 수 없습니다. 로그인 상태를 확인한 뒤 다시 시도하세요.");
  return res.blob();
}

/** 파일 그대로 올리기(이미지 업로드 등) */
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = { "content-type": file.type || "application/octet-stream" };
  if (csrf) headers["x-csrf-token"] = csrf;
  let res: Response;
  try { res = await fetch(`/api${path}`, { method: "POST", headers, body: file, credentials: "same-origin" }); }
  catch { throw new ApiError(0, "파일을 저장하지 못했습니다. 네트워크를 확인한 뒤 다시 저장해 주세요."); }
  const body = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error || `업로드 실패 (HTTP ${res.status})`, body as Record<string, unknown>);
  return body as T;
}


