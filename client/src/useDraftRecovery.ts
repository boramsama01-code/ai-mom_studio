import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DRAFT_RECOVERY_EVENT, readDraftRecoveries, recoveryStorageMessage, removeDraftRecovery, writeDraftRecovery, type DraftRecoveryRecord, type RecoveryStorageIssue, type RecoveryVersion } from "./draftRecovery";

type Options<T> = {
  recoveryKey: string;
  label: string;
  version: RecoveryVersion;
  serverValue: T;
  value: T;
  dirty: boolean;
  ready?: boolean;
  /** Validate field types/ownership, not save-time requirements such as a nonempty title. */
  parse: (value: unknown) => T | null;
  onRestore: (value: T) => void;
};
type State<T> = {
  pending: DraftRecoveryRecord<T> | null;
  copies: DraftRecoveryRecord<T>[];
  status: "disabled" | "idle" | "saved" | "unavailable";
  savedAt: number | null;
  error: string | null;
};
export type DraftRecovery<T> = State<T> & {
  label: string;
  serverValue: T;
  conflict: boolean;
  dirty: boolean;
  choose: (token: string) => void;
  restore: () => void;
  discard: () => void;
  clear: () => void;
};
// JSONB and schema parsing may return object keys in a different order. That is
// not another editor's change; array/page order must still remain significant.
const stable = (value: unknown): string | undefined => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const newSlot = () => globalThis.crypto?.randomUUID?.() ?? Date.now() + "-" + Math.random().toString(36).slice(2);

