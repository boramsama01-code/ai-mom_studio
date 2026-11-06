import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../server/db";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(), quota: vi.fn(), cloud: vi.fn(), resolve: vi.fn(), save: vi.fn(), activate: vi.fn(), audit: vi.fn(),
}));
vi.mock("../server/services/instagram", () => ({ accountIdentity: mocks.identity, publishingLimit: mocks.quota }));
vi.mock("../server/services/connectionTest", () => ({ testCloudinary: mocks.cloud }));
vi.mock("../server/services/secrets", () => ({ resolveSecrets: mocks.resolve, defaultSecretRefs: () => ({ accessToken: "IG_PENGUIN_ACCESS_TOKEN", userId: "IG_PENGUIN_USER_ID" }), slugToEnvPart: () => "PENGUIN" }));
vi.mock("../server/secretStore", () => ({ isFromEnvironment: vi.fn(), saveSecret: mocks.save }));
vi.mock("../server/audit", () => ({ audit: mocks.audit }));

const { checkInstagramConnection, connectInstagram } = await import("../server/services/instagramConnection");
const { channels, destinations } = await import("../shared/schema");

function database(active = true) {
  const where = vi.fn()
    .mockResolvedValueOnce([{ id: 1, slug: "penguin", active }])
    .mockResolvedValueOnce([{ id: 4, channelId: 1, platform: "instagram", enabled: true, secretRefs: {} }]);
  return { select: () => ({ from: () => ({ where }) }) } as unknown as DB;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockReturnValue({ missing: [], invalid: [], values: { userId: "12345", accessToken: "test-secret-token" } });
  mocks.identity.mockResolvedValue({ ok: true, userId: "12345", username: "spacepenguin.co" });
  mocks.quota.mockResolvedValue({ ok: true, used: 2, total: 100 });
  mocks.cloud.mockResolvedValue({ ok: true, message: "이미지 저장소 확인 완료" });
  mocks.save.mockResolvedValue(mocks.activate); mocks.audit.mockResolvedValue(undefined);
});

function connectionDatabase(failCommit = false, existingCount = 1, custom = false) {
  const channel = { id: 1, slug: custom ? "local-atelier" : "penguin", active: true, budget: { dailyPublishLimit: 3 }, version: 1 };
  const existing = { id: 4, label: custom ? "ATELIER.ACCOUNT" : "SPACEPENGUIN.CO", version: 2 };
  let reads = 0;
  const writes: Array<{ table: unknown; patch: Record<string, unknown> }> = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ++reads === 1 ? { for: async () => [channel] } : Promise.resolve(Array.from({ length: existingCount }, (_, index) => ({ ...existing, id: existing.id + index }))) }) }),
    insert: vi.fn(() => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) })),
    update: vi.fn((table: unknown) => ({ set: (patch: Record<string, unknown>) => { writes.push({ table, patch }); return { where: async () => undefined }; } })),
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => [channel] }) }),
    transaction: async (callback: (transaction: typeof tx) => Promise<void>) => { await callback(tx); if (failCommit) throw new Error("commit failed"); },
  } as unknown as DB;
  return { db, tx, channel, writes };
}

it.each([undefined, 0, 3])("ignores obsolete daily cap %s while verifying and saving the exact account", async dailyLimit => {
  const { db, channel, writes } = connectionDatabase();
  const connected = await connectInstagram(db, 1, { token: "test-only-token", username: "spacepenguin.co", authMode: "facebook", ...(dailyLimit === undefined ? {} : { dailyLimit }) }, "operator");
  expect(connected.username).toBe("spacepenguin.co");
  expect(mocks.identity).toHaveBeenCalledWith("test-only-token", "facebook", "spacepenguin.co");
  expect(mocks.quota).toHaveBeenCalledWith("12345", "test-only-token", "facebook");
  const channelWrite = writes.find(write => write.table === channels)?.patch;
  expect(channelWrite).toMatchObject({ version: 2 });
  expect(channelWrite).not.toHaveProperty("budget");
  expect(channel.budget.dailyPublishLimit).toBe(3);
  expect(mocks.audit.mock.calls[0][1].detail).not.toHaveProperty("dailyLimit");
});

