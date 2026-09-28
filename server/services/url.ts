import dns from "node:dns/promises";
import net from "node:net";

/** 추적용 파라미터만 제거. 게시물 ID 등 나머지 파라미터는 보존. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "yclid",
  "ref_src",
]);

export function normalizeUrl(input: string): string {
  const u = new URL(input.trim());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const keep: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    const lk = k.toLowerCase();
    if (lk.startsWith("utm_") || TRACKING_PARAMS.has(lk)) continue;
    keep.push([k, v]);
  }
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let s = u.toString();
  // 경로가 "/"뿐인 경우 외에 끝 슬래시는 유지(서버마다 의미가 다를 수 있음)
  if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
  return s;
}

/* ───────────── SSRF 방지 ───────────── */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // 클라우드 메타데이터 포함
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::" || l === "::1") return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (/^f[cd]/.test(l)) return true; // unique local
    if (/^fe[89ab]/.test(l)) return true; // link local
    if (/^ff/.test(l)) return true; // multicast
    return false;
  }
  return true;
}

export class BlockedUrlError extends Error {}

/** 공개 HTTP(S)만 허용. 호스트를 DNS로 풀어 사설·메타데이터 주소면 차단. */
export async function assertPublicHttpUrl(raw: string, lookup = dns.lookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("잘못된 URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("http/https만 허용");
  if (u.username || u.password) throw new BlockedUrlError("인증정보 포함 URL 차단");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))
    throw new BlockedUrlError("내부 호스트 차단");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new BlockedUrlError("허용되지 않은 포트");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedUrlError("사설/예약 주소 차단");
    return u;
  }
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new BlockedUrlError("DNS 조회 실패");
  for (const a of addrs) if (isPrivateIp(a.address)) throw new BlockedUrlError("사설/예약 주소로 해석되는 호스트 차단");
  return u;
}
