// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PasswordForm, PasswordSetupPage } from "../client/src/pages/Password";
import { forgetPasswordResetToken } from "../client/src/passwordReset";
const api = vi.hoisted(() => vi.fn());
vi.mock("../client/src/api", () => ({api,setCsrf:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root: Root, host: HTMLDivElement;
afterEach(async () => { if(root) await act(async()=>root.unmount()); document.body.innerHTML=""; api.mockReset(); forgetPasswordResetToken(); window.history.replaceState(null,"","/"); });
async function setup(resetToken?: string) {
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<PasswordForm username="spacepenguin" resetToken={resetToken}/>));
}
async function fill(index:number,value:string) {
  const el=host.querySelectorAll("input")[index];
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});
}
async function submit(){await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
it("blocks mismatched confirmation, then submits only the chosen password and clears fields after success", async()=>{
  await setup("test-reset-token");
  await fill(1,"my chosen password 2026");await fill(2,"another password 2026");await submit();
  expect(api).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain("일치하지");
  await fill(2,"my chosen password 2026");api.mockResolvedValueOnce({ok:true});await submit();
  expect(api).toHaveBeenCalledWith("/auth/password-reset",{method:"POST",body:{token:"test-reset-token",password:"my chosen password 2026"}});
  expect(host.textContent).toContain("비밀번호를 저장했습니다");expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/");
});
it("uses the current password for account changes and leaves failed edits available to correct", async()=>{
  await setup();await fill(1,"old password 2026");await fill(2,"new password 2026");await fill(3,"new password 2026");
  api.mockRejectedValueOnce(new Error("현재 비밀번호가 일치하지 않습니다."));await submit();
  expect(api).toHaveBeenCalledWith("/auth/password",{method:"POST",body:{currentPassword:"old password 2026",password:"new password 2026"}});
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("현재 비밀번호");
  expect(host.querySelector('button[type="submit"]') || host.querySelector("button")).not.toBeNull();
  expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
});

it("opens the setup form when a recovery link is reopened in the same tab without a page reload", async()=>{
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  window.history.replaceState(null,"","/password-setup");
  await act(async()=>root.render(<PasswordSetupPage/>));
  expect(host.textContent).toContain("전용 설정 링크가 필요합니다");
  const token="a".repeat(43);
  api.mockResolvedValueOnce({username:"spacepenguin"});
  await act(async()=>{window.history.replaceState(null,"",`/password-setup#reset=${token}`);window.dispatchEvent(new HashChangeEvent("hashchange"));});
  expect(api).toHaveBeenCalledWith("/auth/password-reset/check",{method:"POST",body:{token}});
  expect(host.querySelectorAll('input[autocomplete="new-password"]')).toHaveLength(2);
  expect(window.location.hash).toBe("");
});
