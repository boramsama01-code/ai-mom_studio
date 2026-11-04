// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelProvider, DirtyGuardProvider } from "../client/src/state";
import { ChannelSettingsPage } from "../client/src/pages/ChannelSettings";
import { GlobalChannelSelect } from "../client/src/GlobalChannelSelect";
import { CategorySelect } from "../client/src/CategorySelect";
import { DirtyModal } from "../client/src/ui";
import { ApiError } from "../client/src/api";
import type { Channel } from "../shared/schema";

const mocks = vi.hoisted(() => ({ api: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => ["/settings", mocks.navigate] }));
vi.mock("../client/src/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../client/src/pages/Studio", () => ({ StudioImport: () => null }));
vi.mock("../client/src/pages/InstagramAccounts", () => ({ InstagramAccounts: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient, channels: Channel[], createError: boolean;
const makeChannel = (id: number, name: string, slug = `brand-${id}`): Channel => ({
  id, name, slug, description: "채널 소개", audience: "일반 독자", contentType: "current_dialogue", categories: ["행사", "인터뷰"], aiSettings: null, accentColor: "#51635A", active: true,
  editorialGuide: "확인한 자료를 사용합니다.", cardTemplate: "builtin:classic", canvaBrandTemplateId: null,
  budget: { naverCallsPerRun: 3, resultsPerRun: 20, fetchTargetsPerRun: 3, fetchCallsPerRun: 3, llmCallsPerRun: 2, dailyPublishLimit: 0 },
  version: 1, createdAt: new Date("2026-11-04"), updatedAt: new Date("2026-11-04"),
});
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); createError = false;
  channels = [makeChannel(1, "첫 번째 채널"), makeChannel(2, "다른 채널")];
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (path === "/channels" && options?.method === "POST") {
      if (createError) throw new ApiError(503, "추가하지 못했습니다. 잠시 후 다시 시도하세요.");
      const created = { ...makeChannel(9, options.body.name, options.body.slug ?? "generated-channel-9"), ...structuredClone(options.body) };
      channels.push(created); return structuredClone(created);
    }
    if (path === "/channels") return structuredClone(channels);
    if (/^\/channels\/\d+$/.test(path) && options?.method === "PATCH") {
      const id = Number(path.split("/").at(-1)), row = channels.find(ch => ch.id === id)!;
      if (row.version !== options.body.version) throw new ApiError(409, "다른 곳에서 먼저 수정되었습니다.", { current: row });
      const saved = { ...row, ...structuredClone(options.body), version: row.version + 1 }; channels = channels.map(ch => ch.id === id ? saved : ch); return structuredClone(saved);
    }
    if (/\/destinations$/.test(path)) return { items: [], defaults: { telegram_channel: {} } };
    if (path === "/status") return { integrations: { flags: {} }, globalStop: false, workerConnected: true };
    throw new Error(`Unexpected test API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["channels"], structuredClone(channels));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function render(element: ReactNode = <><GlobalChannelSelect /><ChannelSettingsPage /><DirtyModal /></>) { await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider><ChannelProvider>{element}</ChannelProvider></DirtyGuardProvider></QueryClientProvider>)); await settle(); }
function button(text: string) { const value = [...host.querySelectorAll("button")].find(node => node.textContent === text); if (!value) throw new Error(`Missing button: ${text}`); return value; }
async function click(text: string) { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()); await settle(); }
function field(text: string) { const label = [...host.querySelectorAll("label")].find(node => node.textContent?.trim().startsWith(text)); if (!label) throw new Error(`Missing field: ${text}`); return label.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")!; }
async function fill(text: string, value: string) { const node = field(text); await act(async () => { const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); await settle(); }
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
async function editFirst() { await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="첫 번째 채널 수정"]')!.click()); await settle(); }

describe("manual channel administration", () => {
  it("creates a usable channel with an automatic-content default, chosen taxonomy and optional stable address", async () => {
    await render(); await click("＋ 새 채널 추가");
    expect(field("주로 만들 콘텐츠").value).toBe("current_dialogue");
    await fill("채널명", "새 동네 소식"); await fill("한 줄 소개", "직접 운영하는 지역 채널");
    await fill("소분류", "동네 소식\n방문 후기"); await fill("채널 주소", "local-news");
    await click("채널 추가");
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].body).toMatchObject({ name: "새 동네 소식", contentType: "current_dialogue", categories: ["동네 소식", "방문 후기"], slug: "local-news", audience: "일반 독자" });
    expect(host.textContent).toContain("채널을 추가했습니다");
    expect([...host.querySelector<HTMLSelectElement>('[aria-label="보기 채널"]')!.options].map(option => option.text)).toContain("새 동네 소식");
    await click("이 채널 콘텐츠 보기"); expect(mocks.navigate).toHaveBeenCalledWith("/");
    expect(localStorage.getItem("spacepenguin.channel")).toBe("9");
  });
  it("keeps entered settings after a failed create and catches duplicate categories before sending", async () => {
    await render(); await click("＋ 새 채널 추가"); await fill("채널명", "남길 이름"); await fill("소분류", "중복\n중복");
    await click("채널 추가"); expect(writes()).toHaveLength(0); expect(host.textContent).toContain("소분류 이름이 중복");
    await fill("소분류", "행사"); createError = true; await click("채널 추가");
    expect(field("채널명").value).toBe("남길 이름"); expect(field("소분류").value).toBe("행사");
    expect(host.textContent).toContain("추가하지 못했습니다");
  });
  it("saves a new channel before an approved channel switch and preserves the form when cancelled", async () => {
    await render(); await click("＋ 새 채널 추가"); await fill("채널명", "떠나기 전에 추가할 채널");
    await fill("보기 채널", "2"); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click("머무르기"); expect(field("채널명").value).toBe("떠나기 전에 추가할 채널"); expect(writes()).toEqual([]);
    await fill("보기 채널", "2"); await click("저장하고 이동");
    expect(writes().filter(([path]) => path === "/channels")).toHaveLength(1);
    expect(channels.some(ch => ch.name === "떠나기 전에 추가할 채널")).toBe(true);
    expect(localStorage.getItem("spacepenguin.channel")).toBe("2"); expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
  it("persists edited channel settings with CAS and does not silently use a newer server version", async () => {
    await render(); await editFirst(); await fill("채널명", "내가 수정한 채널명"); await fill("소분류", "행사\n인터뷰\n새 분류");
    channels[0] = { ...channels[0], version: 2, name: "다른 창의 채널명", description: "동시에 바뀐 소개" };
    await click("채널 설정 저장");
    expect(field("채널명").value).toBe("내가 수정한 채널명"); expect(host.textContent).toContain("다른 곳에서 바꾼 채널 설정");
    expect(button("채널 설정 저장").disabled).toBe(true); expect(writes()[0][1].body.version).toBe(1);
    await click("현재 입력으로 다시 저장");
    expect(writes()[1][1].body.version).toBe(2); expect(channels[0].name).toBe("내가 수정한 채널명");
    expect(channels[0].categories).toEqual(["행사", "인터뷰", "새 분류"]); expect(host.textContent).toContain("채널 설정 저장됨");
  });
  it("offers independent role defaults, clears incompatible model overrides and saves only the edited channel", async () => {
    await render(); await editFirst();
    expect(field("기사 요약 AI").value).toBe("gemini");
    expect(field("카드뉴스 문구 AI").value).toBe("openai");
    expect(field("이미지 제작 AI").value).toBe("openai");
    expect(writes()).toHaveLength(0);
    await fill("카드뉴스 문구 모델 ID", "gpt-my-editor");
    await fill("카드뉴스 문구 AI", "anthropic");
    expect(field("카드뉴스 문구 모델 ID").value).toBe("");
    await fill("카드뉴스 문구 모델 ID", "claude-editor");
    await fill("이미지 제작 모델 ID", "gpt-image-illustration");
    await click("채널 설정 저장");
    expect(writes()[0][1].body.aiSettings).toEqual({ summary: { provider: "gemini", model: "" }, copy: { provider: "anthropic", model: "claude-editor" }, image: { provider: "openai", model: "gpt-image-illustration" } });
    expect(channels[1].aiSettings).toBeNull();
    expect(host.textContent).toContain("채널 설정 저장됨");
  });
  it("keeps an invalid model input without sending it and compares conflicting AI settings", async () => {
    await render(); await editFirst();
    await fill("기사 요약 모델 ID", "gpt-wrong-provider");
    await click("채널 설정 저장");
    expect(writes()).toHaveLength(0); expect(field("기사 요약 모델 ID").value).toBe("gpt-wrong-provider");
    expect(host.textContent).toContain("선택한 AI의 텍스트 모델");
    await fill("기사 요약 모델 ID", "gemini-my-summary");
    channels[0] = { ...channels[0], version: 2, aiSettings: { summary: { provider: "gemini", model: "gemini-other-window" }, copy: { provider: "openai", model: "" }, image: { provider: "openai", model: "" } } };
    await click("채널 설정 저장");
    expect(field("기사 요약 모델 ID").value).toBe("gemini-my-summary");
    expect(host.textContent).toContain("gemini-other-window");
    expect(button("채널 설정 저장").disabled).toBe(true);
    await click("현재 입력으로 다시 저장");
    expect(channels[0].aiSettings?.summary.model).toBe("gemini-my-summary");
  });
  it("archives only after edits are resolved and allows restoring the same channel", async () => {
    await render(); await editFirst(); await fill("설명", "아직 저장하지 않은 소개");
    expect(button("이 채널 보관하기").disabled).toBe(true); await click("수정 취소");
    await click("이 채널 보관하기"); expect(writes()).toEqual([]); await click("보관하기");
    expect(writes()[0][1].body).toEqual({ version: 1, active: false }); expect(channels[0].active).toBe(false);
    await click("복원"); expect(channels[0].active).toBe(true); expect(writes()[1][1].body).toEqual({ version: 2, active: true });
  });
  it("uses configured categories, preserves an existing value, and respects an explicit empty taxonomy", async () => {
    const change = vi.fn(); await render(<CategorySelect channel="penguin" categories={["촬영 후기", "행사"]} value="이전 분류" onChange={change}/>);
    const select = host.querySelector("select")!; expect([...select.options].map(option => option.value)).toEqual(["", "이전 분류", "촬영 후기", "행사"]);
    await render(<CategorySelect channel="penguin" categories={[]} value="" onChange={change}/>);
    expect([...host.querySelector("select")!.options].map(option => option.value)).toEqual([""]);
  });
});
