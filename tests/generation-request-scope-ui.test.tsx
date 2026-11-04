// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGenerationRequest } from "../client/src/useGenerationRequest";
import { ApiError } from "../client/src/api";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, current: ReturnType<typeof useGenerationRequest>;
function Harness({ id }: { id: number }) { current = useGenerationRequest(2, id, "card-render"); return <span>{current.unresolved ? "확인 필요" : "준비"}</span>; }
beforeEach(() => { mocks.api.mockReset(); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(id: number) { await act(async () => root.render(<Harness id={id} />)); }

it("keeps an uncertain image request scoped to its content when a route changes", async () => {
  mocks.api.mockRejectedValueOnce(new ApiError(0, "이미지 응답 유실")).mockResolvedValue({ id: 71 });
  await render(9);
  await act(async () => { await expect(current.run("/channels/2/items/9/card", { version: 1, coverMode: "ai" })).rejects.toThrow("이미지 응답 유실"); });
  expect(host.textContent).toBe("확인 필요");
  const original = mocks.api.mock.calls[0][1].body;
  await render(10); expect(host.textContent).toBe("준비");
  await act(async () => { await current.run("/channels/2/items/10/card", { version: 3, coverMode: "ai" }); });
  expect(mocks.api.mock.calls[1][0]).toBe("/channels/2/items/10/card");
  expect(mocks.api.mock.calls[1][1].body.requestId).not.toBe(original.requestId);
  await render(9); expect(host.textContent).toBe("확인 필요");
  await act(async () => { await current.run("/channels/2/items/9/card", { version: 999 }); });
  expect(mocks.api.mock.calls[2]).toEqual(["/channels/2/items/9/card", { method: "POST", body: original }]);
  expect(host.textContent).toBe("준비");
});

it("does not let a late response from the previous content replace a new active request", async () => {
  let finish!: (value: unknown) => void;
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new ApiError(0, "두 번째 응답 유실")).mockResolvedValue({ id: 72 });
  await render(9);
  let pending!: Promise<unknown>;
  await act(async () => { pending = current.run("/channels/2/items/9/card", { version: 1 }); });
  await render(10);
  await act(async () => { await expect(current.run("/channels/2/items/10/card", { version: 3 })).rejects.toThrow(); });
  const second = mocks.api.mock.calls[1][1].body;
  await act(async () => { finish({ id: 71 }); await pending; });
  expect(host.textContent).toBe("확인 필요");
  await act(async () => { await current.run("/channels/2/items/10/card", {}); });
  expect(mocks.api.mock.calls[2]).toEqual(["/channels/2/items/10/card", { method: "POST", body: second }]);
  await render(9); expect(host.textContent).toBe("준비");
});
