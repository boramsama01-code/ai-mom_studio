import { env } from "../env";
import { AiServiceError } from "./llm";
import { currentGenerationSignal } from "./generationContext";

/** Includes the initial request. A successful or ambiguous request is never replayed. */
export const GEMINI_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRY_DELAY_MS = 15_000;
const MAX_ERROR_BYTES = 32_768;

type FailureInfo = { retryable: boolean; quotaExceeded?: boolean; retryAfterMs?: number };
type FailureMessageOptions = Partial<FailureInfo> & { attempts?: number };

export function geminiFailureMessage(status: number, options: FailureMessageOptions = {}): string {
  const reason = status === 503 ? "Gemini 서버가 잠시 혼잡합니다. 잠시 후 다시 시도하거나 AI 없이 직접 편집을 이어가세요." :
    status === 429 && options.quotaExceeded ? "프로젝트 사용 한도에 도달했습니다. AI Studio에서 할당량·결제 상태를 확인하거나 한도가 초기화된 뒤 다시 시도하세요. 직접 편집은 계속할 수 있습니다." :
    status === 429 && options.retryable ? "짧은 시간에 요청이 몰려 Gemini 호출이 제한됐습니다. 잠시 기다린 뒤 다시 시도하거나 직접 편집을 이어가세요." :
    status === 429 ? "호출 한도에 도달했습니다. AI Studio에서 프로젝트 한도를 확인하고 나중에 다시 시도하세요. 직접 편집은 계속할 수 있습니다." :
    status === 401 || status === 403 ? "설정의 Gemini API 키·모델 접근 권한·이용 가능 지역을 확인하세요." :
    status === 402 ? "Gemini 이용 크레딧이 부족합니다. AI Studio에서 결제 상태를 확인하세요. 직접 편집은 계속할 수 있습니다." :
    status === 404 ? "모델을 찾을 수 없습니다. 설정의 모델 ID를 확인하세요." :
    status === 400 ? "키 또는 요청 형식을 확인하세요. 무료 등급 이용 가능 여부도 AI Studio에서 확인하세요." :
    "요청을 완료하지 못했습니다. 기존 내용을 확인한 뒤 다시 시도하거나 직접 편집을 이어가세요.";
  const attempted = (options.attempts ?? 1) > 1 ? ` 총 ${options.attempts}회 시도했습니다.` : "";
  const retryAfter = options.retryAfterMs && Number.isFinite(options.retryAfterMs) ? ` 다시 요청하려면 최소 ${Math.ceil(options.retryAfterMs / 1000)}초 기다려 주세요.` : "";
  return `Gemini HTTP ${status}: ${reason}${attempted}${retryAfter}`;
}

export function geminiModelUrl(model = env.geminiModel): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,119}$/.test(model)) throw new AiServiceError("Gemini 모델 ID 형식이 올바르지 않습니다.", "not_configured");
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = /^[A-Za-z]{3},/.test(trimmed) ? Date.parse(trimmed) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function discardResponse(response: Response) {
  try { await response.body?.cancel(); } catch { /* Nothing from an upstream error is logged or returned. */ }
}

