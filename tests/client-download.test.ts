import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBlob } from "../client/src/api";

afterEach(() => vi.unstubAllGlobals());
describe("Studio PNG download", () => {
  it("returns an authenticated PNG response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("PNG", { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await (await apiBlob("/studio/cards/1/export.png", "image/png")).text()).toBe("PNG");
    expect(fetch).toHaveBeenCalledWith("/api/studio/cards/1/export.png", { credentials: "same-origin" });
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
});
