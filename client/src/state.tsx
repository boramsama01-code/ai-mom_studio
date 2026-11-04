import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, setCsrf } from "./api";
import { enterFromPrivateLink } from "./privateLink";
import type { Channel } from "@shared/schema";
import { activateDraftRecoveryScope } from "./draftRecovery";

/* ───────────── 인증 ───────────── */
export type Me = { user: string | null; demo: boolean; csrf: string | null; authConfigured: boolean; demoAllowed: boolean; recoveryScope?: string | null };

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async ({ signal }) => {
      await enterFromPrivateLink();
      signal.throwIfAborted();
      const me = await api<Me>("/auth/me", { signal });
      signal.throwIfAborted();
      setCsrf(me.csrf);
      activateDraftRecoveryScope(me.user ? me.recoveryScope ?? null : null);
      return me;
    },
    staleTime: 60_000,
  });
}

/* ───────────── 채널 선택 ───────────── */
type ChannelCtx = {
  channels: Channel[];
  allChannels: Channel[];
  selected: "all" | number;
  current: Channel | null; // '전체'면 null
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  select: (v: "all" | number) => void;
};
const Ctx = createContext<ChannelCtx | null>(null);

function readStored(): "all" | number | null {
  try {
    const v = localStorage.getItem("spacepenguin.channel") ?? localStorage.getItem("aimom.channel");
    if (v !== null) {
      localStorage.setItem("spacepenguin.channel", v);
      localStorage.removeItem("aimom.channel");
    }
    if (v === "all") return "all";
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function ChannelProvider({ children }: { children: ReactNode }) {
  const { data: allChannels = [], isLoading, error, refetch } = useQuery({ queryKey: ["channels"], queryFn: () => api<Channel[]>("/channels") });
  const channels = useMemo(() => allChannels.filter(c => c.active), [allChannels]);
  const [stored, setSelected] = useState<"all" | number | null>(readStored);
  const guard = useDirtyGuard();
  const [path, navigate] = useLocation();
  // Channel-aware lists keep their section; editors/settings return to the selected content list.
  const selected: "all" | number =
    stored !== null && stored !== "all" && channels.some((c) => c.id === stored) ? stored : "all";
  const select = useCallback(
    (v: "all" | number) => {
      if (v === selected || (v !== "all" && !channels.some(c => c.id === v))) return;
      const applySelection = () => {
        // Keep detail caches intact. The guard finishes saving/discarding before navigation unmounts them.
        setSelected(v);
        try {
          localStorage.setItem("spacepenguin.channel", String(v));
        } catch {
          /* 저장 불가 환경 무시 */
        }
        if (!["/", "/inbox", "/publish", "/today", "/runs", "/rules", "/design"].includes(path)) navigate("/");
      };
      guard.confirmLeave(applySelection);
    },
    [guard, selected, channels, path, navigate],
  );
  const current = selected === "all" ? null : channels.find((c) => c.id === selected) ?? null;
  useEffect(() => {
    document.documentElement.style.setProperty("--channel-accent", current?.accentColor ?? "#287b76");
    document.documentElement.style.setProperty("--channel-tint", hexA(current?.accentColor ?? "#287b76", 0.1));
  }, [current]);
  const value = useMemo(() => ({ channels, allChannels, selected, current, isLoading, error, refresh: () => { void refetch(); }, select }), [channels, allChannels, selected, current, isLoading, error, refetch, select]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function useChannel() {
  const c = useContext(Ctx);
  if (!c) throw new Error("ChannelProvider 필요");
  return c;
}

/* ───────────── 미저장 편집 보호 ───────────── */
type Guard = {
  setDirty: (key: string, dirty: boolean, save?: () => Promise<boolean>, discard?: () => void) => void;
  hasDirty: (keys?: string[]) => boolean;
  confirmLeave: (proceed: () => void, keys?: string[]) => void;
  pending: null | { proceed: () => void; keys?: string[] };
  resolving: boolean;
  resolve: (choice: "save" | "discard" | "cancel") => void;
};
const GuardCtx = createContext<Guard | null>(null);

export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Map<string, { save?: () => Promise<boolean>; discard?: () => void }>());
  const [pending, setPending] = useState<Guard["pending"]>(null);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  const value = useMemo<Guard>(
    () => ({
      setDirty(key, isDirty, save, discard) {
        if (isDirty) dirty.current.set(key, { save, discard });
        else dirty.current.delete(key);
      },
      hasDirty(keys) {
        return keys ? keys.some(key => dirty.current.has(key)) : dirty.current.size > 0;
      },
      confirmLeave(proceed, keys) {
        if (!(keys ? keys.some(key => dirty.current.has(key)) : dirty.current.size)) return proceed();
        setPending(current => current ?? { proceed, keys });
      },
      pending,
      resolving,
      async resolve(choice) {
        const p = pending;
        if (!p || resolvingRef.current) return;
        if (choice === "cancel") return setPending(null);
        resolvingRef.current = true;
        setResolving(true);
        try {
          const entries = [...dirty.current].filter(([key]) => !p.keys || p.keys.includes(key));
          if (choice === "save") {
            for (const [, entry] of entries) {
              // A pending job or editor without a save callback must not be
              // silently discarded by "save and leave".
              if (!entry.save || !(await entry.save())) return setPending(null);
            }
          } else {
            for (const [, entry] of entries) entry.discard?.();
          }
          for (const [key] of entries) dirty.current.delete(key);
          setPending(null);
          p.proceed();
        } catch {
          // The editor displays the save failure and keeps its draft mounted.
          setPending(null);
        } finally {
          resolvingRef.current = false;
          setResolving(false);
        }
      },
    }),
    [pending, resolving],
  );
  return <GuardCtx.Provider value={value}>{children}</GuardCtx.Provider>;
}

export function useDirtyGuard() {
  const g = useContext(GuardCtx);
  if (!g) throw new Error("DirtyGuardProvider 필요");
  return g;
}
