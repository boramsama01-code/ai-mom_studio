import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DB } from "../server/db";
import { approvals, contentItems, deliveries } from "../shared/schema";
import { setTestEnv } from "./helpers";
setTestEnv();
vi.mock("../server/seed", () => ({ getSetting: async () => false }));
const { cancelApproval, retryDelivery, publishDue } = await import("../server/worker/publish");

/** In-memory transactional rows; tests never connect to a database or a publisher. */
function fixture(status = "failed") {
  const stamp = new Date("2026-11-03T10:00:00Z");
  const item = { id: 1, currentRevisionId: 7, reviewStatus: "reviewed", relevance: "relevant", excluded: false, publishStatus: status };
  const approval = { id: 21, contentItemId: 1, revisionId: 7, channelId: 3, status: "active", scheduledAt: stamp };
  const delivery = { id: 44, approvalId: 21, channelId: 3, destinationId: 90, status, destinationSnapshot: { version: 1, accountId: "123" }, phase: "finished", needsReconciliation: false, updatedAt: stamp, externalId: null as string | null, externalUrl: null, externalContainerId: "container", completedAt: stamp, requestStartedAt: stamp, attempts: 2, lastError: "fixture", errorKind: "transient" };
  const rows: Record<string, Array<Record<string, any>>> = { content_items: [item], approvals: [approval], deliveries: [delivery], audit_logs: [], delivery_attempt_events: [], publisher_heartbeats: [] };
  const predicates: Array<{ sql: string; params: unknown[] }> = [];
  const locked: string[] = [];
  let onLock: ((name: string) => void) | undefined;
  let conflictUpdate = false;
  const dialect = new PgDialect();
  function matches(table: any, row: Record<string, any>, condition?: SQL) {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition), columns = getTableColumns(table);
    const compare = (value: unknown) => value instanceof Date ? value.toISOString() : value;
    return [...query.sql.matchAll(/"[^\"]+"\."([^\"]+)" = \$(\d+)/g)].every(match => {
      const key = Object.keys(columns).find(key => columns[key].name === match[1]);
      return !key || compare(row[key]) === compare(query.params[Number(match[2]) - 1]);
    });
  }
  function select() {
    let table: any, condition: SQL | undefined, lock = false, joined = false;
    const query: any = {
      from(value: any) { table = value; return query; },
      where(value: SQL) { condition = value; return query; },
      orderBy() { return query; }, limit() { return query; },
      innerJoin() { joined = true; return query; },
      for() { lock = true; return query; },
      then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        const name = getTableName(table);
        if (condition) predicates.push(dialect.sqlToQuery(condition));
        if (lock) { locked.push(name); onLock?.(name); }
        // publishDue scope tests need only its two selection predicates, no jobs.
        const result = joined ? [] : (rows[name] ?? []).filter(row => matches(table, row, condition)).map(row => structuredClone(row));
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  }
  function update(table: any) {
    let patch: Record<string, any>, condition: SQL | undefined;
    const run = () => {
      if (conflictUpdate && table === deliveries) return [];
      const changed = (rows[getTableName(table)] ?? []).filter(row => matches(table, row, condition));
      for (const row of changed) Object.assign(row, patch);
      return changed.map(row => structuredClone(row));
    };
    const query: any = { set(value: Record<string, any>) { patch = value; return query; }, where(value: SQL) { condition = value; return query; }, returning() { return Promise.resolve(run()); }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(run()).then(resolve, reject); } };
    return query;
  }
  let serial = Promise.resolve<unknown>(undefined);
  const db = { select, update, insert: (table: any) => ({ values: (value: unknown) => {
    const apply = () => { rows[getTableName(table)].push(value as any); };
    return { then(resolve: (value: unknown) => unknown) { apply(); return Promise.resolve(undefined).then(resolve); }, onConflictDoUpdate() { apply(); return Promise.resolve(); } };
  } }),
    transaction: vi.fn((callback: (tx: DB) => Promise<unknown>) => { const result = serial.then(() => callback(db as unknown as DB)); serial = result.catch(() => undefined); return result; }),
  };
  return { db: db as unknown as DB, item, approval, delivery, rows, predicates, locked,
    beforeLock(callback: typeof onLock) { onLock = callback; }, loseUpdate() { conflictUpdate = true; } };
}
afterEach(() => vi.unstubAllEnvs());

