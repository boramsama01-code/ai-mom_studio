import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetDb, setTestEnv } from "./helpers";
import { approvals, contentItems, contentRevisions, deliveries, deliveryAttempts, deliveryAttemptEvents, destinations, mediaAssets } from "../shared/schema";
setTestEnv();
const mocks = vi.hoisted(() => ({ identity: vi.fn(), quota: vi.fn(), create: vi.fn(), wait: vi.fn(), publish: vi.fn(), status: vi.fn(), upload: vi.fn(), chat: vi.fn(), telegram: vi.fn() }));
vi.mock("../server/services/instagram", () => ({ accountIdentity: mocks.identity, publishingLimit: mocks.quota, createContainer: mocks.create, createCarouselContainer: mocks.create, waitForContainer: mocks.wait, publishContainer: mocks.publish, containerStatus: mocks.status, mediaPermalink: async () => "https://www.instagram.com/p/test-post/" }));
vi.mock("../server/services/cloudinary", () => ({ uploadCard: mocks.upload }));
vi.mock("../server/services/telegram", () => ({ telegramChatIdentity: mocks.chat, sendPhotoToChannel: mocks.telegram, sendAlbumToChannel: mocks.telegram, telegramPostUrl: (name: string, id: number) => `https://t.me/${name}/${id}` }));
const { publicationFixture, expiredPublicationAttempt, publicationAccounts } = await import("./fixtures/publication");
const { closeDb } = await import("../server/db");
const { approveItem, publishDue, retryDelivery, cancelApproval, reconcileDelivery, confirmDeliveryPosted, confirmDeliveryNotPosted } = await import("../server/worker/publish");
const { revokePublicationEligibility, recomputePublicationStatus, aggregatePublicationStatus } = await import("../server/services/publicationState");
const { claimPublicationDelivery, beginDeliveryDispatch, finishDeliveryAttempt, recoverPublicationAttempts } = await import("../server/services/publicationAttempts");
const { getPublisherHealth } = await import("../server/services/publicationHealth");

