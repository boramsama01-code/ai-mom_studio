import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { deliveries, mediaAssets } from "../shared/schema";
import { resetDb, setTestEnv } from "./helpers";
setTestEnv();
const mocks = vi.hoisted(() => ({ wait: vi.fn(), create: vi.fn(), publish: vi.fn(), upload: vi.fn(), identity: vi.fn() }));
vi.mock("../server/services/instagram", () => ({ accountIdentity: mocks.identity, waitForContainer: mocks.wait, createContainer: mocks.create, createCarouselContainer: mocks.create, publishContainer: mocks.publish, mediaPermalink: async () => "https://www.instagram.com/p/fixture/" }));
vi.mock("../server/services/cloudinary", () => ({ uploadCard: mocks.upload }));
const { publishDue, retryDelivery } = await import("../server/worker/publish");
const { publicationFixture, publicationAccounts } = await import("./fixtures/publication");
const { closeDb } = await import("../server/db");

// Actual PostgreSQL transactions/constraints; every social/image API is mocked.
beforeAll(resetDb);
afterAll(closeDb);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DRY_RUN", "false"); vi.stubEnv("AUTO_PUBLISH", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network request is allowed in this worker test"); }));
  mocks.identity.mockImplementation(async (token: string) => ({ ok: true, ...publicationAccounts.get(token) }));
  mocks.wait.mockResolvedValue({ state: "FINISHED" });
  mocks.create.mockResolvedValue({ ok: true, containerId: "new-container" });
  mocks.publish.mockResolvedValue({ ok: true, mediaId: "900001" });
  mocks.upload.mockResolvedValue({ url: "https://example.com/retried-upload.jpg", publicId: "fixture-image" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function fixture() { const f = await publicationFixture(); await f.patch({ externalContainerId: "old-container" }); return f; }

describe("PostgreSQL Instagram container retry recovery", () => {
  it.each(["ERROR", "EXPIRED"])("discards a %s container and publishes a fresh one after explicit retry", async state => {
    const f = await fixture(); mocks.wait.mockResolvedValueOnce({ state, detail: "provider terminal state" });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ failed: 1, succeeded: 0 });
    expect(await f.read()).toMatchObject({ status: "failed", externalContainerId: null, externalId: null });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    expect(await retryDelivery(f.db, f.delivery.id, "test")).toMatchObject({ ok: true });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 1 });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledWith(f.userId, f.token, "new-container", "instagram");
    expect(mocks.wait.mock.calls.map(([id]) => id)).toEqual(["old-container", "new-container"]);
    expect(await f.read()).toMatchObject({ status: "succeeded", externalId: "900001" });
    expect(await retryDelivery(f.db, f.delivery.id, "test", true)).toMatchObject({ ok: false });
  });

  it("keeps an unreadable container and checks it again before any new publish attempt", async () => {
    const f = await fixture(); mocks.wait.mockResolvedValueOnce({ state: "UNKNOWN", err: { kind: "transient", error: "상태 조회 시간 초과" } }).mockResolvedValueOnce({ state: "PUBLISHED" });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ failed: 1 });
    expect((await f.read()).externalContainerId).toBe("old-container");
    expect(await retryDelivery(f.db, f.delivery.id, "test")).toMatchObject({ ok: true });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ unknown: 1 });
    expect(await f.read()).toMatchObject({ status: "unknown", externalContainerId: "old-container" });
    expect(await retryDelivery(f.db, f.delivery.id, "test")).toMatchObject({ ok: false, code: "confirmation_required" });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("leaves a lost publish response unknown until the operator confirms it was not posted", async () => {
    const f = await fixture(); mocks.publish.mockResolvedValueOnce({ ok: false, lost: true, err: { kind: "unknown", error: "timeout" } });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ unknown: 1 });
    expect(await retryDelivery(f.db, f.delivery.id, "test")).toMatchObject({ ok: false, code: "confirmation_required" });
    expect((await f.read()).externalContainerId).toBe("old-container");
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ processed: 0 });
    expect(mocks.publish).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
    expect(await retryDelivery(f.db, f.delivery.id, "test", true)).toMatchObject({ ok: true });
    expect(await f.read()).toMatchObject({ status: "scheduled", externalContainerId: null });
  });

  it("retries a failed image upload and sends the approved image only once", async () => {
    const f = await fixture(); await f.patch({ externalContainerId: null });
    await f.db.update(mediaAssets).set({ cloudinaryUrl: null }).where(eq(mediaAssets.id, f.asset.id));
    mocks.upload.mockRejectedValueOnce(new Error("temporary upload failure"));
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ failed: 1 });
    expect(await f.read()).toMatchObject({ status: "failed", externalContainerId: null, lastError: expect.stringContaining("이미지 업로드 실패") });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    expect(await retryDelivery(f.db, f.delivery.id, "test")).toMatchObject({ ok: true });
    expect(await publishDue(f.db, { deliveryId: f.delivery.id })).toMatchObject({ succeeded: 1 });
    expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.publish).toHaveBeenCalledOnce();
    expect((await f.db.select().from(deliveries).where(eq(deliveries.id, f.delivery.id)))[0].attempts).toBe(2);
  });
});
