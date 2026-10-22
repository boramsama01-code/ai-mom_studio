import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrf } from "./api";
import { enterFromPrivateLink } from "./privateLink";
import type { Channel } from "@shared/schema";

/* ───────────── 인증 ───────────── */
export type Me = { user: string | null; demo: boolean; csrf: string | null; authConfigured: boolean; demoAllowed: boolean };

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      await enterFromPrivateLink();
      const me = await api<Me>("/auth/me");
      setCsrf(me.csrf);
      return me;
    },
    staleTime: 60_000,
  });
}

/* ───────────── 채널 선택 ───────────── */
type ChannelCtx = {
  channels: Channel[];
  selected: "all" | number;
  current: Channel | null; // '전체'면 null
  select: (v: "all" | number) => void;
};
const Ctx = createContext<ChannelCtx | null>(null);

function readStored(): "all" | number | null {
  try {
    const v = localStorage.getItem("aimom.channel");
    if (v === "all") return "all";
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function ChannelProvider({ children }: { children: ReactNode }) {
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: () => api<Channel[]>("/channels") });
  const [stored, setSelected] = useState<"all" | number | null>(readStored);
  const guard = useDirtyGuard();
  const qc = useQueryClient();
  // 저장된 선택이 없거나 없어진 채널이면 첫 채널(쓰기 작업은 채널 하나가 필요)
  const selected: "all" | number =
    stored === "all" ? "all" : stored !== null && channels.some((c) => c.id === stored) ? stored : channels[0]?.id ?? "all";
  const select = useCallback(
    (v: "all" | number) => {
      guard.confirmLeave(() => {
        // 이전 채널 데이터가 잠깐 보이지 않도록 채널 범위 쿼리를 비움
        qc.removeQueries({ predicate: (q) => q.queryKey[0] === "ch" });
        setSelected(v);
        try {
          localStorage.setItem("aimom.channel", String(v));
        } catch {
          /* 저장 불가 환경 무시 */
        }
      });
    },
    [guard, qc],
  );
  const current = selected === "all" ? null : channels.find((c) => c.id === selected) ?? null;
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", current?.accentColor ?? "#172334");
    document.documentElement.style.setProperty("--accent-weak", hexA(current?.accentColor ?? "#172334", 0.1));
  }, [current]);
  const value = useMemo(() => ({ channels, selected, current, select }), [channels, selected, current, select]);
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
  setDirty: (key: string, dirty: boolean, save?: () => Promise<boolean>) => void;
  confirmLeave: (proceed: () => void) => void;
  pending: null | { proceed: () => void };
  resolve: (choice: "save" | "discard" | "cancel") => void;
};
const GuardCtx = createContext<Guard | null>(null);

export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Map<string, (() => Promise<boolean>) | undefined>());
  const [pending, setPending] = useState<null | { proceed: () => void }>(null);
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
      setDirty(key, isDirty, save) {
        if (isDirty) dirty.current.set(key, save);
        else dirty.current.delete(key);
      },
      confirmLeave(proceed) {
        if (!dirty.current.size) return proceed();
        setPending({ proceed });
      },
      pending,
      async resolve(choice) {
        const p = pending;
        if (!p) return;
        if (choice === "cancel") return setPending(null);
        if (choice === "save") {
          for (const save of dirty.current.values()) {
            if (save && !(await save())) return setPending(null); // 저장 실패 → 머무름(입력 유지)
          }
        }
        dirty.current.clear();
        setPending(null);
        p.proceed();
      },
    }),
    [pending],
  );
  return <GuardCtx.Provider value={value}>{children}</GuardCtx.Provider>;
}

export function useDirtyGuard() {
  const g = useContext(GuardCtx);
  if (!g) throw new Error("DirtyGuardProvider 필요");
  return g;
}

