// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CoverCropPreview } from "../client/src/CoverCropPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); });

describe("crop checks use the actual rendered cover", () => {
  it("switches only the view, keeps the original bytes, and displays optional guides", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(createElement(CoverCropPreview, { src: "blob:rendered-cover", alt: "내 표지" })));
    const image = host.querySelector("img")!;
    expect(host.querySelector("figure")?.dataset.cropMode).toBe("full");
    expect(host.querySelector(".cover-crop-guide")).toBeNull();
    for (const [label, mode, ratio] of [["정방형 1:1", "square", "1080 / 1080"], ["프로필 3:4", "profile", "1012.5 / 1350"], ["전체 4:5", "full", "1080 / 1350"]]) {
      const button = [...host.querySelectorAll("button")].find(node => node.textContent === label)!;
      await act(async () => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector("figure")?.dataset.cropMode).toBe(mode);
      expect(host.querySelector("figure")?.style.aspectRatio).toBe(ratio);
      expect(host.querySelector("img")).toBe(image);
      expect(image.getAttribute("src")).toBe("blob:rendered-cover");
    }
    await act(async () => host!.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    expect(host.querySelector(".cover-crop-guide")?.getAttribute("aria-hidden")).toBe("true");
    expect(parseFloat(host.querySelector<HTMLElement>(".cover-crop-guide")!.style.top)).toBeCloseTo(14);
    expect(host.textContent).toContain("출력 파일에 반영되지 않습니다");
  });
});
