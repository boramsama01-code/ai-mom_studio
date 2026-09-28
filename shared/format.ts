/** 표시용 포맷(클라이언트/서버 공용). 원문에 없는 시각을 추가하지 않는다. */

type DP = { date: string; time?: string | null } | null | undefined;
type Sch = { kind: string; label?: string | null; round?: string | null; start?: DP; end?: DP; raw?: string | null };

const KIND: Record<string, string> = {
  apply: "접수",
  event: "행사",
  reservation: "예약",
  result: "결과 발표",
  correction: "정정 안내",
  other: "기타",
};

const WD = ["일", "월", "화", "수", "목", "금", "토"];

export function fmtPoint(p: DP): string {
  if (!p?.date) return "";
  const [y, m, d] = p.date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${p.date}(${wd})${p.time ? ` ${p.time}` : ""}`;
}

export function formatScheduleLines(list: Sch[]): string[] {
  return list.map((s) => {
    const name = [s.round, s.label || KIND[s.kind] || s.kind].filter(Boolean).join(" ");
    const a = fmtPoint(s.start), b = fmtPoint(s.end);
    const range = a && b ? (a === b ? a : `${a} ~ ${b}`) : a ? `${a}부터` : b ? `~ ${b}` : s.raw || "추후 공지";
    return `${name} ${range}`.trim();
  });
}
