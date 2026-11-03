export type PublicationTimingInput = { timing?: "now" | "later"; scheduledAt?: string };

/** Immediate publication uses the server clock; a scheduled post must be in the future. */
export function resolvePublicationTiming(input: PublicationTimingInput, now = new Date()) {
  if (input.timing === "now") return { ok: true as const, timing: "now" as const, scheduledAt: now };
  const scheduledAt = new Date(input.scheduledAt ?? "");
  if (!Number.isFinite(scheduledAt.getTime())) return { ok: false as const, error: "예약 게시 시간을 선택해 주세요." };
  if (input.timing === "later" && scheduledAt.getTime() <= now.getTime()) {
    return { ok: false as const, error: "예약 시간은 현재 이후로 선택해 주세요. 지금 게시하려면 ‘바로 게시’를 선택하세요." };
  }
  // Older clients expressed an immediate request as an already-due timestamp.
  // Keep those approvals compatible; the explicit "later" mode rejects past dates.
  return { ok: true as const, timing: scheduledAt.getTime() <= now.getTime() ? "now" as const : "later" as const, scheduledAt };
}
