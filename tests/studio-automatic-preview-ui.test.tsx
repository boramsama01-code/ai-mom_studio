// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioExport } from "../client/src/pages/StudioExport";
import { studioContentSchema, type StudioCard } from "../shared/studio";
const mocks = vi.hoisted(() => ({ api: vi.fn(), save: vi.fn(), change: vi.fn(), toast: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/pages/StudioPublish", () => ({ StudioPublish: () => null }));
vi.mock("../client/src/pages/Design", () => ({ TemplatePicker: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, card: StudioCard;
beforeEach(() => {
  vi.clearAllMocks();
  card = { ...studioContentSchema.parse({ title: "그림이 있는 카드뉴스", format: "카드뉴스", characters: [], panels: Array.from({ length: 4 }, (_, index) => ({ scene: "장면", dialogue: "본문", imageId: 31 + index })) }), id: 4, version: 7, sourceItemId: null, createdAt: "2026-11-04", updatedAt: "2026-11-04" };
  mocks.save.mockImplementation(async () => card);
  mocks.api.mockImplementation(async (path: string) => { if (path === "/studio/export-check") return { errors: [], warnings: [], pageCount: 6 }; throw new Error(`Unexpected preview request ${path}`); });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(form = card, dirty = false) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(StudioExport, { form, base: card, dirty, busy: false, save: mocks.save, change: mocks.change }))));
  for (let index = 0; index < 5; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
const output = () => host.querySelector<HTMLImageElement>(".studio-output-image img")!;
describe("automatic saved output preview", () => {
  it("opens a saved-version preview without saving or calling AI and labels every carousel page", async () => {
    await render();
    expect(output().getAttribute("src")).toContain("/studio/cards/4/export.png?version=7&page=0");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.every(([path]) => path === "/studio/export-check")).toBe(true);
    const pages = host.querySelectorAll<HTMLButtonElement>('.studio-output-pages button');
    expect([...pages].map(page => page.querySelector("strong")?.textContent)).toEqual(["표지", "본문 1", "본문 2", "본문 3", "본문 4", "마무리"]);
    expect(pages[3].querySelector("img")?.getAttribute("src")).toBe("/api/studio/images/33");
    await act(async () => pages[3].click());
    expect(output().getAttribute("src")).toContain("version=7&page=3");
    expect(pages[3].getAttribute("aria-pressed")).toBe("true");
  });
  it("marks the old preview while typing and automatically refreshes only after a newer saved version", async () => {
    await render();
    await render({ ...card, title: "아직 저장하지 않은 제목" }, true);
    expect(host.textContent).toContain("현재 입력은 아직 반영되지 않았습니다");
    expect(output().getAttribute("src")).toContain("version=7");
    expect(mocks.save).not.toHaveBeenCalled();
    card = { ...card, version: 8, title: "저장한 새 제목" };
    await render();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
    await render();
    expect(output().getAttribute("src")).toContain("version=8");
    expect(host.textContent).toContain("현재 원고와 그림을 반영했습니다");
  });
  it("retries only the preview read after an image load failure", async () => {
    await render(); const initial = output().src;
    await act(async () => output().dispatchEvent(new Event("error", { bubbles: true })));
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "미리보기 다시 불러오기")!;
    expect(host.textContent).toContain("저장한 원고와 그림은 유지됩니다");
    await act(async () => retry.click());
    expect(output().src).not.toBe(initial);
    expect(output().src).toContain("attempt=1");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
