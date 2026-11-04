import { and, eq } from "drizzle-orm";
import { contentItems, contentRevisions } from "../../shared/schema";
import { noticePayloadSchema, payloadSchemaFor } from "../../shared/payloads";
import type { DB } from "../db";
import { audit } from "../audit";
import { createRevision } from "../content";
import { conflict, HttpError } from "../routes/util";
import { computeScheduleStatus } from "./dates";

export type RestoreSourceRevisionInput = {
  channelId: number;
  itemId: number;
  revisionId: number;
  version: number;
  actor: string;
};

/**
 * Restore an immutable payload as a new operator revision, never rewind an ID.
 * The item lock is shared with editing, approval and publication. createRevision
 * revokes pending publication in this transaction while preserving sent/unknown evidence.
 */
export async function restoreSourceRevision(db: DB, input: RestoreSourceRevisionInput) {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(
      eq(contentItems.id, input.itemId), eq(contentItems.channelId, input.channelId),
    )).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    if (item.version !== input.version) conflict(item);
    if (item.origin === "studio" || !["notice", "science_dialogue", "current_dialogue"].includes(item.kind))
      throw new HttpError(409, "이 콘텐츠는 해당 편집기의 버전 기록에서 복원해 주세요.");
    const [selected] = await tx.select().from(contentRevisions).where(and(
      eq(contentRevisions.id, input.revisionId), eq(contentRevisions.contentItemId, item.id),
    ));
    if (!selected) throw new HttpError(404, "이 콘텐츠의 버전을 찾을 수 없습니다.");
    if (item.currentRevisionId === selected.id) throw new HttpError(409, "이미 현재 원고인 버전입니다. 다른 버전을 선택해 주세요.");
    // A legacy/incompatible record remains readable; do not silently drop fields
    // or fill missing facts merely to make it restorable with today's editor.
    const validation = payloadSchemaFor(item.kind).safeParse(selected.payload);
    if (!validation.success) throw new HttpError(422, "이 버전의 원고 형식은 현재 편집기에서 그대로 복원할 수 없습니다. 비교 화면에서 필요한 내용을 확인해 현재 원고에 직접 옮겨 주세요.");
    const payload = structuredClone(selected.payload);
    const notice = item.kind === "notice" ? noticePayloadSchema.parse(payload) : null;
    const previousRevisionId = item.currentRevisionId;
    const candidateTitle = item.kind === "science_dialogue" ? payload.key_question || payload.topic : payload.title;
    const title = typeof candidateTitle === "string" && candidateTitle.trim() ? candidateTitle.trim().slice(0, 200) : item.title;
    const now = new Date();
    await tx.update(contentItems).set({
      title,
      edited: payload,
      reviewStatus: "review_required",
      evidenceStatus: "needs_review",
      version: item.version + 1,
      updatedAt: now,
      ...(notice ? {
        category: notice.category,
        schoolType: notice.school_type,
        relevance: notice.relevance,
        scheduleStatus: computeScheduleStatus(notice.schedules, now),
      } : {}),
    }).where(eq(contentItems.id, item.id));
    const revision = await createRevision(tx, {
      contentItemId: item.id,
      author: "operator",
      payload,
      note: `r${selected.revisionNo} 복원 · 이전 현재 원고와 이미지는 기록에 보존 · 다시 검토 필요`,
    });
    await audit(tx, { actor: input.actor, action: "restore_revision", entity: "content_item", entityId: item.id, channelId: item.channelId,
      detail: { restoredFromRevisionId: selected.id, restoredFromRevisionNo: selected.revisionNo, previousRevisionId, revisionId: revision.id, version: item.version + 1 } });
    const [saved] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
    return { item: saved, revision, restoredFrom: { id: selected.id, revisionNo: selected.revisionNo }, previousRevisionId };
  });
}
