/**
 * 공식 게시판 어댑터(설정형) — "generic_board"
 * 운영자가 확인한 게시판 목록 URL과 CSS 선택자로 공고 목록을 읽는다.
 * - 같은 공식 도메인의 링크만 수집(외부 링크·다른 도메인 무시)
 * - 로그인·차단 페이지는 우회하지 않고 실패로 기록
 * 실제 학교 게시판 구조는 학교마다 달라 선택자를 운영자가 직접 확인해 입력해야 한다.
 */
import * as cheerio from "cheerio";
import { safeFetch, FetchFailure } from "./safeFetch";

export type BoardConfig = {
  linkSelector: string; // 예: "table.board_list td.subject a"
  titleSelector?: string | null; // 링크 안에서 제목을 찾을 선택자(없으면 링크 텍스트)
  dateSelector?: string | null; // 같은 행(tr/li) 안의 날짜 선택자
  maxItems?: number;
};

export type BoardEntry = { url: string; title: string; dateText: string | null };

export function parseBoardList(html: string, pageUrl: string, domain: string, cfg: BoardConfig): BoardEntry[] {
  const $ = cheerio.load(html);
  const out: BoardEntry[] = [];
  const seen = new Set<string>();
  const d = domain.toLowerCase().replace(/^www\./, "");
  $(cfg.linkSelector).each((_, el) => {
    if (out.length >= (cfg.maxItems ?? 10)) return false;
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:") || href === "#") return;
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    const host = abs.hostname.toLowerCase();
    if (!(host === d || host.endsWith(`.${d}`))) return; // 공식 도메인 밖 링크 무시
    abs.hash = "";
    if (seen.has(abs.toString())) return;
    seen.add(abs.toString());
    const title = (cfg.titleSelector ? $(el).find(cfg.titleSelector).first().text() : $(el).text()).replace(/\s+/g, " ").trim();
    const row = $(el).closest("tr, li, .item, article");
    const dateText = cfg.dateSelector ? row.find(cfg.dateSelector).first().text().replace(/\s+/g, " ").trim() || null : null;
    if (title) out.push({ url: abs.toString(), title, dateText });
  });
  return out;
}

export async function fetchBoardList(boardUrl: string, domain: string, cfg: BoardConfig, fetchImpl = safeFetch) {
  try {
    const res = await fetchImpl(boardUrl, { maxBytes: 2 * 1024 * 1024 });
    const html = new TextDecoder(/euc-kr/i.test(res.contentType) ? "euc-kr" : "utf-8").decode(res.body);
    const entries = parseBoardList(html, res.finalUrl, domain, cfg);
    return { ok: true as const, entries };
  } catch (e) {
    return { ok: false as const, error: e instanceof FetchFailure ? e.message : "게시판 조회 실패" };
  }
}

/** KST 날짜 문자열 추출(예: 2026.09.28 / 2026-09-28) — 없으면 null */
export function parseBoardDate(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
