import type { NoticePayload } from "../../shared/payloads";
import type { OfficialSource, SourceDocument } from "../../shared/schema";

/** 문서 URL의 호스트가 "확인된" 공식 출처 도메인과 일치하는지 (하위 도메인 포함) */
export function matchOfficialSource(url: string, sources: OfficialSource[]): OfficialSource | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const s of sources) {
    if (!s.domain || !s.verifiedAt) continue; // 확인되지 않은 도메인으로 공식 판정하지 않음
    const d = s.domain.toLowerCase().replace(/^www\./, "");
    if (host === d || host.endsWith(`.${d}`) || host === `www.${d}`) return s;
  }
  return null;
}

/** 공고 근거 상태 — 서버 규칙으로 계산(모델의 자기 확신으로 판단하지 않음) */
export function computeEvidenceStatus(doc: Pick<SourceDocument, "fetchStatus" | "normalizedUrl" | "kind">, payload: NoticePayload | null, officials: OfficialSource[]):
  "official_confirmed" | "secondary_only" | "needs_review" | "conflict" | "fetch_failed" {
  if (doc.fetchStatus !== "ok") return "fetch_failed";
  if (!payload) return "needs_review";
  if (payload.has_conflict) return "conflict";
  if (!payload.evidence.length) return "needs_review";
  if (matchOfficialSource(doc.normalizedUrl, officials)) return "official_confirmed";
  return "secondary_only";
}

/** 운영상 의미 있는 변경(일정·대상·자격)이 있는지 */
export function materialChange(a: Partial<NoticePayload> | null | undefined, b: Partial<NoticePayload> | null | undefined): boolean {
  if (!a || !b) return false;
  const pick = (p: Partial<NoticePayload>) => JSON.stringify([p.schedules ?? [], p.audience ?? null, p.eligibility ?? null, p.academic_year ?? null]);
  return pick(a) !== pick(b);
}