export function useDraftRecovery<T>(options: Options<T>): DraftRecovery<T> {
  const qc = useQueryClient();
  // Observe the existing authenticated session without another request or storing credentials.
  const subscribe = useCallback((notify: () => void) => qc.getQueryCache().subscribe(event => { if (event.query.queryKey[0] === "me") notify(); }), [qc]);
  const snapshot = useCallback(() => {
    const me = qc.getQueryData<{ user?: string | null; recoveryScope?: string | null }>(["me"]);
    return me?.user && typeof me.recoveryScope === "string" ? me.recoveryScope : null;
  }, [qc]);
  const scope = useSyncExternalStore(subscribe, snapshot, () => null);
  const [state, setState] = useState<State<T>>({ pending: null, copies: [], status: scope ? "idle" : "disabled", savedAt: null, error: null });
  const latest = useRef(options); latest.current = options;
  const pending = useRef<DraftRecoveryRecord<T> | null>(null);
  // Each mounted editor gets an independent slot. Duplicating a tab must not copy its writer identity.
  const slot = useRef<string | null>(null); if (!slot.current) slot.current = newSlot();
  const ownedToken = useRef<string | null>(null);
  const restoredFrom = useRef<string | null>(null);
  const identity = useRef<string | null>(null);
  const suppressed = useRef<string | null>(null);
  const awaitingRestore = useRef<string | null>(null);
  const lastWritten = useRef<string | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const update = (next: State<T>) => {
    stateRef.current = next;
    setState(current => same(current, next) ? current : next);
  };
  const fail = (issue: RecoveryStorageIssue) => update({ ...stateRef.current, status: "unavailable", error: recoveryStorageMessage(issue) });
  const read = () => scope ? readDraftRecoveries(scope, latest.current.recoveryKey, latest.current.parse) : null;
  const load = () => {
    const result = read(); if (!result || !scope) return;
    if (!result.ok) { fail(result.issue); return; }
    const records = result.value.filter(record => {
      if (same(record.value, latest.current.serverValue)) { removeDraftRecovery(scope, latest.current.recoveryKey, record.token); return false; }
      return record.slot !== slot.current;
    });
    const selected = records.find(record => record.token === pending.current?.token) ?? records[0] ?? null;
    pending.current = selected;
    update({ pending: selected, copies: records, status: selected ? "saved" : "idle", savedAt: selected?.savedAt ?? null, error: null });
  };
  const flush = () => {
    const o = latest.current;
    if (!scope || o.ready === false || pending.current) return;
    const valueSignature = JSON.stringify(o.value);
    if (awaitingRestore.current) {
      if (awaitingRestore.current !== valueSignature) return;
      awaitingRestore.current = null;
    }
    if (suppressed.current === valueSignature) return;
    if (!o.dirty) {
      if (ownedToken.current) {
        const removed = removeDraftRecovery(scope, o.recoveryKey, ownedToken.current);
        if (!removed.ok && removed.issue !== "changed") { fail(removed.issue); return; }
      }
      ownedToken.current = null; lastWritten.current = null;
      update({ ...stateRef.current, pending: null, status: "idle", savedAt: null, error: null });
      return;
    }
    const signature = JSON.stringify([o.version, o.serverValue, o.value]);
    if (signature === lastWritten.current) {
      // A deletion in another tab must not turn an unsaved live editor into a false "backed up" state.
      const present = read();
      if (!present?.ok) { if (present) fail(present.issue); return; }
      if (present.value.some(record => record.slot === slot.current && record.token === ownedToken.current)) return;
      ownedToken.current = present.value.find(record => record.slot === slot.current)?.token ?? null;
      lastWritten.current = null;
    }
    let value: T | null, baseValue: T | null;
    try { value = o.parse(o.value); baseValue = o.parse(o.serverValue); } catch { fail("invalid"); return; }
    if (value === null || baseValue === null) { fail("invalid"); return; }
    const written = writeDraftRecovery(scope, o.recoveryKey, { baseVersion: o.version, baseValue, value, slot: slot.current!, expectedToken: ownedToken.current });
    if (!written.ok) { fail(written.issue); return; }
    ownedToken.current = written.value.token; lastWritten.current = signature; suppressed.current = null;
    // Transfer a selected snapshot to this instance only after the new checkpoint is safe.
    // If the source tab is still editing, it recreates its own independent slot on storage change.
    const consumed = restoredFrom.current;
    if (consumed) { removeDraftRecovery(scope, o.recoveryKey, consumed); restoredFrom.current = null; }
    update({ pending: null, copies: stateRef.current.copies.filter(record => record.token !== consumed), status: "saved", savedAt: written.value.savedAt, error: null });
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  const loadRef = useRef(load); loadRef.current = load;
  // Synchronous checkpoints after committed edits avoid a debounce window at tab termination.
  useLayoutEffect(() => {
    const nextIdentity = scope && options.ready !== false ? scope + ":" + options.recoveryKey : null;
    if (identity.current !== nextIdentity) {
      identity.current = nextIdentity;
      pending.current = null; ownedToken.current = null; restoredFrom.current = null; lastWritten.current = null; suppressed.current = null; awaitingRestore.current = null;
      if (nextIdentity) loadRef.current();
      else update({ pending: null, copies: [], status: scope ? "idle" : "disabled", savedAt: null, error: null });
    }
    flushRef.current();
  }, [scope, options.recoveryKey, options.ready, options.version, options.dirty, JSON.stringify(options.value), JSON.stringify(options.serverValue)]);
  useLayoutEffect(() => {
    const key = options.recoveryKey;
    const flushOnClose = () => { if (latest.current.recoveryKey === key && snapshot() === scope) flushRef.current(); };
    const storageChanged = () => {
      if (!scope || latest.current.ready === false) return;
      const result = readDraftRecoveries(scope, latest.current.recoveryKey, latest.current.parse);
      if (!result.ok) {
        pending.current = null; lastWritten.current = null;
        update({ ...stateRef.current, pending: null, copies: [], status: "unavailable", error: recoveryStorageMessage(result.issue) });
        return;
      }
      if (latest.current.dirty && !pending.current) {
        // Other tabs' checkpoints neither block this editor nor replace its input.
        const own = result.value.find(record => record.slot === slot.current);
        if (!own || own.token !== ownedToken.current) { ownedToken.current = own?.token ?? null; lastWritten.current = null; flushRef.current(); }
        return;
      }
      if (!awaitingRestore.current) loadRef.current();
    };
    const visibility = () => { if (document.visibilityState === "hidden") flushOnClose(); };
    window.addEventListener("pagehide", flushOnClose);
    window.addEventListener("beforeunload", flushOnClose);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", storageChanged);
    window.addEventListener(DRAFT_RECOVERY_EVENT, storageChanged);
    return () => {
      // Ordinary unmount keeps the checkpoint. Only server save or explicit discard removes it.
      flushOnClose();
      window.removeEventListener("pagehide", flushOnClose);
      window.removeEventListener("beforeunload", flushOnClose);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(DRAFT_RECOVERY_EVENT, storageChanged);
    };
  }, [scope, options.recoveryKey, snapshot]);

  const clear = () => {
    suppressed.current = JSON.stringify(latest.current.value);
    awaitingRestore.current = null; lastWritten.current = null;
    if (scope) {
      for (const token of new Set([ownedToken.current, pending.current?.token, restoredFrom.current].filter((token): token is string => !!token))) {
        const result = removeDraftRecovery(scope, latest.current.recoveryKey, token);
        if (!result.ok && result.issue !== "changed") { fail(result.issue); return; }
      }
    }
    pending.current = null; ownedToken.current = null; restoredFrom.current = null;
    update({ ...stateRef.current, pending: null, status: scope ? "idle" : "disabled", savedAt: null, error: null });
  };
  const discard = () => { clear(); if (scope) loadRef.current(); };
  const choose = (token: string) => {
    const chosen = stateRef.current.copies.find(record => record.token === token);
    if (!chosen) return;
    pending.current = chosen;
    update({ ...stateRef.current, pending: chosen, savedAt: chosen.savedAt });
  };
  const restore = () => {
    if (!scope || !pending.current) return;
    const result = read();
    if (!result?.ok) { if (result) fail(result.issue); return; }
    const record = result.value.find(record => record.token === pending.current?.token);
    if (!record) { loadRef.current(); return; }
    // Only local fields change. Server persistence still needs the editor's normal CAS/save action.
    latest.current.onRestore(record.value);
    awaitingRestore.current = JSON.stringify(record.value); suppressed.current = null; lastWritten.current = null;
    restoredFrom.current = record.token; pending.current = null;
    update({ ...stateRef.current, pending: null, status: "saved", savedAt: record.savedAt, error: null });
  };
  return { ...state, label: options.label, serverValue: options.serverValue, dirty: options.dirty,
    conflict: !!state.pending && (state.pending.baseVersion !== options.version || !same(state.pending.baseValue, options.serverValue)),
    choose, restore, discard, clear };
}