type Fixture = Awaited<ReturnType<typeof publicationFixture>>;
const account = (token: string) => ({ ok: true as const, ...publicationAccounts.get(token)! });
beforeAll(resetDb);
afterAll(closeDb);
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ AUTO_PUBLISH: "true", DRY_RUN: "false", INLINE_WORKER: "false", INSTAGRAM_API_VERSION: "v26.0", CLOUDINARY_CLOUD_NAME: "fixture", CLOUDINARY_API_KEY: "fixture", CLOUDINARY_API_SECRET: "fixture", TELEGRAM_BOT_TOKEN: "test-only-bot-token" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("All publication providers must be mocked"); }));
  mocks.identity.mockImplementation(async (token: string) => account(token));
  mocks.quota.mockResolvedValue({ ok: true, used: 0, total: 100 });
  mocks.create.mockResolvedValue({ ok: true, containerId: "800001" });
  mocks.wait.mockResolvedValue({ state: "FINISHED" });
  mocks.publish.mockResolvedValue({ ok: true, mediaId: "900001" });
  mocks.status.mockResolvedValue({ ok: true, statusCode: "PUBLISHED", status: "" });
  mocks.upload.mockResolvedValue({ url: "https://example.com/test.jpg", publicId: "fixture" });
  mocks.chat.mockResolvedValue({ ok: true, chatId: "-100999", username: "verified_channel" });
  mocks.telegram.mockResolvedValue({ ok: true, messageId: 701, chatUsername: "fixture_channel" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function input(f: Fixture, extra: Record<string, unknown> = {}) {
  return { itemId: f.item.id, revisionId: f.revision.id, mediaAssetId: f.asset.id, destinationIds: [f.destination.id], captions: { instagram: "승인된 게시 캡션", telegram: "승인된 게시 캡션" }, scheduledAt: new Date(), actor: "test", ...extra };
}
async function nextRevision(f: Fixture) {
  return f.db.transaction(async tx => {
    await tx.select().from(contentItems).where(eq(contentItems.id, f.item.id)).for("update");
    const [revision] = await tx.insert(contentRevisions).values({ contentItemId: f.item.id, revisionNo: 2, author: "operator", payload: { title: "수정한 원고", summary: "수정한 본문" } }).returning();
    await tx.update(contentItems).set({ currentRevisionId: revision.id, reviewStatus: "reviewed", publishStatus: "waiting" }).where(eq(contentItems.id, f.item.id));
    await revokePublicationEligibility(tx as never, f.item.id, "새 원고 저장", "test");
    const [asset] = await tx.insert(mediaAssets).values({ channelId: f.channel.id, contentItemId: f.item.id, revisionId: revision.id, bytes: f.asset.bytes, sha256: f.asset.sha256, width: 1080, height: 1350 }).returning();
    return { revision, asset };
  });
}

// npm test runs this file against the CI PostgreSQL 16 service. We exercise
// production transactions/leases with separate pooled connections; network APIs
// are mocks. Expired rows model crash/redeploy persistence, not a real OS kill.
describe("PostgreSQL publication safety and recovery", () => {
  it.each([{ excluded: true }, { relevance: "irrelevant" }, { reviewStatus: "held" }, { reviewStatus: "rejected" }, { reviewStatus: "review_required" }])("blocks revoked eligibility even if a legacy mutation left its approval active: %j", async patch => {
    const f = await publicationFixture();
    await f.db.update(contentItems).set(patch).where(eq(contentItems.id, f.item.id));
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 0, skipped: 1 });
    expect(await f.read()).toMatchObject({ status: "cancelled", errorKind: "approval_required" });
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it("revocation during read-only preparation commits without waiting for the network and fences dispatch", async () => {
    const f = await publicationFixture();
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.identity.mockImplementationOnce(async (token: string) => { entered(); await blocked; return account(token); });
    const work = publishDue(f.db, { deliveryId: f.delivery.id });
    await started;
    await f.db.transaction(async tx => {
      await tx.update(contentItems).set({ reviewStatus: "held" }).where(eq(contentItems.id, f.item.id));
      await revokePublicationEligibility(tx as never, f.item.id, "운영자 검토 보류", "test");
    });
    release(); await work;
    expect(await f.read()).toMatchObject({ status: "cancelled" });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect((await f.db.select().from(approvals).where(eq(approvals.id, f.approval.id)))[0].status).toBe("invalidated");
  });

  it("serializes the production claim against cancellation", async () => {
    const f = await publicationFixture();
    const [cancelled, claimed] = await Promise.all([cancelApproval(f.db, f.approval.id, "test"), claimPublicationDelivery(f.db, f.delivery.id, "second-worker", new Date())]);
    const final = await f.read();
    if (cancelled.ok) { expect(claimed).toBeNull(); expect(final.status).toBe("cancelled"); }
    else { expect(claimed?.id).toBe(f.delivery.id); expect(final.status).toBe("processing"); }
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("allows one retry and one external publish under duplicate HTTP requests and two workers", async () => {
    const f = await publicationFixture("failed");
    const retries = await Promise.all([retryDelivery(f.db, f.delivery.id, "one"), retryDelivery(f.db, f.delivery.id, "two")]);
    expect(retries.filter(result => result.ok)).toHaveLength(1);
    const results = await Promise.all([publishDue(f.db, { deliveryId: f.delivery.id, actor: "one" }), publishDue(f.db, { deliveryId: f.delivery.id, actor: "two" })]);
    expect(results.reduce((total, result) => total + result.succeeded, 0)).toBe(1);
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(await f.read()).toMatchObject({ status: "succeeded", attempts: 1, externalId: "900001", outcomeSource: "provider_verified" });
    expect(await f.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.deliveryId, f.delivery.id))).toHaveLength(1);
    expect((await retryDelivery(f.db, f.delivery.id, "three", true)).ok).toBe(false);
  });

  it("returns the same approval for concurrent request-ID replays and rejects changed intent", async () => {
    const f = await publicationFixture("cancelled"), requestId = randomUUID();
    const a = { ...input(f), requestId, timing: "now" as const };
    const results = await Promise.all([approveItem(f.db, a), approveItem(f.db, { ...a, scheduledAt: new Date(Date.now() + 2000) })]);
    expect(results.every(result => result.ok)).toBe(true);
    const ids = results.map(result => result.ok ? result.approval.id : -1);
    expect(ids[0]).toBe(ids[1]);
    expect(await f.db.select().from(approvals).where(eq(approvals.requestId, requestId))).toHaveLength(1);
    expect(await f.db.select().from(deliveries).where(eq(deliveries.approvalId, ids[0]))).toHaveLength(1);
    await expect(approveItem(f.db, { ...a, captions: { ...a.captions, instagram: "다른 문구" } })).rejects.toMatchObject({ status: 409 });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("blocks a new revision while an older outcome is unknown, then allows explicit old-result resolution", async () => {
    const f = await publicationFixture("unknown"), newer = await nextRevision(f);
    const a = { ...input(f), revisionId: newer.revision.id, mediaAssetId: newer.asset.id };
    await expect(approveItem(f.db, a)).rejects.toMatchObject({ status: 409 });
    expect(await f.db.select().from(approvals).where(eq(approvals.revisionId, newer.revision.id))).toHaveLength(0);
    expect(await confirmDeliveryNotPosted(f.db, f.delivery.id, "test", "이전 버전이 계정에 없는 것을 확인")).toMatchObject({ ok: true, retryAllowed: false });
    expect(await f.read()).toMatchObject({ status: "cancelled", outcomeSource: "operator_not_posted" });
    expect(await approveItem(f.db, a)).toMatchObject({ ok: true });
  });

  it.each([null, "old-container"])("moves a legacy phase-less processing row with container %s to unknown without resending", async externalContainerId => {
    const f = await publicationFixture("processing");
    await f.patch({ phase: null, lastAttemptId: null, externalContainerId, updatedAt: new Date(Date.now() - 24 * 3600000) });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ unknown: 1, succeeded: 0 });
    expect(await f.read()).toMatchObject({ status: "unknown", externalContainerId });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ processed: 0 });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each(["preparing", "container_wait"])("resumes an expired provably pre-dispatch %s attempt from persistent rows", async phase => {
    const f = await publicationFixture();
    await expiredPublicationAttempt(f, phase, phase === "container_wait" ? { externalContainerId: "saved-container" } : {});
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 1 });
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(phase === "container_wait" ? 0 : 1);
    expect((await f.read()).attempts).toBe(1);
    expect(await f.db.select().from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, f.delivery.id), eq(deliveryAttemptEvents.event, "lease_recovered")))).toHaveLength(1);
  });

  it("never automatically resumes an expired dispatch even when it has a known container", async () => {
    const f = await publicationFixture(); await expiredPublicationAttempt(f, "dispatching", { externalContainerId: "saved-container" });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ unknown: 1 });
    expect(await f.read()).toMatchObject({ status: "unknown", externalContainerId: "saved-container" });
    expect(mocks.wait).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("does not steal a live lease because its updatedAt is old", async () => {
    const f = await publicationFixture(); await expiredPublicationAttempt(f, "preparing", { leaseExpiresAt: new Date(Date.now() + 60000), updatedAt: new Date(0) });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ processed: 0 });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("keeps an old external success without changing the new draft or reactivating its revoked approval", async () => {
    const f = await publicationFixture(), claimed = await claimPublicationDelivery(f.db, f.delivery.id, "old-worker", new Date());
    expect(claimed).not.toBeNull(); expect(await beginDeliveryDispatch(f.db, claimed!)).toMatchObject({ ok: true });
    const newer = await nextRevision(f);
    await finishDeliveryAttempt(f.db, claimed!, { status: "succeeded", externalId: "900099" });
    expect(await f.read()).toMatchObject({ status: "succeeded", externalId: "900099" });
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0]).toMatchObject({ currentRevisionId: newer.revision.id, publishStatus: "waiting" });
    expect((await f.db.select().from(approvals).where(eq(approvals.id, f.approval.id)))[0].status).toBe("invalidated");
  });

  it("preserves late success after a retry was prepared and blocks that newer dispatch until reconciliation", async () => {
    const f = await publicationFixture(), old = await expiredPublicationAttempt(f, "dispatching", { externalContainerId: "old-container" });
    await recoverPublicationAttempts(f.db, { claimSafe: false, actor: "recovery" });
    expect(await confirmDeliveryNotPosted(f.db, f.delivery.id, "operator")).toMatchObject({ ok: true, retryAllowed: true });
    expect(await retryDelivery(f.db, f.delivery.id, "operator")).toMatchObject({ ok: true });
    const next = await claimPublicationDelivery(f.db, f.delivery.id, "new-worker", new Date());
    await finishDeliveryAttempt(f.db, old, { status: "succeeded", externalId: "900088" });
    expect(await f.read()).toMatchObject({ lastAttemptId: next!.lastAttemptId, status: "processing", needsReconciliation: true, externalId: null });
    expect(await beginDeliveryDispatch(f.db, next!)).toMatchObject({ ok: false, uncertain: true });
    await finishDeliveryAttempt(f.db, next!, { status: "unknown", errorKind: "unknown", lastError: "이전 결과 대조 필요" });
    expect(await confirmDeliveryNotPosted(f.db, f.delivery.id, "operator")).toMatchObject({ ok: false });
    expect(await reconcileDelivery(f.db, f.delivery.id, "operator")).toMatchObject({ ok: true, resolved: true });
    expect(await f.read()).toMatchObject({ status: "succeeded", externalId: "900088", outcomeSource: "provider_verified", needsReconciliation: false });
    const late = await f.db.select().from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, f.delivery.id), eq(deliveryAttemptEvents.event, "late_result")));
    expect(late).toEqual(expect.arrayContaining([expect.objectContaining({ attemptId: old.lastAttemptId, externalId: "900088", source: "provider" })]));
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("recomputes success plus cancelled or pending destinations as partial without inventing an active send", async () => {
    const f = await publicationFixture("succeeded"); await f.patch({ externalId: "900001" });
    const [destination] = await f.db.insert(destinations).values({ channelId: f.channel.id, platform: "telegram_channel", label: "second", enabled: true }).returning();
    await f.db.insert(deliveries).values({ channelId: f.channel.id, approvalId: f.approval.id, destinationId: destination.id, status: "scheduled", phase: "queued" });
    await f.db.transaction(async tx => { await tx.select().from(contentItems).where(eq(contentItems.id, f.item.id)).for("update"); await recomputePublicationStatus(tx as never, f.approval.id); });
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].publishStatus).toBe("partial");
    expect(await cancelApproval(f.db, f.approval.id, "test")).toMatchObject({ ok: true, cancelled: 1, approvalCancelled: false });
    expect((await f.db.select().from(contentItems).where(eq(contentItems.id, f.item.id)))[0].publishStatus).toBe("partial");
    expect(aggregatePublicationStatus([{ status: "cancelled" }])).toBe("cancelled");
    expect(aggregatePublicationStatus([{ status: "dry_run" }])).toBe("dry_run");
  });

  it("does not let a newer successful response hide a late success from an older dispatched attempt", async () => {
    const f = await publicationFixture(), old = await expiredPublicationAttempt(f, "dispatching");
    await recoverPublicationAttempts(f.db, { claimSafe: false, actor: "recovery" });
    await confirmDeliveryNotPosted(f.db, f.delivery.id, "operator");
    await retryDelivery(f.db, f.delivery.id, "operator");
    const next = await claimPublicationDelivery(f.db, f.delivery.id, "new-worker", new Date());
    expect(await beginDeliveryDispatch(f.db, next!)).toMatchObject({ ok: true });
    await finishDeliveryAttempt(f.db, old, { status: "succeeded", externalId: "900087" });
    await finishDeliveryAttempt(f.db, next!, { status: "succeeded", externalId: "900089" });
    expect(await f.read()).toMatchObject({ status: "unknown", needsReconciliation: true, externalId: "900089" });
    expect(await reconcileDelivery(f.db, f.delivery.id, "operator")).toMatchObject({ ok: true, resolved: false });
    expect(await confirmDeliveryPosted(f.db, f.delivery.id, "operator", { externalUrl: "https://www.instagram.com/p/checked/", note: "" })).toMatchObject({ ok: false });
    expect(await confirmDeliveryPosted(f.db, f.delivery.id, "operator", { externalUrl: "https://www.instagram.com/p/checked/", note: "실제 계정에서 두 게시물과 중복 여부를 모두 확인하고 유지할 게시물을 기록함" })).toMatchObject({ ok: true });
    expect((await f.db.select().from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, f.delivery.id), eq(deliveryAttemptEvents.source, "provider"), eq(deliveryAttemptEvents.status, "succeeded")))).map(row => row.externalId).sort()).toEqual(["900087", "900089"]);
  });

  it("rejects an account switch after approval and allows token rotation for the same identity", async () => {
    const wrong = await publicationFixture(); process.env[wrong.destination.secretRefs.userId] = "777777";
    expect(await publishDue(wrong.db, { deliveryId: wrong.delivery.id })).toMatchObject({ skipped: 1 });
    expect(await wrong.read()).toMatchObject({ status: "cancelled", errorKind: "approval_required" });
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
    const same = await publicationFixture(); const replacement = `rotated-test-token-${same.channel.id}`;
    process.env[same.destination.secretRefs.accessToken] = replacement; publicationAccounts.set(replacement, { userId: same.userId, username: same.username });
    expect(await publishDue(same.db, { deliveryId: same.delivery.id })).toMatchObject({ succeeded: 1 });
    expect(mocks.publish).toHaveBeenCalledWith(same.userId, replacement, "800001", "instagram");
  });

  it("posts to the approved numeric Telegram channel and cancels a changed configured address", async () => {
    const f = await publicationFixture("scheduled", "telegram_channel");
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 1 });
    expect(mocks.telegram).toHaveBeenCalledWith(f.delivery.destinationSnapshot!.accountId, expect.any(Buffer), "승인된 게시 캡션");
    const changed = await publicationFixture("scheduled", "telegram_channel");
    process.env[changed.destination.secretRefs.chatId] = "@another_channel";
    expect(await publishDue(changed.db, { deliveryId: changed.delivery.id })).toMatchObject({ skipped: 1 });
    expect(mocks.telegram).toHaveBeenCalledOnce();
  });

  it("requires reapproval for a legacy scheduled row without an identity snapshot", async () => {
    const f = await publicationFixture(); await f.patch({ destinationSnapshot: null });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ skipped: 1 });
    expect(await f.read()).toMatchObject({ status: "cancelled", errorKind: "approval_required", destinationSnapshot: null });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("keeps PUBLISHED without an ID unknown, and distinguishes operator-confirmed posts from provider proof", async () => {
    const f = await publicationFixture("unknown"); await f.patch({ externalContainerId: "800001" });
    expect(await reconcileDelivery(f.db, f.delivery.id, "operator")).toMatchObject({ ok: true, resolved: false, message: expect.stringContaining("게시됐다고") });
    expect((await f.read()).status).toBe("unknown");
    expect(await confirmDeliveryPosted(f.db, f.delivery.id, "operator", { externalUrl: "https://evil.example/anything", note: "확인" })).toMatchObject({ ok: false });
    expect(await confirmDeliveryPosted(f.db, f.delivery.id, "operator", { externalUrl: "https://www.instagram.com/p/checked/", note: "계정에서 같은 카드와 문구를 확인함" })).toMatchObject({ ok: true, outcomeSource: "operator_confirmed" });
    expect(await f.read()).toMatchObject({ status: "succeeded", outcomeSource: "operator_confirmed", externalId: null, externalUrl: "https://www.instagram.com/p/checked/" });
    expect((await retryDelivery(f.db, f.delivery.id, "operator", true)).ok).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it("checks the publication draft CAS inside the approval transaction", async () => {
    const f = await publicationFixture("cancelled"), captions = { instagram: "저장한 최신 캡션", telegram: "텔레그램 캡션" };
    await f.db.update(contentItems).set({ publicationDraft: { version: 2, captions } }).where(eq(contentItems.id, f.item.id));
    await expect(approveItem(f.db, { ...input(f), publicationDraftVersion: 1, captions })).rejects.toMatchObject({ status: 409 });
    await expect(approveItem(f.db, { ...input(f), publicationDraftVersion: 2 })).rejects.toMatchObject({ status: 409 });
    expect(await approveItem(f.db, { ...input(f), publicationDraftVersion: 2, captions })).toMatchObject({ ok: true, approval: { captions } });
  });

  it("enforces append-only attempt evidence in PostgreSQL and records actual publisher health", async () => {
    const f = await publicationFixture();
    expect(await publishDue(f.db, { deliveryId: f.delivery.id, actor: "web-publisher" })).toMatchObject({ succeeded: 1 });
    const [event] = await f.db.select().from(deliveryAttemptEvents).where(eq(deliveryAttemptEvents.deliveryId, f.delivery.id));
    await expect(f.db.update(deliveryAttemptEvents).set({ note: "overwritten" }).where(eq(deliveryAttemptEvents.id, event.id))).rejects.toThrow();
    expect((await f.db.select().from(deliveryAttemptEvents).where(eq(deliveryAttemptEvents.id, event.id)))[0].note).toBe(event.note);
    await expect(f.db.delete(deliveryAttempts).where(eq(deliveryAttempts.deliveryId, f.delivery.id))).rejects.toThrow();
    expect(await getPublisherHealth(f.db)).toMatchObject({ connected: true, mode: "inline", lastSweepAt: expect.any(String) });
    expect(await getPublisherHealth(f.db, new Date(Date.now() + 100000))).toMatchObject({ connected: false, status: "stale" });
  });
});
