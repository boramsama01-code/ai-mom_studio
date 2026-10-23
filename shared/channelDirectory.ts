/** Keep the user's draft order while accepting added/removed channels after a conflict. */
export function reconcileChannelOrder(draft: number[], latest: number[]): number[] {
  const present = new Set(latest);
  const kept = [...new Set(draft)].filter(id => present.has(id));
  const seen = new Set(kept);
  return [...kept, ...latest.filter(id => !seen.has(id))];
}

/** Hidden channels retain their positions and are always included in the server payload. */
export function moveVisibleChannel(ids: number[], visible: number[], id: number, to: number): number[] {
  const visibleSet = new Set(visible);
  const moving = ids.filter(value => visibleSet.has(value));
  const from = moving.indexOf(id);
  if (from < 0 || to < 0 || to >= moving.length) return ids;
  moving.splice(from, 1); moving.splice(to, 0, id);
  let index = 0;
  return ids.map(value => visibleSet.has(value) ? moving[index++] : value);
}
