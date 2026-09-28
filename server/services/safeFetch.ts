/**
 * 외부 원문 조회 — 공개 HTTP(S)만, 리디렉트마다 재검사, 크기·시간·횟수 제한.
 * 로그인·유료벽·차단을 우회하지 않는다(401/402/403/429는 그대로 실패로 기록).
 */
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { assertPublicHttpUrl, BlockedUrlError, isPrivateIp } from "./url";

/**
 * 연결 시점에 다시 DNS를 풀어 사설 주소면 거부(DNS 리바인딩 방지).
 * 사전 검사(assertPublicHttpUrl)와 실제 연결 사이에 주소가 바뀌어도 막힌다.
 */
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

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
};

export class FetchFailure extends Error {
  constructor(
    message: string,
    public kind: "blocked" | "http" | "timeout" | "too_large" | "network" | "too_many_redirects",
    public status?: number,
  ) {
    super(message);
  }
}

export async function safeFetch(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; accept?: string } = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxRedirects = opts.maxRedirects ?? 4;
  let current = url;
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    try {
      await assertPublicHttpUrl(current);
    } catch (e) {
      throw new FetchFailure(e instanceof BlockedUrlError ? e.message : "URL 검사 실패", "blocked");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchFailure("시간 초과", "timeout");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(current, {
        dispatcher: guardedAgent,
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent": "ai-mom-studio/0.1 (+education notice monitor; contact via site operator)",
          accept: opts.accept ?? "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
          "accept-language": "ko-KR,ko;q=0.9",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") throw new FetchFailure("시간 초과", "timeout");
      throw new FetchFailure("네트워크 오류", "network");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new FetchFailure(`HTTP ${res.status}`, "http", res.status);
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) {
      clearTimeout(timer);
      throw new FetchFailure("응답이 너무 큼", "too_large");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new FetchFailure("응답이 너무 큼", "too_large");
          }
          chunks.push(Buffer.from(value));
        }
      }
    } catch (e) {
      if (e instanceof FetchFailure) throw e;
      if ((e as Error).name === "AbortError") throw new FetchFailure("시간 초과", "timeout");
      throw new FetchFailure("본문 읽기 실패", "network");
    } finally {
      clearTimeout(timer);
    }
    return {
      finalUrl: current,
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      body: Buffer.concat(chunks),
    };
  }
  throw new FetchFailure("리디렉트가 너무 많음", "too_many_redirects");
}