it("reuses the existing destination ID when its label differs only in casing or @", async () => {
  const { db, tx } = connectionDatabase();
  await connectInstagram(db, 1, { token: "test-only-token", username: "spacepenguin.co", dailyLimit: 3, authMode: "facebook" }, "operator");
  expect(tx.update).toHaveBeenCalledWith(destinations);
  expect(tx.insert).not.toHaveBeenCalledWith(destinations);
  expect(mocks.activate).toHaveBeenCalledTimes(3);
});

it("accepts a uniquely verified custom OAuth account without manufacturing a fixed username", async () => {
  const { db, tx } = connectionDatabase(false, 1, true);
  mocks.identity.mockResolvedValue({ ok: true, userId: "8811", username: "atelier.account" });
  const connected = await connectInstagram(db, 1, { token: "test-only-token", username: "", dailyLimit: 0, authMode: "facebook" }, "operator");
  expect(connected.username).toBe("atelier.account");
  expect(mocks.identity).toHaveBeenCalledWith("test-only-token", "facebook", "");
  expect(tx.update).toHaveBeenCalledWith(destinations);
  expect(mocks.activate).toHaveBeenCalledTimes(3);
});

it("never activates newly saved credentials after a transaction rollback", async () => {
  const { db } = connectionDatabase(true);
  await expect(connectInstagram(db, 1, { token: "test-only-token", username: "spacepenguin.co", dailyLimit: 3 }, "operator")).rejects.toMatchObject({
    status: 500,
    message: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
    extra: { code: "persistence_failed", diagnostic: { stage: "persistence" } },
  });
  expect(mocks.save).toHaveBeenCalled();
  expect(mocks.activate).not.toHaveBeenCalled();
});

it("rejects duplicate enabled destinations without modifying existing records or credentials", async () => {
  const { db, tx } = connectionDatabase(false, 2);
  await expect(connectInstagram(db, 1, { token: "test-only-token", username: "spacepenguin.co", dailyLimit: 3 }, "operator")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("여러 개") });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.activate).not.toHaveBeenCalled();
  expect(tx.update).not.toHaveBeenCalled();
  expect(tx.insert).not.toHaveBeenCalled();
});

describe("Instagram connection and image hosting are independent", () => {
  it("keeps successful account authentication when image hosting fails", async () => {
    mocks.cloud.mockResolvedValue({ ok: false, message: "이미지 저장소 인증을 확인하세요." });
    const result = await checkInstagramConnection(database(), 1, 4);
    expect(result).toMatchObject({ ok: true, username: "spacepenguin.co", used: 2, total: 100, mediaHosting: { ok: false } });
    expect(result.checkedAt).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("test-secret-token");
  });

  it("isolates an unexpected image-host failure from the account check", async () => {
    mocks.cloud.mockRejectedValue(new Error("provider diagnostic must not leak"));
    const result = await checkInstagramConnection(database(), 1, 4);
    expect(result.ok).toBe(true);
    expect(result.mediaHosting).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("provider diagnostic");
  });

  it("rejects another account's token before checking image hosting", async () => {
    mocks.identity.mockResolvedValue({ ok: true, userId: "56789", username: "spacepenguin.co" });
    await expect(checkInstagramConnection(database(), 1, 4)).rejects.toMatchObject({ status: 409 });
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("keeps a publishing-permission error as an Instagram error", async () => {
    mocks.quota.mockResolvedValue({ ok: false });
    await expect(checkInstagramConnection(database(), 1, 4)).rejects.toMatchObject({ status: 400 });
    expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("does not check a destination in an inactive channel", async () => {
    await expect(checkInstagramConnection(database(false), 1, 4)).rejects.toMatchObject({ status: 400 });
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.cloud).not.toHaveBeenCalled();
  });
});
