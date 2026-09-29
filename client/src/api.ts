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

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error || `요청 실패 (HTTP ${res.status})`, body as Record<string, unknown>);
  return body as T;
}

export const qs = (o: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

/** 파일 그대로 올리기(이미지 업로드 등) */
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = { "content-type": file.type || "application/octet-stream" };
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: file, credentials: "same-origin" });
  const body = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error || `업로드 실패 (HTTP ${res.status})`, body as Record<string, unknown>);
  return body as T;
}
