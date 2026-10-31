// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplatePicker } from "../client/src/pages/Design";
import { cardDesignOptions } from "../shared/cardDesigns";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("paired design browser", () => {
  it("browses categories and body pages without changing the selection until Apply", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(createElement(TemplatePicker, { cid: "studio", value: "set:r01", onChange, items: cardDesignOptions() })));
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(2);
    const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
    await act(async () => button("뉴스·속보").click());
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(3);
    await act(async () => button("와이 브리프").click());
    expect(host.querySelectorAll(".collection-colors button")).toHaveLength(6);
    await act(async () => button("코발트").click());
    await act(async () => button("본문 4").click());
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=set%3An04-cobalt&page=4");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => button("이 디자인 사용").click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("set:n04-cobalt");
  });
  it("restores a saved palette and marks its layout as applied", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(createElement(TemplatePicker, { cid: "studio", value: "set:n01-yellow", onChange: vi.fn(), items: cardDesignOptions() })));
    expect(host.querySelector(".collection-filter[aria-pressed=true]")?.textContent).toContain("뉴스·속보");
    expect(host.querySelector(".collection-color[aria-pressed=true]")?.textContent).toContain("시그널 옐로");
    expect(host.querySelector(".collection-grid .tpl[aria-pressed=true] .collection-applied")?.textContent).toBe("사용 중");
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=set%3An01-yellow");
    expect(host.textContent).not.toContain("이전 디자인");
  });
});
