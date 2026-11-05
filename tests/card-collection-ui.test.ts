// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplatePicker } from "../client/src/pages/Design";
import { cardDesignOptions } from "../shared/cardDesigns";
import { templateCatalogOptions } from "../shared/templateCatalog";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("paired design browser", () => {
  it("applies an existing set's colour immediately and keeps the body page being inspected", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const changed = vi.fn();
    function Controlled() {
      const [value, setValue] = useState("set:r01");
      return createElement(TemplatePicker, { cid: 1, value, items: cardDesignOptions(), onChange: (key, item) => { changed(key, item); setValue(key); } });
    }
    await act(async () => root.render(createElement(Controlled)));
    const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
    await act(async () => button("본문 3").click());
    await act(async () => button("Aa페이퍼 블루").click());
    expect(changed).toHaveBeenCalledExactlyOnceWith("set:r01-blue", expect.objectContaining({ key: "set:r01-blue", templateKey: "set:r01-blue" }));
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=set%3Ar01-blue&page=3");
    expect(host.querySelector(".collection-color[aria-pressed=true]")?.textContent).toContain("페이퍼 블루");
    expect(button("현재 사용 중인 디자인").disabled).toBe(true);
  });
  it("does not apply palette changes while the editing action is disabled", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(createElement(TemplatePicker, { cid: 1, value: "set:r01", onChange, items: cardDesignOptions(), disabled: true })));
    const blue = [...host.querySelectorAll<HTMLButtonElement>(".collection-colors button")].find(button => button.textContent?.includes("페이퍼 블루"))!;
    expect(blue.disabled).toBe(true);
    await act(async () => blue.click());
    expect(onChange).not.toHaveBeenCalled();
  });
  it("browses categories and body pages without changing the selection until Apply", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(createElement(TemplatePicker, { cid: "studio", value: "set:r01", onChange, items: cardDesignOptions() })));
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(21);
    const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
    await act(async () => button("뉴스·속보").click());
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(10);
    await act(async () => button("알리고당 브리프").click());
    expect(host.querySelectorAll(".collection-colors button")).toHaveLength(6);
    await act(async () => button("코발트").click());
    await act(async () => button("본문 4").click());
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=set%3An04-cobalt&page=4");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => button("이 디자인 사용").click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("set:n04-cobalt", expect.objectContaining({ templateKey: "set:n04-cobalt", format: "standard", cardCopyVersion: 1, previewPageCount: 5, pageCountMode: "variable" }));
  });
  it("restores a saved palette and marks its layout as applied", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(createElement(TemplatePicker, { cid: "studio", value: "set:n01-yellow", onChange: vi.fn(), items: cardDesignOptions() })));
    expect(host.querySelector(".collection-filter[aria-pressed=true]")?.textContent).toContain("전체");
    expect(host.querySelector(".collection-color[aria-pressed=true]")?.textContent).toContain("시그널 옐로");
    expect(host.querySelector(".collection-grid .tpl[aria-pressed=true] .collection-applied")?.textContent).toBe("사용 중");
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=set%3An01-yellow");
    expect(host.textContent).not.toContain("이전 디자인");
  });
  it("shows all 37 sets, searches the completed styles and passes the eight-page contract only on Apply", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(createElement(TemplatePicker, { cid: 1, value: "set:r01", onChange, items: templateCatalogOptions() })));
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(37);
    expect(host.querySelector(".collection-filter[aria-pressed=true]")?.textContent).toBe("전체37");
    const length = host.querySelector(".collection-length select") as HTMLSelectElement;
    await act(async () => { length.value = "8"; length.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(16);
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "BANG BANG");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(1);
    expect(host.querySelector(".collection-cover img")?.getAttribute("src")).toContain("/cardnews14/bang-bang-cover.webp");
    const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
    await act(async () => button("8장 전체보기").click());
    expect(host.querySelector(".collection-overview")?.getAttribute("src")).toContain("/cardnews14/bang-bang.webp");
    await act(async () => button("한 장씩").click());
    await act(async () => button("닫는 표지").click());
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=cardnews14-bang-bang-v1&page=7");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => button("이 디자인 사용").click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("cardnews14-bang-bang-v1", expect.objectContaining({ templateKey: "cardnews14-bang-bang-v1", cardCopyVersion: 2, format: "family_dialogue_8", pageCountMode: "fixed", previewPageCount: 8 }));
  });
});
