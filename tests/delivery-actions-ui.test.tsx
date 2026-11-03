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
async function render(status: string, approvalStatus = "active", id = 44, needsReconciliation = false) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(DeliveryActions, { channelId: 3, approvalId: 21, approvalStatus, delivery: { id, status, needsReconciliation }, onChanged: mocks.changed }))));
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
    await render("unknown");
    const byText = (text: string) => [...host.querySelectorAll("button")].find(button => button.textContent === text)!;
    expect(byText("게시 결과 다시 확인").disabled).toBe(false);
    expect(byText("다시 전송")).toBeUndefined();
    expect(byText("미게시 확인 기록").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(byText("미게시 확인 기록").disabled).toBe(false);
    await act(async () => byText("미게시 확인 기록").click()); await settle();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/deliveries/44/confirm-not-posted", { method: "POST", body: { note: undefined } });
    expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/retry"))).toBe(false);
    await render("unknown", "active", 45); expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false); expect(byText("미게시 확인 기록").disabled).toBe(true);
  });
  it("can reconcile an unknown result from an invalidated approval without retransmitting it", async () => {
    await render("unknown", "invalidated");
    await click();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/deliveries/44/reconcile", { method: "POST", body: {} });
    expect(host.textContent).not.toContain("다시 전송");
  });
  it("records a manually verified published URL through a separate action without retrying", async () => {
    await render("unknown");
    expect([...host.querySelectorAll("label")].find(label => label.textContent?.startsWith("확인 메모"))?.querySelector("input")?.maxLength).toBe(500);
    const url = host.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(url, "https://www.instagram.com/p/verified/");
      url.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "이미 게시됨으로 기록")!.click()); await settle();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/deliveries/44/confirm-posted", { method: "POST", body: { externalUrl: "https://www.instagram.com/p/verified/", note: undefined } });
    expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/retry"))).toBe(false);
  });
  it("waits for the active transmission to finish before reconciling a flagged late result", async () => {
    await render("processing", "active", 44, true);
    expect(host.textContent).toContain("이전 시도의 늦은 결과가 있어 현재 전송 종료 후 확인이 필요합니다.");
    const byText = (text: string) => [...host.querySelectorAll("button")].find(button => button.textContent === text)!;
    for (const label of ["게시 결과 다시 확인", "이미 게시됨으로 기록", "미게시 확인 기록"]) {
      expect(byText(label).disabled).toBe(true);
      await act(async () => byText(label).click());
    }
    expect([...host.querySelectorAll("input")].every(input => input.disabled)).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
    await render("unknown", "active", 44, true);
    expect(host.textContent).not.toContain("현재 전송 종료 후 확인이 필요합니다.");
    expect(byText("게시 결과 다시 확인").disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
    await click();
    expect(mocks.api).toHaveBeenCalledWith("/channels/3/deliveries/44/reconcile", { method: "POST", body: {} });
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
