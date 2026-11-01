// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { zipSync, strToU8 } from "fflate";
import { StudioZipImport } from "../client/src/pages/StudioZipImport";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), close: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), apiUpload: mocks.upload }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => ({ confirmLeave: (f: () => void) => f(), setDirty: vi.fn() }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(async () => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(StudioZipImport, { channels: [{ id: "penguin", name: "우주펭귄상회" }], initialChannel: "penguin", onClose: mocks.close }))));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
async function select(bytes: Uint8Array, name = "완성.zip") {
  const file = new File([bytes as BlobPart], name, { type: "application/zip" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await settle();
  return file;
}
it("previews grouped page counts and captions before uploading the original archive and linking each saved post", async () => {
  const bytes = zipSync({ "01_가족/1.png": new Uint8Array([1]), "01_가족/2.png": new Uint8Array([2]), "02_탄생/1.png": new Uint8Array([3]), "게시글.txt": new Uint8Array(strToU8("[01 가족]\n소개 캡션\n\n[02 탄생]\n탄생 캡션")) });
  const file = await select(bytes);
  expect(host.textContent).toContain("2건 · 총 3장"); expect(host.textContent).toContain("캡션 포함"); expect(mocks.upload).not.toHaveBeenCalled();
  mocks.upload.mockResolvedValue({ imported: 2, skipped: 0, pageCount: 3, cards: [{ id: 21, title: "가족", pages: 2, duplicate: false, trashed: false }, { id: 22, title: "탄생", pages: 1, duplicate: false, trashed: false }] });
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "2건 검토함에 가져오기")!;
  await act(async () => button.click()); await settle();
  expect(mocks.upload).toHaveBeenCalledWith("/studio/import-zip?channel=penguin", file);
  expect(host.textContent).toContain("새 작업 2건 저장"); expect(host.querySelector('a[href="/studio/21"]')).not.toBeNull(); expect(host.querySelector('a[href="/studio/22"]')).not.toBeNull();
});
it("leaves upload disabled when the archive is unreadable", async () => {
  await select(strToU8("bad ZIP"));
  expect(host.textContent).toContain("ZIP을 읽을 수 없습니다");
  expect([...host.querySelectorAll("button")].find(b => b.textContent?.includes("검토함에 가져오기"))?.disabled).toBe(true);
  expect(mocks.upload).not.toHaveBeenCalled();
});
