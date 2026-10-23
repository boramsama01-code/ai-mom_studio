import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Channel } from "@shared/schema";
import { api, ApiError } from "../api";
import { moveVisibleChannel, reconcileChannelOrder } from "@shared/channelDirectory";
import { useDirtyGuard } from "../state";
import { useToast } from "../toast";
import { ErrorBox } from "../ui";

export function ChannelDirectory({ channels, onEdit, onCreate }: { channels: Channel[]; onEdit: (id: number) => void; onCreate: () => void }) {
  const [order, setOrder] = useState<{ ids: number[]; previousIds: number[] } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const qc = useQueryClient();
  const guard = useDirtyGuard();
  const toast = useToast();
  const active = channels.filter(ch => ch.active);
  const archived = channels.filter(ch => !ch.active);
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
    return { ...current, ids: moveVisibleChannel(current.ids, active.map(ch => ch.id), id, to) };
  });
  const refresh = useMutation({ mutationFn: () => api<Channel[]>("/channels"), onSuccess: latest => {
    qc.setQueryData(["channels"], latest);
    const latestIds = latest.map(ch => ch.id);
    setOrder(current => current ? { ids: reconcileChannelOrder(current.ids, latestIds), previousIds: latestIds } : null);
    save.reset(); toast("ok", "지금 정렬을 유지하며 최신 목록을 불러왔습니다. 순서를 확인하고 저장하세요.");
  } });
  const restore = useMutation({ mutationFn: (ch: Channel) => api(`/channels/${ch.id}`, { method: "PATCH", body: { version: ch.version, active: true } }), onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["studio"] }); toast("ok", "채널을 복원했습니다.");
  } });
  const sorted = order?.ids.flatMap(id => { const ch = active.find(c => c.id === id); return ch ? [ch] : []; }) ?? active;
  return <>
    <div className="settings-section-head"><div><span className="studio-eyebrow">우주펭귄상회</span><h2>내 채널 <span className="muted">{active.length}</span></h2>{order && <p className="small muted">드래그하거나 화살표로 순서를 바꾸세요.</p>}</div>
      {order ? <div className="row"><button className="btn" disabled={save.isPending} onClick={() => { setOrder(null); save.reset(); }}>취소</button><button className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "저장 중…" : "순서 저장"}</button></div>
        : <button className="btn" disabled={active.length < 2} onClick={start}>↕ 순서 변경</button>}
    </div>
    {save.error && <ErrorBox error={save.error} />}
    {save.error instanceof ApiError && save.error.status === 409 && <button className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? "불러오는 중…" : "지금 정렬 유지하고 목록 새로 불러오기"}</button>}
    {(refresh.error || restore.error) && <ErrorBox error={refresh.error || restore.error} />}
    {!order && !active.length && <p className="notice">사용 중인 채널이 없습니다. 첫 채널을 추가하거나 보관한 채널을 복원하세요.</p>}
    {order ? <ol className="channel-sort-list" aria-label="채널 표시 순서">{sorted.map((ch, index) => <li key={ch.id} className={`channel-sort-row ${dragged === ch.id ? "dragging" : ""}`} draggable={!save.isPending}
      onDragStart={e => { setDragged(ch.id); e.dataTransfer.setData("text/channel-id", String(ch.id)); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => setDragged(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(Number(e.dataTransfer.getData("text/channel-id")), index); setDragged(null); }}>
      <span className="sort-grip" aria-hidden="true">⠿</span><span className="sort-number">{index + 1}</span><span className="channel-avatar" style={{ backgroundColor: ch.accentColor }}>{ch.name.slice(0, 1)}</span><strong>{ch.name}</strong>
      <div className="channel-sort-controls"><button className="btn sm" aria-label={`${ch.name} 위로 이동`} disabled={index === 0 || save.isPending} onClick={() => move(ch.id, index - 1)}>↑</button><button className="btn sm" aria-label={`${ch.name} 아래로 이동`} disabled={index === sorted.length - 1 || save.isPending} onClick={() => move(ch.id, index + 1)}>↓</button></div>
    </li>)}</ol> : <div className="channel-directory">{active.map(ch => <button className="channel-card" key={ch.id} onClick={() => onEdit(ch.id)} aria-label={`${ch.name} 수정`}>
      <span className="channel-avatar" style={{ backgroundColor: ch.accentColor }}>{ch.name.slice(0, 1)}</span><span className="channel-card-copy"><strong>{ch.name}</strong><span>{ch.description || "채널 소개를 추가하세요"}</span><small>{ch.active ? "사용 중" : "사용 중지"}</small></span><span className="channel-edit">수정 ↗</span>
    </button>)}<button className="channel-card channel-create" onClick={onCreate}><span className="channel-avatar">＋</span><strong>새 채널 추가</strong></button></div>}
    {!order && <p className="small muted">기본 채널도 이름을 바꾸거나 보관할 수 있습니다. 실제 운영하는 채널만 남겨 두세요.</p>}
    {!order && archived.length > 0 && <details className="panel settings-details"><summary>보관한 채널 {archived.length}개</summary><p className="small muted">기존 콘텐츠는 보존됩니다. 복원하면 이전 자동 작업 설정도 다시 적용됩니다.</p><ul className="list">{archived.map(ch => <li className="row between" key={ch.id}><button className="btn ghost" onClick={() => onEdit(ch.id)}>{ch.name}</button><button className="btn sm" disabled={restore.isPending} onClick={() => restore.mutate(ch)}>복원</button></li>)}</ul></details>}
  </>;
}
