/** The recovery secret lives in memory, never query strings or browser storage. */
export function takePasswordResetToken(location: Pick<Location, "hash" | "pathname" | "search">, history: Pick<History, "replaceState">) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("reset")) return null;
  const value = params.get("reset") || "";
  history.replaceState(null, "", location.pathname + location.search);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

let resetToken = typeof window === "undefined" ? null : takePasswordResetToken(window.location, window.history);
export const passwordResetToken = () => {
  // Reopening the link in the same tab can change only its fragment, without a reload.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.hash.slice(1)).has("reset")) resetToken = takePasswordResetToken(window.location, window.history);
  return resetToken;
};
export const forgetPasswordResetToken = () => { resetToken = null; };
