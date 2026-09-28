import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  EVIDENCE_LABEL,
  PUBLISH_LABEL,
  RELEVANCE_LABEL,
  REVIEW_LABEL,
  RUN_STATUS_LABEL,
  SCHEDULE_LABEL,
  JOB_STATUS_LABEL,
} from "@shared/domain";
import { useDirtyGuard } from "./state";
import { ApiError } from "./api";

export function Badge({ kind = "", children, title }: { kind?: "" | "ok" | "warn" | "err" | "sample"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${kind}`} title={title}>
      {children}
    </span>
  );
}

const tone: Record<string, "" | "ok" | "warn" | "err"> = {
  official_confirmed: "ok", secondary_only: "", needs_review: "warn", conflict: "err", fetch_failed: "err",
  open: "ok", upcoming: "", closed: "err", unknown: "warn",
  pending: "warn", reviewed: "ok", held: "", rejected: "err", review_required: "err",
  relevant: "ok", irrelevant: "err", uncertain: "warn",
  succeeded: "ok", failed: "err", processing: "", scheduled: "", waiting: "", cancelled: "", dry_run: "warn",
  ok: "ok", ok_zero: "", partial: "warn", aborted: "err", running: "", queued: "",
};

export function StatusBadge({ type, value }: { type: "evidence" | "schedule" | "review" | "relevance" | "publish" | "run" | "job"; value: string }) {
  const labels = { evidence: EVIDENCE_LABEL, schedule: SCHEDULE_LABEL, review: REVIEW_LABEL, relevance: RELEVANCE_LABEL, publish: PUBLISH_LABEL, run: RUN_STATUS_LABEL, job: JOB_STATUS_LABEL }[type];
  const prefix = { evidence: "근거", schedule: "일정", review: "검토", relevance: "관련성", publish: "발행", run: "", job: "" }[type];
  if (value === "not_applicable") return null;
  return <Badge kind={tone[value] ?? ""}>{prefix ? `${prefix}: ` : ""}{labels[value] ?? value}</Badge>;
}

export function Loading({ lines = 3, label = "불러오는 중" }: { lines?: number; label?: string }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "알 수 없는 오류";
  return (
    <div className="notice err" role="alert">
      <div className="row between">
        <span>{msg}</span>
        {retry && (
          <button className="btn sm" onClick={retry}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="panel muted">{children}</div>;
}

/** 미저장 편집을 확인하고 이동하는 링크 */
export function GuardedLink({ href, children, className, ariaCurrent, onClick }: { href: string; children: ReactNode; className?: string; ariaCurrent?: boolean; onClick?: () => void }) {
  const [, navigate] = useLocation();
  const guard = useDirtyGuard();
  return (
    <a
      href={href}
      className={className}
      aria-current={ariaCurrent ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        guard.confirmLeave(() => {
          onClick?.();
          navigate(href);
        });
      }}
    >
      {children}
    </a>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>("button, input, textarea, select, a")?.focus();
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      (prev.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function DirtyModal() {
  const g = useDirtyGuard();
  if (!g.pending) return null;
  return (
    <Modal title="저장하지 않은 변경이 있습니다" onClose={() => g.resolve("cancel")}>
      <p>이동하기 전에 어떻게 할까요?</p>
      <div className="row">
        <button className="btn primary" onClick={() => g.resolve("save")}>
          저장하고 이동
        </button>
        <button className="btn danger" onClick={() => g.resolve("discard")}>
          버리고 이동
        </button>
        <button className="btn" onClick={() => g.resolve("cancel")}>
          취소
        </button>
      </div>
    </Modal>
  );
}

export function fmtDate(iso: string | null | undefined, precision: string | null = "datetime") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const k = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return precision === "date" ? k.slice(0, 10) : `${k.slice(0, 10)} ${k.slice(11, 16)}`;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row" aria-label="페이지">
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        이전
      </button>
      <span className="small muted">
        {page} / {pages} 페이지 · 총 {total}건
      </span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        다음
      </button>
    </nav>
  );
}
