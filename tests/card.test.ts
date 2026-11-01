import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CardOverflowError, loadFonts, renderCardJpeg, wrapText, CARD_W } from "../server/services/card";
import { buildCardModel, buildCaptions, validateCaptions } from "../server/services/cardModel";

const base = {
  relevance: "relevant", title: "경기과학고등학교 2027학년도 신입생 입학설명회", organization: "경기과학고등학교", notice_type: "입학설명회",
  category: "영재학교·과학고 입시", school_type: "gifted", academic_year: "2027학년도", audience: "중학교 3학년", eligibility: null,
  schedules: [
    { kind: "event", label: "입학설명회", start: { date: "2026-10-10", time: "14:00" }, end: null },
    { kind: "apply", label: "1차 원서접수", start: { date: "2026-10-20" }, end: { date: "2026-10-24" } },
    { kind: "apply", label: "2차 원서접수", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } },
  ],
  deadline_type: "fixed", key_details: "설명회는 사전 예약제입니다.", one_line_summary: "10월 10일 설명회, 10월 20~24일 1차 접수.", uncertainties: [], has_conflict: false, evidence: [],
};

describe("카드 렌더링", () => {
  it("한글 폰트 로드(대체 폰트 없음)", () => {
    const f = loadFonts();
    expect(f.bold.charToGlyph("한").index).toBeGreaterThan(0);
  });

  it("1080×1350 RGB JPEG, 복수 일정·숫자 혼합", async () => {
    const model = buildCardModel({ kind: "notice", payload: base, channelName: "Highscoop", accent: "#0B766E", sourceOrg: "경기과학고등학교", checkedDate: "2026-09-28" });
    const { jpeg } = await renderCardJpeg(model);
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height, meta.channels, meta.space]).toEqual(["jpeg", 1080, 1350, 3, "srgb"]);
  });

  it("긴 한글 제목은 편집 필요(넘침)로 돌려보냄", async () => {
    const model = buildCardModel({ kind: "notice", payload: { ...base, title: "아주 긴 제목 ".repeat(20) }, channelName: "c", accent: "#0B766E", sourceOrg: null, checkedDate: "2026-09-28" });
    await expect(renderCardJpeg(model)).rejects.toBeInstanceOf(CardOverflowError);
  });

  it("띄어쓰기 없는 긴 단어는 글자 단위로 줄바꿈", () => {
    const f = loadFonts();
    const lines = wrapText(f.regular, "가".repeat(80) + " 2026-10-20", 34, CARD_W - 168);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(f.regular.getAdvanceWidth(l, 34)).toBeLessThanOrEqual(CARD_W - 168);
  });

  it("과학·시사 카드도 생성", async () => {
    const sci = { topic: "나무", age_band: "중학생", key_question: "도시의 나무는 어디에 먼저 심어야 할까?", background: ["나무는 그늘을 만든다.", "도시는 열섬 현상이 있다.", "나무마다 필요한 공간이 다르다."], discussion_questions: ["우리 동네에서 가장 더운 곳은 어디일까?", "b", "c"], scientific_basis: "x", misconceptions: [], parent_hints: [], safe_activity: null, sources: [], evidence: [] };
    const r = await renderCardJpeg(buildCardModel({ kind: "science_dialogue", payload: sci, channelName: "Alligodang · 과학", accent: "#6550A6", sourceOrg: null, checkedDate: "2026-09-28" }));
    expect(r.jpeg.length).toBeGreaterThan(10_000);
  });
});

describe("캡션", () => {
  it("인스타그램은 URL 대신 출처 기관, 텔레그램은 원문 링크 포함", () => {
    const c = buildCaptions({ kind: "notice", payload: base, sourceUrl: "https://gs.hs.kr/1", sourceOrg: "경기과학고등학교" });
    expect(c.instagram).not.toContain("https://");
    expect(c.telegram).toContain("https://gs.hs.kr/1");
    expect(validateCaptions(c)).toEqual([]);
  });
  it("길이 제한 검사", () => {
    expect(validateCaptions({ instagram: "가".repeat(2201), telegram: "x" }).length).toBe(1);
    expect(validateCaptions({ instagram: "x", telegram: "가".repeat(1025) }).length).toBe(1);
    expect(validateCaptions({ instagram: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), telegram: "x" }).length).toBe(1);
  });
});


describe("우주펭귄상회 브랜드", () => {
  it("새 카드의 브랜드만 변경하고 기존 채널명과 입력은 보존", () => {
    const args = { kind: "notice", payload: base, channelName: "Highscoop", accent: "#0B766E", sourceOrg: null, checkedDate: "2026-10-18" };
    const before = JSON.stringify(args);
    expect(buildCardModel(args).brandLine).toBe("Highscoop");
    expect(JSON.stringify(args)).toBe(before);
  });
  it.each(["classic", "header", "magazine", "minimal"] as const)("%s: 긴 브랜드와 분류도 영역 안에서 생성", async (layout) => {
    const model = buildCardModel({ kind: "notice", payload: { ...base, title: "입학설명회", category: "영재학교·과학고 입시", schedules: [], one_line_summary: "공식 공고를 확인하세요." }, channelName: "Alligodang · 과학", accent: "#0B766E", sourceOrg: null, checkedDate: "2026-10-18" });
    const { jpeg } = await renderCardJpeg(model, { layout });
    expect(jpeg.length).toBeGreaterThan(10_000);
    const mascot = await sharp(jpeg).extract({ left: 84, top: layout === "minimal" ? 119 : 79, width: 46, height: 46 }).stats();
    expect(mascot.channels[0].stdev).toBeGreaterThan(20);
  });
});

