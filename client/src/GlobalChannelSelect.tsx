import { useId, type CSSProperties } from "react";
import { Icon } from "./icons";
import { useChannel } from "./state";

/** One persistent list scope. A saved content item's own channel never changes here. */
export function GlobalChannelSelect() {
  const id = useId();
  const { channels, current, selected, select, isLoading } = useChannel();
  return (
    <label className="global-channel-select" htmlFor={id} style={{ "--scope-accent": current?.accentColor ?? "#287b76" } as CSSProperties}>
      <span className="global-channel-label">보기 채널</span>
      <span className="global-channel-control">
        <span className="global-channel-dot" aria-hidden="true" />
        <select id={id} aria-label="보기 채널" value={selected} disabled={isLoading}
          onChange={event => select(event.target.value === "all" ? "all" : Number(event.target.value))}>
          <option value="all">{isLoading ? "채널 불러오는 중…" : "모든 채널"}</option>
          {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <Icon name="chevron" size={14} />
      </span>
    </label>
  );
}
