/**
 * 공식 게시판 어댑터(설정형) — "generic_board"
 * 운영자가 확인한 게시판 목록 URL과 CSS 선택자로 공고 목록을 읽는다.
 * - 같은 공식 도메인의 링크만 수집(외부 링크·다른 도메인 무시)
 * - 로그인·차단 페이지는 우회하지 않고 실패로 기록
 * 실제 학교 게시판 구조는 학교마다 달라 선택자를 운영자가 직접 확인해 입력해야 한다.
 */
import * as cheerio from "cheerio";
import { safeFetch } from "./safeFetch";
import { decodePublicText } from "./publicTextResponse";

export type BoardConfig = {
  linkSelector: string; // 예: "table.board_list td.subject a"
  titleSelector?: string | null; // 링크 안에서 제목을 찾을 선택자(없으면 링크 텍스트)
  dateSelector?: string | null; // 같은 행(tr/li) 안의 날짜 선택자
  maxItems?: number;
  format?: "links" | "ged_selection" | "rss" | "school_ntt" | "linkareer";
  subcategory?: string;
  maxAgeDays?: number;
  recruitmentOnly?: boolean;
  sourceRole?: "official" | "discovery";
  youthOnly?: boolean;
  useTitleAttribute?: boolean;
  articleBaseUrl?: string; // Explicit same-domain base for relative links in official feeds.
};

export type BoardEntry = { url: string; title: string; dateText: string | null; audience?: string };

export function officialHostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host.toLowerCase() === d || host.toLowerCase().endsWith(`.${d}`);
}

