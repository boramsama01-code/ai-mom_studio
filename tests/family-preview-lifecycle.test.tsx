// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, startTransition, Suspense, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFamilyPreviewImages } from "../client/src/FamilyDialogueEditor";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Images = ReturnType<typeof useFamilyPreviewImages>;
let root: Root | null, host: HTMLDivElement, images: Images;
let committed: (value: Images) => void, suspend: boolean;
let created: string[], revoked: string[];
const blob = () => new Blob(["preview"], { type: "image/jpeg" });
const never = new Promise<void>(() => {});
function Probe() {
  images = useFamilyPreviewImages();
  useLayoutEffect(() => committed(images), [images.preview, images.thumbs]);
  if (suspend && images.preview?.signature === "pending") throw never;
  return createElement("div", {}, images.preview && createElement("img", { "data-selected": true, src: images.preview.url }),
    ...Object.entries(images.thumbs).map(([id, value]) => createElement("img", { key: id, "data-page": id, src: value.url })));
}
beforeEach(() => {
  created = []; revoked = []; committed = () => {}; suspend = false;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => { const url = `blob:owned-${created.length + 1}`; created.push(url); return url; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn((url: string) => {
    // A retirement effect runs after the DOM stopped using that exact URL.
    expect([...host.querySelectorAll("img")].some(image => image.getAttribute("src") === url)).toBe(false);
    revoked.push(url);
  }) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); host.remove(); });
async function mount() { await act(async () => root!.render(createElement(Suspense, { fallback: "pending" }, createElement(Probe)))); }

describe("family preview URL ownership", () => {
  it("keeps a future thumbnail queued by a layout commit alive through older passive effects", async () => {
    await mount();
    let queued = false;
    committed = value => {
      if (value.preview?.signature !== "selected" || queued) return;
      queued = true;
      // This URL exists before the selected render's passive effects run,
      // but its thumbnail state has not committed yet.
      value.receive("news_summary", "future", blob());
    };
    await act(async () => images.receive("cover", "selected", blob(), true));
    expect(created).toHaveLength(2); expect(revoked).toEqual([]);
    expect(host.querySelector('[data-page="news_summary"]')?.getAttribute("src")).toBe(created[1]);
  });

  it("retires superseded batched URLs after commit while preserving shared selected references", async () => {
    await mount();
    let queued = false;
    committed = value => {
      if (value.preview?.signature !== "first" || queued) return;
      queued = true;
      value.receive("cover", "superseded-before-commit", blob(), true);
      value.receive("cover", "latest", blob(), true);
    };
    await act(async () => images.receive("cover", "first", blob(), true));
    expect(created).toHaveLength(3); expect(revoked).toEqual(created.slice(0, 2));
    expect([...host.querySelectorAll("img")].map(image => image.getAttribute("src"))).toEqual([created[2], created[2]]);
    await act(async () => images.receive("cover", "thumbnail-only", blob()));
    expect(revoked).not.toContain(created[2]); // Still displayed by the selected preview.
    await act(async () => images.receive("concept", "new-selected", blob(), true));
    expect(revoked).toEqual(created.slice(0, 3));
    expect(new Set(created.filter(url => !revoked.includes(url))).size).toBe(2);
  });

  it("releases every owned URL on unmount, including an uncommitted transition", async () => {
    await mount();
    await act(async () => images.receive("cover", "visible", blob(), true));
    suspend = true;
    await act(async () => startTransition(() => images.receive("cover", "pending", blob(), true)));
    expect(created).toHaveLength(2); expect(revoked).toEqual([]);
    expect(host.querySelector('[data-selected]')?.getAttribute("src")).toBe(created[0]);
    await act(async () => root!.unmount()); root = null;
    expect(new Set(revoked)).toEqual(new Set(created));
    expect(revoked).toHaveLength(created.length);
  });
});