/** The error body is read only to classify a limit; its contents never leave this adapter. */
async function boundedResponseText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get("content-length") || 0) > limit) {
    await discardResponse(response);
    throw new AiServiceError("Gemini 응답이 저장 한도를 초과했습니다.", "parse");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AiServiceError("Gemini 응답이 비어 있습니다.", "parse");
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new AiServiceError("Gemini 응답이 저장 한도를 초과했습니다.", "parse");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

async function failureInfo(response: Response, signal: AbortSignal): Promise<FailureInfo> {
  const headerDelay = retryAfterMs(response.headers.get("retry-after"));
  if (response.status !== 429) {
    await discardResponse(response);
    // A timeout, network failure, 500 or 504 can have an unknown/billable outcome.
    return { retryable: response.status === 503, retryAfterMs: headerDelay };
  }
  try {
    const parsed = JSON.parse(await boundedResponseText(response, MAX_ERROR_BYTES, signal));
    const error = parsed?.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return { retryable: false, retryAfterMs: headerDelay };
    const description = JSON.stringify(error);
    // Daily/zero quotas and billing caps sometimes also carry RetryInfo: they take precedence.
    const quotaExceeded = /per[\s_-]?day|daily|insufficient[_ -]quota|quota_exceeded|spend[\s_-]?(?:cap|limit)|billing[\s_-](?:disabled|not[\s_-]enabled)|(?:credit|balance)[\s_-](?:depleted|exhausted|insufficient)|(?:depleted|insufficient)[\s_-](?:credit|balance)|\blimit[\s\"]*[:=]\s*0(?:\D|$)|"quota(?:Value|_value)"\s*:\s*"?0(?:["},\s]|$)/i.test(description);
    const details = Array.isArray(error.details) ? error.details : [];
    const retryInfo = details.find((detail: any) => detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo");
    const delayMatch = typeof retryInfo?.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(retryInfo.retryDelay) : null;
    const detailDelay = delayMatch ? Number(delayMatch[1]) * 1000 : undefined;
    const delay = headerDelay === undefined && detailDelay === undefined ? undefined : Math.max(headerDelay ?? 0, detailDelay ?? 0);
    const temporaryLimit = /rate_limit_exceeded|too_many_requests|per[\s_-]?(?:minute|second)|\b(?:RPM|TPM)\b/i.test(description);
    return { retryable: !quotaExceeded && (temporaryLimit || delay !== undefined), quotaExceeded, retryAfterMs: delay };
  } catch {
    // A malformed/oversized/unknown 429 is not evidence of a temporary limit.
    return { retryable: false, retryAfterMs: headerDelay };
  }
}

function waitToRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Fixed key/model/origin; bounded transient retries only, with one deadline and no provider fallback. */
export async function geminiRequest(body: Record<string, unknown>, options: {
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Reserve each extra HTTP request against the caller's existing request budget. */
  reserveRetry?: () => boolean;
} = {}): Promise<Record<string, any>> {
  const key = env.geminiKey;
  if (!key) throw new AiServiceError("설정에서 Gemini API 키를 먼저 입력하세요.", "not_configured");
  const url = `${geminiModelUrl(options.model)}:generateContent`;
  const requestBody = JSON.stringify(body);
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? REQUEST_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  timer.unref?.();
  const cancellation = [options.signal, currentGenerationSignal()].filter((signal): signal is AbortSignal => !!signal);
  const signal = AbortSignal.any([...cancellation, timeout.signal]);
  try {
    for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      const response = await fetch(url, {
        method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: requestBody, signal, redirect: "error",
      });
      if (!response.ok) {
        const failure = await failureInfo(response, signal);
        signal.throwIfAborted();
        const error = new AiServiceError(geminiFailureMessage(response.status, { ...failure, attempts: attempt }));
        const delay = Math.max(failure.retryAfterMs ?? 0, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        // Never shorten Retry-After to fit the UI deadline or bypass a local request budget.
        if (!failure.retryable || attempt === GEMINI_MAX_ATTEMPTS || delay > MAX_RETRY_DELAY_MS || Date.now() + delay >= deadline) throw error;
        if (options.reserveRetry && !options.reserveRetry()) throw error;
        await waitToRetry(delay, signal);
        continue;
      }
      const text = await boundedResponseText(response, 2_000_000, signal);
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
        return parsed as Record<string, any>;
      } catch { throw new AiServiceError("Gemini 응답 형식을 읽을 수 없습니다.", "parse"); }
    }
    throw new AiServiceError("Gemini 요청을 완료하지 못했습니다. 잠시 후 다시 시도하거나 직접 편집을 이어가세요.");
  } catch (error) {
    if (cancellation.some(value => value.aborted)) throw new AiServiceError("Gemini 요청을 취소했습니다. 기존 내용은 유지됩니다. 공급자의 처리·과금 여부는 확인할 수 없어 자동 재호출하지 않았습니다.");
    if (signal.aborted) throw new AiServiceError("Gemini 응답 대기 시간이 초과됐습니다. 처리 여부를 확인할 수 없어 중복 요청을 피하려고 자동 재시도하지 않았습니다. 기존 내용을 확인하거나 직접 편집을 이어가세요.");
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError("Gemini 연결 오류입니다. 처리 여부를 확인할 수 없어 중복 요청을 피하려고 자동 재시도하지 않았습니다. 기존 내용을 확인하거나 직접 편집을 이어가세요.");
  } finally {
    clearTimeout(timer);
  }
}
