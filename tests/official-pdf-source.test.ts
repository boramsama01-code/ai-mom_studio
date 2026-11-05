import { describe, expect, it, vi } from "vitest";
const text = "The official press release states the appointment date, role and policy background. ".repeat(4);
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn(async () => ({})), extractText: vi.fn(async () => ({ text })) }));
const { fetchAndExtract, extractHtml } = await import("../server/services/extract");
const page = "https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=123";
const pdf = "https://www.mcst.go.kr/files/press.pdf";
const html = `<h3 class="view_title">문화 정책 발표</h3><p>${"공공누리 저작권 이용 안내 ".repeat(20)}</p><a href="${pdf}">보도자료.pdf</a>`;
const response = (url: string, body: string, contentType = "text/html") => ({ finalUrl: url, body: Buffer.from(body), contentType, status: 200 });
describe("official attachment body", () => {
  it("reads a single same-host PDF once, instead of storing license text", async () => {
    const fetcher = vi.fn(async (url: string) => response(url, url === page ? html : "%PDF-fixture", url === page ? "text/html" : "application/pdf"));
    const reserve = vi.fn(() => true);
    const result = await fetchAndExtract(page, fetcher, { title: "문화 정책 발표", takeExtraCall: reserve });
    expect(result).toMatchObject({ ok: true, text: text.trim(), contentKind: "pdf", finalUrl: page, attachments: [{ status: "ok" }] });
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([page, pdf]);
    expect(reserve).toHaveBeenCalledOnce();
  });
  it("does not store license text when budget is exhausted, attachments are ambiguous, or the response is HTML", async () => {
    for (const [markup, allowed] of [[html, false], [html + '<a href="/another.pdf">첨부.pdf</a>', true], [html, true]] as const) {
      const fetcher = vi.fn(async (url: string) => response(url, url === page ? markup : "<title>로그인</title>"));
      const result = await fetchAndExtract(page, fetcher, { title: "문화 정책 발표", takeExtraCall: () => allowed });
      expect(result).toMatchObject({ ok: false, status: "unsupported" });
      expect(fetcher.mock.calls.length).toBe(markup === html && allowed ? 2 : 1);
    }
  });
  it("does not follow a cross-host PDF or download after an article identity mismatch", async () => {
    for (const markup of [html.replace(pdf, "https://other.example/press.pdf"), html.replace("문화 정책 발표", "다른 보도자료")]) {
      const fetcher = vi.fn(async () => response(page, markup));
      expect((await fetchAndExtract(page, fetcher, { title: "문화 정책 발표" })).ok).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("isolates KAIST's article container from longer related research summaries", () => {
    const markup = `<div class="prog_bord_view"><div class="prog_contents"><p>${text}</p></div><div class="card--body"><p>${"Other research. ".repeat(100)}</p></div></div>`;
    expect(extractHtml(markup, "https://www.kaist.ac.kr/news/html/news/?mode=V&mng_no=1").text).toBe(text.trim());
  });
});
