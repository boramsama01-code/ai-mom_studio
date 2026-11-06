// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionsSection } from "../client/src/pages/Connections";
import { SECRET_GROUPS } from "../shared/secretsCatalog";

const mocks = vi.hoisted(() => ({ api: vi.fn(), guard: { setDirty: vi.fn(), confirmLeave: (action: () => void) => action() } }));
vi.mock("../client/src/api", () => ({ api: mocks.api }));
vi.mock("../client/src/state", () => ({ useDirtyGuard: () => mocks.guard }));
vi.mock("wouter", () => ({ useLocation: () => ["/connections", vi.fn()], useSearch: () => "?service=naver" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/secrets") return { groups: SECRET_GROUPS.filter(g => g.id === "naver"), statuses: [
      { key: "NAVER_CLIENT_ID", source: "screen", updatedAt: "2026-11-06T01:40:00Z", valueLength: 10, secret: false, value: null },
      { key: "NAVER_CLIENT_SECRET", source: "screen", updatedAt: "2026-11-06T01:40:00Z", valueLength: 40, secret: true, value: null },
    ], tests: {} };
    if (path === "/secrets/test/naver") return { ok: true, message: "검색 성공" };
    throw new Error(`Unexpected API ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><ConnectionsSection /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const testButton = () => [...host.querySelectorAll("button")].find(button => button.textContent === "연결 확인")!;
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("identifies service key replacements separately from saved login credentials and tests only stored keys", async () => {
  const id = host.querySelector<HTMLInputElement>("#sec-NAVER_CLIENT_ID")!;
  const secret = host.querySelector<HTMLInputElement>("#sec-NAVER_CLIENT_SECRET")!;
  expect(id.name).toBe("integration-setting-naver_client_id");
  expect(id.autocomplete).toBe("off");
  expect(secret.name).toBe("integration-setting-naver_client_secret");
  expect(secret.type).toBe("password");
  expect(secret.autocomplete).toBe("new-password");
  expect(id.form?.getAttribute("autocomplete")).toBe("off");
  expect(host.querySelectorAll('input[autocomplete="username"],input[autocomplete="current-password"],input[type="hidden"]')).toHaveLength(0);
  expect([id, secret].every(input => input.value === "" && input.dataset["1pIgnore"] === "true")).toBe(true);
  await act(async () => testButton().click());
  expect(mocks.api).toHaveBeenCalledWith("/secrets/test/naver", { method: "POST", body: {} });
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(0);
});
it("keeps unsaved input separate, blocks testing edited keys, and permits clearing without saving", async () => {
  const id = host.querySelector<HTMLInputElement>("#sec-NAVER_CLIENT_ID")!;
  await fill(id, "unsaved replacement");
  expect(testButton().disabled).toBe(true);
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  await fill(id, "");
  expect(testButton().disabled).toBe(false);
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
});
