// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { InboxPage } from "../client/src/pages/Inbox";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../client/src/api", async orig => ({ ...await orig<object>(), api: mocks.api }));
vi.mock("wouter", async orig => ({ ...await orig<object>(), useLocation: () => ["/inbox", vi.fn()], useSearch: () => `collectedOn=2026-11-01&subcategory=${encodeURIComponent("감자튀김 맛집")}` }));
vi.mock("../client/src/state", () => {
  const ch = { id: 5, slug: "fryday", name: "fryday", contentType: "manual", active: true };
  return { useChannel: () => ({ current: ch, selected: ch.id, channels: [ch], allChannels: [ch], select: vi.fn() }), useDirtyGuard: () => ({ confirmLeave: (fn: () => void) => fn() }) };
});
vi.mock("../client/src/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("../client/src/pages/InboxKeywords", () => ({ InboxKeywords: () => null }));
vi.mock("../client/src/collection", () => ({ CollectionPanel: () => null, useKstToday: () => "2026-11-01" }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("fryday 브리핑 링크는 아이디어 대신 선택한 날짜와 소분류의 실제 수집 자료를 연다", async () => {
  mocks.api.mockResolvedValue({ total: 0, items: [], page: 1, pageSize: 20 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><InboxPage /></QueryClientProvider>); });
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    const url = new URL(mocks.api.mock.calls[0][0], "https://example.test");
    expect(url.searchParams.get("origin")).toBe("scrap");
    expect(url.searchParams.get("collectedOn")).toBe("2026-11-01");
    expect(url.searchParams.get("subcategory")).toBe("감자튀김 맛집");
    expect((host.querySelector('[aria-label="소분류 필터"]') as HTMLSelectElement).value).toBe("감자튀김 맛집");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
