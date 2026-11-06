// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetResults } from "../client/src/AssetResults";
import type { AssetLibraryItem } from "../shared/assetLibrary";

const mocks = vi.hoisted(() => ({ api: vi.fn(), selected: 1 as number | "all", navigate: vi.fn() }));
const channels = [{ id: 1, name: "첫 채널", slug: "current-dialogue" }, { id: 2, name: "둘째 채널", slug: "family-penguin" }];
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useChannel: () => ({ selected: mocks.selected, channels, select: (id: number | "all") => { mocks.selected = id; } }), useDirtyGuard: () => ({ confirmLeave: (action: () => void) => action() }) }));
vi.mock("wouter", async original => ({ ...await original<object>(), useLocation: () => ["/assets", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
const image = (id: number, channelId = 1): AssetLibraryItem => ({ key: `image:${id}`, kind: "image", assetId: id, title: `보존한 결과 ${channelId}-${id}`, name: `이미지${id}.jpg`, channelId, channelName: channels[channelId - 1].name, createdAt: "2026-11-06T02:00:00Z", mimeType: "image/jpeg", sha256: "a".repeat(64), width: 1080, height: 1350, pageCount: 8, previewUrl: `/api/channels/${channelId}/media/${id}`, downloadUrl: `/api/channels/${channelId}/media/${id}?download=1`, bundleDownloadUrl: `/api/channels/${channelId}/media/${id}/deck.zip`, current: false, approval: { id: id + 100, status: "invalidated", approvedAt: "2026-11-05T02:00:00Z", approvedBy: "운영자" }, source: { itemId: 9, sourceRevisionId: 3, sourceRevisionNo: 1, studioCardId: 8, studioRevisionId: null, studioVersion: null, currentVersion: 4 }, editorUrl: `/items/${channelId}/9`, historyUrl: `/items/${channelId}/9?tab=history&revision=3`, currentPreview: { assetId: id + 1, kind: "image", previewUrl: `/api/channels/${channelId}/media/${id + 1}`, downloadUrl: `/api/channels/${channelId}/media/${id + 1}?download=1`, mimeType: "image/jpeg", sourceRevisionId: 4, studioVersion: null, approvalStatus: null } });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><AssetResults/></QueryClientProvider>)); await settle(); }
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text)!;
async function click(text: string) { expect(button(text), text).toBeTruthy(); await act(async () => button(text).click()); await settle(); }
async function select(label: string, value: string) { const node = [...host.querySelectorAll("label")].find(node => node.textContent?.startsWith(label))!.querySelector("select")!; await act(async () => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
function writes() { return mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET"); }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); mocks.selected = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)); vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id)); vi.stubGlobal("scrollTo", vi.fn());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); client.setQueryDefaults(["me"], { gcTime: Infinity }); client.setQueryData(["me"], { user: "editor-a", recoveryScope: "scope-a" });
  mocks.api.mockImplementation(async (path: string) => { const url = new URL(path, "https://fixture.test"); const cid = Number(url.searchParams.get("channelId") || 1), offset = Number(url.searchParams.get("offset")); return { items: [image(40 + offset, cid)], hasMore: offset === 0, nextOffset: offset === 0 ? 24 : null, filters: {} }; });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

describe("saved result library", () => {
  it("compares the actual historical file with the current unapproved artifact and links exact manuscript history without restoring", async () => {
    await render(); await act(async () => host.querySelector<HTMLButtonElement>(".asset-result-card")!.click()); await settle();
    const detail = host.querySelector('[aria-label="선택한 결과 비교"]')!;
    expect([...detail.querySelectorAll("img")].map(node => node.getAttribute("src"))).toEqual(["/api/channels/1/media/40", "/api/channels/1/media/41"]);
    expect(detail.textContent).toContain("이전 승인 · 현재 무효"); expect(detail.textContent).toContain("현재 초안 이미지 · 게시 승인 없음");
    expect(detail.textContent).toContain("문구만 복원");
    const history = [...detail.querySelectorAll("a")].find(node => node.textContent === "원고 버전 비교")!; expect(history.getAttribute("href")).toBe("/items/1/9?tab=history&revision=3");
    await act(async () => history.click()); expect(mocks.navigate).toHaveBeenCalledWith("/items/1/9?tab=history&revision=3"); expect(writes()).toHaveLength(0);
    expect(detail.querySelector('a[href="/api/channels/1/media/40/deck.zip"]')).not.toBeNull(); expect(detail.querySelector('a[href="/?start=finished&channel=news&mode=manual"]')).not.toBeNull();
  });
  it("retains filters, search, page and safe selection after detail navigation/remount, independently per channel and user", async () => {
    await render(); await select("결과 종류", "image"); await select("기록 범위", "history");
    const input = host.querySelector("input")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "보존"); input.dispatchEvent(new Event("input", { bubbles: true })); }); await click("결과 찾기"); await click("다음 결과");
    await act(async () => host.querySelector<HTMLButtonElement>(".asset-result-card")!.click()); await settle();
    await act(async () => root.render(<QueryClientProvider client={client}><p>상세 화면</p></QueryClientProvider>)); await render();
    expect(host.querySelector<HTMLSelectElement>("label:nth-child(2) select")!.value).toBe("image"); expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("보존"); expect(host.textContent).toContain("2페이지"); expect(host.querySelector('[aria-label="선택한 결과 비교"]')).not.toBeNull();
    mocks.selected = 2; await render(); expect(host.querySelector('[aria-label="선택한 결과 비교"]')).toBeNull(); expect(host.querySelector<HTMLInputElement>("input")!.value).toBe(""); expect(host.textContent).toContain("1페이지");
    mocks.selected = 1; await render(); expect(host.textContent).toContain("2페이지"); expect(host.querySelector('[aria-label="선택한 결과 비교"]')).not.toBeNull();
    client.setQueryData(["me"], { user: "editor-b", recoveryScope: "scope-b" }); await render(); expect(host.querySelector<HTMLInputElement>("input")!.value).toBe(""); expect(host.querySelector('[aria-label="선택한 결과 비교"]')).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("does not substitute a historical image when the current version has no rendered result", async () => {
    mocks.api.mockResolvedValue({ items: [{ ...image(40), currentPreview: null }], hasMore: false, nextOffset: null }); await render(); await act(async () => host.querySelector<HTMLButtonElement>(".asset-result-card")!.click()); await settle();
    expect(host.querySelector('[aria-label="선택한 결과 비교"]')!.querySelectorAll("img")).toHaveLength(1); expect(host.textContent).toContain("현재 버전에는 연결된 완성 결과가 없습니다");
  });
  it("offers historical approval records when a newer draft has no current approval", async () => {
    mocks.api.mockImplementation(async (path: string) => ({ items: path.includes("view=history") ? [image(40)] : [], hasMore: false, nextOffset: null })); await render(); expect(host.textContent).toContain("조건에 맞는 승인 이미지"); await click("이전 승인·사용 기록 보기"); expect(host.querySelector(".asset-result-card")).not.toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("uses poster-only thumbnails and explicit non-autoplay players for videos, with no approval claim", async () => {
    const video = { ...image(50), kind: "video", mimeType: "video/mp4", previewUrl: "/api/assets/library/videos/50/preview", downloadUrl: "/api/studio/media/50?download=1", bundleDownloadUrl: null, approval: null, current: true, currentPreview: null, source: { ...image(50).source, studioVersion: 3, studioRevisionId: 60 }, historyUrl: "/studio/8?tab=history&revision=60" };
    mocks.api.mockResolvedValue({ items: [video], hasMore: false, nextOffset: null }); await render(); expect(host.querySelectorAll("video")).toHaveLength(0); expect(host.querySelector("img")!.src).toContain("/api/assets/library/videos/50/preview"); await act(async () => host.querySelector<HTMLButtonElement>(".asset-result-card")!.click()); await settle();
    const player = host.querySelector("video")!; expect(player.preload).toBe("none"); expect(player.autoplay).toBe(false); expect(player.controls).toBe(true); expect(host.textContent).toContain("저장 영상 · 게시 승인 없음"); expect(writes()).toHaveLength(0);
  });
});
