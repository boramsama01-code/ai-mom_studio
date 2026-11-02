import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountIdentity, containerStatus, createCarouselContainer, createContainer, mediaPermalink, publishContainer, publishingLimit, waitForContainer } from "../server/services/instagram";
import { resolveSecrets } from "../server/services/secrets";

const token = "test-only-secret-token";
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { process.env.INSTAGRAM_API_VERSION = "v26.0"; fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.IG_PENGUIN_AUTH_MODE; });
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("Meta Unified Login accounts", () => {
  it("chooses only the expected username from a multi-account system-user token", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "1", username: "highscoop.official" }, { id: "2", username: "spacepenguin.co" }] }));
    expect(await accountIdentity(token, "facebook", "@SPACEPENGUIN.CO")).toEqual({ ok: true, userId: "2", username: "spacepenguin.co" });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).origin).toBe("https://graph.facebook.com");
    expect(new URL(url).pathname).toBe("/v26.0/me/assigned_instagram_accounts");
    expect(new URL(url).searchParams.get("access_token")).toBeNull();
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("does not save or silently select another assigned account", async () => {
    fetcher.mockResolvedValue(response({ data: [{ id: "1", username: "highscoop.official" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: false, reason: "account_mismatch" });
  });

  it("keeps pagination on the trusted host even when next contains another origin", async () => {
    fetcher.mockResolvedValueOnce(response({ data: [{ id: "1", username: "highscoop.official" }], paging: { next: "https://untrusted.example/?token=bad", cursors: { after: "next-cursor" } } }))
      .mockResolvedValueOnce(response({ data: [{ id: "2", username: "spacepenguin.co" }] }));
    expect(await accountIdentity(token, "facebook", "spacepenguin.co")).toMatchObject({ ok: true, userId: "2" });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).origin)).toEqual(["https://graph.facebook.com", "https://graph.facebook.com"]);
  });

  it("preserves Instagram Login for legacy destinations without a mode reference", async () => {
    process.env.IG_PENGUIN_USER_ID = "2"; process.env.IG_PENGUIN_ACCESS_TOKEN = token;
    const legacy = resolveSecrets("instagram", "penguin", { userId: "IG_PENGUIN_USER_ID", accessToken: "IG_PENGUIN_ACCESS_TOKEN" });
    expect(legacy).toMatchObject({ missing: [], invalid: [], values: { authMode: "instagram" } });
    fetcher.mockResolvedValue(response({ user_id: "2", username: "spacepenguin.co" }));
    expect(await accountIdentity(token)).toMatchObject({ ok: true, userId: "2" });
    expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe("graph.instagram.com");
  });

  it("rejects an unknown explicit mode instead of guessing a host", () => {
    process.env.IG_PENGUIN_AUTH_MODE = "something-else";
    const result = resolveSecrets("instagram", "penguin", { userId: "IG_PENGUIN_USER_ID", accessToken: "IG_PENGUIN_ACCESS_TOKEN", authMode: "IG_PENGUIN_AUTH_MODE" });
    expect(result.invalid).toContain("authMode");
  });

  it("carries the chosen host through every publishing request without a live post", async () => {
    fetcher.mockImplementation(async (url: URL) => response(url.pathname.endsWith("content_publishing_limit") ? { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } : url.searchParams.has("fields") ? { status_code: "FINISHED", permalink: "https://www.instagram.com/p/test/" } : { id: "123" }));
    await publishingLimit("2", token, "facebook");
    await createContainer("2", token, "https://example.com/1.jpg", "caption", undefined, "facebook");
    await createCarouselContainer("2", token, ["https://example.com/1.jpg", "https://example.com/2.jpg"], "caption", undefined, "facebook");
    await containerStatus("123", token, "facebook");
    await waitForContainer("123", token, 1, "facebook");
    await publishContainer("2", token, "123", "facebook");
    await mediaPermalink("123", token, "facebook");
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(9);
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(url).origin).toBe("https://graph.facebook.com");
      expect(init.headers.authorization).toBe(`Bearer ${token}`);
      expect(init.redirect).toBe("error");
    }
  });
});
