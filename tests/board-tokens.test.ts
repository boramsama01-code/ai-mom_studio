import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBoardDate, parseBoardList } from "../server/services/boardAdapter";
import { TOKENS } from "../shared/tokens";

describe("설정형 공식 게시판 어댑터", () => {
  const html = fs.readFileSync(new URL("./fixtures/board-list.html", import.meta.url), "utf8");
  it("공식 도메인 링크만, 절대 URL·날짜 추출", () => {
    const e = parseBoardList(html, "https://school.hs.kr/board/list.do", "school.hs.kr", { linkSelector: "td.subject a", dateSelector: "td.date" });
    expect(e.map((x) => x.url)).toEqual(["https://school.hs.kr/board/view.do?nttId=303", "https://school.hs.kr/board/view.do?nttId=302&utm_source=x"]);
    expect(e.map((x) => parseBoardDate(x.dateText))).toEqual(["2026-09-25", "2026-09-20"]);
  });
  it("선택자가 틀리면 빈 목록", () => {
    expect(parseBoardList(html, "https://school.hs.kr/", "school.hs.kr", { linkSelector: "ul.none a" })).toEqual([]);
  });
});

function lum(h: string) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("디자인 토큰 대비(WCAG AA 4.5:1)", () => {
  it("본문·보조·강조·경고·오류 글자 대비", () => {
    for (const fg of [TOKENS.text, TOKENS.muted, TOKENS.opportunities, TOKENS.science, TOKENS.current, TOKENS.warning, TOKENS.error]) {
      expect(ratio(fg, TOKENS.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(fg, TOKENS.background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of [TOKENS.opportunities, TOKENS.science, TOKENS.current]) expect(ratio("#FFFFFF", bg)).toBeGreaterThanOrEqual(4.5);
  });
});
