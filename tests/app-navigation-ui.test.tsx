// @vitest-environment jsdom
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn(), app: undefined as unknown, path: "/", navigate: vi.fn(), toast: vi.fn(), confirmLeave: vi.fn((fn: () => void) => fn()) }));
vi.mock("react-dom/client", async original => {
  const actual = await original<typeof import("react-dom/client")>();
  return { ...actual, createRoot: (host: Element | Document | DocumentFragment | null) => host ? actual.createRoot(host) : { render: (app: unknown) => { mocks.app = app; } } };
});
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.path, mocks.navigate], Route: () => null, Switch: () => null, Redirect: () => null }));
vi.mock("../client/src/GuardedRouter", () => ({ GuardedRouter: ({ children }: { children: ReactNode }) => children }));
vi.mock("../client/src/state", () => ({
  ChannelProvider: ({ children }: { children: ReactNode }) => children,
  DirtyGuardProvider: ({ children }: { children: ReactNode }) => children,
  useChannel: () => ({ selected: 1 }),
  useDirtyGuard: () => ({ pending: null, confirmLeave: mocks.confirmLeave }),
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
    const more = nav.querySelector('a[href="/today"]')!.closest("details")!;
    const settings = nav.querySelector('a[href="/instagram"]')!.closest("details")!;
    expect(more.open).toBe(false);
    expect(more.querySelector("summary")?.textContent).toContain("더 보기");
    expect(more.querySelector('a[href="/today"]')).not.toBeNull();
    expect(settings.open).toBe(false);
    expect(settings.querySelector("summary")?.textContent).toContain("설정");
    expect([...settings.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/instagram", "/rules", "/design", "/connections", "/settings", "/account", "/runs"]);
    expect(nav.querySelector('a[href="/drafts"]')).toBeNull();
    expect(nav.querySelector('a[href="/inbox"] .nav-count')?.getAttribute("aria-label")).toBe("검토 대기 7건");

    await act(async () => more.querySelector("summary")!.click());
    expect(more.open).toBe(true);
    await act(async () => more.querySelector<HTMLAnchorElement>('a[href="/today"]')!.click());
    expect(mocks.navigate).toHaveBeenLastCalledWith("/today");

    await renderAt("/today");
    expect(host.querySelector<HTMLAnchorElement>('.sidebar a[href="/today"]')!.closest("details")?.open).toBe(true);
    expect(host.querySelector('.sidebar a[href="/today"]')?.getAttribute("aria-current")).toBe("page");
    await renderAt("/instagram");
    expect(host.querySelector<HTMLAnchorElement>('.sidebar a[href="/instagram"]')!.closest("details")?.open).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});


it("로그아웃도 저장 경계를 거치며 승인 전에는 세션을 종료하지 않는다", async () => {
  mocks.path = "/studio/11";
  mocks.confirmLeave.mockImplementation(() => {});
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(cloneElement(mocks.app as ReactElement, { key: "logout-guard" })));
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "로그아웃")!.click());
    expect(mocks.confirmLeave).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.api.mock.calls.some(([path]) => path === "/auth/logout")).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
    mocks.confirmLeave.mockImplementation(fn => fn());
  }
});
