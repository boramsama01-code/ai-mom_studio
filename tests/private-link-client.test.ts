import { expect, it, vi } from "vitest";
import { takePrivateLink } from "../client/src/privateLink";

it("접속 비밀값은 fragment에서만 읽고 요청 전 주소창에서 제거한다", () => {
  const replaceState = vi.fn();
  expect(takePrivateLink({ hash: "#access=secret", pathname: "/", search: "" }, { replaceState })).toBe("secret");
  expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  replaceState.mockClear();
  expect(takePrivateLink({ hash: "#main", pathname: "/", search: "?access=ignored" }, { replaceState })).toBeNull();
  expect(replaceState).not.toHaveBeenCalled();
});
