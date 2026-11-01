import { expect, it, vi } from "vitest";
import { takePasswordResetToken } from "../client/src/passwordReset";
import { passwordError } from "../shared/password";

it("takes the reset token from the fragment and removes it without using storage or query strings", () => {
  const replaceState = vi.fn(), token = "x".repeat(43);
  expect(takePasswordResetToken({hash:`#reset=${token}`,pathname:"/password-setup",search:""},{replaceState})).toBe(token);
  expect(replaceState).toHaveBeenCalledWith(null,"","/password-setup");
  replaceState.mockClear();
  expect(takePasswordResetToken({hash:"",pathname:"/password-setup",search:`?reset=${token}`},{replaceState})).toBeNull();
  expect(replaceState).not.toHaveBeenCalled();
  expect(takePasswordResetToken({hash:"#reset=invalid",pathname:"/password-setup",search:""},{replaceState})).toBeNull();
  expect(replaceState).toHaveBeenCalled();
});
it("keeps passphrases intact and enforces bcrypt's Unicode byte boundary", () => {
  expect(passwordError("my long password phrase")).toBeNull();
  expect(passwordError("가".repeat(24))).toBeNull();
  expect(passwordError("가".repeat(25))).not.toBeNull();
  expect(passwordError("a".repeat(72))).toBeNull();
  expect(passwordError("a".repeat(73))).not.toBeNull();
  expect(passwordError("short")).not.toBeNull();
  expect(passwordError(" ".repeat(15))).not.toBeNull();
});
