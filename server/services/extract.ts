/** Public article extraction. Never execute page scripts or bypass access restrictions. */
import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { safeFetch, FetchFailure } from "./safeFetch";
import { sha256 } from "./text";
import { articleAccessProblem, decodeGoogleNewsUrl, googleArticleLink, isGoogleNewsUrl, publisherArticleLink, structuredArticleBody, type ArticleContext } from "./articleSource";
import { resolveGoogleNewsArticle } from "./googleNewsResolve";

export type Attachment = { url: string; name: string; kind: string; status: string; reason?: string };
export type ExtractResult =
  | { ok: true; finalUrl: string; title: string; text: string; hash: string; attachments: Attachment[]; contentKind: "html" | "pdf" }
  | { ok: false; status: "failed" | "unsupported" | "blocked"; error: string; attachments?: Attachment[] };
const MAX_TEXT = 20_000;

/** Same public Naver blog post, in its readable mobile layout. */
export function preferReadableUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "blog.naver.com") {
      const m = u.pathname.match(/^\/([^/]+)\/(\d+)/);
      if (m) return `https://m.blog.naver.com/${m[1]}/${m[2]}`;
      const blogId = u.searchParams.get("blogId"), logNo = u.searchParams.get("logNo");
      if (blogId && logNo) return `https://m.blog.naver.com/${blogId}/${logNo}`;
    }
  } catch { /* invalid URL is rejected by safeFetch */ }
  return url;
}
function classifyAttachment(href: string, name: string): string | null {
  const h = (href + " " + name).toLowerCase();
  if (/\.pdf(\b|$|\?)/.test(h)) return "pdf";
  if (/\.hwpx(\b|$|\?)/.test(h)) return "hwpx";
  if (/\.hwp(\b|$|\?)/.test(h)) return "hwp";
  if (/\.(docx?|xlsx?|pptx?)(\b|$|\?)/.test(h)) return "office";
  if (/\.zip(\b|$|\?)/.test(h)) return "zip";
  if (/filedown|download|attach/i.test(href)) return "file";
  return null;
}
const cleanText = (s: string) => s.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

export function extractHtml(html: string, baseUrl: string): { title: string; text: string; attachments: Attachment[] } {
  const $ = cheerio.load(html);
  const structured = structuredArticleBody(html);
  const title = ($("meta[property='og:title']").attr("content") || structured.title || $("title").first().text() || "").trim();
  const attachments: Attachment[] = [];
  if (isGoogleNewsUrl(baseUrl) || articleAccessProblem(html)) return { title, text: "", attachments };
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "", name = $(a).text().trim().slice(0, 200);
    const kind = classifyAttachment(href, name);
    if (!kind) return;
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { return; }
    if (!/^https?:/.test(abs) || attachments.some(x => x.url === abs)) return;
    attachments.push({ url: abs, name: name || abs.split("/").pop() || "첨부", kind,
      status: kind === "pdf" ? "pending" : "manual_check",
      reason: kind === "pdf" ? undefined : `${kind.toUpperCase()} 파일은 자동 추출하지 않음 — 수동 확인 필요` });
  });
  $("script,style,noscript,iframe,svg,header,footer,nav,form,aside,button").remove();
  $("br").replaceWith("\n");
  $("p,div,section,li,h1,h2,h3,h4,tr").append("\n");
  const selectors = ["#dic_area", "#newsct_article", ".se-main-container", "#postViewArea", "[itemprop='articleBody']",
    "#article-view-content-div", "#articleBodyContents", "#articleBody", "#newsEndContents", ".article-body", ".article_body", ".article_view", ".article_txt", ".article-text", ".news_body", "article",
    "[class*='board_view']", "[class*='bbs_view']", "[class*='view_cont']", "[class*='viewCont']"];
  let text = "";
  for (const selector of selectors) {
    const choices = $(selector).toArray().map(el => cleanText($(el).text())).filter(t => t.length >= 80);
    if (choices.length) { text = choices.sort((a, b) => b.length - a.length)[0]; break; }
  }
  if (structured.text.length >= 80 && structured.text.length > text.length) text = structured.text;
  if (!text) {
    for (const selector of ["main", "#content", "body"]) {
      const node = $(selector).first();
      const paragraphs = node.find("p").toArray().map(el => cleanText($(el).text())).filter(t => t.length >= 30);
      if (paragraphs.join("\n").length >= 80) { text = paragraphs.join("\n"); break; }
      const t = cleanText(node.text());
      if (node.find("a").length === 0 && t.length >= 80) { text = t; break; }
    }
  }
  return { title, text: text.slice(0, MAX_TEXT), attachments: attachments.slice(0, 20) };
}

