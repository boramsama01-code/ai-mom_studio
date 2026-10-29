import { createApp } from "./app.mjs";

if (process.env.RENDER && !process.env.DATA_DIR) throw new Error("DATA_DIR must point to the mounted persistent disk on Render.");
const service = await createApp();
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");
const server = service.app.listen(port, "0.0.0.0", () => console.log(`Ledger listening on port ${port}`));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { service.close(); process.exit(0); });
  server.closeIdleConnections();
  const timer = setTimeout(() => { service.close(); process.exit(1); }, 25_000);
  timer.unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
