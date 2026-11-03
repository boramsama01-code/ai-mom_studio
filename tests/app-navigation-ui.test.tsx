// @vitest-environment jsdom
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn(), app: undefined as unknown, path: "/", navigate: vi.fn(), toast: vi.fn() }));
vi.mock("react-dom/client", async original => {
  const actual = await original<typeof import("react-dom/client")>();
  return { ...actual, createRoot: (host: Element | Document | DocumentFragment | null) => host ? actual.createRoot(host) : { render: (app: unknown) => { mocks.app = app; } } };
});
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.path, mocks.navigate], Route: () => null, Switch: () => null, Redirect: () => null }));
vi.mock("../client/src/state", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => children,
  DirtyGuardProvider: ({ children }: { children: ReactNode }) => children,
  useChannel: () => ({ selected: 1 }),
  useDirtyGuard: () => ({ pending: null, confirmLeave: (fn: () => void) => fn() }),
  useMe: () => ({ data: { user: "editor", demo: false }, isLoading: false, error: null }),
}));
vi.mock("../client/src/toast", () => ({ ToastProvider: ({ children }: { children: ReactNode }) => children, useToast: () => mocks.toast }));
vi.mock("../client/src/GlobalChannelSelect", () => ({ GlobalChannelSelect: () => null }));
vi.mock("../client/src/palette", () => ({ CommandPalette: () => null }));
import "../client/src/main";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("주요 메뉴를 세 개로 유지하고 보조·설정 경로를 접으며 준비된 초안 수를 전체 초안 badge로 표시하지 않는다", async () => {
  mocks.api.mockImplementation(async (url: string) => {
    if (url === "/status") return { globalStop: false };
    if (url === "/channels/1/today") return { counts: { pendingReview: 7, draftsReady: 99 } };
    throw new Error(`Unexpected request: ${url}`);
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const app = mocks.app as ReactElement;
  const renderAt = async (path: string) => {
    mocks.path = path;
    await act(async () => root.render(cloneElement(app, { key: path })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  };
  try {
    await renderAt("/");
    const nav = host.querySelector(".sidebar .nav")!;
    expect([...nav.querySelectorAll(":scope > div.nav-group a")].map(a => a.getAttribute("href"))).toEqual(["/", "/inbox", "/publish"]);
    expect([...host.querySelectorAll(".mobile-nav a")].map(a => a.getAttribute("href"))).toEqual(["/", "/inbox", "/publish"]);
    const more = nav.querySelector('a[href="/drafts"]')!.closest("details")!;
    const settings = nav.querySelector('a[href="/instagram"]')!.closest("details")!;
    expect(more.open).toBe(false);
    expect(more.querySelector("summary")?.textContent).toContain("더 보기");
    expect(more.querySelector('a[href="/today"]')).not.toBeNull();
    expect(settings.open).toBe(false);
    expect(settings.querySelector("summary")?.textContent).toContain("설정");
    expect([...settings.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/instagram", "/rules", "/design", "/connections", "/settings", "/account", "/runs"]);
    expect(nav.querySelector('a[href="/drafts"] .nav-count')).toBeNull();
    expect(nav.querySelector('a[href="/inbox"] .nav-count')?.getAttribute("aria-label")).toBe("검토 대기 7건");

    await act(async () => more.querySelector("summary")!.click());
    expect(more.open).toBe(true);
    await act(async () => more.querySelector<HTMLAnchorElement>('a[href="/drafts"]')!.click());
    expect(mocks.navigate).toHaveBeenLastCalledWith("/drafts");

    await renderAt("/drafts");
    expect(host.querySelector<HTMLAnchorElement>('.sidebar a[href="/drafts"]')!.closest("details")?.open).toBe(true);
    expect(host.querySelector('.sidebar a[href="/drafts"]')?.getAttribute("aria-current")).toBe("page");
    await renderAt("/instagram");
    expect(host.querySelector<HTMLAnchorElement>('.sidebar a[href="/instagram"]')!.closest("details")?.open).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
