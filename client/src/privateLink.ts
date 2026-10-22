import { api } from "./api";

// A fragment is never sent in HTTP URLs or Referer headers. Remove it before
// any request; keep the token only in memory until the session exchange succeeds.
export function takePrivateLink(location: Pick<Location, "hash" | "pathname" | "search">, history: Pick<History, "replaceState">) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("access")) return null;
  const token = params.get("access") ?? "";
  history.replaceState(null, "", location.pathname + location.search);
  return token;
}

let token = typeof window === "undefined" ? null : takePrivateLink(window.location, window.history);
let pending: Promise<void> | null = null;
export function enterFromPrivateLink(): Promise<void> {
  if (token === null) return Promise.resolve();
  if (!pending) pending = api("/auth/private-link", { method: "POST", body: { token } })
    .then(() => { token = null; })
    .catch(error => { pending = null; throw error; });
  return pending;
}
