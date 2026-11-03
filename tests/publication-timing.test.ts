import { describe, expect, it } from "vitest";
import { resolvePublicationTiming } from "../shared/publicationTiming";
import { deliveryState } from "../client/src/publicationStatus";

const now = new Date("2026-11-03T12:00:00Z");
describe("explicit immediate and scheduled publication", () => {
  it("uses the server clock for immediate publication without requiring a date field", () => {
    expect(resolvePublicationTiming({ timing: "now" }, now)).toEqual({ ok: true, timing: "now", scheduledAt: now });
    expect(resolvePublicationTiming({ timing: "now", scheduledAt: "2099-01-01T00:00:00Z" }, now)).toEqual({ ok: true, timing: "now", scheduledAt: now });
  });
  it("accepts an explicitly future Korean-time schedule", () => {
    expect(resolvePublicationTiming({ timing: "later", scheduledAt: "2026-11-03T22:00:00+09:00" }, now)).toEqual({ ok: true, timing: "later", scheduledAt: new Date("2026-11-03T13:00:00Z") });
  });
  it.each([undefined, "invalid", "2026-11-03T11:59:59Z", "2026-11-03T12:00:00Z"])("rejects missing, invalid or elapsed schedule %s", scheduledAt => {
    expect(resolvePublicationTiming({ timing: "later", scheduledAt }, now).ok).toBe(false);
  });
  it("preserves old clients' already-due timestamp requests", () => {
    expect(resolvePublicationTiming({ scheduledAt: "2026-11-03T11:59:59Z" }, now)).toMatchObject({ ok: true, timing: "now" });
    expect(resolvePublicationTiming({ scheduledAt: "2026-11-03T12:00:01Z" }, now)).toMatchObject({ ok: true, timing: "later" });
    expect(resolvePublicationTiming({ scheduledAt: "2026-11-03T11:00:00Z" }, now)).toMatchObject({ ok: true, timing: "now" });
  });
});

describe("newly due publication status", () => {
  it.each([0, 1, 59_999, 60_000])("keeps the first %i ms of waiting neutral without claiming publication success", elapsed => {
    const state = deliveryState("scheduled", new Date(now.getTime() - elapsed), now.getTime());
    expect(state).toMatchObject({ label: "전송 대기 · 게시 요청됨", tone: "" });
    expect(state.detail).toContain("실제 게시 결과");
  });
  it("warns only after the complete one-minute grace period", () => {
    expect(deliveryState("scheduled", new Date(now.getTime() - 60_001), now.getTime())).toMatchObject({ label: "예약 시각 지남 · 전송 대기", tone: "warn" });
  });
  it("preserves future reservations and completed delivery outcomes", () => {
    expect(deliveryState("scheduled", new Date(now.getTime() + 1), now.getTime())).toMatchObject({ label: "예약 대기 · 아직 게시 안 됨", tone: "" });
    expect(deliveryState("succeeded", now, now.getTime())).toMatchObject({ label: "게시 성공", tone: "ok" });
    expect(deliveryState("unknown", now, now.getTime())).toMatchObject({ label: "게시 여부 확인 필요", tone: "warn" });
  });
});
