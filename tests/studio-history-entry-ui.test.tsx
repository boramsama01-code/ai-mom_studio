// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioHistoryEntry } from "../client/src/StudioHistoryEntry";
import { DirtyGuardProvider, useDirtyGuard } from "../client/src/state";
import { DirtyModal } from "../client/src/ui";
import { ApiError } from "../client/src/api";
import { emptyStudioCard, type StudioCard, type StudioRevision } from "../shared/studio";
const mocks = vi.hoisted(() => ({ api: vi.fn(), search: "tab=history&revision=2" }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", async original => ({ ...await original<object>(), useSearch: () => mocks.search }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient, card: StudioCard, revision: StudioRevision;
function Editor() { const guard = useDirtyGuard(); const [value, setValue] = useState("저장본"); useEffect(() => { guard.setDirty("test-editor", value !== "저장본", async () => { card = { ...card, version: 72 }; setValue("저장본"); return true; }, () => setValue("저장본")); return () => guard.setDirty("test-editor", false); }, [value, guard.setDirty]); return <textarea aria-label="편집 중" value={value} onChange={event => setValue(event.target.value)}/>; }
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider><Editor/><StudioHistoryEntry card={card}/><DirtyModal/></DirtyGuardProvider></QueryClientProvider>)); await settle(); }
async function click(text: string) { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text); expect(node, text).toBeTruthy(); await act(async () => node!.click()); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");
beforeEach(() => {
  vi.clearAllMocks(); mocks.search = "tab=history&revision=2"; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); client.setQueryDefaults(["me"], { gcTime: Infinity }); client.setQueryData(["me"], { user: "editor", recoveryScope: "a" });
  card = { ...emptyStudioCard(), id: 8, sourceItemId: null, title: "현재 작업", version: 70, createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", finishedDeck: { pages: [{ imageId: 50, name: "현재 이미지", altText: "현재 표지" }] } };
  revision = { id: 2, cardId: 8, version: 1, applied: true, createdAt: "2026-11-01T00:00:00Z", provider: null, model: null, instruction: "", snapshot: { ...emptyStudioCard(), title: "60개보다 오래된 정확한 작업", finishedDeck: { pages: [{ imageId: 20, name: "과거 이미지", altText: "과거 표지" }] } } };
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => { if (path === "/studio/cards/8/revisions/2") return structuredClone(revision); if (path === "/studio/cards/8" && !options?.method) return { card: structuredClone(card), revisions: [], jobs: [] }; if (path === "/studio/cards/8/restore") { if (options?.body.version !== card.version) throw new ApiError(409, "버전이 바뀌었습니다"); card = { ...card, ...structuredClone(revision.snapshot), version: card.version + 1 }; return structuredClone(card); } throw new ApiError(404, "기록을 찾을 수 없습니다"); });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
describe("exact Studio history entry", () => {
  it("loads an exact record outside the latest sixty without writes and compares real saved image references", async () => { await render(); expect(host.textContent).toContain("60개보다 오래된 정확한 작업"); expect([...host.querySelectorAll("img")].map(node => node.getAttribute("src"))).toEqual(["/api/studio/images/50", "/api/studio/images/20"]); expect(mocks.api).toHaveBeenCalledWith("/studio/cards/8/revisions/2", expect.objectContaining({ signal: expect.any(AbortSignal) })); expect(writes()).toHaveLength(0); });
  it("rejects malformed and foreign record responses rather than falling back to another record", async () => { mocks.search = "tab=history&revision=-2"; await render(); expect(host.textContent).toContain("버전 주소를 확인"); expect(mocks.api).not.toHaveBeenCalled(); mocks.search = "tab=history&revision=2"; revision.cardId = 9; await render(); expect(host.textContent).toContain("이 콘텐츠의 저장 기록을 확인하지 못했습니다"); expect(host.textContent).not.toContain("60개보다 오래된 정확한 작업"); expect(writes()).toHaveLength(0); });
  it("keeps dirty input mounted, resolves the dirty guard first, and uses the fresh version only after a second confirmation", async () => {
    await render(); const input = host.querySelector("textarea")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "저장 전 입력"); input.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
    await click("이 작업을 새 초안으로 복원"); await click("머무르기"); expect(input.value).toBe("저장 전 입력"); expect(writes()).toHaveLength(0);
    await click("이 작업을 새 초안으로 복원"); await click("저장하고 이동"); expect(card.version).toBe(72); expect(host.querySelector('[aria-label="작업 복원 확인"]')).not.toBeNull(); expect(writes()).toHaveLength(0); expect(host.querySelector("textarea")).toBe(input);
    await click("확인 후 새 초안으로 복원"); expect(writes()).toHaveLength(1); expect(writes()[0][1].body).toEqual({ version: 72, revisionId: 2 }); expect(card.finishedDeck!.pages[0].imageId).toBe(20);
  });
  it("preserves input on stale CAS, never automatically retries, and requires a fresh comparison again", async () => { await render(); await click("이 작업을 새 초안으로 복원"); card = { ...card, version: 71 }; await click("확인 후 새 초안으로 복원"); expect(host.textContent).toContain("입력은 유지됩니다"); expect(writes()).toHaveLength(1); await settle(); expect(writes()).toHaveLength(1); await click("이 작업을 새 초안으로 복원"); await click("확인 후 새 초안으로 복원"); expect(writes()[1][1].body.version).toBe(71); });
  it("compares actual video output, scene timing, subtitles and ratio without claiming approval", async () => { card.videoProject = { version: 1, ratio: "9:16", outputMediaId: 55, coverMediaId: null, audioGuide: "현재 음향", scenes: [{ id: "11111111-1111-4111-8111-111111111111", mediaId: 56, title: "첫 장면", duration: 4, narration: "현재 내레이션", subtitle: "현재 자막", audio: "바람" }] }; revision.snapshot.videoProject = { ...card.videoProject, ratio: "16:9", outputMediaId: 22, scenes: [{ ...card.videoProject.scenes[0], subtitle: "과거 자막", duration: 8 }] }; await render(); expect([...host.querySelectorAll("video")].map(node => node.getAttribute("src"))).toEqual(["/api/studio/media/55", "/api/studio/media/22"]); expect(host.textContent).toContain("과거 자막"); expect(host.textContent).toContain("16:9"); expect(host.textContent).toContain("총 8초"); expect(host.textContent).toContain("게시 승인은 다시 필요"); expect(writes()).toHaveLength(0); });
  it("does not apply a delayed response after the URL target changes", async () => { let release!: (value: StudioRevision) => void; mocks.api.mockImplementation((path: string) => path.endsWith("/2") ? new Promise(resolve => { release = resolve; }) : Promise.reject(new ApiError(404, "다른 기록 없음"))); await render(); mocks.search = "tab=history&revision=999"; await render(); await act(async () => release(structuredClone(revision))); await settle(); expect(host.textContent).not.toContain("60개보다 오래된 정확한 작업"); expect(host.textContent).toContain("다른 기록 없음"); expect(writes()).toHaveLength(0); });
  it("restores a published generic Studio card while leaving canonical source-bound cards to manuscript history", async () => {
    card.sourceItemId = 90; card.sourceOutput = { assetId: 100, channelId: 1, itemId: 90, revisionId: 91, stale: false, pages: [{ id: 100, title: "발행된 결과" }], coverCredit: "" }; await render();
    expect(host.textContent).toContain("60개보다 오래된 정확한 작업"); await click("이 작업을 새 초안으로 복원"); await click("확인 후 새 초안으로 복원"); expect(writes()).toHaveLength(1); expect(card.sourceItemId).toBe(90); expect(card.finishedDeck!.pages[0].imageId).toBe(20);
    card.sourceReference = { itemId: 90, channelId: 1 }; await render(); expect(host.querySelector(".studio-history-entry")).toBeNull();
  });
  it("refetches the exact revision after an in-place actor/recovery scope change", async () => {
    client.setQueryDefaults(["studio", "exact-revision"], { gcTime: Infinity }); await render(); expect(host.textContent).toContain("60개보다 오래된 정확한 작업");
    client.setQueryData(["me"], { user: "other", recoveryScope: "b" }); mocks.api.mockRejectedValue(new ApiError(404, "이 사용자의 기록이 아닙니다")); await render(); expect(host.textContent).not.toContain("60개보다 오래된 정확한 작업"); expect(host.textContent).toContain("이 사용자의 기록이 아닙니다"); expect(writes()).toHaveLength(0);
  });
});
