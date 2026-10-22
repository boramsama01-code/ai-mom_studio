import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Channel } from "@shared/schema";
import { api } from "../api";
import { useDirtyGuard } from "../state";
import { useToast } from "../toast";
import { ErrorBox } from "../ui";

export function ChannelDirectory({ channels, onEdit, onCreate }: { channels: Channel[]; onEdit: (id: number) => void; onCreate: () => void }) {
  const [order, setOrder] = useState<{ ids: number[]; previousIds: number[] } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const toast = useToast();
  const dirty = !!order && JSON.stringify(order.ids) !== JSON.stringify(order.previousIds);
  const save = useMutation({ mutationFn: () => api<Channel[]>("/channels/order", { method: "PUT", body: order }),
    onSuccess: saved => { qc.setQueryData(["channels"], saved); guard.setDirty("channel-order", false); setOrder(null); toast("ok", "채널 순서를 저장했습니다."); },
    onError: () => { qc.invalidateQueries({ queryKey: ["channels"] }); },
  });
  useEffect(() => {
    guard.setDirty("channel-order", dirty, async () => { try { await save.mutateAsync(); return true; } catch { return false; } });
    return () => guard.setDirty("channel-order", false);
  }, [dirty, order]);
  const start = () => { const ids = channels.map(ch => ch.id); save.reset(); setOrder({ ids, previousIds: ids }); };
  const move = (id: number, to: number) => setOrder(current => {
    if (!current || save.isPending || to < 0 || to >= current.ids.length) return current;
    const from = current.ids.indexOf(id); if (from < 0 || from === to) return current;
    const ids = [...current.ids]; ids.splice(from, 1); ids.splice(to, 0, id); return { ...current, ids };
  });
  const sorted = order?.ids.flatMap(id => { const ch = channels.find(c => c.id === id); return ch ? [ch] : []; }) ?? channels;
  return <>
    <div className="settings-section-head"><div><h2>내 채널 <span className="muted">{channels.length}</span></h2>{order && <p className="small muted">드래그하거나 화살표로 순서를 바꾸세요. 모든 화면에 함께 적용됩니다.</p>}</div>
      {order ? <div className="row"><button className="btn" disabled={save.isPending} onClick={() => { setOrder(null); save.reset(); }}>취소</button><button className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "순서 저장"}</button></div>
        : <button className="btn" disabled={channels.length < 2} onClick={start}>↕ 순서 변경</button>}
    </div>
    {save.error && <ErrorBox error={save.error} />}
    {order ? <ol className="channel-sort-list" aria-label="채널 표시 순서">{sorted.map((ch, index) => <li key={ch.id} className={`channel-sort-row ${dragged === ch.id ? "dragging" : ""}`} draggable={!save.isPending}
      onDragStart={e => { setDragged(ch.id); e.dataTransfer.setData("text/channel-id", String(ch.id)); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => setDragged(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(Number(e.dataTransfer.getData("text/channel-id")), index); setDragged(null); }}>
      <span className="sort-grip" aria-hidden="true">⠿</span><span className="sort-number">{index + 1}</span><span className="channel-avatar" style={{ backgroundColor: ch.accentColor }}>{ch.name.slice(0, 1)}</span><strong>{ch.name}</strong>
      <div className="channel-sort-controls"><button className="btn sm" aria-label={`${ch.name} 위로 이동`} disabled={index === 0 || save.isPending} onClick={() => move(ch.id, index - 1)}>↑</button><button className="btn sm" aria-label={`${ch.name} 아래로 이동`} disabled={index === sorted.length - 1 || save.isPending} onClick={() => move(ch.id, index + 1)}>↓</button></div>
    </li>)}</ol> : <div className="channel-directory">{channels.map(ch => <button className="channel-card" key={ch.id} onClick={() => onEdit(ch.id)} aria-label={`${ch.name} 수정`}>
      <span className="channel-avatar" style={{ backgroundColor: ch.accentColor }}>{ch.name.slice(0, 1)}</span><span className="channel-card-copy"><strong>{ch.name}</strong><span>{ch.description || "채널 소개를 추가하세요"}</span><small>{ch.active ? "사용 중" : "사용 중지"}</small></span><span className="channel-edit">수정 ↗</span>
    </button>)}<button className="channel-card channel-create" onClick={onCreate}><span className="channel-avatar">＋</span><strong>새 채널 추가</strong></button></div>}
  </>;
}
