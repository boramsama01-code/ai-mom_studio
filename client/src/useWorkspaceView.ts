import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "./state";

export type WorkspaceView = { search: string; subcategory: string; layout: "list" | "board"; status: "active" | "review" | "done" | "all"; archived: boolean };
const initial: WorkspaceView = { search: "", subcategory: "", layout: "list", status: "active", archived: false };
function read(key: string): WorkspaceView {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && typeof value.search === "string" && typeof value.subcategory === "string" && ["list","board"].includes(value.layout) && ["active","review","done","all"].includes(value.status) && typeof value.archived === "boolean" ? value : initial;
  } catch { return initial; }
}
/** UI preferences only. The server remains authoritative for every content field. */
export function useWorkspaceView(channel: number | "all", ready: boolean) {
  const me = useMe();
  const key = `spacepenguin.view:${me.data?.recoveryScope ?? me.data?.user ?? "anonymous"}:${channel}`;
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const value = state.key === key ? state.value : read(key);
  const current = useRef({ key, value }); current.current = { key, value };
  const update = useCallback((patch: Partial<WorkspaceView>) => {
    const next = { ...current.current.value, ...patch };
    current.current = { key, value: next };
    setState({ key, value: next });
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep in-memory view. */ }
  }, [key]);
  const restored = useRef("");
  useEffect(() => {
    if (!ready || restored.current === key) return;
    restored.current = key;
    let top = 0;
    try { top = Number(sessionStorage.getItem(key + ":scroll")) || 0; } catch { /* Start at top. */ }
    const frame = requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
  useEffect(() => {
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { try { sessionStorage.setItem(key + ":scroll", String(window.scrollY)); } catch { /* Optional preference. */ } });
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", save); };
  }, [key]);
  return { value, update };
}
