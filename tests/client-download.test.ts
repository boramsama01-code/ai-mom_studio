import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBlob, setCsrf } from "../client/src/api";

afterEach(() => { vi.unstubAllGlobals(); setCsrf(null); });
describe("Studio PNG download", () => {
  it("returns an authenticated PNG response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("PNG", { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await (await apiBlob("/studio/cards/1/export.png", "image/png")).text()).toBe("PNG");
    expect(fetch).toHaveBeenCalledWith("/api/studio/cards/1/export.png", expect.objectContaining({ credentials: "same-origin", method: "GET" }));
  });
  it("surfaces dialogue overflow without leaving the editor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "대사가 너무 깁니다." }, { status: 400 })));
    await expect(apiBlob("/studio/cards/1/export.png", "image/png")).rejects.toThrow("대사가 너무 깁니다.");
  });
  it("does not download a login HTML page as a PNG", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Login</html>", { headers: { "content-type": "text/html" } })));
    await expect(apiBlob("/studio/cards/1/export.png", "image/png")).rejects.toThrow("로그인 상태");
  });
  it("reports an offline error without retrying", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(apiBlob("/studio/cards/1/export.png", "image/png")).rejects.toThrow("네트워크");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("sends editable preview JSON with CSRF protection and abort support", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("JPEG", { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetch); setCsrf("preview-fixture-csrf");
    const controller = new AbortController();
    const body = { version: 4, copy: { title: "한글 미리보기" }, page: 1 };
    expect(await (await apiBlob("/channels/1/items/9/card-copy/preview", "image/jpeg", { method: "POST", body, signal: controller.signal })).text()).toBe("JPEG");
    expect(fetch).toHaveBeenCalledWith("/api/channels/1/items/9/card-copy/preview", expect.objectContaining({ method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": "preview-fixture-csrf" }, body: JSON.stringify(body), signal: controller.signal }));
  });
});
