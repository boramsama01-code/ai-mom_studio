import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Router } from "wouter";
import { useDirtyGuard } from "./state";

const INDEX = "__spacepenguinHistoryIndex";
type Entry = { url: string; index: number; state: unknown };
type NavigateOptions = { replace?: boolean; state?: unknown };
type Blocker = { hasDirty: () => boolean; confirmLeave: (proceed: () => void) => void };

/** Keep the accepted route mounted while a native history move is being resolved.
 * Restoring the history cursor (rather than pushing a duplicate URL) preserves
 * both Back and Forward, including the cancel/save-failure cases.
 */
export function createGuardedHistory(browser: Window, blocker: () => Blocker) {
  const url = () => browser.location.pathname + browser.location.search + browser.location.hash;
  const indexOf = (state: unknown) => state && typeof state === "object" && Number.isInteger((state as Record<string, unknown>)[INDEX])
    ? (state as Record<string, number>)[INDEX] : null;
  let current: Entry = { url: url(), index: indexOf(browser.history.state) ?? 0, state: browser.history.state };
  const listeners = new Set<() => void>();
  let writing = false;
  let restoring: { origin: Entry; target: Entry } | null = null;
  let permittedIndex: number | null = null;
  const tagged = (state: unknown, index: number) => ({ ...(state && typeof state === "object" ? state : {}), [INDEX]: index });
  const publish = (entry: Entry) => { current = entry; listeners.forEach(listener => listener()); };
  const write = (entry: Entry, replace: boolean) => {
    writing = true;
    try { browser.history[replace ? "replaceState" : "pushState"](tagged(entry.state, entry.index), "", entry.url); }
    finally { writing = false; }
  };
  const navigate = (to: string, options: NavigateOptions = {}) => {
    const targetUrl = new URL(to, browser.location.href);
    if (targetUrl.origin !== browser.location.origin) {
      blocker().confirmLeave(() => browser.location.assign(targetUrl.href));
      return;
    }
    const nextUrl = targetUrl.pathname + targetUrl.search + targetUrl.hash;
    if (nextUrl === current.url && !options.replace) return;
    blocker().confirmLeave(() => {
      const next = { url: nextUrl, index: current.index + (options.replace ? 0 : 1), state: options.state ?? null };
      write(next, !!options.replace);
      publish(next);
    });
  };
  const askAfterRestore = (origin: Entry, target: Entry) => {
    blocker().confirmLeave(() => {
      permittedIndex = target.index;
      browser.history.go(target.index - origin.index);
    });
  };
  const onPop = () => {
    const observedIndex = indexOf(browser.history.state);
    const target: Entry = { url: url(), index: observedIndex ?? current.index, state: browser.history.state };
    if (permittedIndex !== null && observedIndex === permittedIndex) {
      permittedIndex = null;
      publish(target);
      return;
    }
    if (restoring) {
      const pending = restoring;
      if (observedIndex === pending.origin.index) {
        restoring = null;
        askAfterRestore(pending.origin, pending.target);
      } else if (observedIndex !== null) {
        browser.history.go(pending.origin.index - observedIndex);
      }
      return;
    }
    if (!blocker().hasDirty()) {
      if (observedIndex === null) write(target, true);
      publish(target);
      return;
    }
    if (observedIndex !== null && observedIndex !== current.index) {
      restoring = { origin: current, target };
      browser.history.go(current.index - target.index);
    } else {
      // An untagged same-document entry may predate this app session. Preserve
      // the draft and restore the current URL before asking, without assuming
      // an unknown history offset.
      write(current, true);
      blocker().confirmLeave(() => { write(target, true); publish(target); });
    }
  };
  const onWrite = (event: Event) => {
    if (writing) return;
    const origin = current;
    const target: Entry = { url: url(), index: current.index + (event.type === "pushState" ? 1 : 0), state: browser.history.state };
    write(target, true);
    if (target.url === current.url || !blocker().hasDirty()) return publish(target);
    if (event.type === "pushState") {
      restoring = { origin, target };
      browser.history.go(-1);
    } else {
      write(origin, true);
      blocker().confirmLeave(() => { write(target, true); publish(target); });
    }
  };
  return {
    navigate,
    getSnapshot: () => current.url,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => {
      write(current, true);
      browser.addEventListener("popstate", onPop);
      // Wouter emits these events for History API writes, including callers
      // outside useLocation. All actual rendering reads the accepted snapshot.
      browser.addEventListener("pushState", onWrite);
      browser.addEventListener("replaceState", onWrite);
      return () => {
        browser.removeEventListener("popstate", onPop);
        browser.removeEventListener("pushState", onWrite);
        browser.removeEventListener("replaceState", onWrite);
      };
    },
  };
}

export function GuardedRouter({ children }: { children: ReactNode }) {
  const guard = useDirtyGuard();
  const guardRef = useRef(guard);
  guardRef.current = guard;
  const history = useMemo(() => createGuardedHistory(window, () => guardRef.current), []);
  useLayoutEffect(() => history.start(), [history]);
  const hooks = useMemo(() => ({
    useLocation: () => {
      const path = useSyncExternalStore(history.subscribe, history.getSnapshot);
      return [path.split(/[?#]/, 1)[0], history.navigate] as [string, typeof history.navigate];
    },
    useSearch: () => {
      const path = useSyncExternalStore(history.subscribe, history.getSnapshot);
      return new URL(path, window.location.origin).search;
    },
  }), [history]);
  return <Router hook={hooks.useLocation} searchHook={hooks.useSearch}>{children}</Router>;
}
