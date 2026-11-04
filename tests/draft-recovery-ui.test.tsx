// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryNotice } from "../client/src/RecoveryNotice";
import { useDraftRecovery } from "../client/src/useDraftRecovery";
import { activateDraftRecoveryScope, clearAllDraftRecovery, readDraftRecovery, readDraftRecoveries, removeDraftRecovery } from "../client/src/draftRecovery";
import { usePublicationDraft } from "../client/src/usePublicationDraft";
import { PublicationDraftControls } from "../client/src/PublicationDraftControls";
import { DirtyGuardProvider } from "../client/src/state";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scope = "ui-session-recovery-scope-a";
const key = "item:2:9:source";
const parse = (value: unknown) => typeof value === "string" ? value : null;
let host: HTMLDivElement, root: Root, client: QueryClient;
function Editor({ server = "서버 원고", version = 1 }: { server?: string; version?: number }) {
  const [value, setValue] = useState(server);
  const [saved, setSaved] = useState(server);
  const recovery = useDraftRecovery({ recoveryKey: key, label: "원고", version, serverValue: saved, value, dirty: value !== saved, parse, onRestore: setValue });
  return <><RecoveryNotice recovery={recovery}/><textarea aria-label="원고" value={value} disabled={!!recovery.pending} onChange={event => setValue(event.target.value)} /><button disabled={!!recovery.pending} onClick={() => { recovery.clear(); setSaved(value); }}>서버 저장 성공</button><button onClick={() => { recovery.clear(); setValue(saved); }}>명시적으로 버리기</button></>;
}
function CaptionEditor() {
  const defaults = { destinationIds: [20], timing: "now" as const, scheduledAtKst: "" };
  const draft = usePublicationDraft(3, 9790, { version: 1, captions: { instagram: "서버 캡션", telegram: "" }, options: defaults }, defaults);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (draft.recovery.pending) setOpen(true); }, [draft.recovery.pending]);
  return <details id="caption-drawer" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>게시 준비</summary><textarea aria-label="인스타그램 캡션" value={draft.captions.instagram} onChange={event => draft.setCaptions({ ...draft.captions, instagram: event.target.value })} /><PublicationDraftControls draft={draft} destinations={[{ id: 20, label: "테스트 게시 계정" }]} /></details>;
}
beforeEach(() => {
  localStorage.clear(); activateDraftRecoveryScope(scope);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { user: "operator", recoveryScope: scope, csrf: "DO-NOT-STORE-AUTH-SECRET" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function render(element: React.ReactNode = createElement(Editor)) { await act(async () => root.render(createElement(QueryClientProvider, { client }, element))); }
const input = () => host.querySelector("textarea")!;
async function type(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
const button = (text: string) => [...host.querySelectorAll("button")].find(node => node.textContent === text)!;
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); }
const stored = () => readDraftRecovery(scope, key, parse);

describe("explicit device recovery", () => {
  it("retains a generic publication checkpoint across StrictMode remount and opens the recovery drawer", async () => {
    const editor = () => createElement(StrictMode, null, createElement(DirtyGuardProvider, null, createElement(CaptionEditor)));
    await render(editor()); await type("강제 종료 후 남아야 하는 캡션");
    expect(readDraftRecovery(scope, "item:3:9790:publication", value => value as any)).toMatchObject({ ok: true, value: { value: { captions: { instagram: "강제 종료 후 남아야 하는 캡션" } } } });
    await render(null); await render(editor());
    expect(host.querySelector<HTMLDetailsElement>("#caption-drawer")!.open).toBe(true);
    expect(button("복구본을 편집기에 불러오기")).toBeDefined();
    await click("복구본을 편집기에 불러오기"); expect(input().value).toBe("강제 종료 후 남아야 하는 캡션");
  });
  it("checkpoints the final keystroke before pagehide and restores only by explicit choice after remount", async () => {
    await render();
    await type("첫 문장"); await type("첫 문장\n연속 입력의 마지막 글자🐧");
    window.dispatchEvent(new Event("pagehide"));
    expect(stored()).toMatchObject({ ok: true, value: { value: "첫 문장\n연속 입력의 마지막 글자🐧" } });
    expect(Object.values(localStorage).join("")).not.toContain("DO-NOT-STORE-AUTH-SECRET");
    await render(null); await render();
    expect(input().value).toBe("서버 원고"); expect(input().disabled).toBe(true);
    expect(host.textContent).toContain("서버에 반영하려면 따로 저장");
    await click("복구본을 편집기에 불러오기");
    expect(input().value).toBe("첫 문장\n연속 입력의 마지막 글자🐧");
    expect(host.textContent).toContain("서버에는 아직 저장하지 않았습니다");
    await click("서버 저장 성공"); expect(stored()).toEqual({ ok: true, value: null });
  });
  it("shows both versions and requires comparison before restoring an older device draft", async () => {
    await render(); await type("기기에만 있는 이전 초안"); await render(null);
    await render(createElement(Editor, { server: "다른 창에서 바꾼 최신 서버 원고", version: 2 }));
    expect(input().value).toBe("다른 창에서 바꾼 최신 서버 원고");
    expect(host.textContent).toContain("기기에만 있는 이전 초안");
    expect(button("복구본을 편집기에 불러오기").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("복구본을 편집기에 불러오기");
    expect(input().value).toBe("기기에만 있는 이전 초안");
    expect(stored()).toMatchObject({ ok: true, value: { baseVersion: 2, baseValue: "다른 창에서 바꾼 최신 서버 원고" } });
  });
  it("removes an explicitly discarded checkpoint and does not resurrect it on close", async () => {
    await render(); await type("버릴 초안"); await click("명시적으로 버리기");
    window.dispatchEvent(new Event("pagehide")); await render(null); await render();
    expect(stored()).toEqual({ ok: true, value: null }); expect(input().value).toBe("서버 원고");
    expect(button("복구본을 편집기에 불러오기")).toBeUndefined();
  });
  it("keeps in-memory editing available and warns accurately when browser storage fails", async () => {
    await render();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    await type("저장소가 막혀도 입력은 사라지지 않음");
    expect(input().value).toBe("저장소가 막혀도 입력은 사라지지 않음");
    expect(host.textContent).toContain("이 기기에 임시 보관할 수 없습니다");
    expect(host.textContent).not.toContain("이 기기에 임시 보관됨");
    expect(button("서버 저장 성공").disabled).toBe(false);
  });
  it("stops the old tab from persisting after logout and reveals nothing to a new login", async () => {
    await render(); await type("이전 로그인 기밀 원고");
    await act(async () => clearAllDraftRecovery());
    await type("로그아웃 이후 오래된 탭의 입력");
    expect(host.textContent).toContain("로그인 세션이 바뀌어");
    expect(Object.values(localStorage).join("")).not.toContain("원고");
    await render(null);
    const next = "ui-session-recovery-scope-b";
    await act(async () => { activateDraftRecoveryScope(next); client.setQueryData(["me"], { user: "another-operator", recoveryScope: next }); });
    await render();
    expect(host.textContent).not.toContain("이전 로그인 기밀 원고");
    expect(button("복구본을 편집기에 불러오기")).toBeUndefined();
  });
  it("lets the user discard a pending recovery without first applying it", async () => {
    await render(); await type("불러오지 않을 복구본"); await render(null); await render();
    await click("기기 복구본 버리기");
    expect(input().value).toBe("서버 원고"); expect(input().disabled).toBe(false);
    expect(stored()).toEqual({ ok: true, value: null });
  });
  it("preserves two active tabs independently and recreates a deleted checkpoint without blocking either editor", async () => {
    await render();
    const otherHost = document.createElement("div"); document.body.append(otherHost); const otherRoot = createRoot(otherHost);
    try {
      await act(async () => otherRoot.render(createElement(QueryClientProvider, { client }, createElement(Editor))));
      await type("첫 탭에서 계속 쓰는 초안");
      const otherInput = otherHost.querySelector("textarea")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(otherInput, "두 번째 탭의 별도 초안"); otherInput.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => window.dispatchEvent(new Event("storage")));
      expect(input().disabled).toBe(false); expect(otherInput.disabled).toBe(false);
      let records = readDraftRecoveries(scope, key, parse); if (!records.ok) throw new Error("cannot read records");
      expect(records.value.map(record => record.value).sort()).toEqual(["두 번째 탭의 별도 초안", "첫 탭에서 계속 쓰는 초안"].sort());
      expect(new Set(records.value.map(record => record.slot)).size).toBe(2);
      const removed = records.value.find(record => record.value === "첫 탭에서 계속 쓰는 초안")!;
      removeDraftRecovery(scope, key, removed.token);
      await act(async () => window.dispatchEvent(new Event("storage")));
      records = readDraftRecoveries(scope, key, parse); if (!records.ok) throw new Error("cannot read records");
      expect(records.value.map(record => record.value).sort()).toEqual(["두 번째 탭의 별도 초안", "첫 탭에서 계속 쓰는 초안"].sort());
      expect(input().value).toBe("첫 탭에서 계속 쓰는 초안"); expect(otherInput.value).toBe("두 번째 탭의 별도 초안");
      await click("서버 저장 성공");
      records = readDraftRecoveries(scope, key, parse); if (!records.ok) throw new Error("cannot read records");
      expect(records.value.map(record => record.value)).toEqual(["두 번째 탭의 별도 초안"]);
    } finally { await act(async () => otherRoot.unmount()); otherHost.remove(); }
  });
  it("offers multiple closed-tab copies by stable content key and keeps unselected copies after restoring and saving one", async () => {
    await render();
    const otherHost = document.createElement("div"); document.body.append(otherHost); const otherRoot = createRoot(otherHost);
    try {
      await act(async () => otherRoot.render(createElement(QueryClientProvider, { client }, createElement(Editor))));
      await type("첫 번째 보존 원고");
      await act(async () => { const node = otherHost.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, "두 번째 보존 원고"); node.dispatchEvent(new Event("input", { bubbles: true })); });
    } finally { await act(async () => otherRoot.unmount()); otherHost.remove(); }
    await render(null); await render();
    const select = host.querySelector<HTMLSelectElement>(".draft-recovery select")!;
    expect(select.options).toHaveLength(2); expect(host.textContent).toContain("선택하지 않은 복구본은 그대로 보관됩니다");
    await act(async () => { select.value = [...select.options].find(option => option.textContent?.includes("첫 번째 보존 원고"))!.value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("복구본을 편집기에 불러오기"); expect(input().value).toBe("첫 번째 보존 원고");
    await click("서버 저장 성공");
    const records = readDraftRecoveries(scope, key, parse); if (!records.ok) throw new Error("cannot read records");
    expect(records.value.map(record => record.value)).toEqual(["두 번째 보존 원고"]);
  });
});
