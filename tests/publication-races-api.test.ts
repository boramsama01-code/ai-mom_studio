import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { approvals, auditLogs, contentItems, contentRevisions, deliveries, destinations, mediaAssets } from "../shared/schema";

setTestEnv();
const { getDb, closeDb } = await import("../server/db");
const { cancelApproval, retryDelivery } = await import("../server/worker/publish");
const outbound = vi.fn(() => { throw new Error("Publication race tests must never send a network request"); });
beforeAll(async () => { await resetDb(); vi.stubGlobal("fetch", outbound); });
afterAll(async () => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await closeDb(); });

async function fixture(status: string) {
  const db = getDb();
  const [item] = await db.insert(contentItems).values({ channelId: 1, kind: "notice", origin: "manual", title: "게시 동시 요청 테스트", reviewStatus: "reviewed", relevance: "relevant", publishStatus: status }).returning();
  const [rev] = await db.insert(contentRevisions).values({ contentItemId: item.id, revisionNo: 1, author: "operator", payload: {} }).returning();
  await db.update(contentItems).set({ currentRevisionId: rev.id }).where(eq(contentItems.id, item.id));
  const [asset] = await db.insert(mediaAssets).values({ channelId: 1, contentItemId: item.id, revisionId: rev.id, sha256: `race-${item.id}`, width: 1, height: 1, bytes: Buffer.from("test-only") }).returning();
  const [approval] = await db.insert(approvals).values({ channelId: 1, contentItemId: item.id, revisionId: rev.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions: { instagram: "test", telegram: "test" }, scheduledAt: new Date(Date.now() - 1000), approvedBy: "test" }).returning();
  const [destination] = await db.insert(destinations).values({ channelId: 1, platform: "instagram", label: `test-${item.id}`, enabled: false }).returning();
  const [delivery] = await db.insert(deliveries).values({ channelId: 1, approvalId: approval.id, destinationId: destination.id, status, lastError: "test failure", attempts: 1 }).returning();
  return { db, item, approval, delivery };
}

// CI runs these against PostgreSQL 16 with separate pooled connections. No social
// adapter is invoked: the second participant uses the worker's conditional claim.
describe("PostgreSQL publication races", () => {
  it("allows only one of two concurrent retry requests to queue the delivery", async () => {
    const { db, delivery } = await fixture("failed");
    const results = await Promise.all([retryDelivery(db, delivery.id, "first"), retryDelivery(db, delivery.id, "second")]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toHaveLength(1);
    expect((await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0]).toMatchObject({ status: "scheduled", attempts: 1, lastError: null });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "retry_delivery"), eq(auditLogs.entityId, String(delivery.id))))).toHaveLength(1);
  });

  it("either cancels the queued delivery or preserves a worker claim, never both", async () => {
    const { db, approval, delivery } = await fixture("scheduled");
    const [cancelled, claimed] = await Promise.all([
      cancelApproval(db, approval.id, "test"),
      db.update(deliveries).set({ status: "processing", requestStartedAt: new Date() }).where(and(eq(deliveries.id, delivery.id), eq(deliveries.status, "scheduled"))).returning({ id: deliveries.id }),
    ]);
    const [finalDelivery] = await db.select().from(deliveries).where(eq(deliveries.id, delivery.id));
    const [finalApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    if (cancelled.ok) {
      expect(claimed).toHaveLength(0);
      expect(finalDelivery.status).toBe("cancelled");
      expect(finalApproval.status).toBe("cancelled");
    } else {
      expect(claimed).toHaveLength(1);
      expect(finalDelivery.status).toBe("processing");
      expect(finalApproval.status).toBe("active");
    }
  });

  it("keeps unknown outcomes blocked until explicit confirmation and rejects a stale revision", async () => {
    const { db, item, approval, delivery } = await fixture("unknown");
    expect(await retryDelivery(db, delivery.id, "test")).toMatchObject({ ok: false, code: "confirmation_required" });
    expect((await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0].status).toBe("unknown");
    await db.update(contentItems).set({ currentRevisionId: approval.revisionId + 1 }).where(eq(contentItems.id, item.id));
    expect((await retryDelivery(db, delivery.id, "test", true)).ok).toBe(false);
    await db.update(contentItems).set({ currentRevisionId: approval.revisionId }).where(eq(contentItems.id, item.id));
    expect(await retryDelivery(db, delivery.id, "test", true)).toMatchObject({ ok: true, deliveryId: delivery.id });
  });
});
