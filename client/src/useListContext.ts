import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type Saved<T> = { value: T; entry?: string };
type Entry<T> = { id: string; value: T };

/** Browser-session list preferences only; never content, jobs or action selections. */
export function useListContext<T extends object>(section: string, channel: number | "all", defaults: T, parse: (value: unknown) => T | null, entry?: Entry<T>) {
  const me = useQueryClient().getQueryData<{ user?: string | null; recoveryScope?: string | null }>(["me"]);
  const persistent = !!me?.user;
  const key = `spacepenguin.list:${JSON.stringify([me?.user ?? null, me?.recoveryScope ?? null, section, channel])}`;
  const read = (): Saved<T> | null => {
    if (!persistent) return null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null"), value = parse(saved?.value);
      return value ? { value, ...(typeof saved.entry === "string" ? { entry: saved.entry } : {}) } : null;
    } catch { return null; }
  };
  const [state, setState] = useState<Saved<T> & { key: string }>(() => {
    const saved = read();
    return { key, value: entry && saved?.entry !== entry.id ? entry.value : saved?.value ?? defaults, entry: entry?.id ?? saved?.entry };
  });
  // A channel switch restores that channel's context, rather than carrying the
  // departing channel's URL/filter values into another channel's query.
  const scoped = state.key === key ? state : { key, ...(read() ?? { value: defaults }) };
  const current = useRef(scoped); current.current = scoped;
  if (state.key !== key) setState(scoped);
  const save = useCallback((saved: Saved<T>) => {
    try { if (persistent) sessionStorage.setItem(key, JSON.stringify(saved)); } catch { /* Optional preference; retain the in-memory view. */ }
  }, [key, persistent]);
  useEffect(() => { save(scoped); }, [key, scoped.value, scoped.entry, save]);
  const update = useCallback((change: Partial<T> | ((previous: T) => T)) => {
    const previous = current.current;
    const next = { ...previous, value: typeof change === "function" ? change(previous.value) : { ...previous.value, ...change } };
    current.current = next; setState(next); save(next);
  }, [save]);
  const rememberEntry = useCallback((id: string) => {
    if (current.current.entry === id) return;
    const next = { ...current.current, entry: id };
    current.current = next; setState(next); save(next);
  }, [save]);
  return { value: scoped.value, update, rememberEntry, key: persistent ? key : null, scope: key };
}

/** Wait for the restored query before scrolling; loading screens must not erase the old offset. */
export function useListScroll(key: string | null, ready: boolean) {
  const read = () => {
    try { const top = Number(key && sessionStorage.getItem(key + ":scroll")); return Number.isFinite(top) && top > 0 ? top : 0; }
    catch { return 0; }
  };
  const position = useRef({ key, top: read(), restored: false });
  if (position.current.key !== key) position.current = { key, top: read(), restored: false };
  useEffect(() => {
    const saved = position.current;
    if (!key || !ready || saved.restored || typeof requestAnimationFrame !== "function") return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: saved.top, behavior: "instant" });
      saved.restored = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
  useEffect(() => {
    const saved = position.current;
    if (!key) return;
    const store = () => { try { sessionStorage.setItem(key + ":scroll", String(saved.top)); } catch { /* Optional preference. */ } };
    const save = () => { if (saved.restored) { saved.top = window.scrollY; store(); } };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("click", save, true);
    window.addEventListener("pagehide", save);
    return () => {
      if (saved.restored) store();
      window.removeEventListener("scroll", save); window.removeEventListener("click", save, true); window.removeEventListener("pagehide", save);
    };
  }, [key]);
}
