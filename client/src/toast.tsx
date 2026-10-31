/** 알림(토스트) — 저장·실패 결과를 화면 아래에 잠깐 보여준다 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastAction = { label: string; onClick: () => Promise<unknown> | void };
type Toast = { id: number; kind: "ok" | "err" | "info"; text: string; action?: ToastAction };
const Ctx = createContext<(kind: Toast["kind"], text: string, action?: ToastAction) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), action ? 12000 : kind === "err" ? 7000 : 3500);
  }, []);
  const [pending, setPending] = useState<number | null>(null);
  async function runAction(t: Toast) {
    setPending(t.id);
    try { await t.action?.onClick(); setList(l => l.filter(x => x.id !== t.id)); }
    catch (e) { push("err", e instanceof Error ? e.message : "다시 시도해 주세요."); }
    finally { setPending(null); }
  }
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span aria-hidden>{t.kind === "ok" ? "✓" : t.kind === "err" ? "!" : "i"}</span>
            <span>{t.text}</span>
            {t.action && <button className="toast-action" disabled={pending !== null} onClick={() => void runAction(t)}>{pending === t.id ? "처리 중…" : t.action.label}</button>}
            <button className="toast-x" aria-label="닫기" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

