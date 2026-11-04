/** Device-only recovery. Authentication secrets must never be passed as a value or scope. */
export const DRAFT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DRAFT_RECOVERY_MAX_BYTES = 256 * 1_024;
export const DRAFT_RECOVERY_TOTAL_BYTES = 1_024 * 1_024;
export const DRAFT_RECOVERY_MAX_RECORDS = 20;
export const DRAFT_RECOVERY_EVENT = "spacepenguin:draft-recovery";
const PREFIX = "spacepenguin.draft-recovery.v1:";
const ACTIVE = `${PREFIX}active`;

export type RecoveryVersion = string | number;
export type DraftRecoveryRecord<T> = {
  schema: 1;
  token: string;
  slot: string;
  key: string;
  baseVersion: RecoveryVersion;
  baseValue: T;
  value: T;
  savedAt: number;
};
export type RecoveryStorageIssue = "unavailable" | "session_changed" | "too_large" | "capacity" | "changed" | "invalid";
type Result<T> = { ok: true; value: T } | { ok: false; issue: RecoveryStorageIssue };
type Parser<T> = (value: unknown) => T | null;
const validScope = (scope: unknown): scope is string => typeof scope === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(scope);
const validKey = (key: string) => /^[A-Za-z0-9:./_-]{1,180}$/.test(key);
const storageKey = (scope: string, key: string, slot: string) => `${PREFIX}${scope}:${key}:${slot}`;
const size = (value: string) => value.length * 2; // localStorage accounts for UTF-16 strings.
const token = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function storageOf(storage?: Storage): Storage { return storage ?? window.localStorage; }
function keys(storage: Storage) { return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key && key.startsWith(PREFIX) && key !== ACTIVE); }
function announce() { if (typeof window !== "undefined") window.dispatchEvent(new Event(DRAFT_RECOVERY_EVENT)); }
function active(storage: Storage, scope: string) { return validScope(scope) && storage.getItem(ACTIVE) === scope; }
function fresh(record: unknown, now: number): record is DraftRecoveryRecord<unknown> {
  if (!record || typeof record !== "object") return false;
  const r = record as Partial<DraftRecoveryRecord<unknown>>;
  return r.schema === 1 && typeof r.token === "string" && typeof r.key === "string" && validKey(r.key)
    && typeof r.slot === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(r.slot)
    && (typeof r.baseVersion === "string" || (typeof r.baseVersion === "number" && Number.isFinite(r.baseVersion)))
    && typeof r.savedAt === "number" && Number.isFinite(r.savedAt) && r.savedAt <= now + 60_000 && now - r.savedAt < DRAFT_RECOVERY_TTL_MS;
}
function prune(storage: Storage, now: number) {
  for (const key of keys(storage)) {
    try {
      const raw = storage.getItem(key);
      if (!raw || size(raw) > DRAFT_RECOVERY_MAX_BYTES || !fresh(JSON.parse(raw), now)) storage.removeItem(key);
    } catch { storage.removeItem(key); }
  }
}

/** Call only after a fresh /auth/me response, never from a stale editor cache. */
export function activateDraftRecoveryScope(scope: string | null | undefined, storage?: Storage): Result<null> {
  try {
    const store = storageOf(storage);
    if (!validScope(scope)) { clearAllDraftRecovery(store); return { ok: true, value: null }; }
    // Changing the active scope first prevents an old tab from writing its draft again.
    store.setItem(ACTIVE, scope);
    for (const key of keys(store)) if (!key.startsWith(`${PREFIX}${scope}:`)) store.removeItem(key);
    prune(store, Date.now());
    announce();
    return { ok: true, value: null };
  } catch { return { ok: false, issue: "unavailable" }; }
}

export function clearAllDraftRecovery(storage?: Storage): Result<null> {
  try {
    const store = storageOf(storage);
    store.removeItem(ACTIVE);
    for (const key of keys(store)) store.removeItem(key);
    announce();
    return { ok: true, value: null };
  } catch { return { ok: false, issue: "unavailable" }; }
}

export function readDraftRecovery<T>(scope: string, key: string, parse: Parser<T>, storage?: Storage, now = Date.now()): Result<DraftRecoveryRecord<T> | null> {
  const records = readDraftRecoveries(scope, key, parse, storage, now);
  return records.ok ? { ok: true, value: records.value[0] ?? null } : records;
}

