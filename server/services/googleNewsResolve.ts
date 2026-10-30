/**
 * Resolve modern opaque Google News links using their own public URL-lookup response.
 * This is not a supported Google API; fail closed if its format changes.
 * No cookies, account credentials, proxies, CAPTCHA solving, page-script execution, or retries.
 */
import { load } from "cheerio";
import { isIP } from "node:net";
import { GOOGLE_NEWS_RPC_URL, safeFetch, FetchFailure } from "./safeFetch";
import { isPrivateIp } from "./url";
import { articleAccessProblem } from "./articleSource";

export type GoogleNewsParameters = { articleId: string; timestamp: number; signature: string };
export function googleNewsArticleId(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "news.google.com" || u.username || u.password || u.port) return null;
    return u.pathname.match(/^\/(?:rss\/articles|articles|read)\/([A-Za-z0-9_-]{8,8192})\/?$/)?.[1] ?? null;
  } catch { return null; }
}

/** Only use parameters belonging to the requested article, not another item on the page. */
export function googleNewsParameters(url: string, html: string): GoogleNewsParameters | null {
  const articleId = googleNewsArticleId(url);
  if (!articleId) return null;
  const $ = load(html), candidates = new Map<string, GoogleNewsParameters>();
  $("[data-n-a-sg][data-n-a-ts]").slice(0, 50).each((_, el) => {
    const node = $(el), nodeId = node.attr("data-n-a-id");
    if (nodeId && nodeId !== articleId) return;
    const signature = node.attr("data-n-a-sg") || "", rawTime = node.attr("data-n-a-ts") || "";
    if (!/^[A-Za-z0-9_=-]{1,512}$/.test(signature) || !/^\d{1,16}$/.test(rawTime)) return;
    const timestamp = Number(rawTime);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return;
    candidates.set(`${timestamp}:${signature}`, { articleId, timestamp, signature });
  });
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

/** Protocol data, encoded with JSON and URLSearchParams rather than string interpolation. */
export function googleNewsRequestForm(p: GoogleNewsParameters): string {
  const context = [
    ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
    "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
  ];
  const args = JSON.stringify(["garturlreq", context, p.articleId, p.timestamp, p.signature]);
  return new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", args]]]) }).toString();
}
function publisherUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const u = new URL(value), host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return null;
    if (/(^|\.)google\.[a-z.]+$/.test(host) || /(^|\.)(localhost|local|internal|invalid)$/.test(host) || (isIP(host) && isPrivateIp(host))) return null;
    u.hash = "";
    return u.href; // DNS/public-IP validation still happens in safeFetch before following it.
  } catch { return null; }
}

/** Accept only an unambiguous garturlres inside an Fbv4je frame, never any URL in the response. */
export function parseGoogleNewsResponse(raw: string): string | null {
  if (raw.length > 512_000) return null;
  const text = raw.replace(/^\uFEFF/, "").replace(/^\)\]\}'[^\n]*\n/, "").trim();
  const urls = new Set<string>(); let nodes = 0;
  function frames(value: unknown, depth = 0): void {
    if (++nodes > 1000 || depth > 8 || !Array.isArray(value)) return;
    if (value[0] === "wrb.fr" && value[1] === "Fbv4je" && typeof value[2] === "string") {
      try {
        const result = JSON.parse(value[2]);
        if (Array.isArray(result) && result[0] === "garturlres") { const u = publisherUrl(result[1]); if (u) urls.add(u); }
      } catch { /* malformed data is not executable */ }
      return;
    }
    for (const child of value) frames(child, depth + 1);
  }
  // Google may return one JSON document or length-prefixed, line-delimited JSON frames.
  try { frames(JSON.parse(text)); }
  catch {
    for (const line of text.split(/\r?\n/).slice(0, 100)) {
      if (!line.trimStart().startsWith("[")) continue;
      try { frames(JSON.parse(line)); } catch { /* incomplete frame */ }
    }
  }
  return urls.size === 1 ? [...urls][0] : null;
}

export async function resolveGoogleNewsArticle(
  url: string, html: string, fetchImpl: typeof safeFetch = safeFetch,
  context: { deadline: number; takeExtraCall?: () => boolean },
): Promise<string | null> {
  const parameters = googleNewsParameters(url, html);
  if (!parameters) return null;
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) throw new FetchFailure("원문 주소 확인 시간 한도를 초과했습니다.", "timeout");
  if (context.takeExtraCall && !context.takeExtraCall()) throw new FetchFailure("이번 수집의 원문 호출 한도에 도달했습니다. 원문 다시 확보를 눌러 확인해 주세요.", "too_large");
  let response;
  try {
    response = await fetchImpl(GOOGLE_NEWS_RPC_URL, {
      googleNewsForm: googleNewsRequestForm(parameters), maxBytes: 512_000,
      timeoutMs: Math.min(8000, remaining), maxRedirects: 0, accept: "application/json,text/plain,*/*;q=0.1",
    });
  } catch (e) {
    // A public publisher redirect is URL-resolution data, NOT permission to forward the POST.
    // The caller fetches that URL with GET and repeats all DNS/SSRF checks.
    if (e instanceof FetchFailure && e.kind === "redirect" && e.redirectUrl) {
      const resolved = publisherUrl(e.redirectUrl);
      if (resolved && !/\/(login|signin|captcha|challenge|consent|paywall|subscribe)(?:\/|$)/i.test(new URL(resolved).pathname)) return resolved;
    }
    if (e instanceof FetchFailure && e.kind === "http" && [401, 402, 403, 429].includes(e.status ?? 0))
      throw new FetchFailure(`Google 뉴스 원문 주소 조회가 제한되었습니다(HTTP ${e.status}). 아직 언론사 본문을 요청한 단계가 아닙니다. 자동 재시도하지 않았습니다.`, "blocked", e.status);
    throw e;
  }
  const text = response.body.toString("utf8");
  if (response.finalUrl !== GOOGLE_NEWS_RPC_URL || /text\/html/i.test(response.contentType)) {
    const reason = articleAccessProblem(text);
    throw new FetchFailure(reason || "Google 뉴스 주소 조회가 로그인·동의 또는 확인 화면을 반환했습니다. 자동 통과하지 않았습니다.", "blocked");
  }
  return parseGoogleNewsResponse(text);
}
