/** UI mode only. The private gateway independently enforces allowed requests. */
export function isPrivateWorkroom(): boolean {
  return typeof document !== "undefined" && document.getElementById("workroom-mode") !== null;
}
