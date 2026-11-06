import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { approvals, channels, contentItems, contentRevisions, deliveries, destinations, mediaAssets } from "../shared/schema";

setTestEnv();
const mocks = vi.hoisted(() => ({ identity: vi.fn(), quota: vi.fn(), create: vi.fn(), wait: vi.fn(), publish: vi.fn(), upload: vi.fn() }));
vi.mock("../server/services/instagram", () => ({ accountIdentity: mocks.identity, publishingLimit: mocks.quota, createContainer: mocks.create, createCarouselContainer: mocks.create, waitForContainer: mocks.wait, publishContainer: mocks.publish, mediaPermalink: async () => "https://www.instagram.com/p/isolated-daily-cap-test/" }));
vi.mock("../server/services/cloudinary", () => ({ uploadCard: mocks.upload }));
const { publicationFixture, publicationAccounts } = await import("./fixtures/publication");
const { publishDue, approveItem } = await import("../server/worker/publish");
const { closeDb } = await import("../server/db");
type Fixture = Awaited<ReturnType<typeof publicationFixture>>;

// Root/CI run this suite against isolated PostgreSQL; every provider is mocked.
beforeAll(resetDb);
afterAll(closeDb);
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({ AUTO_PUBLISH: "true", DRY_RUN: "false", INLINE_WORKER: "false", INSTAGRAM_API_VERSION: "v26.0", CLOUDINARY_CLOUD_NAME: "fixture", CLOUDINARY_API_KEY: "fixture", CLOUDINARY_API_SECRET: "fixture" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real provider call is allowed in daily-cap regression tests"); }));
  mocks.identity.mockImplementation(async (token: string) => ({ ok: true, ...publicationAccounts.get(token)! }));
  mocks.quota.mockResolvedValue({ ok: true, used: 0, total: 100 });
  mocks.create.mockResolvedValue({ ok: true, containerId: "isolated-container" });
  mocks.wait.mockResolvedValue({ state: "FINISHED" });
  mocks.publish.mockResolvedValue({ ok: true, mediaId: "isolated-post" });
  mocks.upload.mockResolvedValue({ url: "https://example.com/isolated.jpg", publicId: "isolated" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function legacyChannel(f: Fixture, dailyPublishLimit: number) {
  await f.db.update(channels).set({ budget: { ...f.channel.budget, dailyPublishLimit } }).where(eq(channels.id, f.channel.id));
}
async function priorSuccesses(f: Fixture) {
  for (let n = 0; n < 3; n++) {
    const [item] = await f.db.insert(contentItems).values({ channelId: f.channel.id, kind: "current_dialogue", origin: "manual", title: `이전 게시 ${n}`, reviewStatus: "reviewed", publishStatus: "succeeded" }).returning();
    const [revision] = await f.db.insert(contentRevisions).values({ contentItemId: item.id, revisionNo: 1, author: "operator", payload: {} }).returning();
    await f.db.update(contentItems).set({ currentRevisionId: revision.id }).where(eq(contentItems.id, item.id));
    const [asset] = await f.db.insert(mediaAssets).values({ channelId: f.channel.id, contentItemId: item.id, revisionId: revision.id, sha256: `different-prior-${item.id}`, bytes: Buffer.from(`previous-${item.id}`), width: 1080, height: 1350 }).returning();
    const [approval] = await f.db.insert(approvals).values({ channelId: f.channel.id, contentItemId: item.id, revisionId: revision.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions: { instagram: "이전 게시", telegram: "" }, scheduledAt: new Date(), approvedBy: "test", status: "completed" }).returning();
    await f.db.insert(deliveries).values({ channelId: f.channel.id, approvalId: approval.id, destinationId: f.destination.id, status: "succeeded", phase: "finished", requestStartedAt: new Date(), completedAt: new Date(), externalId: `prior-${n}`, outcomeSource: "provider_verified" });
  }
}

describe("PostgreSQL approved publishing without an application daily cap", () => {
  it.each([0, 3])("publishes an approved new asset despite legacy%s and three actual prior success rows", async legacyLimit => {
    const f = await publicationFixture(); await legacyChannel(f, legacyLimit); await priorSuccesses(f);
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 1 });
    expect(await f.read()).toMatchObject({ status: "succeeded", attempts: 1, outcomeSource: "provider_verified" });
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 0 });
    expect(mocks.publish).toHaveBeenCalledOnce();
    await expect(approveItem(f.db, { itemId: f.item.id, revisionId: f.revision.id, mediaAssetId: f.asset.id, destinationIds: [f.destination.id], captions: { instagram: "다시 보내기", telegram: "" }, scheduledAt: new Date(), actor: "test" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
  it("still rejects a destination disabled after approval with legacy zero", async () => {
    const f = await publicationFixture(); await legacyChannel(f, 0);
    await f.db.update(destinations).set({ enabled: false, version: f.destination.version + 1 }).where(eq(destinations.id, f.destination.id));
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ skipped: 1, succeeded: 0 });
    expect(await f.read()).toMatchObject({ status: "cancelled", errorKind: "approval_required" });
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps an external Instagram quota refusal instead of dispatching despite legacy zero", async () => {
    const f = await publicationFixture(); await legacyChannel(f, 0);
    mocks.create.mockResolvedValue({ ok: false, err: { kind: "quota", error: "Instagram provider quota reached" } });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ failed: 1, succeeded: 0 });
    expect(await f.read()).toMatchObject({ status: "failed", lastError: expect.stringContaining("provider quota") });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("still rejects another account and a stale manuscript before dispatch", async () => {
    const wrong = await publicationFixture(); await legacyChannel(wrong, 0);
    process.env[wrong.destination.secretRefs.userId] = "999999";
    expect(await publishDue(wrong.db, { deliveryId: wrong.delivery.id })).toMatchObject({ skipped: 1 });
    const stale = await publicationFixture(); await legacyChannel(stale, 0);
    const [next] = await stale.db.insert(contentRevisions).values({ contentItemId: stale.item.id, revisionNo: 2, author: "operator", payload: { title: "새 원고" } }).returning();
    await stale.db.update(contentItems).set({ currentRevisionId: next.id }).where(eq(contentItems.id, stale.item.id));
    expect(await publishDue(stale.db, { deliveryId: stale.delivery.id })).toMatchObject({ skipped: 1 });
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not retry an unknown outcome or a cancelled approval when legacy cap is zero", async () => {
    const unknown = await publicationFixture("unknown"); await legacyChannel(unknown, 0);
    await publishDue(unknown.db, { deliveryId: unknown.delivery.id });
    expect(await unknown.read()).toMatchObject({ status: "unknown", attempts: 0 });
    const cancelled = await publicationFixture(); await legacyChannel(cancelled, 0);
    await cancelled.db.update(approvals).set({ status: "cancelled" }).where(eq(approvals.id, cancelled.approval.id));
    await publishDue(cancelled.db, { deliveryId: cancelled.delivery.id });
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
