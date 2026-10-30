/** Reuse only an actually fetched article URL. Never infer one from a title or publisher homepage. */
import { isIP } from "node:net";
import { isPrivateIp } from "./url";

type Source = { originalUrl: string; meta: Record<string, unknown>; fetchedText?: string | null; contentHash?: string | null };
const isGoogle = (value: string) => { try { return new URL(value).hostname === "news.google.com"; } catch { return false; } };
export function sourceFetchUrl(source: Source): string {
  const fallback = typeof source.meta.fetchUrl === "string" && source.meta.fetchUrl ? source.meta.fetchUrl : source.originalUrl;
  if (!isGoogle(source.originalUrl) && !isGoogle(fallback)) return fallback;
  if (!source.contentHash || !source.fetchedText || typeof source.meta.finalUrl !== "string") return fallback;
  try {
    const u = new URL(source.meta.finalUrl), host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return fallback;
    if (/(^|\.)google\.[a-z.]+$/.test(host) || /(^|\.)(localhost|internal|local)$/.test(host) || (isIP(host) && isPrivateIp(host))) return fallback;
    u.hash = "";
    return u.href; // safeFetch still validates DNS before making the GET request.
  } catch { return fallback; }
}
