import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { approvals, contentItems, deliveries, destinations, mediaAssets } from "../shared/schema";
import { login, resetDb, setTestEnv } from "./helpers";
setTestEnv();
const { createApp } = await import("../server/app");
const { closeDb } = await import("../server/db");
const { publicationFixture } = await import("./fixtures/publication");
const { retryDelivery } = await import("../server/worker/publish");
const app = createApp();
let auth: Awaited<ReturnType<typeof login>>;
beforeAll(async () => { await resetDb(); auth = await login(app); });
afterAll(closeDb);
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("List organization must not call external providers"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const organize = (channel: number, id: number, version: number, state: string) => auth.agent.post(`/api/channels/${channel}/deliveries/organize`).set("x-csrf-token", auth.csrf).send({ state, records: [{ id, version }] });

describe("reversible publication list management in PostgreSQL", () => {
  it("archives, trashes and restores a published record while preserving its SNS evidence and original content", async () => {
    const f = await publicationFixture("succeeded");
    await f.patch({ externalId: "published-proof-1", externalUrl: "https://www.instagram.com/p/published-proof/", completedAt: new Date("2026-11-05T02:00:00Z") });
    const before = await f.read();
    let result = await organize(f.channel.id, f.delivery.id, 1, "archived");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.items[0]).toMatchObject({ listState: "archived", listVersion: 2, previousState: "active" });
    expect((await auth.agent.get("/api/deliveries").query({ channelId: f.channel.id, page: 1 })).body.total).toBe(0);
    const archived = await auth.agent.get("/api/deliveries").query({ channelId: f.channel.id, view: "archived", page: 1 });
    expect(archived.body).toMatchObject({ total: 1, items: [{ d: { id: f.delivery.id, status: "succeeded", externalId: before.externalId } }] });
    result = await organize(f.channel.id, f.delivery.id, 2, "trashed");
    expect(result.body.items[0]).toMatchObject({ listState: "trashed", listVersion: 3, previousState: "archived" });
    expect((await auth.agent.get("/api/deliveries").query({ channelId: f.channel.id, view: "trashed", page: 1 })).body.total).toBe(1);
    expect((await organize(f.channel.id, f.delivery.id, 3, "active")).status).toBe(200);
    const after = await f.read();
    const { listState: _s, listVersion: _v, listUpdatedAt: _u, ...publicationBefore } = before;
    const { listState, listVersion, listUpdatedAt, ...publicationAfter } = after;
    expect(publicationAfter).toEqual(publicationBefore);
    expect([listState, listVersion]).toEqual(["active", 4]); expect(listUpdatedAt).toBeInstanceOf(Date);
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].publishStatus).toBe("succeeded");
    expect((await f.db.select().from(approvals).where(eq(approvals.id, f.approval.id)))[0]).toEqual(f.approval);
    expect((await f.db.select().from(mediaAssets).where(eq(mediaAssets.id, f.asset.id)))[0].bytes).toEqual(f.asset.bytes);
  });

  it.each(["scheduled", "processing", "unknown", "waiting"])("keeps an unresolved %s attempt visible", async status => {
    const f = await publicationFixture(status);
    expect((await organize(f.channel.id, f.delivery.id, 1, "trashed")).status).toBe(409);
    expect((await f.read()).listState).toBe("active");
  });

  it("checks every row before an all-or-nothing batch and refuses late unresolved results", async () => {
    const f = await publicationFixture("succeeded");
    const [destination] = await f.db.insert(destinations).values({ channelId: f.channel.id, platform: "instagram", label: "second fixture target" }).returning();
    const [pending] = await f.db.insert(deliveries).values({ channelId: f.channel.id, approvalId: f.approval.id, destinationId: destination.id, status: "processing" }).returning();
    const result = await auth.agent.post(`/api/channels/${f.channel.id}/deliveries/organize`).set("x-csrf-token", auth.csrf).send({ state: "trashed", records: [{ id: f.delivery.id, version: 1 }, { id: pending.id, version: 1 }] });
    expect(result.status).toBe(409); expect((await f.read()).listState).toBe("active");
    await f.patch({ needsReconciliation: true });
    expect((await organize(f.channel.id, f.delivery.id, 1, "archived")).status).toBe(409);
  });

  it("rejects stale versions, missing CSRF and rows from another channel without deleting anything", async () => {
    const f = await publicationFixture("succeeded"), other = await publicationFixture("succeeded");
    expect((await organize(f.channel.id, f.delivery.id, 1, "archived")).status).toBe(200);
    expect((await organize(f.channel.id, f.delivery.id, 1, "trashed")).status).toBe(409);
    expect((await organize(other.channel.id, f.delivery.id, 2, "trashed")).status).toBe(404);
    expect((await auth.agent.post(`/api/channels/${f.channel.id}/deliveries/organize`).send({ state: "trashed", records: [{ id: f.delivery.id, version: 2 }] })).status).toBe(403);
    expect((await request(app).post(`/api/channels/${f.channel.id}/deliveries/organize`).send({ state: "trashed", records: [{ id: f.delivery.id, version: 2 }] })).status).toBe(401);
    expect(await f.read()).toMatchObject({ listState: "archived", listVersion: 2, status: "succeeded" });
  });

  it("surfaces late reconciliation evidence even after a record was archived", async () => {
    const f = await publicationFixture("failed");
    await organize(f.channel.id, f.delivery.id, 1, "archived");
    await f.patch({ needsReconciliation: true });
    expect((await auth.agent.get("/api/deliveries").query({ channelId: f.channel.id, page: 1 })).body.items[0].d.id).toBe(f.delivery.id);
    expect((await auth.agent.get("/api/deliveries").query({ channelId: f.channel.id, page: 1, view: "archived" })).body.total).toBe(0);
  });

  it("returns an explicitly retried archived failure to the active list", async () => {
    const f = await publicationFixture("failed");
    await organize(f.channel.id, f.delivery.id, 1, "archived");
    expect(await retryDelivery(f.db, f.delivery.id, "test")).toMatchObject({ ok: true });
    expect(await f.read()).toMatchObject({ status: "scheduled", listState: "active", listVersion: 3 });
  });
});
