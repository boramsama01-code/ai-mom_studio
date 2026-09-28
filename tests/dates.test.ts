import { describe, expect, it } from "vitest";
import { computeScheduleStatus, parseBlogPostDate, parseNewsPubDate, kstToday } from "../server/services/dates";
import { formatScheduleLines } from "../shared/format";

const NOW = new Date("2026-09-28T03:00:00Z"); // 2026-09-28 12:00 KST

describe("날짜 파싱 — 뉴스/블로그 형식 차이", () => {
  it("뉴스 pubDate는 시각까지(datetime)", () => {
    const d = parseNewsPubDate("Mon, 28 Sep 2026 10:00:00 +0900");
    expect(d.precision).toBe("datetime");
    expect(d.iso).toBe("2026-09-28T01:00:00.000Z");
    expect(d.raw).toBe("Mon, 28 Sep 2026 10:00:00 +0900");
  });
  it("블로그 postdate는 날짜만(date) — 시각을 만들지 않음", () => {
    const d = parseBlogPostDate("20260928");
    expect(d.precision).toBe("date");
    expect(d.iso).toBe("2026-09-27T15:00:00.000Z"); // KST 자정
    expect(parseBlogPostDate("2026-09-28").precision).toBe("unknown");
    expect(parseBlogPostDate("20260231").precision).toBe("unknown");
  });
  it("KST 날짜 경계", () => {
    expect(kstToday(new Date("2026-09-27T15:30:00Z"))).toBe("2026-09-28");
  });
});

describe("접수 상태 계산 (Asia/Seoul)", () => {
  it("2026-09-28 기준 2026-08-28 마감 모집은 마감", () => {
    expect(computeScheduleStatus([{ kind: "apply", end: { date: "2026-08-28" } }], NOW)).toBe("closed");
  });
  it("최근 기사라도 접수 기간이 과거면 마감", () => {
    expect(computeScheduleStatus([{ kind: "apply", start: { date: "2026-09-01" }, end: { date: "2026-09-10" } }], NOW)).toBe("closed");
  });
  it("다음 학년도 공고는 연도만으로 제외하지 않음 — 접수 예정", () => {
    expect(computeScheduleStatus([{ kind: "apply", start: { date: "2027-03-02" }, end: { date: "2027-03-06" } }], NOW)).toBe("upcoming");
  });
  it("날짜만 있는 마감일은 그날 끝까지 접수 중", () => {
    expect(computeScheduleStatus([{ kind: "apply", start: { date: "2026-09-20" }, end: { date: "2026-09-28" } }], NOW)).toBe("open");
    expect(computeScheduleStatus([{ kind: "apply", end: { date: "2026-09-28", time: "11:00" } }], NOW)).toBe("closed");
  });
  it("여러 회차 중 하나라도 남아 있으면 마감 아님", () => {
    const s = computeScheduleStatus(
      [
        { kind: "apply", round: "1차", end: { date: "2026-09-01" } },
        { kind: "apply", round: "2차", start: { date: "2026-10-05" }, end: { date: "2026-10-09" } },
      ],
      NOW,
    );
    expect(s).toBe("upcoming");
  });
  it("접수 일정이 없으면 설명회 예약 → 행사 순으로 판단, 결과 발표는 접수 상태를 만들지 않음", () => {
    expect(computeScheduleStatus([{ kind: "event", start: { date: "2026-10-10", time: "14:00" } }], NOW)).toBe("upcoming");
    expect(computeScheduleStatus([{ kind: "result", start: { date: "2026-12-01" } }], NOW)).toBe("unknown");
    expect(computeScheduleStatus([{ kind: "reservation", start: { date: "2026-09-20" }, end: { date: "2026-09-25" } }, { kind: "event", start: { date: "2026-10-10" } }], NOW)).toBe("closed");
  });
  it("시작만 있고 이미 지났으면 판단 불가(unknown)", () => {
    expect(computeScheduleStatus([{ kind: "apply", start: { date: "2026-09-01" } }], NOW)).toBe("unknown");
  });
  it("일정 없음 → unknown", () => {
    expect(computeScheduleStatus([], NOW)).toBe("unknown");
    expect(computeScheduleStatus(null, NOW)).toBe("unknown");
  });
});

describe("일정 표시 — 원문에 없는 시각을 추가하지 않음", () => {
  it("날짜만 있으면 시각 없이 표시", () => {
    expect(formatScheduleLines([{ kind: "apply", start: { date: "2026-10-20" }, end: { date: "2026-10-24" } }])).toEqual(["접수 2026-10-20(화) ~ 2026-10-24(토)"]);
    expect(formatScheduleLines([{ kind: "event", label: "입학설명회", start: { date: "2026-10-10", time: "14:00" } }])).toEqual(["입학설명회 2026-10-10(토) 14:00부터"]);
    expect(formatScheduleLines([{ kind: "apply", raw: "추후 공지" }])).toEqual(["접수 추후 공지"]);
  });
});
