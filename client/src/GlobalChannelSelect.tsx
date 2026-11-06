import { useId, type CSSProperties } from "react";
import { Icon } from "./icons";
import { useChannel, useDirtyGuard } from "./state";

/** Switch the active workspace after resolving any unsaved edits. */
export function GlobalChannelSelect() {
  const id = useId();
  const { channels, current, selected, select, isLoading, error, refresh } = useChannel();
  const guard = useDirtyGuard();
  return (
    <div className="global-channel-wrap">
    <label className="global-channel-select" htmlFor={id} style={{ "--scope-accent": current?.accentColor ?? "#287b76" } as CSSProperties}>
      <span className="global-channel-label">보기 채널</span>
      <span className="global-channel-control">
        <span className="global-channel-dot" aria-hidden="true" />
        <select id={id} aria-label="보기 채널" title={`${current?.name ?? "모든 채널"} · 채널을 바꾸면 선택한 채널의 콘텐츠나 자료 목록으로 이동합니다.`} value={selected} disabled={isLoading || (!channels.length && !!error) || !!guard.pending || guard.resolving}
          onChange={event => select(event.target.value === "all" ? "all" : Number(event.target.value))}>
          <option value="all">{isLoading ? "채널 불러오는 중…" : "모든 채널"}</option>
          {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <Icon name="chevron" size={14} />
      </span>
    </label>
    {error && !channels.length && <button className="btn sm ghost" onClick={refresh}>채널 다시 불러오기</button>}
    </div>
  );
}
