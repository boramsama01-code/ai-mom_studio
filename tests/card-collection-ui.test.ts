// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplatePicker } from "../client/src/pages/Design";
import { CARD_DESIGNS } from "../shared/cardDesigns";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("paired design browser", () => {
  it("browses categories and body pages without changing the selection until Apply", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(createElement(TemplatePicker, { cid: "studio", value: "set:r01", onChange, items: CARD_DESIGNS.map(d => ({ key: `set:${d.id}`, name: d.name, description: d.description, family: d.family, setId: d.id, pageCount: 5, kind: "builtin" })) })));
    expect(host.querySelectorAll(".collection-grid .tpl")).toHaveLength(10);
    const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
    await act(async () => button("뉴스·속보").click());
    await act(async () => button("데일리 페이퍼").click());
    await act(async () => button("본문 4").click());
    expect(host.querySelector(".collection-large")?.getAttribute("src")).toContain("key=set%3An02&page=4");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => button("이 디자인 사용").click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("set:n02");
  });
});
