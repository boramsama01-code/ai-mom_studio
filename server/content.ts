/**
 * 콘텐츠 버전·승인 무효화 공용 로직
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db";
import { approvals, contentItems, contentRevisions, deliveries } from "../shared/schema";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

export async function createRevision(
  tx: Tx,
  a: {
    contentItemId: number;
    author: "llm" | "operator" | "system";
    payload: Record<string, unknown>;
    model?: string | null;
    promptVersion?: string | null;
    usage?: { inputTokens: number; outputTokens: number } | null;
    note?: string;
    makeCurrent?: boolean;
  },
) {
  const [{ next }] = (
    await tx.execute(sql`select coalesce(max(revision_no), 0) + 1 as next from content_revisions where content_item_id = ${a.contentItemId}`)
  ).rows as Array<{ next: number }>;
  const [rev] = await tx
    .insert(contentRevisions)
    .values({
      contentItemId: a.contentItemId,
      revisionNo: Number(next),
      author: a.author,
      payload: a.payload,
      model: a.model ?? null,
      promptVersion: a.promptVersion ?? null,
      usage: a.usage ?? null,
      note: a.note ?? "",
    })
    .returning();
  if (a.makeCurrent !== false) {
    await tx.update(contentItems).set({ currentRevisionId: rev.id, updatedAt: new Date() }).where(eq(contentItems.id, a.contentItemId));
    await invalidateApprovals(tx, a.contentItemId, "콘텐츠 버전 변경 — 재승인 필요");
  }
  return rev;
}

/**
 * 활성 승인을 무효화하고, 아직 처리 시작 전인 전송만 취소한다.
 * 처리 중·완료된 외부 게시는 건드리지 않는다.
 */
export async function invalidateApprovals(tx: Tx, contentItemId: number, reason: string): Promise<number> {
  const active = await tx
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.contentItemId, contentItemId), eq(approvals.status, "active")));
  if (!active.length) return 0;
  const ids = active.map((a) => a.id);
  await tx.update(approvals).set({ status: "invalidated", invalidatedReason: reason, updatedAt: new Date() }).where(inArray(approvals.id, ids));
  await tx
    .update(deliveries)
    .set({ status: "cancelled", lastError: reason, updatedAt: new Date() })
    .where(and(inArray(deliveries.approvalId, ids), inArray(deliveries.status, ["scheduled", "waiting"])));
  await tx
    .update(contentItems)
    .set({ publishStatus: "waiting" })
    .where(and(eq(contentItems.id, contentItemId), inArray(contentItems.publishStatus, ["scheduled", "waiting"])));
  return ids.length;
}
