// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeliveryActions } from "../client/src/DeliveryActions";
import { ApiError } from "../client/src/api";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), changed: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); mocks.api.mockResolvedValue({ ok: true, workerStarted: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(status: string, approvalStatus = "active", id = 44) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(DeliveryActions, { channelId: 3, approvalId: 21, approvalStatus, delivery: { id, status }, onChanged: mocks.changed }))));
  await settle();
}
async function click() { await act(async () => host.querySelector("button")!.click()); await settle(); }

describe("shared publication actions", () => {
  it("offers a failed destination retry without posting anything on render", async () => {
    await render("failed"); expect(mocks.api).not.toHaveBeenCalled(); expect(host.textContent).toContain("다시 전송");
    await click();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/deliveries/44/retry", { method: "POST", body: { confirmNotPosted: false } });
    expect(mocks.changed).toHaveBeenCalledOnce(); expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("실제 게시 결과"));
  });
  it("requires a not-posted check for unknown results and clears it for another delivery", async () => {
    await render("unknown"); expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelector("button")!.disabled).toBe(false);
    await click();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/deliveries/44/retry", { method: "POST", body: { confirmNotPosted: true } });
    await render("unknown", "active", 45); expect(host.querySelector<HTMLInputElement>("input")!.checked).toBe(false); expect(host.querySelector("button")!.disabled).toBe(true);
  });
  it.each(["processing", "succeeded", "cancelled"])("does not offer a mutation for %s", async status => {
    await render(status); expect(host.querySelector("button")).toBeNull(); expect(mocks.api).not.toHaveBeenCalled();
  });
  it("does not retry an invalidated approval", async () => {
    await render("failed", "invalidated"); expect(host.querySelector("button")).toBeNull();
  });
  it("explicitly reports cancellation of only the queued destinations", async () => {
    const message = "대기 중인 1건만 취소했습니다. 이미 시작된 1건은 취소되지 않았으므로 전송 결과를 확인해 주세요.";
    mocks.api.mockResolvedValue({ ok: true, approvalCancelled: false, cancelled: 1, alreadyProcessing: 1, message });
    await render("scheduled"); expect(host.textContent).toContain("예약 취소"); await click();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/approvals/21/cancel", { method: "POST", body: {} });
    expect(mocks.toast).toHaveBeenCalledWith("info", message);
  });
  it("refreshes and displays the server's race result instead of claiming cancellation", async () => {
    mocks.api.mockRejectedValue(new ApiError(409, "전송이 이미 시작되어 취소할 수 없습니다."));
    await render("scheduled"); await click();
    expect(host.textContent).toContain("전송이 이미 시작되어 취소할 수 없습니다.");
    expect(mocks.toast).not.toHaveBeenCalled(); expect(mocks.changed).toHaveBeenCalledOnce();
  });
});