function officialUrl(value: string, pageUrl: string, domain: string): string | null {
  try {
    const u = new URL(value, pageUrl);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !officialHostMatches(u.hostname, domain)) return null;
    u.hash = "";
    if (["wr_id", "mng_no", "articleNo", "nttSn", "bbsSn"].some(k => u.searchParams.has(k))) {
      for (const k of ["page", "pageNo", "GotoPage", "thisPage", "article.offset", "articleLimit", "totalNoticeYn", "totalBoardNo", "sop", "sst", "sod", "sfl", "stx"]) u.searchParams.delete(k);
    }
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
  if (cfg.format === "linkareer") {
    if (d !== "linkareer.com") return [];
    const data = JSON.parse($("#__NEXT_DATA__").text() || "{}");
    const state = data?.props?.pageProps?.props?.__APOLLO_STATE__ ?? {};
    // Read public SSR data only for activities visibly linked in this result list.
    $('a[href^="/activity/"]').each((_, el) => {
      if (out.length >= limit) return false;
      const id = ($(el).attr("href") || "").match(/^\/activity\/(\d+)$/)?.[1];
      const row = id ? state[`Activity:${id}`] : null;
      const url = id ? officialUrl(`/activity/${id}`, pageUrl, d) : null;
      if (!row || row.__typename !== "Activity" || typeof row.title !== "string" || !url || seen.has(url)) return;
      const published = typeof row.createdAt === "number" ? new Date(row.createdAt + 9 * 3600_000) : null;
      seen.add(url); out.push({ url, title: row.title.trim().slice(0, 500), dateText: published && Number.isFinite(published.getTime()) ? published.toISOString().slice(0, 10) : null });
    });
    return out;
  }
  if (cfg.format === "rss") {
    if (!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(html)) throw new Error("공식 RSS/Atom 형식이 아닙니다.");
    $("item, entry").each((_, el) => {
      if (out.length >= limit) return false;
      const row = $(el);
      const href = row.find('link[rel="alternate"]').attr("href") || row.find("link").first().attr("href") || row.find("link").first().text().trim();
      const url = officialUrl(href, cfg.articleBaseUrl ?? pageUrl, d);
      const title = cheerio.load(row.find("title").first().text()).text().replace(/\s+/g, " ").trim().slice(0, 500);
      const rawDate = row.find("pubDate, published, updated, dc\\:date").first().text().trim();
      const date = new Date(rawDate.replace(/\bKST\b/g, "+0900"));
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
    let href = $(el).attr("href");
    if (cfg.format === "school_ntt" && /\/na\/ntt\/selectNttList\.do$/.test(new URL(pageUrl).pathname)) {
      const id = $(el).attr("data-id");
      if (!id || !/^\d+$/.test(id)) return;
      const detail = new URL(pageUrl);
      detail.pathname = detail.pathname.replace(/selectNttList\.do$/, "selectNttInfo.do");
      detail.searchParams.set("nttSn", id);
      href = detail.href;
    }
    if (!href || href.startsWith("javascript:") || href === "#") return;
    const resolved = officialUrl(href, pageUrl, d);
    if (!resolved) return;
    const abs = new URL(resolved);
    if (seen.has(abs.toString())) return;
    const title = (cfg.useTitleAttribute && $(el).attr("title") ? $(el).attr("title")! : cfg.titleSelector ? $(el).find(cfg.titleSelector).first().text() : $(el).text()).replace(/\s+/g, " ").trim().slice(0, 500);
    const row = $(el).closest("tr, li, .item, article");
    const dateText = cfg.dateSelector ? row.find(cfg.dateSelector).first().text().replace(/\s+/g, " ").trim() || null : null;
    if (title) { seen.add(abs.toString()); out.push({ url: abs.toString(), title, dateText }); }
  });
  return out;
}

export async function fetchBoardList(boardUrl: string, domain: string, cfg: BoardConfig, fetchImpl = safeFetch, options: { takeExtraCall?: () => boolean } = {}): Promise<{ ok: true; entries: BoardEntry[]; warnings?: string[]; pages?: number } | { ok: false; error: string }> {
  try {
    if (!officialUrl(boardUrl, boardUrl, domain)) throw new Error("게시판 URL이 확인한 공식 도메인과 다릅니다.");
    if (cfg.articleBaseUrl && !officialUrl(cfg.articleBaseUrl, boardUrl, domain)) throw new Error("RSS 원문 기준 주소가 공식 도메인과 다릅니다.");
    const host = new URL(boardUrl).hostname;
    const read = async (url: string, config = cfg) => {
      const res = await fetchImpl(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 10000, allowedHosts: [host, host.startsWith("www.") ? host.slice(4) : `www.${host}`] });
      if (!officialUrl(res.finalUrl, boardUrl, domain)) throw new Error("공식 도메인 밖으로 이동했습니다.");
      const html = decodePublicText(res.body, res.contentType);
      const entries = parseBoardList(html, res.finalUrl, domain, config);
      if (!entries.length) throw new Error(/type=["']password|captcha|접근이 제한|로그인이 필요/i.test(html)
        ? "로그인·접근 제한 화면입니다. 원문에서 직접 확인하세요."
        : "목록을 찾지 못했습니다. 게시판 구조 변경·빈 목록·동적 화면 여부를 확인하세요.");
      return { html, entries };
    };
    const url = new URL(boardUrl);
    const ged = cfg.format === "ged_selection" && url.hostname === "ged.kedi.re.kr" && url.pathname === "/slct/noti/slctNotiStat.do";
    const pageSize = [100, 50, 40, 30, 20, 10].find(n => n <= (cfg.maxItems ?? 100)) ?? 10;
    const config = ged ? { ...cfg, maxItems: pageSize } : cfg;
    if (ged) { url.searchParams.set("pageUnit", String(pageSize)); url.searchParams.set("pageIndex", "1"); }
    const first = await read(url.href, config);
    const entries = first.entries, warnings: string[] = [];
    let pages = 1;
    if (ged) {
      // Public form and fn_pageing parameters verified against GED's actual GET response.
      const totalPages = Math.max(1, ...[...first.html.matchAll(/fn_pageing\(\s*['"]?(\d+)/g)].map(m => Number(m[1])));
      const seen = new Set(entries.map(e => e.url));
      for (let page = 2; page <= Math.min(totalPages, 10); page++) {
        if (!options.takeExtraCall?.()) { warnings.push(`GED ${totalPages}페이지 중 ${pages}페이지만 확인했습니다. 호출 한도 밖의 공고는 원문에서 확인하세요.`); break; }
        url.searchParams.set("pageIndex", String(page));
        try {
          const next = await read(url.href, config);
          pages++;
          const fresh = next.entries.filter(e => !seen.has(e.url));
          if (!fresh.length) { warnings.push("GED 다음 페이지가 같은 목록을 반환했습니다. 페이지 구성을 확인하세요."); break; }
          for (const e of fresh) { seen.add(e.url); entries.push(e); }
        } catch (error) { warnings.push(`GED ${page}페이지 조회 실패: ${(error as Error).message}`); break; }
      }
      if (totalPages > 10) warnings.push(`GED 전체 ${totalPages}페이지 중 최대 10페이지만 확인합니다.`);
    }
    return { ok: true, entries, warnings, pages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "게시판 조회 실패" };
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

