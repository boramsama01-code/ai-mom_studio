// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsSection } from "../client/src/pages/Connections";
import { SECRET_GROUPS } from "../shared/secretsCatalog";

const mocks = vi.hoisted(() => ({ api: vi.fn(), navigate: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (action: () => void) => action() } }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard }));
vi.mock("wouter", () => ({ useLocation: () => ["/connections", mocks.navigate], useSearch: () => "?service=notion" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type KeyStatus = { key: string; source: "screen" | "none"; updatedAt: string | null; valueLength: number | null; secret: boolean; value: null };
let host: HTMLDivElement, root: Root, client: QueryClient, statuses: KeyStatus[];
let tests: Record<string, { ok: boolean; message: string; at: string }>;
beforeEach(() => {
  vi.clearAllMocks();
  statuses = [
    { key: "NOTION_API_TOKEN", source: "screen", updatedAt: "2026-11-09T00:00:00Z", valueLength: 32, secret: true, value: null },
    { key: "NOTION_CONTENT_DATA_SOURCE_ID", source: "none", updatedAt: null, valueLength: null, secret: false, value: null },
  ];
  tests = {};
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/secrets") return { groups: SECRET_GROUPS.filter(group => ["notion", "canva", "naver"].includes(group.id)), statuses: structuredClone(statuses), tests: structuredClone(tests) };
    if (path === "/secrets/NOTION_API_TOKEN" && options?.method === "PUT") {
      statuses[0] = { ...statuses[0], source: "screen", updatedAt: "2026-11-09T01:00:00Z", valueLength: options.body.value.length };
      return { ok: true };
    }
    if (path === "/secrets/test/notion" && options?.method === "POST") {
      tests.notion = { ok: true, message: "콘텐츠 제작표에 접근할 수 있습니다.", at: "2026-11-09T01:01:00Z" };
      return { ok: true, message: tests.notion.message };
    }
    throw new Error("Unexpected Notion connection request: " + path);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><ConnectionsSection /></QueryClientProvider>)); await settle(); }
function button(name: string) { const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === name); if (!result) throw new Error("Missing button: " + name); return result; }
async function click(name: string) { expect(button(name).disabled).toBe(false); await act(async () => button(name).click()); await settle(); }
async function fillToken(value: string) { const input = host.querySelector<HTMLInputElement>("#sec-NOTION_API_TOKEN")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");

describe("Notion connection settings", () => {
  it("exposes Notion in the service menu and opens its secret token form through the service query", async () => {
    await render();
    const menu = host.querySelector('[aria-label="API 서비스 선택"]')!;
    const notion = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(node => node.querySelector("strong")?.textContent === "Notion")!;
    expect(notion).toBeTruthy(); expect(notion.getAttribute("aria-current")).toBe("page");
    expect(notion.textContent).toContain("원고·사진 동기화"); expect(notion.textContent).toContain("등록됨 · 확인 필요");
    expect(host.querySelector('[aria-label="Notion 설정"]')).not.toBeNull();
    const token = host.querySelector<HTMLInputElement>("#sec-NOTION_API_TOKEN")!;
    expect(token.type).toBe("password"); expect(token.autocomplete).toBe("new-password"); expect(token.value).toBe("");
    expect(token.name).toBe("integration-setting-notion_api_token"); expect(token.dataset["1pIgnore"]).toBe("true");
    await act(async () => notion.click());
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/connections?service=notion"); expect(writes()).toHaveLength(0);
  });

  it("tests the stored Notion connection with an empty POST body and reports the verified result", async () => {
    await render(); await click("연결 확인");
    expect(writes()).toEqual([["/secrets/test/notion", { method: "POST", body: {} }]]);
    expect(host.textContent).toContain("최근 연결 확인 성공"); expect(host.textContent).toContain("콘텐츠 제작표에 접근할 수 있습니다.");
    expect(host.querySelector<HTMLInputElement>("#sec-NOTION_API_TOKEN")!.value).toBe("");
    expect(mocks.api.mock.calls.some(([path]) => /notion\/(import|links)|generate|publish/.test(String(path)))).toBe(false);
  });

  it("blocks checking a missing or unsaved token, then asks for a connection check after the token is saved", async () => {
    statuses[0] = { ...statuses[0], source: "none", updatedAt: null, valueLength: null };
    await render(); expect(button("연결 확인").disabled).toBe(true);
    await act(async () => button("연결 확인").click()); expect(writes()).toHaveLength(0);
    await fillToken("fixture-notion-token");
    expect(button("연결 확인").disabled).toBe(true); expect(button("키 저장").disabled).toBe(false);
    await act(async () => button("연결 확인").click()); expect(writes()).toHaveLength(0);
    await click("키 저장");
    expect(writes()).toEqual([["/secrets/NOTION_API_TOKEN", { method: "PUT", body: { value: "fixture-notion-token" } }]]);
    expect(host.textContent).toContain("키를 저장했습니다. 연결 확인을 실행해 주세요.");
    expect(host.querySelector<HTMLInputElement>("#sec-NOTION_API_TOKEN")!.value).toBe("");
    expect(host.textContent).not.toContain("fixture-notion-token"); expect(host.textContent).not.toContain("최근 연결 확인 성공");
    expect(button("연결 확인").disabled).toBe(false);
  });
});
