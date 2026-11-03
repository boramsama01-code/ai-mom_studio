import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestEnv } from "./helpers";
setTestEnv();
const { publishContainer, createContainer, createCarouselContainer } = await import("../server/services/instagram");
const { sendPhotoToChannel, telegramChatIdentity } = await import("../server/services/telegram");
beforeEach(() => { vi.stubEnv("INSTAGRAM_API_VERSION", "v26.0"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-only-never-a-live-token"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("publication adapter evidence validation (mock HTTP only)", () => {
  it.each([{}, [], null, { id: "undefined" }, { id: "0" }, { id: 0 }, { id: 9007199254740992 }])("never reports malformed 2xx Instagram response %j as a successful post", async body => {
    const outbound = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", outbound);
    expect(await publishContainer("123", "test-only", "456")).toMatchObject({ ok: false, lost: true, err: { kind: "unknown" } });
    expect(outbound).toHaveBeenCalledOnce();
  });
  it("treats an unreadable successful response and a publishing 503 as uncertain", async () => {
    const outbound = vi.fn().mockResolvedValueOnce(new Response("not-json", { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }));
    vi.stubGlobal("fetch", outbound);
    expect(await publishContainer("123", "test-only", "456")).toMatchObject({ ok: false, lost: true });
    expect(await publishContainer("123", "test-only", "456")).toMatchObject({ ok: false, lost: true });
  });
  it("preserves a valid remote ID exactly, including IDs larger than a safe JSON number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "17990071992547409929" }), { status: 200 })));
    expect(await publishContainer("123", "test-only", "456")).toEqual({ ok: true, mediaId: "17990071992547409929" });
  });
  it("fails malformed container creation before publishing or creating a parent", async () => {
    const outbound = vi.fn(async (_url: unknown) => new Response(JSON.stringify({ id: "undefined" }), { status: 200 }));
    vi.stubGlobal("fetch", outbound);
    expect(await createContainer("123", "test-only", "https://example.com/one.jpg", "caption")).toMatchObject({ ok: false, lost: false });
    expect(await createCarouselContainer("123", "test-only", ["https://example.com/one.jpg", "https://example.com/two.jpg"], "caption")).toMatchObject({ ok: false, lost: false });
    expect(outbound).toHaveBeenCalledTimes(2);
    expect(outbound.mock.calls.every(call => !String(call[0]).includes("media_publish"))).toBe(true);
  });
  it("resolves Telegram handles with a read-only getChat and refuses non-channel or rounded identities", async () => {
    const outbound = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: -1001234567890, type: "channel", username: "test_channel" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 9007199254740992, type: "channel" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 1234, type: "private" } })));
    vi.stubGlobal("fetch", outbound);
    expect(await telegramChatIdentity("@test_channel")).toEqual({ ok: true, chatId: "-1001234567890", username: "test_channel" });
    expect(await telegramChatIdentity("@test_channel")).toMatchObject({ ok: false });
    expect(await telegramChatIdentity("@test_channel")).toMatchObject({ ok: false });
    for (const [url, init] of outbound.mock.calls) { expect(String(url)).toContain("/getChat?"); expect(init.method).toBe("GET"); }
  });
  it("never calls a malformed Telegram success or 503 a definite failure eligible for blind resend", async () => {
    const outbound = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", outbound);
    expect(await sendPhotoToChannel("-100123", Buffer.from("fixture"), "caption")).toMatchObject({ ok: false, kind: "unknown" });
    expect(await sendPhotoToChannel("-100123", Buffer.from("fixture"), "caption")).toMatchObject({ ok: false, kind: "unknown" });
  });
});
