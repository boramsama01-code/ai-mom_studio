import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Delivery } from "@shared/schema";
import { canOrganizePublication, publicationListLabels, publicationListState, publicationOrganizeBlockedReason, type OrganizedPublication, type OrganizePublicationsResult, type PublicationListState } from "@shared/publicationList";
import { api } from "./api";
import { useToast } from "./toast";

type OrganizationRow = { d: Delivery; item: { channelId: number } };
type Change = { id: number; channelId: number; version: number; state: PublicationListState };

async function applyChanges(changes: Change[]) {
  const groups = new Map<string, { channelId: number; state: PublicationListState; records: Array<{ id: number; version: number }> }>();
  for (const change of changes) {
    const key = `${change.channelId}:${change.state}`;
    const group = groups.get(key) ?? { channelId: change.channelId, state: change.state, records: [] };
    group.records.push({ id: change.id, version: change.version }); groups.set(key, group);
  }
  const items: OrganizedPublication[] = [], errors: string[] = [];
  // Every write names its channel, even when the list shows all channels.
  for (const { channelId, state, records } of groups.values()) {
    try { const result = await api<OrganizePublicationsResult>(`/channels/${channelId}/deliveries/organize`, { method: "POST", body: { state, records } }); items.push(...result.items); }
    catch (error) { errors.push(error instanceof Error ? error.message : "목록을 변경하지 못했습니다."); }
  }
  return { items, errors };
}

export function usePublicationOrganization(onChanged: () => void) {
  const qc = useQueryClient(), toast = useToast();
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  async function refresh() { await qc.invalidateQueries({ predicate: query => query.queryKey.includes("deliveries") }); onChanged(); }
  async function move(rows: OrganizationRow[], state: PublicationListState) {
    if (pending || !rows.length) return;
    setPending(true); setError(null);
    try {
      const result = await applyChanges(rows.map(row => ({ id: row.d.id, channelId: row.item.channelId, version: row.d.listVersion ?? 1, state })));
      await refresh();
      if (result.items.length) toast("ok", state === "active" ? `${result.items.length}건을 발행 목록으로 복원했어요.` : `${result.items.length}건을 ${publicationListLabels[state]}으로 이동했어요.`, {
        label: "실행 취소", onClick: async () => {
          const undone = await applyChanges(result.items.map(item => ({ id: item.id, channelId: item.channelId, version: item.listVersion, state: item.previousState })));
          await refresh();
          if (undone.errors.length) throw new Error(`${undone.items.length ? `${undone.items.length}건 되돌림. ` : ""}${[...new Set(undone.errors)].join(" ")}`);
          toast("ok", "발행 기록을 이전 목록으로 되돌렸어요.");
        },
      });
      if (result.errors.length) setError(`${result.items.length ? `${result.items.length}건은 처리됐습니다. 나머지는 ` : ""}${[...new Set(result.errors)].join(" ")}`);
    } finally { setPending(false); }
  }
  return { move, pending, error };
}

export function PublicationListActions({ delivery, title, pending, move }: { delivery: Delivery; title: string; pending: boolean; move: (state: PublicationListState) => void }) {
  const state = publicationListState(delivery), reason = publicationOrganizeBlockedReason(delivery);
  if (!canOrganizePublication(delivery)) return <p className="small muted publication-organize-hint">{reason}</p>;
  return <div className="row publication-list-actions">
    {state !== "active" && <button className="btn sm" aria-label={`${title} 발행 목록으로 복원`} disabled={pending} onClick={() => move("active")}>복원</button>}
    {state !== "archived" && <button className="btn sm ghost" aria-label={`${title} 발행 기록 보관`} disabled={pending} onClick={() => move("archived")}>보관</button>}
    {state !== "trashed" && <button className="btn sm ghost" aria-label={`${title} 발행 기록 삭제`} title="스튜디오 휴지통으로 이동 · 복원 가능" disabled={pending} onClick={() => move("trashed")}>삭제</button>}
    <span className="small muted">{state === "trashed" ? "원고·이미지·발행 기록을 보존하고 있어요." : "SNS 원본은 그대로 유지됩니다."}</span>
  </div>;
}
