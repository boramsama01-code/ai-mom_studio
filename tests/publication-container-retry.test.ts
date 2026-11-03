import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DB } from "../server/db";
import { setTestEnv } from "./helpers";

const mocks = vi.hoisted(() => ({ wait: vi.fn(), create: vi.fn(), publish: vi.fn(), upload: vi.fn(), pages: vi.fn() }));
setTestEnv();
vi.mock("../server/seed", () => ({ getSetting: async () => false }));
vi.mock("../server/services/secrets", () => ({ resolveSecrets: () => ({ invalid: [], missing: [], values: { accessToken: "test-only", userId: "test-user", authMode: "instagram" } }) }));
vi.mock("../server/services/instagram", () => ({ waitForContainer: mocks.wait, createContainer: mocks.create, createCarouselContainer: mocks.create, publishContainer: mocks.publish, mediaPermalink: async () => "https://example.com/test-post" }));
vi.mock("../server/services/cloudinary", () => ({ uploadCard: mocks.upload }));
vi.mock("../server/services/cardCarousel", () => ({ loadCardPages: mocks.pages, cardApprovalHash: () => "fixture-hash" }));
const { publishDue, retryDelivery } = await import("../server/worker/publish");

/** One in-memory approval; every storage/network boundary is controlled here. */
function fixture() {
  const stamp = new Date("2026-11-03T10:00:00Z");
  const item = { id: 1, channelId: 3, kind: "current_dialogue", currentRevisionId: 7, reviewStatus: "reviewed", relevance: "relevant", excluded: false, publishStatus: "scheduled" };
  const approval = { id: 21, contentItemId: 1, revisionId: 7, mediaAssetId: 60, channelId: 3, status: "active", scheduledAt: stamp, cardSha256: "fixture-hash", captions: { instagram: "승인한 캡션", telegram: "" } };
  const delivery = { id: 44, approvalId: 21, channelId: 3, destinationId: 90, status: "scheduled", updatedAt: stamp, externalId: null as string | null, externalUrl: null, externalContainerId: "old-container" as string | null, attempts: 1, lastError: null, errorKind: null };
  const asset = { id: 60, channelId: 3, bytes: Buffer.from("test-image"), cloudinaryUrl: "https://example.com/saved-image.jpg" };
  const rows: Record<string, Array<Record<string, any>>> = {
    content_items: [item], approvals: [approval], deliveries: [delivery], media_assets: [asset],
    channels: [{ id: 3, slug: "test-fixture", active: true, budget: { dailyPublishLimit: 100 } }],
    destinations: [{ id: 90, channelId: 3, enabled: true, platform: "instagram", secretRefs: {} }],
    content_revisions: [{ id: 7, payload: {} }], studio_cards: [], audit_logs: [],
  };
  const dialect = new PgDialect();
  function matches(table: any, row: Record<string, any>, condition?: SQL) {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition), columns = getTableColumns(table);
    const same = (value: unknown) => value instanceof Date ? value.toISOString() : value;
    if (!row.externalContainerId && query.sql.includes('"external_container_id" is not null')) return false;
    if (query.sql.includes("interval '2 minutes'") && new Date(row.updatedAt).getTime() >= Date.now() - 120_000) return false;
    return [...query.sql.matchAll(/"[^\"]+"\."([^\"]+)" = \$(\d+)/g)].every(match => {
      const key = Object.keys(columns).find(key => columns[key].name === match[1]);
      return !key || same(row[key]) === same(query.params[Number(match[2]) - 1]);
    });
  }
  const select = () => {
    let table: any, condition: SQL | undefined, joined = false;
    const query: any = {
      from(value: any) { table = value; return query; }, where(value: SQL) { condition = value; return query; },
      innerJoin() { joined = true; return query; }, orderBy() { return query; }, limit() { return query; }, for() { return query; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        const result = joined
          ? delivery.status === "scheduled" && approval.status === "active" ? [{ d: structuredClone(delivery), ap: structuredClone(approval) }] : []
          : (rows[getTableName(table)] ?? []).filter(row => matches(table, row, condition)).map(row => structuredClone(row));
        return Promise.resolve(result).then(resolve, reject);
      },
    }; return query;
  };
  const update = (table: any) => {
    let patch: Record<string, any>, condition: SQL | undefined;
    const run = () => {
      const changed = (rows[getTableName(table)] ?? []).filter(row => matches(table, row, condition));
      for (const row of changed) for (const [key, value] of Object.entries(patch)) row[key] = key === "attempts" && typeof value !== "number" ? row.attempts + 1 : value;
      return changed.map(row => structuredClone(row));
    };
    const query: any = { set(value: Record<string, any>) { patch = value; return query; }, where(value: SQL) { condition = value; return query; }, returning() { return Promise.resolve(run()); }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(run()).then(resolve, reject); } };
    return query;
  };
  const db = { select, update, execute: async () => ({ rows: [{ c: 0 }] }),
    insert: (table: any) => ({ values: async (value: unknown) => { rows[getTableName(table)].push(value as any); } }),
    transaction: async (callback: (tx: DB) => Promise<unknown>) => callback(db as unknown as DB),
  };
  mocks.pages.mockImplementation(async () => [asset]);
  return { db: db as unknown as DB, item, approval, delivery, asset };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DRY_RUN", "false"); vi.stubEnv("AUTO_PUBLISH", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network request is allowed in this worker test"); }));
  mocks.wait.mockResolvedValue({ state: "FINISHED" });
  mocks.create.mockResolvedValue({ ok: true, containerId: "new-container" });
  mocks.publish.mockResolvedValue({ ok: true, mediaId: "new-media" });
  mocks.upload.mockResolvedValue({ url: "https://example.com/retried-upload.jpg", publicId: "fixture-image" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Instagram container retry recovery", () => {
  it.each(["ERROR", "EXPIRED"])("discards a %s container and publishes a fresh one after explicit retry", async state => {
    const f = fixture(); mocks.wait.mockResolvedValueOnce({ state, detail: "provider terminal state" });
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ failed: 1, succeeded: 0 });
    expect(f.delivery).toMatchObject({ status: "failed", externalContainerId: null, externalId: null });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    expect(await retryDelivery(f.db, 44, "test")).toMatchObject({ ok: true });
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ succeeded: 1 });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledWith("test-user", "test-only", "new-container", "instagram");
    expect(mocks.wait.mock.calls.map(([id]) => id)).toEqual(["old-container", "new-container"]);
    expect(f.delivery).toMatchObject({ status: "succeeded", externalId: "new-media" });
    expect(await retryDelivery(f.db, 44, "test", true)).toMatchObject({ ok: false });
  });

  it("keeps an unreadable container and checks it again before any new publish attempt", async () => {
    const f = fixture(); mocks.wait.mockResolvedValueOnce({ state: "UNKNOWN", err: { kind: "transient", error: "상태 조회 시간 초과" } }).mockResolvedValueOnce({ state: "PUBLISHED" });
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ failed: 1 });
    expect(f.delivery.externalContainerId).toBe("old-container");
    expect(await retryDelivery(f.db, 44, "test")).toMatchObject({ ok: true });
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ unknown: 1 });
    expect(f.delivery).toMatchObject({ status: "unknown", externalContainerId: "old-container" });
    expect(await retryDelivery(f.db, 44, "test")).toMatchObject({ ok: false, code: "confirmation_required" });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("leaves a lost publish response unknown until the operator confirms it was not posted", async () => {
    const f = fixture(); mocks.publish.mockResolvedValueOnce({ ok: false, lost: true, err: { kind: "unknown", error: "timeout" } });
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ unknown: 1 });
    expect(await retryDelivery(f.db, 44, "test")).toMatchObject({ ok: false, code: "confirmation_required" });
    expect(f.delivery.externalContainerId).toBe("old-container");
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ processed: 0 });
    expect(mocks.publish).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
    expect(await retryDelivery(f.db, 44, "test", true)).toMatchObject({ ok: true });
    expect(f.delivery).toMatchObject({ status: "scheduled", externalContainerId: null });
  });

  it("retries a failed image upload and sends the approved image only once", async () => {
    const f = fixture(); f.delivery.externalContainerId = null; f.asset.cloudinaryUrl = "";
    mocks.upload.mockRejectedValueOnce(new Error("temporary upload failure"));
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ failed: 1 });
    expect(f.delivery).toMatchObject({ status: "failed", externalContainerId: null, lastError: expect.stringContaining("이미지 업로드 실패") });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    expect(await retryDelivery(f.db, 44, "test")).toMatchObject({ ok: true });
    expect(await publishDue(f.db, { deliveryId: 44 })).toMatchObject({ succeeded: 1 });
    expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.publish).toHaveBeenCalledOnce();
  });
});
