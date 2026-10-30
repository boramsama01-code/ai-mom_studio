/**
 * 외부 원문 조회 — 공개 HTTP(S)만, 리디렉트마다 재검사, 크기·시간·횟수 제한.
 * 로그인·유료벽·차단을 우회하지 않는다(401/402/403/429는 그대로 실패로 기록).
 */
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { assertPublicHttpUrl, BlockedUrlError, isPrivateIp } from "./url";

/** Public, unauthenticated URL lookup only. POSTs are never allowed to arbitrary hosts. */
export const GOOGLE_NEWS_RPC_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je";

/** Recheck DNS at connection time to prevent DNS rebinding. */
const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        const list = addresses as unknown as dns.LookupAddress[];
        const bad = list.find((a) => isPrivateIp(a.address));
        if (bad || !list.length) return callback(new Error("사설/예약 주소 연결 차단"), "", 4);
        if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
        return callback(null, list[0].address, list[0].family);
      });
    },
  },
});

export type SafeFetchResult = { finalUrl: string; status: number; contentType: string; body: Buffer };
export type SafeFetchOptions = {
  maxBytes?: number; timeoutMs?: number; maxRedirects?: number; accept?: string;
  /** Only accepted for GOOGLE_NEWS_RPC_URL; cookies/auth headers are not supported. */
  googleNewsForm?: string;
};
export class FetchFailure extends Error {
  constructor(message: string, public kind: "blocked" | "redirect" | "http" | "timeout" | "too_large" | "network" | "too_many_redirects", public status?: number, public redirectUrl?: string) {
    super(message);
  }
}

/** A redirect is not an access denial. Never forward the signed POST to its destination. */
export function googleNewsRedirectFailure(status: number, location: string, base = GOOGLE_NEWS_RPC_URL): FetchFailure {
  let target: URL;
  try { target = new URL(location, base); }
  catch { return new FetchFailure(`Google 뉴스 원문 주소 조회가 잘못된 이동 주소를 반환했습니다(HTTP ${status}).`, "redirect", status); }
  const host = target.hostname.toLowerCase();
  const googleHost = ["news.google.com", "google.com", "www.google.com"].includes(host);
  const login = host === "accounts.google.com" || host === "consent.google.com";
  const challenge = googleHost && /^\/(sorry|recaptcha|challenge|signin|ServiceLogin)(?:\/|$)/i.test(target.pathname);
  if (login || challenge) return new FetchFailure(
    `Google 뉴스 원문 주소 조회가 ${login ? "로그인·동의" : "자동 요청 확인"} 화면으로 이동했습니다(HTTP ${status}; ${host}). 언론사 원문의 접근 제한이 아니라 Google 조회 단계의 제한입니다. 확인 화면은 자동 통과하지 않았습니다.`,
    "blocked", status);
  return new FetchFailure(
    `Google 뉴스 원문 주소 조회에서 주소 이동 응답을 받았습니다(HTTP ${status}; ${host}). 이 응답만으로 로그인·구독·접근 차단을 판단하지 않습니다.`,
    "redirect", status, target.href);
}

/** Validate before any network access; exported so the narrow POST boundary is testable. */
export function validateGoogleNewsForm(url: string, form: string): void {
  if (url !== GOOGLE_NEWS_RPC_URL || typeof form !== "string" || form.length > 60_000)
    throw new FetchFailure("허용되지 않은 원문 주소 조회 요청", "blocked");
  try {
    const params = new URLSearchParams(form);
    if ([...params.keys()].join(",") !== "f.req") throw new Error("unexpected form");
    const envelope = JSON.parse(params.get("f.req") || "");
    if (!Array.isArray(envelope) || envelope.length !== 1 || !Array.isArray(envelope[0]) || envelope[0].length !== 1) throw new Error("unexpected envelope");
    const call = envelope[0][0];
    if (!Array.isArray(call) || call[0] !== "Fbv4je" || typeof call[1] !== "string") throw new Error("unexpected RPC");
    const args = JSON.parse(call[1]);
    if (!Array.isArray(args) || args[0] !== "garturlreq" || args.length !== 5) throw new Error("unexpected operation");
  } catch {
    throw new FetchFailure("허용되지 않은 Google 뉴스 조회 형식", "blocked");
  }
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const isRpc = opts.googleNewsForm !== undefined;
  if (isRpc) validateGoogleNewsForm(url, opts.googleNewsForm!);
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxRedirects = isRpc ? 0 : opts.maxRedirects ?? 4;
  let current = url;
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    try { await assertPublicHttpUrl(current); }
    catch (e) { throw new FetchFailure(e instanceof BlockedUrlError ? e.message : "URL 검사 실패", "blocked"); }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchFailure("시간 초과", "timeout");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(current, {
        dispatcher: guardedAgent, redirect: "manual", signal: ctrl.signal,
        ...(isRpc ? { method: "POST", body: opts.googleNewsForm } : {}),
        headers: {
          "user-agent": "ai-mom-studio/0.1 (+education notice monitor; contact via site operator)",
          accept: opts.accept ?? "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
          "accept-language": "ko-KR,ko;q=0.9",
          ...(isRpc ? { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", referer: "https://news.google.com/" } : {}),
        },
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") throw new FetchFailure("시간 초과", "timeout");
      throw new FetchFailure("네트워크 오류", "network");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer); await res.body?.cancel();
      if (isRpc) throw googleNewsRedirectFailure(res.status, res.headers.get("location")!, current);
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer); await res.body?.cancel();
      throw new FetchFailure(`HTTP ${res.status}`, "http", res.status);
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) {
      clearTimeout(timer); await res.body?.cancel();
      throw new FetchFailure("응답이 너무 큼", "too_large");
    }
    const chunks: Buffer[] = []; let total = 0;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) { await reader.cancel(); throw new FetchFailure("응답이 너무 큼", "too_large"); }
          chunks.push(Buffer.from(value));
        }
      }
    } catch (e) {
      if (e instanceof FetchFailure) throw e;
      if ((e as Error).name === "AbortError") throw new FetchFailure("시간 초과", "timeout");
      throw new FetchFailure("본문 읽기 실패", "network");
    } finally { clearTimeout(timer); }
    return { finalUrl: current, status: res.status, contentType: res.headers.get("content-type") || "", body: Buffer.concat(chunks) };
  }
  throw new FetchFailure("리디렉트가 너무 많음", "too_many_redirects");
}