describe("atomic cancellation and retry controls", () => {
  it("cancels queued destinations and the approval together", async () => {
    const f = fixture("scheduled"); f.rows.deliveries.push({ ...f.delivery, id: 45 });
    expect(await cancelApproval(f.db, 21, "qa")).toMatchObject({ ok: true, cancelled: 2, approvalCancelled: true, alreadyProcessing: 0 });
    expect(f.rows.deliveries.every(d => d.status === "cancelled")).toBe(true);
    expect(f.approval.status).toBe("cancelled"); expect(f.item.publishStatus).toBe("cancelled");
    expect(f.locked).toEqual(["content_items", "deliveries", "approvals"]);
  });
  it.each(["processing", "succeeded", "unknown"])("does not report a %s delivery as cancelled", async status => {
    const f = fixture(status);
    expect(await cancelApproval(f.db, 21, "qa")).toMatchObject({ ok: false });
    expect(f.delivery.status).toBe(status); expect(f.approval.status).toBe("active"); expect(f.rows.audit_logs).toHaveLength(0);
  });
  it.each(["processing", "succeeded", "unknown"])("cancels only queued destinations beside a %s delivery", async status => {
    const f = fixture(status); f.rows.deliveries.push({ ...f.delivery, id: 45, status: "scheduled" });
    const result = await cancelApproval(f.db, 21, "qa");
    expect(result).toMatchObject({ ok: true, cancelled: 1, approvalCancelled: false, alreadyProcessing: 1, message: expect.stringContaining("취소되지 않았") });
    expect(f.delivery.status).toBe(status); expect(f.rows.deliveries[1].status).toBe("cancelled"); expect(f.approval.status).toBe("active");
  });
  it("re-reads the worker's claim before reporting cancellation", async () => {
    const f = fixture("scheduled");
    f.beforeLock(table => { if (table === "deliveries") f.delivery.status = "processing"; });
    expect(await cancelApproval(f.db, 21, "qa")).toMatchObject({ ok: false });
    expect(f.approval.status).toBe("active"); expect(f.delivery.status).toBe("processing");
  });
  it("queues a failed destination once when two retry requests arrive together", async () => {
    const f = fixture();
    const results = await Promise.all([retryDelivery(f.db, 44, "qa"), retryDelivery(f.db, 44, "qa")]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(f.delivery).toMatchObject({ status: "scheduled", lastError: null, completedAt: null, requestStartedAt: null, externalContainerId: "container", attempts: 2 });
    expect(f.rows.audit_logs).toHaveLength(1);
  });
  it("requires explicit not-posted confirmation for an unknown result", async () => {
    const f = fixture("unknown");
    expect(await retryDelivery(f.db, 44, "qa")).toMatchObject({ ok: false });
    expect(f.delivery.status).toBe("unknown");
    expect(await retryDelivery(f.db, 44, "qa", true)).toMatchObject({ ok: true, deliveryId: 44, approvalId: 21 });
    expect(f.delivery.externalContainerId).toBeNull();
  });
  it.each(["ERROR", "EXPIRED"])("discards a historical %s container when retrying a definite failure", async state => {
    const f = fixture("failed"); f.delivery.lastError = `컨테이너 상태 ${state} provider detail`; f.delivery.errorKind = "terminal";
    expect(await retryDelivery(f.db, 44, "qa")).toMatchObject({ ok: true, deliveryId: 44 });
    expect(f.delivery.externalContainerId).toBeNull();
  });
  it.each(["컨테이너 상태 UNKNOWN", "권한 확인 실패", "게시 요청 오류"])("preserves the existing container after %s instead of risking another post", async error => {
    const f = fixture("failed"); f.delivery.lastError = error;
    expect(await retryDelivery(f.db, 44, "qa")).toMatchObject({ ok: true });
    expect(f.delivery.externalContainerId).toBe("container");
  });
  it.each(["scheduled", "processing", "succeeded", "cancelled"])("never retries a %s row", async status => {
    const f = fixture(status);
    expect(await retryDelivery(f.db, 44, "qa", true)).toMatchObject({ ok: false });
    expect(f.delivery.status).toBe(status); expect(f.rows.audit_logs).toHaveLength(0);
  });
  it("rejects stale revisions, inactive approvals and recorded remote posts", async () => {
    const f = fixture(); f.item.currentRevisionId = 8;
    expect((await retryDelivery(f.db, 44, "qa")).ok).toBe(false);
    f.item.currentRevisionId = 7; f.approval.status = "cancelled";
    expect((await retryDelivery(f.db, 44, "qa")).ok).toBe(false);
    f.approval.status = "active"; f.delivery.externalId = "already-posted";
    expect((await retryDelivery(f.db, 44, "qa")).ok).toBe(false);
    expect(f.rows.audit_logs).toHaveLength(0);
  });
  it("reports a compare-and-update conflict without claiming a queued retry", async () => {
    const f = fixture(); f.loseUpdate();
    expect(await retryDelivery(f.db, 44, "qa")).toMatchObject({ ok: false });
    expect(f.delivery.status).toBe("failed"); expect(f.rows.audit_logs).toHaveLength(0);
  });
});

describe("targeted publication wake selection", () => {
  it.each([{ approvalId: 21 }, { deliveryId: 44 }])("scopes both new work and resumable work to %j", async target => {
    const f = fixture("failed");
    vi.stubEnv("DRY_RUN", "true"); vi.stubEnv("AUTO_PUBLISH", "false");
    await publishDue(f.db, target);
    expect(f.predicates).toHaveLength(2);
    for (const query of f.predicates) {
      expect(query.sql).toContain("approvalId" in target ? '"deliveries"."approval_id" =' : '"deliveries"."id" =');
      expect(query.params).toContain("approvalId" in target ? target.approvalId : target.deliveryId);
    }
  });
});