export async function extractPdf(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").trim().slice(0, MAX_TEXT);
}
function failure(e: unknown): ExtractResult {
  if (e instanceof FetchFailure) {
    // Keep the failed stage and redirect reason; do not turn every Google 302 into a publisher denial.
    if (e.kind === "redirect") return { ok: false, status: "unsupported", error: e.message };
    if (e.kind === "blocked") return { ok: false, status: "blocked", error: e.message };
    const restricted = [401, 402, 403, 429].includes(e.status ?? 0);
    return { ok: false, status: restricted ? "blocked" : "failed", error: restricted
      ? `원문 접근 제한(${e.status ? `HTTP ${e.status}` : e.message}) — 로그인·구독·봇 검증·호출 제한은 우회하지 않습니다. 원문을 직접 확인해 주세요.`
      : e.message };
  }
  return { ok: false, status: "failed", error: "원문 조회 실패 — 원문 주소와 연결 상태를 확인해 주세요." };
}

/** Bounded page/URL-lookup/feed requests, all using the shared deadline and caller budget. */
export async function fetchAndExtract(url: string, fetchImpl = safeFetch, context: ArticleContext = {}): Promise<ExtractResult> {
  let target = preferReadableUrl(decodeGoogleNewsUrl(url) || url);
  const visited = new Set<string>(), deadline = Date.now() + 24_000;
  for (let hop = 0; hop < 3; hop++) {
    if (visited.has(target)) return { ok: false, status: "failed", error: "원문 연결이 반복되어 중단했습니다." };
    if (Date.now() >= deadline) return { ok: false, status: "failed", error: "원문 확인 시간 한도를 초과했습니다." };
    if (hop > 0 && context.takeExtraCall && !context.takeExtraCall()) return { ok: false, status: "failed", error: "이번 수집의 원문 호출 한도에 도달했습니다. 원문 다시 확보를 눌러 확인해 주세요." };
    visited.add(target);
    let res;
    try { res = await fetchImpl(target, { timeoutMs: Math.min(12_000, deadline - Date.now()) }); }
    catch (e) { return failure(e); }
    const ct = res.contentType.toLowerCase();
    if (ct.includes("pdf") || res.body.subarray(0, 5).toString() === "%PDF-") {
      try {
        const text = await extractPdf(res.body);
        if (text.length < 50) return { ok: false, status: "unsupported", error: "텍스트가 없는 PDF(스캔본 가능성) — 수동 확인 필요" };
        return { ok: true, finalUrl: res.finalUrl, title: "", text, hash: sha256(text), attachments: [], contentKind: "pdf" };
      } catch { return { ok: false, status: "unsupported", error: "PDF 텍스트 추출 실패 — 수동 확인 필요" }; }
    }
    if (!ct.includes("html") && !ct.includes("xml") && ct !== "") return { ok: false, status: "unsupported", error: `지원하지 않는 형식(${ct.split(";")[0]}) — 수동 확인 필요` };
    const html = decodeHtml(res.body, ct), restriction = articleAccessProblem(html);
    if (restriction) return { ok: false, status: "blocked", error: restriction };
    if (isGoogleNewsUrl(res.finalUrl)) {
      let original = googleArticleLink(html, res.finalUrl);
      // Modern opaque IDs need Google's public per-article signature + URL lookup.
      // Reuse the page already fetched; do not request a second Google article page.
      if (!original) {
        try { original = await resolveGoogleNewsArticle(res.finalUrl, html, fetchImpl, { deadline, takeExtraCall: context.takeExtraCall }); }
        catch (e) { return failure(e); }
      }
      if (!original && Date.now() < deadline) {
        try { original = await publisherArticleLink(context, fetchImpl, deadline - Date.now()); }
        catch (e) { return failure(e); }
      }
      if (original) { target = preferReadableUrl(original); continue; }
      return { ok: false, status: "unsupported", error: "Google 뉴스 중간 링크의 원문 주소 조회를 완료하지 못했습니다. Google 응답 형식 변경 또는 원문 연결 정보 누락 가능성이 있습니다. 다른 기사를 추측하거나 제목·요약을 본문으로 저장하지 않았습니다." };
    }
    const { title, text, attachments } = extractHtml(html, res.finalUrl);
    if (text.length < 80) return { ok: false, status: "unsupported", error: "공개 HTML·구조화 데이터에서 충분한 본문을 찾지 못했습니다. 자바스크립트로만 표시되는 페이지이거나 본문 형식 확인이 필요합니다. 원문을 직접 열어 확인하거나 본문을 붙여넣어 주세요.", attachments };
    return { ok: true, finalUrl: res.finalUrl, title, text, hash: sha256(text), attachments, contentKind: "html" };
  }
  return { ok: false, status: "failed", error: "원문 연결 단계 한도를 초과했습니다." };
}
function decodeHtml(buf: Buffer, contentType: string): string {
  const m = contentType.match(/charset=([\w-]+)/i) || buf.subarray(0, 2048).toString("latin1").match(/charset=["']?([\w-]+)/i);
  const cs = (m?.[1] || "utf-8").toLowerCase();
  try { return new TextDecoder(cs === "ks_c_5601-1987" ? "euc-kr" : cs).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}
