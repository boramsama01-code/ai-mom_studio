import { afterEach, describe, expect, it, vi } from "vitest";
import { setTestEnv } from "./helpers";
setTestEnv();
const { sendAlbumToChannel } = await import("../server/services/telegram");
const { createCarouselContainer } = await import("../server/services/instagram");
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.INSTAGRAM_API_VERSION; });
describe("ordered carousel publishing adapters", () => {
  it("sends every Telegram photo in one album with the caption only on its first page", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-only";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: [{ message_id: 77, chat: { username: "test" } }, { message_id: 78 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await sendAlbumToChannel("@test", [Buffer.from("one"), Buffer.from("two")], "전체 캡션");
    expect(result).toMatchObject({ ok: true, messageId: 77, chatUsername: "test" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("sendMediaGroup"); const body = init.body as FormData;
    expect(JSON.parse(String(body.get("media")))).toEqual([{ type: "photo", media: "attach://page0", caption: "전체 캡션" }, { type: "photo", media: "attach://page1" }]);
    expect(await (body.get("page1") as Blob).text()).toBe("two");
  });
  it("treats a Telegram album timeout as unknown to avoid automatically duplicating a post", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-only"; vi.stubGlobal("fetch", async () => { throw new Error("timeout"); });
    expect(await sendAlbumToChannel("@test", [Buffer.from("1"), Buffer.from("2")], "")).toMatchObject({ ok: false, kind: "unknown" });
  });
  it("creates ordered Instagram children and one parent; no publishing occurs here", async () => {
    process.env.INSTAGRAM_API_VERSION = "v23.0";
    let next = 0;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: String(++next) }), { status: 200 })); vi.stubGlobal("fetch", fetcher);
    expect(await createCarouselContainer("account", "test-token", ["https://example.com/1.jpg", "https://example.com/2.jpg"], "캡션")).toEqual({ ok: true, containerId: "3" });
    const params = fetcher.mock.calls.map(call => (call as unknown as [string, RequestInit])[1].body as URLSearchParams);
    expect(params[0].get("is_carousel_item")).toBe("true"); expect(params[0].has("caption")).toBe(false);
    expect(params[1].get("image_url")).toBe("https://example.com/2.jpg");
    expect(params[2].get("children")).toBe("1,2"); expect(params[2].get("media_type")).toBe("CAROUSEL"); expect(params[2].get("caption")).toBe("캡션");
    expect(fetcher.mock.calls.every(call => !String((call as unknown as [string])[0]).includes("media_publish"))).toBe(true);
  });
  it("does not create a parent when a child failed", async () => {
    process.env.INSTAGRAM_API_VERSION = "v23.0";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "failed" } }), { status: 400 })); vi.stubGlobal("fetch", fetcher);
    expect(await createCarouselContainer("account", "token", ["https://example.com/1.jpg", "https://example.com/2.jpg"], "")).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
