/**
 * 날짜 처리 — 모든 판단은 Asia/Seoul(UTC+9, 서머타임 없음) 기준.
 * 날짜만 있는 값에 원문에 없던 시각을 사실로 추가하지 않는다.
 * 마감 판단 시 날짜만 있는 종료일은 "그날 23:59:59 KST까지"로 해석한다(판단용 규칙이며 표시값을 바꾸지 않음).
 */

export const KST_OFFSET_MIN = 9 * 60;

export type Precision = "datetime" | "date" | "unknown";

export type ParsedDate = { raw: string | null; iso: string | null; precision: Precision };

/** 네이버 뉴스 pubDate (RFC 822, 예: "Mon, 28 Sep 2026 10:00:00 +0900") */
export function parseNewsPubDate(raw: string | undefined | null): ParsedDate {
  if (!raw) return { raw: null, iso: null, precision: "unknown" };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { raw, iso: null, precision: "unknown" };
  return { raw, iso: d.toISOString(), precision: "datetime" };
}

/** 네이버 블로그 postdate ("20260928") — 날짜 정밀도. KST 자정으로 저장하되 precision=date */
export function parseBlogPostDate(raw: string | undefined | null): ParsedDate {
  if (!raw || !/^\d{8}$/.test(raw)) return { raw: raw ?? null, iso: null, precision: "unknown" };
  const y = raw.slice(0, 4), m = raw.slice(4, 6), d = raw.slice(6, 8);
  const iso = kstDateStartIso(`${y}-${m}-${d}`);
  return { raw, iso, precision: iso ? "date" : "unknown" };
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function kstDateStartIso(ymd: string): string | null {
  if (!isValidYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - KST_OFFSET_MIN * 60_000).toISOString();
}

/** 날짜만 있는 종료일의 판단용 끝 시각 (KST 23:59:59.999) */
export function kstDateEndMs(ymd: string): number | null {
  if (!isValidYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - KST_OFFSET_MIN * 60_000;
}

export function kstDateTimeMs(ymd: string, hhmm: string): number | null {
  if (!isValidYmd(ymd) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  if (hh > 23 || mm > 59) return null;
  return Date.UTC(y, m - 1, d, hh, mm) - KST_OFFSET_MIN * 60_000;
}

/** 현재 KST 날짜 문자열 */
export function kstToday(now = new Date()): string {
  const k = new Date(now.getTime() + KST_OFFSET_MIN * 60_000);
  return k.toISOString().slice(0, 10);
}

export function formatKst(iso: string | Date | null | undefined, precision: Precision = "datetime"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const k = new Date(d.getTime() + KST_OFFSET_MIN * 60_000).toISOString();
  return precision === "date" ? k.slice(0, 10) : `${k.slice(0, 10)} ${k.slice(11, 16)}`;
}

/* ───────────── 공고 일정 → 상태 ───────────── */

export type DatePoint = { date: string; time?: string | null } | null;

export type ScheduleEntry = {
  kind: "apply" | "event" | "reservation" | "result" | "correction" | "other";
  label?: string | null;
  round?: string | null;
  start?: DatePoint;
  end?: DatePoint;
  raw?: string | null; // 원문 날짜 표현
};

export type DeadlineType = "fixed" | "first_come" | "tbd" | "unknown";

function pointStartMs(p: DatePoint | undefined): number | null {
  if (!p || !p.date) return null;
  return p.time ? kstDateTimeMs(p.date, p.time) : kstDateStartIso(p.date) ? Date.parse(kstDateStartIso(p.date)!) : null;
}

function pointEndMs(p: DatePoint | undefined): number | null {
  if (!p || !p.date) return null;
  return p.time ? kstDateTimeMs(p.date, p.time) : kstDateEndMs(p.date);
}

/**
 * 접수 상태 계산
 * - 접수(apply) 일정이 있으면 그것만으로 판단
 * - 없으면 예약(reservation) → 행사(event) 순으로 판단 (설명회 등)
 * - 결과 발표·정정 안내는 별도 유형이며 접수 상태를 만들지 않는다
 * - 하나라도 아직 끝나지 않은 창이 있으면 열림/예정, 모든 창이 끝났으면 마감
 */
export function computeScheduleStatus(
  schedules: ScheduleEntry[] | null | undefined,
  now = new Date(),
): "upcoming" | "open" | "closed" | "unknown" {
  const list = schedules ?? [];
  const pick = (k: ScheduleEntry["kind"]) => list.filter((s) => s.kind === k);
  const windows = pick("apply").length ? pick("apply") : pick("reservation").length ? pick("reservation") : pick("event");
  if (!windows.length) return "unknown";
  const t = now.getTime();
  let anyOpen = false, anyUpcoming = false, allClosedKnown = true;
  for (const w of windows) {
    const s = pointStartMs(w.start);
    const e = pointEndMs(w.end) ?? (w.start && !w.end ? null : null);
    if (e !== null) {
      if (e < t) continue; // 이 창은 끝남
      allClosedKnown = false;
      if (s !== null && s > t) anyUpcoming = true;
      else anyOpen = true;
    } else {
      allClosedKnown = false;
      if (s !== null && s > t) anyUpcoming = true;
      // 시작만 있고 이미 지난 경우: 끝을 알 수 없음
    }
  }
  if (anyOpen) return "open";
  if (anyUpcoming) return "upcoming";
  if (allClosedKnown) return "closed";
  return "unknown";
}

/** 발행 후보 여부 — 마감이면 신규 발행 후보에서 제외 */
export function isPublishableSchedule(status: string): boolean {
  return status !== "closed";
}