export function readDraftRecoveries<T>(scope: string, key: string, parse: Parser<T>, storage?: Storage, now = Date.now()): Result<DraftRecoveryRecord<T>[]> {
  try {
    const store = storageOf(storage);
    if (!active(store, scope)) return { ok: false, issue: "session_changed" };
    if (!validKey(key)) return { ok: false, issue: "invalid" };
    const records: DraftRecoveryRecord<T>[] = [];
    let invalid = false;
    for (const name of keys(store).filter(name => name.startsWith(`${PREFIX}${scope}:${key}:`))) {
      const raw = store.getItem(name); if (!raw) continue;
      let record: unknown;
      try { record = JSON.parse(raw); } catch { store.removeItem(name); invalid = true; continue; }
      if (!fresh(record, now)) { store.removeItem(name); continue; }
      if (record.key !== key) continue; // nested logical field keys are independent
      const value = parse(record.value), baseValue = parse(record.baseValue);
      if (name !== storageKey(scope, key, record.slot) || size(raw) > DRAFT_RECOVERY_MAX_BYTES || value === null || baseValue === null) {
        store.removeItem(name); invalid = true; continue;
      }
      records.push({ ...record, value, baseValue });
    }
    if (!records.length && invalid) return { ok: false, issue: "invalid" };
    return { ok: true, value: records.sort((a, b) => b.savedAt - a.savedAt || b.token.localeCompare(a.token)) };
  } catch { return { ok: false, issue: "unavailable" }; }
}

export function writeDraftRecovery<T>(scope: string, key: string, input: { baseVersion: RecoveryVersion; baseValue: T; value: T; expectedToken: string | null; slot?: string }, storage?: Storage, now = Date.now()): Result<DraftRecoveryRecord<T>> {
  try {
    const store = storageOf(storage);
    if (!active(store, scope)) return { ok: false, issue: "session_changed" };
    if (!validKey(key)) return { ok: false, issue: "invalid" };
    prune(store, now);
    const candidates = keys(store).filter(name => name.startsWith(`${PREFIX}${scope}:${key}:`)).map(name => JSON.parse(store.getItem(name)!) as DraftRecoveryRecord<unknown>);
    const previousRecord = candidates.find(record => record.key === key && record.token === input.expectedToken);
    if (!input.slot && input.expectedToken && !previousRecord) return { ok: false, issue: "changed" };
    const slot = input.slot ?? previousRecord?.slot ?? token();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(slot)) return { ok: false, issue: "invalid" };
    const name = storageKey(scope, key, slot), previous = store.getItem(name);
    if (previous && (JSON.parse(previous) as DraftRecoveryRecord<unknown>).token !== input.expectedToken) return { ok: false, issue: "changed" };
    const record: DraftRecoveryRecord<T> = { schema: 1, token: token(), slot, key, baseVersion: input.baseVersion, baseValue: input.baseValue, value: input.value, savedAt: now };
    const raw = JSON.stringify(record);
    if (size(raw) > DRAFT_RECOVERY_MAX_BYTES) return { ok: false, issue: "too_large" };
    const others = keys(store).filter(key => key !== name);
    const total = others.reduce((bytes, key) => bytes + size(store.getItem(key) ?? ""), size(raw));
    // Keep other unexpired drafts intact instead of silently evicting unsaved work.
    if (others.length >= DRAFT_RECOVERY_MAX_RECORDS || total > DRAFT_RECOVERY_TOTAL_BYTES) return { ok: false, issue: "capacity" };
    store.setItem(name, raw);
    return { ok: true, value: record };
  } catch { return { ok: false, issue: "unavailable" }; }
}

/** Remove only the selected snapshot. A successful save never erases another tab's slot. */
export function removeDraftRecovery(scope: string, key: string, expectedToken: string | null, storage?: Storage): Result<null> {
  try {
    const store = storageOf(storage);
    if (!active(store, scope)) return { ok: false, issue: "session_changed" };
    if (!expectedToken) return { ok: true, value: null };
    const candidates = keys(store).filter(name => name.startsWith(`${PREFIX}${scope}:${key}:`));
    for (const name of candidates) {
      const raw = store.getItem(name); if (!raw) continue;
      const record = JSON.parse(raw) as DraftRecoveryRecord<unknown>;
      if (record.key === key && record.token === expectedToken) { store.removeItem(name); return { ok: true, value: null }; }
    }
    if (candidates.length) return { ok: false, issue: "changed" };
    return { ok: true, value: null };
  } catch { return { ok: false, issue: "unavailable" }; }
}

export const recoveryStorageMessage = (issue: RecoveryStorageIssue) => ({
  unavailable: "이 기기에 임시 보관할 수 없습니다. 브라우저를 닫기 전에 서버에 저장해 주세요.",
  session_changed: "로그인 세션이 바뀌어 이 탭의 임시 보관을 중단했습니다. 현재 입력은 유지됩니다. 저장 전 로그인 상태를 확인해 주세요.",
  too_large: "입력 내용이 기기 복구본의 크기 제한(256KB)을 넘었습니다. 현재 입력은 유지됩니다. 서버에 저장해 주세요.",
  capacity: "기기 복구본의 보관 한도에 도달했습니다. 현재 입력은 유지됩니다. 서버에 저장하거나 다른 복구본을 확인한 뒤 정리해 주세요.",
  changed: "다른 탭에서 보관한 복구본이 있습니다. 현재 입력은 유지했으니 내용을 확인해 주세요.",
  invalid: "기기의 복구본을 읽을 수 없습니다. 서버에 저장된 내용은 그대로 유지됩니다.",
}[issue]);
