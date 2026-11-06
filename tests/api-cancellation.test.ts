import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../client/src/api";

afterEach(() => vi.unstubAllGlobals());

it("passes cancellation to fetch and preserves abort rather than classifying it as a network failure", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })));
  vi.stubGlobal("fetch", fetcher);
  const request = api("/auth/me", { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await rejected;
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
});

it("rejects an auth response cancelled while the response body was being read", async () => {
  const controller = new AbortController();
  let release!: () => void;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: () => new Promise(resolve => { release = () => resolve({ user: "old-session", recoveryScope: "synthetic-old-scope" }); }) })));
  const activate = vi.fn();
  const request = api("/auth/me", { signal: controller.signal }).then(activate);
  await Promise.resolve(); await Promise.resolve();
  const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); release(); await rejected;
  expect(activate).not.toHaveBeenCalled();
});

it("still reports an actual network failure through the existing recoverable API error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("synthetic network failure"); }));
  await expect(api("/auth/me")).rejects.toBeInstanceOf(ApiError);
  await expect(api("/auth/me")).rejects.toMatchObject({ status: 0 });
});

it.each(["GET", "PATCH"])("does not accept an interrupted successful %s JSON body as an empty success", async method => {
  const fetcher = vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => { throw new TypeError("connection interrupted after headers"); } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api("/studio/cards/1", { method })).rejects.toMatchObject({ status: 0, body: { code: "response_incomplete", resultUnknown: method !== "GET" } });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("preserves an HTTP authentication failure when its optional JSON error body is incomplete", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, headers: new Headers({ "content-type": "application/json" }), json: async () => { throw new Error("truncated error"); } })));
  await expect(api("/auth/me")).rejects.toMatchObject({ status: 401 });
});

it("marks a lost write response unknown without repeating the mutation", async () => {
  const fetcher = vi.fn(async () => { throw new TypeError("write response lost"); });
  vi.stubGlobal("fetch", fetcher);
  await expect(api("/studio/cards/1", { method: "PATCH", body: { version: 2, script: "입력 유지" } })).rejects.toMatchObject({ status: 0, body: { code: "request_result_unknown", resultUnknown: true } });
  expect(fetcher).toHaveBeenCalledOnce();
});
