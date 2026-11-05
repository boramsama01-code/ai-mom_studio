import { z } from "zod";

export const publicationListStates = ["active", "archived", "trashed"] as const;
export type PublicationListState = typeof publicationListStates[number];
export const completedDeliveryStatuses = ["succeeded", "failed", "cancelled", "dry_run"] as const;
export const publicationListLabels: Record<PublicationListState, string> = { active: "발행 목록", archived: "보관함", trashed: "휴지통" };

type ListableDelivery = { status: string; needsReconciliation?: boolean | null; listState?: string | null };

/** An unresolved or running attempt must remain discoverable, including late responses. */
export function canOrganizePublication(delivery: ListableDelivery): boolean {
  return !delivery.needsReconciliation && (completedDeliveryStatuses as readonly string[]).includes(delivery.status);
}

export function publicationListState(delivery: ListableDelivery): PublicationListState {
  if (!canOrganizePublication(delivery)) return "active";
  return delivery.listState === "archived" || delivery.listState === "trashed" ? delivery.listState : "active";
}

export function publicationOrganizeBlockedReason(delivery: ListableDelivery): string | null {
  if (canOrganizePublication(delivery)) return null;
  if (delivery.needsReconciliation || delivery.status === "unknown") return "게시 결과를 먼저 확인한 뒤 보관하거나 삭제할 수 있어요.";
  if (["scheduled", "waiting"].includes(delivery.status)) return "예약을 먼저 취소한 뒤 보관하거나 삭제할 수 있어요.";
  return "전송이 끝난 뒤 보관하거나 삭제할 수 있어요.";
}

export const organizePublicationsSchema = z.object({
  state: z.enum(publicationListStates),
  records: z.array(z.object({ id: z.number().int().positive(), version: z.number().int().positive() }).strict()).min(1).max(100)
    .refine(records => new Set(records.map(record => record.id)).size === records.length, "같은 전송 기록을 중복 선택할 수 없습니다."),
}).strict();
export type OrganizePublicationsInput = z.infer<typeof organizePublicationsSchema>;
export type OrganizedPublication = { id: number; channelId: number; listState: PublicationListState; listVersion: number; previousState: PublicationListState };
export type OrganizePublicationsResult = { updated: number; items: OrganizedPublication[] };
