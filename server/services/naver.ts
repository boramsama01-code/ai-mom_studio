/**
 * 네이버 검색 API (뉴스/블로그)
 * - query는 단순 텍스트. OR/AND 불리언 문법을 삽입하지 않는다.
 * - 429/일시적 5xx는 제한된 백오프, 인증·권한 오류는 재시도하지 않는다.
 * 문서: https://developers.naver.com/docs/serviceapi/search/news/news.md
 */
import { env } from "../env";
import { stripHtml } from "./text";
import { parseBlogPostDate, parseNewsPubDate, type ParsedDate } from "./dates";

export type NaverEndpoint = "news" | "blog";

export type NaverItem = {
  endpoint: NaverEndpoint;
  title: string;
  description: string;
  link: string;
  originallink?: string;
  bloggername?: string;
  bloggerlink?: string;
  published: ParsedDate;
  raw: Record<string, string>;
};

export class NaverError extends Error {
  constructor(
    message: string,
    public kind: "not_configured" | "auth" | "rate_limit" | "server" | "bad_request" | "network",
    public status?: number,
  ) {
    super(message);
  }
}

export type CallCounter = { naver: number; limit: number };

export function mapNaverItem(endpoint: NaverEndpoint, it: Record<string, string>): NaverItem {
  return {
    endpoint,
    title: stripHtml(it.title || ""),
    description: stripHtml(it.description || ""),
    link: it.link || "",
    originallink: endpoint === "news" ? it.originallink || undefined : undefined,
    bloggername: endpoint === "blog" ? it.bloggername : undefined,
    bloggerlink: endpoint === "blog" ? it.bloggerlink : undefined,
    published: endpoint === "news" ? parseNewsPubDate(it.pubDate) : parseBlogPostDate(it.postdate),
    raw: it,
  };
}

export async function naverSearch(
  query: string,
  endpoint: NaverEndpoint,
  display: number,
  counter: CallCounter,
  fetchImpl: typeof fetch = fetch,
): Promise<NaverItem[]> {
  if (!env.naverClientId || !env.naverClientSecret) throw new NaverError("네이버 API 키 미연결", "not_configured");
  const url = new URL(`https://openapi.naver.com/v1/search/${endpoint}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.min(Math.max(display, 1), 100)));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "date");

  const delays = [0, 1500, 4000];
  let lastErr: NaverError | null = null;
  for (const delay of delays) {
    if (counter.naver >= counter.limit) throw new NaverError("이번 실행의 네이버 호출 한도 도달", "rate_limit");
    if (delay) await new Promise((r) => setTimeout(r, delay));
    counter.naver++;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { "X-Naver-Client-Id": env.naverClientId, "X-Naver-Client-Secret": env.naverClientSecret },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      lastErr = new NaverError("네트워크 오류", "network");
      continue;
    }
    if (res.ok) {
      const json = (await res.json()) as { items?: Record<string, string>[] };
      return (json.items || []).map((it) => mapNaverItem(endpoint, it));
    }
    if (res.status === 401 || res.status === 403) throw new NaverError(`인증/권한 오류 (HTTP ${res.status})`, "auth", res.status);
    if (res.status === 400) throw new NaverError("잘못된 요청(검색어 확인)", "bad_request", 400);
    if (res.status === 429) lastErr = new NaverError("호출 한도 초과(429)", "rate_limit", 429);
    else if (res.status >= 500) lastErr = new NaverError(`네이버 서버 오류 (HTTP ${res.status})`, "server", res.status);
    else throw new NaverError(`HTTP ${res.status}`, "bad_request", res.status);
  }
  throw lastErr ?? new NaverError("알 수 없는 오류", "network");
}

/** 제외어 적용(수집 후). 제외 사유를 반환. */
export function applyExcludeTerms(
  item: { title: string; description: string },
  terms: string[],
  scope: "title" | "title_and_snippet",
): string | null {
  const hay = (scope === "title" ? item.title : `${item.title} ${item.description}`).toLowerCase();
  for (const t of terms) {
    const k = t.trim().toLowerCase();
    if (k && hay.includes(k)) return `제외어 "${t}" 포함 (${scope === "title" ? "제목" : "제목+요약"})`;
  }
  return null;
}
