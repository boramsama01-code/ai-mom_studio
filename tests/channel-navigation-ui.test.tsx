// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelProvider, DirtyGuardProvider, useChannel, useDirtyGuard } from "../client/src/state";
import { GlobalChannelSelect } from "../client/src/GlobalChannelSelect";
import { DirtyModal } from "../client/src/ui";

const mocks = vi.hoisted(() => ({ api: vi.fn(), path: "/", navigate: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.path, mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const channels = [
  { id: 1, slug: "penguin", name: "우주펭귄상회", active: true, accentColor: "#287b76" },
  { id: 2, slug: "fryday", name: "fryday", active: true, accentColor: "#b47829" },
  { id: 3, slug: "archived", name: "보관 채널", active: false, accentColor: "#888888" },
];
let host: HTMLDivElement, root: Root, client: QueryClient;
const save = vi.fn<() => Promise<boolean>>(), leave = vi.fn();

function Harness() {
  const { selected } = useChannel();
  const guard = useDirtyGuard();
  const [page, setPage] = useState("내 콘텐츠");
  return <>
    <GlobalChannelSelect />
    <output data-testid="selected">{selected}</output><h1>{page}</h1>
    <button onClick={() => setPage("수집함")}>다른 화면</button>
    <button onClick={() => guard.setDirty("editor", true, save)}>미저장 입력</button>
    <button onClick={() => guard.confirmLeave(leave)}>작업 나가기</button>
    <DirtyModal />
  </>;
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider><ChannelProvider><Harness /></ChannelProvider></DirtyGuardProvider></QueryClientProvider>));
}
function selector() { return host.querySelector<HTMLSelectElement>('[aria-label="보기 채널"]')!; }
async function choose(value: string) {
  await act(async () => { selector().value = value; selector().dispatchEvent(new Event("change", { bubbles: true })); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
  await act(async () => button.click());
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.path = "/";
  save.mockResolvedValue(true);
  mocks.api.mockResolvedValue(channels);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["channels"], channels);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });

describe("one persistent channel scope", () => {
  it("starts with all channels, keeps the choice across screens and reloads, and omits archived channels", async () => {
    await render();
    expect(selector().value).toBe("all");
    expect([...selector().options].map(option => option.text)).toEqual(["모든 채널", "우주펭귄상회", "fryday"]);
    await choose("2"); await click("다른 화면");
    expect(host.querySelector("h1")?.textContent).toBe("수집함");
    expect(selector().value).toBe("2");
    expect(localStorage.getItem("spacepenguin.channel")).toBe("2");
    await act(async () => root.unmount()); root = createRoot(host); await render();
    expect(selector().value).toBe("2");
  });

  it("falls back to all for a removed channel and migrates a valid older preference", async () => {
    localStorage.setItem("spacepenguin.channel", "999"); await render();
    expect(selector().value).toBe("all");
    await act(async () => root.unmount());
    localStorage.removeItem("spacepenguin.channel"); localStorage.setItem("aimom.channel", "2");
    root = createRoot(host); await render();
    expect(selector().value).toBe("2");
    expect(localStorage.getItem("aimom.channel")).toBeNull();
    expect(localStorage.getItem("spacepenguin.channel")).toBe("2");
  });

  it("keeps the current scope when unsaved changes are cancelled or saving fails", async () => {
    await render(); await click("미저장 입력"); await choose("2");
    expect(selector().value).toBe("all");
    expect(localStorage.getItem("spacepenguin.channel")).toBeNull();
    await click("취소");
    expect(selector().value).toBe("all");
    save.mockResolvedValueOnce(false); await choose("2"); await click("저장하고 이동");
    expect(save).toHaveBeenCalledOnce(); expect(selector().value).toBe("all");
    await choose("2"); await click("저장하고 이동");
    expect(selector().value).toBe("2");
  });

  it("does not retarget or discard a detail editor when its list scope changes", async () => {
    mocks.path = "/studio/11";
    await render(); await click("미저장 입력"); await choose("2");
    expect(selector().value).toBe("2");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    await click("작업 나가기");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("저장하지 않은 변경");
    expect(leave).not.toHaveBeenCalled();
    await click("취소");
    expect(leave).not.toHaveBeenCalled();
  });
});
