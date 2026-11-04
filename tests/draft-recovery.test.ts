import { beforeEach, describe, expect, it } from "vitest";
import { activateDraftRecoveryScope, clearAllDraftRecovery, DRAFT_RECOVERY_MAX_BYTES, DRAFT_RECOVERY_MAX_RECORDS, DRAFT_RECOVERY_TTL_MS, readDraftRecovery, removeDraftRecovery, writeDraftRecovery } from "../client/src/draftRecovery";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}
const scope = "safe-session-recovery-scope-a", otherScope = "safe-session-recovery-scope-b";
const parse = (value: unknown) => typeof value === "string" ? value : null;
const key = "item:2:9:source";
const now = Date.now();
let store: MemoryStorage;
beforeEach(() => { store = new MemoryStorage(); activateDraftRecoveryScope(scope, store); });
const write = (value: string, expectedToken: string | null = null, target = key) => writeDraftRecovery(scope, target, { baseVersion: 2, baseValue: "서버 원고", value, expectedToken }, store, now);

describe("session-scoped manuscript recovery storage", () => {
  it("keeps exact multiline/incomplete input separately from its saved baseline", () => {
    const text = "\n아직 다 쓰지 않은 원고 🐧\n";
    expect(write(text).ok).toBe(true);
    expect(readDraftRecovery(scope, key, parse, store, now)).toMatchObject({ ok: true, value: { baseVersion: 2, baseValue: "서버 원고", value: text } });
    expect([...store.values.values()].join("")).not.toContain("csrf");
    expect([...store.values.values()].join("")).not.toContain("sessionID");
  });
  it("removes expired records and never offers a record older than seven days", () => {
    expect(write("오래된 원고").ok).toBe(true);
    expect(readDraftRecovery(scope, key, parse, store, now + DRAFT_RECOVERY_TTL_MS)).toEqual({ ok: true, value: null });
    expect(store.length).toBe(1); // only the active non-authentication scope remains
  });
  it("erases old-session drafts and rejects stale tabs after another login or logout", () => {
    write("첫 로그인만 볼 원고");
    activateDraftRecoveryScope(otherScope, store);
    expect(readDraftRecovery(otherScope, key, parse, store, now)).toEqual({ ok: true, value: null });
    expect(readDraftRecovery(scope, key, parse, store, now)).toEqual({ ok: false, issue: "session_changed" });
    expect(write("오래된 탭이 다시 쓰려는 원고")).toEqual({ ok: false, issue: "session_changed" });
    expect([...store.values.values()].join("")).not.toContain("첫 로그인만 볼 원고");
    clearAllDraftRecovery(store);
    expect(store.length).toBe(0);
    expect(writeDraftRecovery(otherScope, key, { baseVersion: 1, baseValue: "", value: "다시 쓰기", expectedToken: null }, store)).toEqual({ ok: false, issue: "session_changed" });
  });
  it("requires the current checkpoint token so an older tab cannot overwrite or delete newer work", () => {
    const first = write("첫 번째 원고"); if (!first.ok) throw new Error("write failed");
    const second = write("다른 탭의 최신 원고", first.value.token); if (!second.ok) throw new Error("write failed");
    expect(write("오래된 탭 입력", first.value.token)).toEqual({ ok: false, issue: "changed" });
    expect(removeDraftRecovery(scope, key, first.value.token, store)).toEqual({ ok: false, issue: "changed" });
    expect(readDraftRecovery(scope, key, parse, store, now)).toMatchObject({ ok: true, value: { value: "다른 탭의 최신 원고" } });
    expect(removeDraftRecovery(scope, key, second.value.token, store).ok).toBe(true);
  });
  it("reports an oversized edit while retaining its last usable checkpoint", () => {
    const first = write("작지만 보존할 초안"); if (!first.ok) throw new Error("write failed");
    expect(write("가".repeat(DRAFT_RECOVERY_MAX_BYTES), first.value.token)).toEqual({ ok: false, issue: "too_large" });
    expect(readDraftRecovery(scope, key, parse, store, now)).toMatchObject({ ok: true, value: { value: "작지만 보존할 초안" } });
  });
  it("does not silently evict another unfinished draft when record capacity is full", () => {
    for (let i = 0; i < DRAFT_RECOVERY_MAX_RECORDS; i++) expect(write(`원고 ${i}`, null, `item:2:${i}:source`).ok).toBe(true);
    expect(write("추가 원고", null, "item:2:99:source")).toEqual({ ok: false, issue: "capacity" });
    expect(readDraftRecovery(scope, "item:2:0:source", parse, store, now)).toMatchObject({ ok: true, value: { value: "원고 0" } });
  });
  it("enforces the total byte limit without removing existing recoveries", () => {
    for (let i = 0; i < 8; i++) expect(write("가".repeat(60_000), null, `item:2:${i}:source`).ok).toBe(true);
    expect(write("나".repeat(60_000), null, "item:2:99:source")).toEqual({ ok: false, issue: "capacity" });
    expect(store.length).toBe(9);
  });
  it("rejects corrupted shapes and makes disabled storage a recoverable warning", () => {
    const first = write("정상 원고"); if (!first.ok) throw new Error("write failed");
    const name = [...store.values.keys()].find(name => name.includes(`${key}:`))!;
    store.setItem(name, JSON.stringify({ ...first.value, value: { unexpected: "not manuscript text" } }));
    expect(readDraftRecovery(scope, key, parse, store, now)).toEqual({ ok: false, issue: "invalid" });
    expect(store.getItem(name)).toBeNull();
    const blocked = { ...store, getItem() { throw new Error("storage denied"); } } as unknown as Storage;
    expect(readDraftRecovery(scope, key, parse, blocked)).toEqual({ ok: false, issue: "unavailable" });
    expect(writeDraftRecovery(scope, key, { baseVersion: 1, baseValue: "", value: "원고", expectedToken: null }, blocked)).toEqual({ ok: false, issue: "unavailable" });
  });
});
