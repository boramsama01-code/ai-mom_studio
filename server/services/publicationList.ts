import { and, eq, inArray, not, or, type SQL } from "drizzle-orm";
import { deliveries } from "../../shared/schema";
import { canOrganizePublication, completedDeliveryStatuses, publicationListState, publicationOrganizeBlockedReason, type OrganizePublicationsInput, type OrganizePublicationsResult, type PublicationListState } from "../../shared/publicationList";
import type { DB } from "../db";
import { audit } from "../audit";
import { HttpError } from "../routes/util";

export function publicationListCondition(state: PublicationListState): SQL {
  const complete = and(inArray(deliveries.status, [...completedDeliveryStatuses]), eq(deliveries.needsReconciliation, false))!;
  return state === "active" ? or(eq(deliveries.listState, "active"), not(complete))!
    : and(eq(deliveries.listState, state), complete)!;
}

/** Reversible list changes only. Never delete publication evidence or call an SNS adapter. */
export async function organizePublications(db: DB, channelId: number, input: OrganizePublicationsInput, actor: string): Promise<OrganizePublicationsResult> {
  return db.transaction(async tx => {
    const ids = input.records.map(record => record.id);
    const rows = await tx.select().from(deliveries)
      .where(and(eq(deliveries.channelId, channelId), inArray(deliveries.id, ids)))
      .orderBy(deliveries.id).for("update");
    if (rows.length !== ids.length) throw new HttpError(404, "선택한 채널의 전송 기록을 찾을 수 없습니다. 목록을 새로고침해 주세요.");
    const versions = new Map(input.records.map(record => [record.id, record.version]));
    for (const row of rows) {
      if (row.listVersion !== versions.get(row.id)) throw new HttpError(409, "다른 화면에서 발행 목록을 변경했습니다. 새로고침한 뒤 다시 선택해 주세요.", { code: "publication_list_conflict" });
      if (input.state !== "active" && !canOrganizePublication(row)) throw new HttpError(409, publicationOrganizeBlockedReason(row)!, { code: "publication_not_settled", deliveryId: row.id });
    }
    const now = new Date(), items: OrganizePublicationsResult["items"] = [];
    let updated = 0;
    for (const row of rows) {
      const previousState = publicationListState(row);
      if (row.listState === input.state) {
        items.push({ id: row.id, channelId, listState: input.state, listVersion: row.listVersion, previousState });
        continue;
      }
      const [saved] = await tx.update(deliveries).set({ listState: input.state, listVersion: row.listVersion + 1, listUpdatedAt: now })
        .where(and(eq(deliveries.id, row.id), eq(deliveries.channelId, channelId), eq(deliveries.listVersion, row.listVersion)))
        .returning({ id: deliveries.id, listState: deliveries.listState, listVersion: deliveries.listVersion });
      if (!saved) throw new HttpError(409, "발행 목록이 변경되었습니다. 새로고침한 뒤 다시 선택해 주세요.");
      updated++;
      items.push({ ...saved, channelId, previousState });
      await audit(tx, { actor, action: `publication_list:${input.state}`, entity: "delivery", entityId: row.id, channelId,
        detail: { from: previousState, to: input.state, externalPostChanged: false } });
    }
    return { updated, items };
  });
}
