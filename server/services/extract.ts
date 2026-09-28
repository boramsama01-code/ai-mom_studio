/**
 * 원문 본문 추출. HTML은 Cheerio로 본문 텍스트만, 텍스트 PDF는 unpdf로 추출.
 * HWP/HWPX·스캔 PDF·이미지는 추출하지 않고 첨부 링크와 수동 확인 사유를 남긴다.
 */
import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { safeFetch, FetchFailure } from "./safeFetch";
import { sha256 } from "./text";

export type Attachment = { url: string; name: string; kind: string; status: string; reason?: string };

export type ExtractResult =
  | { ok: true; finalUrl: string; title: string; text: string; hash: string; attachments: Attachment[]; contentKind: "html" | "pdf" }
  | { ok: false; status: "failed" | "unsupported" | "blocked"; error: string; attachments?: Attachment[] };

const MAX_TEXT = 20_000;

/** 네이버 블로그 PC 주소는 iframe 구조라 모바일 주소로 바꿔 본문을 읽는다(같은 공개 글). */
export function preferReadableUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "blog.naver.com") {
      const m = u.pathname.match(/^\/([^/]+)\/(\d+)/);
      if (m) return `https://m.blog.naver.com/${m[1]}/${m[2]}`;
      const blogId = u.searchParams.get("blogId"), logNo = u.searchParams.get("logNo");
      if (blogId && logNo) return `https://m.blog.naver.com/${blogId}/${logNo}`;
    }
  } catch {
    /* noop */
  }
  return url;
}

function classifyAttachment(href: string, name: string): string | null {
  const h = (href + " " + name).toLowerCase();
  if (/\.pdf(\b|$|\?)/.test(h)) return "pdf";
  if (/\.hwpx(\b|$|\?)/.test(h)) return "hwpx";
  if (/\.hwp(\b|$|\?)/.test(h)) return "hwp";
  if (/\.(docx?|xlsx?|pptx?)(\b|$|\?)/.test(h)) return "office";
  if (/\.(zip)(\b|$|\?)/.test(h)) return "zip";
  if (/filedown|download|attach|fileDown/i.test(href)) return "file";
  return null;
}

export function extractHtml(html: string, baseUrl: string): { title: string; text: string; attachments: Attachment[] } {
  const $ = cheerio.load(html);
  const title = ($("meta[property='og:title']").attr("content") || $("title").first().text() || "").trim();
  const attachments: Attachment[] = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const name = $(a).text().trim().slice(0, 200);
    const kind = classifyAttachment(href, name);
    if (!kind) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(abs)) return;
    if (attachments.some((x) => x.url === abs)) return;
    attachments.push({
      url: abs,
      name: name || abs.split("/").pop() || "첨부",
      kind,
      status: kind === "pdf" ? "pending" : "manual_check",
      reason: kind === "pdf" ? undefined : `${kind.toUpperCase()} 파일은 자동 추출하지 않음 — 수동 확인 필요`,
    });
  });
  $("script,style,noscript,iframe,svg,header,footer,nav,form,aside,button").remove();
  const candidates = [
    "#dic_area", // 네이버 뉴스
    "#newsct_article",
    ".se-main-container", // 네이버 블로그(스마트에디터)
    "#postViewArea",
    "article",
    "[class*='board_view']",
    "[class*='bbs_view']",
    "[class*='view_cont']",
    "[class*='viewCont']",
    "main",
    "#content",
    "body",
  ];
  let text = "";
  for (const sel of candidates) {
    const t = $(sel).first().text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    if (t.length > 80) {
      text = t;
      break;
    }
  }
  return { title, text: text.slice(0, MAX_TEXT), attachments: attachments.slice(0, 20) };
}

export async function extractPdf(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").trim().slice(0, MAX_TEXT);
}

export async function fetchAndExtract(url: string, fetchImpl = safeFetch): Promise<ExtractResult> {
  const target = preferReadableUrl(url);
  let res;
  try {
    res = await fetchImpl(target, {});
  } catch (e) {
    if (e instanceof FetchFailure) {
      return { ok: false, status: e.kind === "blocked" ? "blocked" : "failed", error: e.message };
    }
    return { ok: false, status: "failed", error: "원문 조회 실패" };
  }
  const ct = res.contentType.toLowerCase();
  if (ct.includes("pdf") || res.body.subarray(0, 5).toString() === "%PDF-") {
    try {
      const text = await extractPdf(res.body);
      if (text.length < 50) return { ok: false, status: "unsupported", error: "텍스트가 없는 PDF(스캔본 가능성) — 수동 확인 필요" };
      return { ok: true, finalUrl: res.finalUrl, title: "", text, hash: sha256(text), attachments: [], contentKind: "pdf" };
    } catch {
      return { ok: false, status: "unsupported", error: "PDF 텍스트 추출 실패 — 수동 확인 필요" };
    }
  }
  if (!ct.includes("html") && !ct.includes("xml") && ct !== "") {
    return { ok: false, status: "unsupported", error: `지원하지 않는 형식(${ct.split(";")[0]}) — 수동 확인 필요` };
  }
  const html = decodeHtml(res.body, ct);
  const { title, text, attachments } = extractHtml(html, res.finalUrl);
  if (text.length < 80) return { ok: false, status: "failed", error: "본문을 찾지 못함(동적 페이지·차단 가능성)", attachments };
  return { ok: true, finalUrl: res.finalUrl, title, text, hash: sha256(text), attachments, contentKind: "html" };
}

function decodeHtml(buf: Buffer, contentType: string): string {
  const m = contentType.match(/charset=([\w-]+)/i) || buf.subarray(0, 2048).toString("latin1").match(/charset=["']?([\w-]+)/i);
  const cs = (m?.[1] || "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs === "ks_c_5601-1987" ? "euc-kr" : cs).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}
