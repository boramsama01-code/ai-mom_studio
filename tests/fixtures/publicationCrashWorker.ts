/** Test-only process. It commits a publication checkpoint, then waits to be killed. */
export {};
if (process.env.PUBLICATION_CRASH_TEST !== "1" || process.env.APP_ENV !== "test" ||
    !process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test") ||
    process.env.APP_DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error("The crash fixture requires the explicit isolated test database");
}
globalThis.fetch = async () => { throw new Error("The crash fixture must never call a provider"); };

const deliveryId = Number(process.argv[2]);
const phase = process.argv[3];
if (!Number.isSafeInteger(deliveryId) || deliveryId <= 0 || !["preparing", "dispatching"].includes(phase)) {
  throw new Error("Invalid publication crash checkpoint");
}
const { getDb } = await import("../../server/db");
const { claimPublicationDelivery, beginDeliveryDispatch } = await import("../../server/services/publicationAttempts");
const claimed = await claimPublicationDelivery(getDb(), deliveryId, "process-that-will-be-killed", new Date());
if (!claimed) throw new Error("The crash fixture could not claim its test delivery");
if (phase === "dispatching") {
  const started = await beginDeliveryDispatch(getDb(), claimed);
  if (!started.ok) throw new Error("The crash fixture could not persist its dispatch boundary");
}
if (!process.send) throw new Error("The crash fixture needs its test parent");
process.on("disconnect", () => process.exit(1));
process.send({ deliveryId, phase, attemptId: claimed.lastAttemptId });
// An unresolved promise alone does not keep Node alive. The parent deliberately
// uses SIGKILL, so neither database cleanup nor normal shutdown can mask a loss.
setInterval(() => {}, 1000);
