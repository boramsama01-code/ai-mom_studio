// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstagramAccounts } from "../client/src/pages/InstagramAccounts";
import { InstagramConnectionsPage } from "../client/src/pages/InstagramConnections";
import { DirtyGuardProvider } from "../client/src/state";
import { DirtyModal, GuardedLink } from "../client/src/ui";
import type { InstagramAccountRow, InstagramConnectionCheck } from "../shared/channelInstagram";

const mocks = vi.hoisted(() => ({ api: vi.fn(), check: vi.fn(), connect: vi.fn(), navigate: vi.fn() }));
vi.mock("../client/src/api", async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock("wouter", () => ({ useLocation: () => ["/instagram", mocks.navigate] }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const accounts: InstagramAccountRow[] = [
  { channelId: 1, channelName: "우주펭귄상회", expectedUsername: "spacepenguin.co", destinations: [{ id: 11, label: "@spacepenguin.co", enabled: true, configured: true }] },
  { channelId: 2, channelName: "HighScoop", expectedUsername: "highscoop.official", destinations: [{ id: 22, label: "@highscoop.official", enabled: true, configured: true }] },
  { channelId: 3, channelName: "알리고당", expectedUsername: "alligodang.official", destinations: [] },
  { channelId: 4, channelName: "fryday", expectedUsername: "fryday.official.kr", destinations: [] },
];
const success: InstagramConnectionCheck = { ok: true, username: "spacepenguin.co", checkedAt: "2026-11-02T05:00:00Z", mediaHosting: { ok: true, message: "이미지 저장소 확인 완료" } };
let host: HTMLDivElement, root: Root, client: QueryClient, oauthConfigured: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/instagram");
  oauthConfigured = true;
  mocks.check.mockResolvedValue(success);
  mocks.connect.mockResolvedValue({ ok: true, username: "spacepenguin.co" });
  mocks.api.mockImplementation((path: string, options?: unknown) => {
    if (path === "/studio/instagram/accounts") return Promise.resolve({ accounts });
    if (path === "/studio/instagram/oauth/config") return Promise.resolve({ configured: oauthConfigured, missing: oauthConfigured ? [] : ["META_APP_ID", "META_APP_SECRET", "META_IG_LOGIN_CONFIG_ID"], appId: oauthConfigured ? "123456" : null, redirectUri: "https://studio.example/api/studio/instagram/oauth/callback" });
    if (path === "/secrets") return Promise.resolve({ groups: [], statuses: [], tests: {} });
    if (path === "/studio/instagram/1/check") return mocks.check();
    if (path === "/studio/instagram/1/connect") return mocks.connect(options);
    throw new Error(`Unexpected API: ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); document.getElementById("workroom-mode")?.remove(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(children: ReactNode = <InstagramAccounts />) {
  await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider>{children}<GuardedLink href="/">다른 작업으로</GuardedLink><DirtyModal /></DirtyGuardProvider></QueryClientProvider>));
  await settle();
}
function button(text: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}
async function click(text: string, scope: ParentNode = host) { await act(async () => button(text, scope).click()); await settle(); }
function account(username = "spacepenguin.co") {
  return [...host.querySelectorAll<HTMLElement>("article.instagram-account")].find(card => card.querySelector("a")?.textContent === `@${username}`)!;
}
async function fillToken(value = "synthetic-ui-test-token") {
  const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openTokenForm() {
  await click("연결 정보 확인·갱신", account());
  await click("이미 발급한 토큰으로 연결", account());
}

describe("Instagram account connection states", () => {
  it("shows a custom channel by slug, hides empty profile links and accepts its actual account name", async () => {
    const custom: InstagramAccountRow = { channelId: 9, channelSlug: "custom-brand", channelName: "새로 추가한 채널", expectedUsername: "", destinations: [] };
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path: string, options?: any) => {
      if (path === "/studio/instagram/accounts") return Promise.resolve({ accounts: [...accounts, custom, { ...custom, channelId: 10, channelSlug: "other-brand", channelName: "다른 사용자 채널" }] });
      if (path === "/studio/instagram/9/connect") { expect(options.body.username).toBe("custom.official"); return Promise.resolve({ username: "custom.official" }); }
      return fallback(path, options);
    });
    await render(<InstagramAccounts channel="custom-brand" />);
    expect(host.querySelectorAll("article.instagram-account")).toHaveLength(1); expect(host.textContent).toContain("새로 추가한 채널");
    expect(host.querySelector('a[href="https://www.instagram.com//"]')).toBeNull();
    await click("이 계정 연결하기");
    const username = host.querySelector<HTMLInputElement>('input[placeholder="my.brand"]')!;
    expect(username.readOnly).toBe(false);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(username, "custom.official"); username.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("이미 발급한 토큰으로 연결"); await fillToken(); await click("계정 확인하고 연결");
    expect(host.querySelector('a[href="https://www.instagram.com/custom.official/"]')).not.toBeNull();
    expect(host.textContent).toContain("@custom.official · 계정·게시 권한 확인 완료");
  });
  it("sends an optional custom account name for an unambiguous OAuth connection", async () => {
    const fallback = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path: string, options?: any) => {
      if (path === "/studio/instagram/accounts") return Promise.resolve({ accounts: [{ channelId: 9, channelSlug: "custom-brand", channelName: "새 채널", expectedUsername: "", destinations: [] }] });
      if (path === "/studio/instagram/9/oauth/start") return new Promise(() => {}); // no external navigation
      return fallback(path, options);
    });
    await render(<InstagramAccounts channelId={9} />); await click("이 계정 연결하기");
    const username = host.querySelector<HTMLInputElement>('input[placeholder="my.brand"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(username, "@custom.official"); username.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Instagram으로 연결");
    expect(mocks.api).toHaveBeenCalledWith("/studio/instagram/9/oauth/start", { method: "POST", body: { username: "custom.official" } });
  });
  it("keeps sanitized OAuth diagnostics visible after removing the query string", async () => {
    window.history.replaceState(null, "", "/instagram?instagram=error&reason=direct_account_access_failed&stage=business_asset&http_status=400&graph_code=100&graph_subcode=33&lost=false&code=PRIVATE_CODE&state=PRIVATE_STATE");
    await render(<InstagramConnectionsPage />);
    expect(window.location.search).toBe("");
    expect(host.querySelector('[data-testid="instagram-oauth-diagnostic"]')?.textContent).toBe("진단: direct_account_access_failed / 단계: business_asset / HTTP 400 / Graph 100 / subcode 33 / lost=false");
    expect(host.textContent).toContain("선택한 계정 정보를 조회하지 못했습니다");
    expect(host.innerHTML).not.toContain("PRIVATE");
    await act(async () => { await client.invalidateQueries({ queryKey: ["instagram-oauth-config"] }); }); await settle();
    expect(host.querySelector('[data-testid="instagram-oauth-diagnostic"]')?.textContent).toContain("business_asset / HTTP 400 / Graph 100 / subcode 33");
  });

  it.each([
    ["invalid_request", "callback", "유효한 로그인 코드를 받지 못했습니다"],
    ["exchange_failed", "token_exchange", "Meta 로그인 응답을 확인하지 못했습니다"],
    ["direct_publish_access_failed", "quota", "게시 API 접근을 확인하지 못했습니다"],
    ["persistence_failed", "persistence", "연결 정보를 저장하지 못했습니다"],
    ["denied", "callback", "Meta에서 로그인 승인을 완료하지 못했습니다"],
  ])("shows a distinct safe notice for %s", async (reason, stage, message) => {
    window.history.replaceState(null, "", `/instagram?instagram=error&reason=${reason}&stage=${stage}`);
    await render(<InstagramConnectionsPage />);
    expect(host.textContent).toContain(message);
    expect(host.querySelector('[data-testid="instagram-oauth-diagnostic"]')?.textContent).toBe(`진단: ${reason} / 단계: ${stage}`);
    expect(window.location.search).toBe("");
  });

  it("does not reflect unknown labels, secret-bearing fields or malformed numeric query values", async () => {
    const query = new URLSearchParams({ instagram: "error", reason: "PRIVATE_TOKEN<script>", stage: "PRIVATE_STATE", http_status: "PRIVATE_SECRET", graph_code: "1e2", graph_subcode: "PRIVATE_CODE", lost: "PRIVATE", access_token: "PRIVATE_ACCESS_TOKEN", error_description: "PRIVATE_PROVIDER_MESSAGE", stack: "PRIVATE_SQL" });
    window.history.replaceState(null, "", `/instagram?${query}`);
    await render(<InstagramConnectionsPage />);
    expect(host.querySelector('[data-testid="instagram-oauth-diagnostic"]')?.textContent).toBe("진단: connect_failed");
    expect(host.innerHTML).not.toContain("PRIVATE");
    expect(host.innerHTML).not.toContain("<script>");
    expect(window.location.search).toBe("");
  });

  it("shows all four exact account targets without treating saved credentials as a verified connection", async () => {
    await render();
    expect(host.querySelectorAll("article.instagram-account")).toHaveLength(4);
    for (const row of accounts) expect(host.querySelector(`a[href="https://www.instagram.com/${row.expectedUsername}/"]`)).not.toBeNull();
    expect(account().querySelector(".instagram-state")?.textContent).toBe("확인 필요");
    expect(account("alligodang.official").querySelector(".instagram-state")?.textContent).toBe("연결 전");
    expect(host.querySelector(".is-verified")).toBeNull();
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  });

  it("offers login first and reveals a password-masked token form only on an explicit request", async () => {
    await render(); await click("연결 정보 확인·갱신", account());
    expect(button("Instagram으로 연결", account()).disabled).toBe(false);
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await click("이미 발급한 토큰으로 연결", account());
    const username = account().querySelector<HTMLInputElement>('input[placeholder="spacepenguin.co"]')!;
    expect(username.value).toBe("spacepenguin.co"); expect(username.readOnly).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.autocomplete).toBe("off");
    expect(button("계정 확인하고 연결").disabled).toBe(true);
    await fillToken();
    expect(button("계정 확인하고 연결").disabled).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "다른 작업으로")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("저장하지 않은 변경");
    await click("머무르기", host.querySelector('[role="dialog"]')!);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("synthetic-ui-test-token");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("offers the token form directly when OAuth is not configured and explains the issuance screen without changing typed tokens", async () => {
    oauthConfigured = false;
    await render(); await click("연결 정보 확인·갱신", account());
    expect(account().querySelector('input[type="password"]')).not.toBeNull();
    expect(account().textContent).toContain("앱 ID·시크릿·구성 ID는 필요하지 않아요");
    expect(account().textContent).not.toContain("최초 연결 준비가 필요해요");
    expect(account().textContent).not.toContain("새 앱");
    expect(account().textContent).not.toContain("기존 앱");
    const mode = account().querySelector<HTMLSelectElement>("select")!;
    expect(mode.value).toBe("facebook");
    expect([...mode.options].map(option => option.textContent)).toEqual(["Meta 통합 로그인", "Instagram 로그인 (이전 API)"]);
    expect(account().textContent).toContain("‘통합된 로그인이 포함된 API 설정’에서 발급한 토큰");
    await fillToken();
    await act(async () => { mode.value = "instagram"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(account().textContent).toContain("‘Instagram 로그인이 포함된 API 설정’에서 발급한 토큰");
    expect(account().querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("synthetic-ui-test-token");
    oauthConfigured = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ["instagram-oauth-config"] }); }); await settle();
    expect(account().querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("synthetic-ui-test-token");
    expect(mode.value).toBe("instagram");
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST" || options?.method === "PUT")).toBe(false);
  });

  it("keeps optional login-button setup collapsed while manual token connection remains available", async () => {
    oauthConfigured = false;
    await render(<InstagramConnectionsPage />); await settle();
    const setup = host.querySelector<HTMLDetailsElement>("details#setup")!;
    expect(setup).not.toBeNull();
    expect(setup.open).toBe(false);
    expect(setup.querySelector("summary")?.textContent).toBe("로그인 버튼 설정 (선택)");
    expect(setup.querySelector("#sec-META_APP_ID")).not.toBeNull();
    expect(setup.querySelector("#sec-META_APP_SECRET")).not.toBeNull();
    await click("연결 정보 확인·갱신", account());
    expect(account().querySelector('input[type="password"]')).not.toBeNull();
    expect(setup.open).toBe(false);
    expect(account().textContent).not.toContain("최초 연결 준비가 필요해요");
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST" || options?.method === "PUT")).toBe(false);
  });

  it("does not silently discard a typed token when closing the connection editor", async () => {
    await render(); await openTokenForm(); await fillToken();
    await click("연결 입력 닫기", account());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("저장하지 않은 변경");
    await click("머무르기", host.querySelector('[role="dialog"]')!);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("synthetic-ui-test-token");
    expect(button("연결 입력 닫기", account())).toBeDefined();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("only reports saved-and-leave after the token has actually been verified and saved", async () => {
    await render(); await openTokenForm(); await fillToken();
    await act(async () => [...host.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "다른 작업으로")!.click());
    await click("저장하고 이동");
    expect(mocks.api).toHaveBeenCalledWith("/studio/instagram/1/connect", { method: "POST", body: { username: "spacepenguin.co", token: "synthetic-ui-test-token", authMode: "facebook" } });
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    expect(host.querySelector('input[type="password"]')).toBeNull();
  });
  it("connects without asking for an application daily cap", async () => {
    await render(); await openTokenForm(); await fillToken();
    expect(account().textContent).not.toContain("하루 발행 한도");
    expect(account().querySelector('input[type="number"]')).toBeNull();
    await click("계정 확인하고 연결", account());
    expect(mocks.api).toHaveBeenCalledWith("/studio/instagram/1/connect", { method: "POST", body: { username: "spacepenguin.co", token: "synthetic-ui-test-token", authMode: "facebook" } });
  });

  it("removes a previous success badge while rechecking and when that recheck fails", async () => {
    await render(); await click("실제 계정 확인", account());
    expect(account().classList.contains("is-verified")).toBe(true);
    expect(account().textContent).toContain("계정·게시 권한 확인 완료");
    let reject: (error: Error) => void = () => undefined;
    mocks.check.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await act(async () => button("실제 계정 확인", account()).click());
    expect(account().classList.contains("is-verified")).toBe(false);
    expect(account().querySelector(".instagram-state")?.textContent).toBe("확인 중");
    await act(async () => reject(new Error("연결 권한이 만료됐습니다. 다시 연결해 주세요."))); await settle();
    expect(account().querySelector(".instagram-state")?.textContent).toBe("재확인 필요");
    expect(account().querySelector(".is-ok")).toBeNull();
    expect(account().textContent).not.toContain("계정·게시 권한 확인 완료");
    expect(account().textContent).not.toContain("마지막 확인");
    expect(account().querySelector('[role="alert"]')?.textContent).toContain("연결 권한이 만료");
  });

  it("keeps Instagram success distinct from a failed image-hosting check", async () => {
    mocks.check.mockResolvedValueOnce({ ...success, mediaHosting: { ok: false, message: "Cloudinary 서명 확인 실패" } });
    await render(); await click("실제 계정 확인", account());
    expect(account().querySelector(".instagram-state")?.textContent).toBe("계정 확인 완료");
    expect(account().querySelector(".notice.warn")?.textContent).toContain("Instagram 계정은 확인했습니다");
    expect(account().querySelector('a[href="/connections?service=cloudinary"]')).not.toBeNull();
    expect(account().querySelector('[role="alert"]')).toBeNull();
    expect(mocks.api).toHaveBeenCalledWith("/studio/instagram/1/check", { method: "POST", body: { destinationId: 11 } });
  });

  it("keeps private workrooms free of connection forms and tokens", async () => {
    const marker = document.createElement("div"); marker.id = "workroom-mode"; document.body.prepend(marker);
    await render(<InstagramAccounts channel="penguin" />);
    expect(host.querySelectorAll("article.instagram-account")).toHaveLength(1);
    expect(host.textContent).toContain("게시 계정 확인");
    expect(host.querySelectorAll("input, form")).toHaveLength(0);
    expect([...account().querySelectorAll("button")].map(b => b.textContent)).toEqual(["실제 계정 확인"]);
    expect(mocks.api).not.toHaveBeenCalledWith("/studio/instagram/oauth/config");
    await click("실제 계정 확인", account());
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST").map(([path]) => path)).toEqual(["/studio/instagram/1/check"]);
  });
});
