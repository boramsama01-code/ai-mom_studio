import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { channels, destinations } from "../shared/schema";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), quota: vi.fn() }));
vi.mock("../server/services/instagram", () => ({ accountIdentity: mocks.identity, publishingLimit: mocks.quota }));
const { publicationReadinessFor, verifyInstagramPublicationAccess } = await import("../server/services/publishReadiness");
const channel = { id: 1, slug: "penguin", active: true, budget: { dailyPublishLimit: 3 } } as typeof channels.$inferSelect;
const destination = { id: 8, channelId: 1, platform: "instagram", label: "@spacepenguin.co", enabled: true, version: 1, createdAt: new Date(), updatedAt: new Date(), secretRefs: { accessToken: "IG_PENGUIN_ACCESS_TOKEN", userId: "IG_PENGUIN_USER_ID", authMode: "IG_PENGUIN_AUTH_MODE" } } satisfies typeof destinations.$inferSelect;
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ DRY_RUN: "false", AUTO_PUBLISH: "true", APP_CANONICAL_REDIRECT_URL: "", CLOUDINARY_CLOUD_NAME: "test", CLOUDINARY_API_KEY: "test", CLOUDINARY_API_SECRET: "test", INSTAGRAM_API_VERSION: "v26.0", IG_PENGUIN_ACCESS_TOKEN: "fixture-secret-not-for-output", IG_PENGUIN_USER_ID: "12345", IG_PENGUIN_AUTH_MODE: "facebook" })) vi.stubEnv(key, value);
  mocks.identity.mockResolvedValue({ ok: true, userId: "12345", username: "spacepenguin.co" });
  mocks.quota.mockResolvedValue({ ok: true, used: 2, total: 100 });
});
afterEach(() => vi.unstubAllEnvs());

describe("new approvals require a usable publication route", () => {
  it("blocks zero destinations instead of saving an approval with no deliveries", () => {
    expect(publicationReadinessFor(channel, [], false)).toMatchObject({ ready: false, blockers: [expect.stringContaining("계정이 연결되지")], destinations: [] });
  });
  it("blocks missing tokens and invalid auth modes without exposing credentials", () => {
    vi.stubEnv("IG_PENGUIN_ACCESS_TOKEN", "");
    expect(publicationReadinessFor(channel, [destination], false).ready).toBe(false);
    vi.stubEnv("IG_PENGUIN_ACCESS_TOKEN", "fixture-secret-not-for-output");
    vi.stubEnv("IG_PENGUIN_AUTH_MODE", "guess-from-token-prefix");
    const result = publicationReadinessFor(channel, [destination], false);
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-not-for-output");
    expect(JSON.stringify(result)).not.toContain("IG_PENGUIN_ACCESS_TOKEN");
  });
  it("reports missing image hosting and API version before approval", () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", ""); vi.stubEnv("INSTAGRAM_API_VERSION", "not-a-version");
    const result = publicationReadinessFor(channel, [destination], false);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.stringContaining("Cloudinary"), expect.stringContaining("API 버전")]));
  });
  it("blocks archived channels, global stop and simulated/stopped publishing even with an ignored legacy zero cap", () => {
    vi.stubEnv("DRY_RUN", "true"); vi.stubEnv("AUTO_PUBLISH", "false");
    const result = publicationReadinessFor({ ...channel, active: false, budget: { ...channel.budget, dailyPublishLimit: 0 } }, [destination], true);
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(4);
    expect(result.dryRun).toBe(true); expect(result.autoPublish).toBe(false);
  });
  it.each([0, 3])("allows an otherwise ready approved account with legacy daily cap %s", dailyPublishLimit => {
    const result = publicationReadinessFor({ ...channel, budget: { ...channel.budget, dailyPublishLimit } }, [destination], false);
    expect(result).toMatchObject({ ready: true, blockers: [], expectedUsername: "spacepenguin.co" });
    expect(result).not.toHaveProperty("dailyLimit");
    expect(mocks.identity).not.toHaveBeenCalled(); expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("does not approve duplicated active Instagram destinations", () => {
    expect(publicationReadinessFor(channel, [destination, { ...destination, id: 9 }], false)).toMatchObject({ ready: false, blockers: [expect.stringContaining("여러 개")] });
  });
  it("performs no remote lookup while displaying readiness", () => {
    expect(publicationReadinessFor(channel, [destination], false)).toMatchObject({ ready: true, expectedUsername: "spacepenguin.co", blockers: [] });
    expect(mocks.identity).not.toHaveBeenCalled(); expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("confirms the explicit API mode, exact channel identity and publish permission before approval", async () => {
    expect(await verifyInstagramPublicationAccess(channel, [destination])).toBeNull();
    expect(mocks.identity).toHaveBeenCalledWith("fixture-secret-not-for-output", "facebook", "spacepenguin.co");
    expect(mocks.quota).toHaveBeenCalledWith("12345", "fixture-secret-not-for-output", "facebook");
  });
  it("rejects a wrong account or saved ID before querying publish permissions", async () => {
    mocks.identity.mockResolvedValue({ ok: true, userId: "12345", username: "highscoop.official" });
    expect(await verifyInstagramPublicationAccess(channel, [destination])).toContain("계정과 연결된 계정이 다릅니다");
    mocks.identity.mockResolvedValue({ ok: true, userId: "99999", username: "spacepenguin.co" });
    expect(await verifyInstagramPublicationAccess(channel, [destination])).toContain("계정 ID");
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("rejects expired credentials and missing publishing permission", async () => {
    mocks.identity.mockResolvedValueOnce({ ok: false, error: "토큰이 만료됐습니다." });
    expect(await verifyInstagramPublicationAccess(channel, [destination])).toContain("만료");
    mocks.quota.mockResolvedValue({ ok: false, error: "permission denied" });
    expect(await verifyInstagramPublicationAccess(channel, [destination])).toContain("게시 권한");
  });
});
