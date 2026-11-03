/**
 * 명령 팔레트 (Ctrl/⌘ + K) — 페이지 이동, 자주 쓰는 동작, 항목 제목 검색을 한 곳에서
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, qs } from "./api";
import { useChannel, useDirtyGuard } from "./state";
import { useFocusScope } from "./useFocusScope";
import { Icon } from "./icons";
import type { ListRow } from "./pages/Inbox";

type Cmd = { id: string; label: string; hint?: string; group: string; run: () => void };

export function CommandPalette({ open, onClose, onCollect }: { open: boolean; onClose: () => void; onCollect: () => void }) {
  const [, navigate] = useLocation();
  const guard = useDirtyGuard();
  const { channels, selected, select } = useChannel();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusScope(dialog, open, onClose);
  const go = (href: string) => guard.confirmLeave(() => navigate(href));

  const search = useQuery({
    queryKey: ["palette", selected, q],
    queryFn: () => api<{ items: ListRow[] }>(`/items?${qs({ channelId: selected, q, view: "all", pageSize: 6 })}`),
    enabled: open && q.trim().length >= 2,
  });

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const cmds: Cmd[] = useMemo(() => {
    const pages: Cmd[] = [
      ["/", "내 콘텐츠"], ["/today", "아침 수집 브리핑"], ["/inbox", "수집함"], ["/publish", "발행함"],
      ["/rules", "검색 설정"], ["/design", "카드 디자인"], ["/connections", "API 키 관리 · OpenAI / Claude / Canva"], ["/settings", "채널 설정"], ["/account", "계정·비밀번호 변경"], ["/runs", "실행 기록"],
    ].map(([href, label]) => ({ id: `p${href}`, label, group: "이동", run: () => go(href) }));
    const actions: Cmd[] = [
      { id: "a-collect", label: "수집 요청", hint: "현재 채널", group: "동작", run: onCollect },
      { id: "a-new", label: "새 초안 직접 작성", group: "동작", run: () => go("/?start=free") },
      { id: "a-pending", label: "검토 대기만 보기", group: "동작", run: () => go("/inbox?review=pending,review_required") },
    ];
    const chans: Cmd[] = channels.map((c) => ({ id: `c${c.id}`, label: `채널 전환: ${c.name}`, group: "채널", run: () => select(c.id) }));
    const items: Cmd[] = (search.data?.items ?? []).map(({ item, channelName }) => ({
      id: `i${item.id}`,
      label: item.title,
      hint: channelName,
      group: "항목",
      run: () => go(`/items/${item.channelId}/${item.id}`),
    }));
    const t = q.trim().toLowerCase();
    const base = [...pages, ...actions, ...chans].filter((c) => !t || c.label.toLowerCase().includes(t));
    return [...base, ...items];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, search.data, channels, selected]);

  if (!open) return null;
  const run = (c: Cmd) => {
    onClose();
    c.run();
  };
  let lastGroup = "";
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="palette" role="dialog" aria-modal="true" aria-label="명령 팔레트">
        <div className="palette-head"><input
          ref={input}
          className="palette-input"
          aria-label="페이지 또는 자료 검색"
          placeholder="이동할 곳, 동작, 항목 제목을 입력하세요"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, cmds.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && cmds[idx]) run(cmds[idx]);
          }}
          aria-activedescendant={cmds[idx] ? `cmd-${cmds[idx].id}` : undefined}
          aria-controls="palette-list"
          role="combobox"
          aria-expanded
        />
        <button type="button" className="btn ghost icon palette-close" aria-label="검색창 닫기" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {cmds.map((c, i) => {
            const header = c.group !== lastGroup ? ((lastGroup = c.group), <li key={`g${c.group}`} className="palette-group">{c.group}</li>) : null;
            return [
              header,
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === idx}
                className={`palette-item ${i === idx ? "active" : ""}`}
                onMouseEnter={() => setIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(c);
                }}
              >
                <span>{c.label}</span>
                {c.hint && <span className="small muted">{c.hint}</span>}
              </li>,
            ];
          })}
          {q.trim().length >= 2 && search.isFetching && <li className="palette-group">항목 찾는 중…</li>}
          {!cmds.length && <li className="palette-group">결과가 없습니다</li>}
        </ul>
        <div className="palette-foot small muted">↑↓ 이동 · Enter 실행 · Esc 닫기</div>
      </div>
    </div>
  );
}


