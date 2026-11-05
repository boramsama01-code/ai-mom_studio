/**
 * 공식 게시판 어댑터(설정형) — "generic_board"
 * 운영자가 확인한 게시판 목록 URL과 CSS 선택자로 공고 목록을 읽는다.
 * - 같은 공식 도메인의 링크만 수집(외부 링크·다른 도메인 무시)
 * - 로그인·차단 페이지는 우회하지 않고 실패로 기록
 * 실제 학교 게시판 구조는 학교마다 달라 선택자를 운영자가 직접 확인해 입력해야 한다.
 */
import * as cheerio from "cheerio";
import { safeFetch, FetchFailure } from "./safeFetch";
import { decodePublicText } from "./publicTextResponse";

export type BoardConfig = {
  linkSelector: string; // 예: "table.board_list td.subject a"
  titleSelector?: string | null; // 링크 안에서 제목을 찾을 선택자(없으면 링크 텍스트)
  dateSelector?: string | null; // 같은 행(tr/li) 안의 날짜 선택자
  maxItems?: number;
  format?: "links" | "ged_selection" | "rss";
  subcategory?: string;
  maxAgeDays?: number;
  recruitmentOnly?: boolean;
};

export type BoardEntry = { url: string; title: string; dateText: string | null };

export function officialHostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host.toLowerCase() === d || host.toLowerCase().endsWith(`.${d}`);
}

function officialUrl(value: string, pageUrl: string, domain: string): string | null {
  try {
    const u = new URL(value, pageUrl);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !officialHostMatches(u.hostname, domain)) return null;
    u.hash = "";
    return u.href;
  } catch { return null; }
}

export function parseBoardList(html: string, pageUrl: string, domain: string, cfg: BoardConfig): BoardEntry[] {
  const $ = cheerio.load(html, { xmlMode: cfg.format === "rss" });
  const out: BoardEntry[] = [];
  const seen = new Set<string>();
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (!officialUrl(pageUrl, pageUrl, d)) return [];
  const limit = Math.min(100, Math.max(1, cfg.maxItems ?? 20));
  if (cfg.format === "rss") {
    if (!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(html)) throw new Error("공식 RSS/Atom 형식이 아닙니다.");
    $("item, entry").each((_, el) => {
      if (out.length >= limit) return false;
      const row = $(el);
      const href = row.find('link[rel="alternate"]').attr("href") || row.find("link").first().attr("href") || row.find("link").first().text().trim();
      const url = officialUrl(href, pageUrl, d);
      const title = cheerio.load(row.find("title").first().text()).text().replace(/\s+/g, " ").trim().slice(0, 500);
      const rawDate = row.find("pubDate, published, updated, dc\\:date").first().text().trim();
      const date = new Date(rawDate);
      const dateText = rawDate && Number.isFinite(date.getTime()) ? new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10) : null;
      if (url && title && !seen.has(url)) { seen.add(url); out.push({ url, title, dateText }); }
    });
    return out;
  }
  if (cfg.format === "ged_selection") {
    if (d !== "ged.kedi.re.kr" || new URL(pageUrl).hostname !== d) return [];
    // Public GED download-popup links: parameters verified against fn_down and its form.
    $("a.sdown[onclick]").each((_, el) => {
      if (out.length >= limit) return false;
      const args = ($(el).attr("onclick") || "").match(/fn_down\(\s*['"](\d{4})['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/);
      if (!args) return;
      const title = $(el).closest("tr").find("td").eq(2).text().replace(/\s+/g, " ").trim();
      if (!title) return;
      const url = new URL("/inno/slctNotiInnoPop.do", pageUrl);
      url.search = new URLSearchParams({ pop1: "Y", stndYear: args[1], orgId: args[2], seq: args[3] }).toString();
      if (!seen.has(url.href)) { seen.add(url.href); out.push({ url: url.href, title, dateText: null }); }
    });
    return out;
  }
  $(cfg.linkSelector).each((_, el) => {
    if (out.length >= limit) return false;
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:") || href === "#") return;
    const resolved = officialUrl(href, pageUrl, d);
    if (!resolved) return;
    const abs = new URL(resolved);
    if (seen.has(abs.toString())) return;
    seen.add(abs.toString());
    const title = (cfg.titleSelector ? $(el).find(cfg.titleSelector).first().text() : $(el).text()).replace(/\s+/g, " ").trim().slice(0, 500);
    const row = $(el).closest("tr, li, .item, article");
    const dateText = cfg.dateSelector ? row.find(cfg.dateSelector).first().text().replace(/\s+/g, " ").trim() || null : null;
    if (title) out.push({ url: abs.toString(), title, dateText });
  });
  return out;
}

export async function fetchBoardList(boardUrl: string, domain: string, cfg: BoardConfig, fetchImpl = safeFetch) {
  try {
    if (!officialUrl(boardUrl, boardUrl, domain)) throw new Error("게시판 URL이 확인한 공식 도메인과 다릅니다.");
    const host = new URL(boardUrl).hostname;
    const res = await fetchImpl(boardUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 10000, allowedHosts: [host, host.startsWith("www.") ? host.slice(4) : `www.${host}`] });
    if (!officialUrl(res.finalUrl, boardUrl, domain)) throw new Error("공식 도메인 밖으로 이동했습니다.");
    const html = decodePublicText(res.body, res.contentType);
    const entries = parseBoardList(html, res.finalUrl, domain, cfg);
    if (!entries.length) throw new Error(/type=["']password|captcha|접근이 제한|로그인이 필요/i.test(html)
      ? "로그인·접근 제한 화면입니다. 원문에서 직접 확인하세요."
      : "목록을 찾지 못했습니다. 게시판 구조 변경·빈 목록·동적 화면 여부를 확인하세요.");
    return { ok: true as const, entries };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "게시판 조회 실패" };
  }
}

/** KST 날짜 문자열 추출(예: 2026.09.28 / 2026-09-28) — 없으면 null */
export function parseBoardDate(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!m) return null;
  const value = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

