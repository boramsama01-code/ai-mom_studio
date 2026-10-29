import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "ledger-api-check-"));
const setupKey = randomBytes(40).toString("base64url");
const password = "Local-only-test-password-2026!";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F2kAAAAASUVORK5CYII=", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length 0>>stream\n\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF");
let service, server, base, cookie = "";
const logger = { error: (...args) => { throw new Error("Unexpected server error: " + args.join(" ")); } };
async function start() {
  service = await createApp({ dataDir: directory, setupKey, production: false, logger });
  server = await new Promise((resolve, reject) => { const result = service.app.listen(0, "127.0.0.1", () => resolve(result)); result.on("error", reject); });
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  if (server) { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); server = null; }
  service?.close(); service = null;
}
async function api(route, init = {}, authenticated = true) {
  const response = await fetch(base + route, { ...init, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(init.method && init.method !== "GET" ? { Origin: base } : {}), ...init.headers } });
  return response;
}
async function status(response, expected) { assert.equal(response.status, expected, await response.text()); }
async function jsonRequest(route, value, authenticated = true) { return api(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }, authenticated); }
function remember(response) { cookie = response.headers.getSetCookie()[0]?.split(";")[0] || cookie; }
function payload(extra = {}) { return { id: randomUUID(), paidOn: "2026-10-01", category: "교육비", child: "현우", title: "[검증] 교육비", amount: 300000, retainedReceiptIds: [], ...extra }; }
function form(value, files = []) {
  const result = new FormData(); result.append("payload", JSON.stringify(value));
  for (const [name, data, type] of files) result.append("files", new Blob([data], { type }), name);
  return result;
}
async function list(query = "") {
  const response = await api("/api/expenses" + query);
  assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).expenses;
}

try {
  await start();
  await status(await api("/api/health", {}, false), 200);
  assert.deepEqual(await (await api("/api/session", {}, false)).json(), { authenticated: false, setupRequired: true });
  await status(await api("/api/expenses", {}, false), 401);
  await status(await api("/api/expenses", { headers: { "oai-authenticated-user-id": "forged", "oai-authenticated-user-email": "forged@example.test" } }, false), 401);
  await status(await jsonRequest("/api/setup", { setupKey: "wrong", username: "owner", password }, false), 401);
  await status(await jsonRequest("/api/setup", { setupKey, username: "owner", password: "short" }, false), 400);
  const setup = await jsonRequest("/api/setup", { setupKey, username: "owner", password, name: "검증" }, false);
  assert.equal(setup.status, 201, await setup.clone().text());
  assert.match(setup.headers.get("set-cookie"), /HttpOnly/); assert.match(setup.headers.get("set-cookie"), /SameSite=Strict/); remember(setup); await setup.json();
  assert.equal((await (await api("/api/session")).json()).authenticated, true);
  await status(await jsonRequest("/api/setup", { setupKey, username: "second", password }, false), 409);
  const stored = service.db.prepare("SELECT password_hash FROM users").get().password_hash;
  assert.ok(stored.startsWith("scrypt$")); assert.ok(!stored.includes(password));
  assert.notEqual(service.db.prepare("SELECT token_hash FROM sessions").get().token_hash, cookie.split("=")[1]);
  console.log("PASS: setup key, single owner, password hashing, private session cookie, anonymous and forged identity rejection");

  const one = payload();
  await status(await api("/api/expenses", { method: "POST", body: form(one, [["영수증.png", png, "image/png"], ["receipt.pdf", pdf, "application/pdf"]]) }), 201);
  const two = payload({ paidOn: "2026-10-31", child: "정우", amount: 200000 }); await status(await api("/api/expenses", { method: "POST", body: form(two) }), 201);
  const outside = payload({ paidOn: "2026-09-30", category: "식비", child: null, amount: 10000 }); await status(await api("/api/expenses", { method: "POST", body: form(outside) }), 201);
  await status(await api("/api/expenses", { method: "POST", body: form(one) }), 200);
  await status(await api("/api/expenses", { method: "POST", body: form({ ...one, amount: 1 }) }), 409);
  const rows = await list("?from=2026-10-01&to=2026-10-31");
  assert.equal(rows.length, 2); assert.equal(rows.reduce((sum, e) => sum + e.amount, 0), 500000);
  assert.equal((await list("?from=2026-10-01&to=2026-10-01")).length, 1);
  await status(await api("/api/expenses?from=2026-10-31&to=2026-10-01"), 400);
  const entry = rows.find(e => e.id === one.id);
  const image = entry.receipts.find(r => r.mime === "image/png");
  const document = entry.receipts.find(r => r.mime === "application/pdf");
  assert.equal(image.name, "영수증.png");
  for (const [receipt, expected] of [[image, png], [document, pdf]]) {
    const response = await api(`/api/receipts/${receipt.id}`); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), receipt.mime);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    await status(await api(`/api/receipts/${receipt.id}`, {}, false), 401);
  }
  const download = await api(`/api/receipts/${image.id}?download=1`); assert.match(download.headers.get("content-disposition"), /^attachment;/); await download.arrayBuffer();
  await stop(); await start();
  assert.equal((await list()).length, 3);
  assert.deepEqual(Buffer.from(await (await api(`/api/receipts/${document.id}`)).arrayBuffer()), pdf);
  console.log("PASS: exact KRW totals, inclusive date boundaries, duplicate-request safety, image/PDF roundtrip, Korean filenames, restart persistence");

  for (const invalid of [payload({ amount: 0 }), payload({ amount: 1.5 }), payload({ paidOn: "2026-02-29" }), payload({ child: null })]) await status(await api("/api/expenses", { method: "POST", body: form(invalid) }), 400);
  await status(await api("/api/expenses", { method: "POST", body: form(payload(), [["fake.png", Buffer.from("<script>bad</script>"), "image/png"]]) }), 400);
  await status(await api("/api/expenses", { method: "POST", body: form(payload(), [["empty.pdf", Buffer.alloc(0), "application/pdf"]]) }), 400);
  await status(await api("/api/expenses", { method: "POST", headers: { Origin: "https://untrusted.invalid" }, body: form(payload()) }), 403);
  await status(await api("/api/expenses", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: form(payload()) }), 403);
  const five = payload({ title: "[검증] 다섯 영수증" });
  await status(await api("/api/expenses", { method: "POST", body: form(five, Array.from({ length: 5 }, (_, i) => [`receipt-${i}.png`, png, "image/png"])) }), 201);
  await status(await api("/api/expenses", { method: "POST", body: form(payload(), Array.from({ length: 6 }, (_, i) => [`receipt-${i}.png`, png, "image/png"])) }), 400);
  const tooLarge = Buffer.alloc(10 * 1024 * 1024 + 1); png.copy(tooLarge);
  await status(await api("/api/expenses", { method: "POST", body: form(payload(), [["large.png", tooLarge, "image/png"]]) }), 400);
  console.log("PASS: invalid amounts/dates/education child, signature and empty-file validation, CSRF, five-file and per-file size limits");

  const update = { ...one, child: "정우", amount: 350000, version: 1, retainedReceiptIds: [document.id] };
  await status(await api(`/api/expenses/${one.id}`, { method: "PUT", body: form(update) }), 200);
  await status(await api(`/api/expenses/${one.id}`, { method: "PUT", body: form(update) }), 409);
  await status(await api(`/api/receipts/${image.id}`), 404);
  await status(await api(`/api/receipts/${document.id}`), 200);
  let updated = (await list()).find(e => e.id === one.id);
  assert.equal(updated.version, 2); assert.equal(updated.amount, 350000); assert.equal(updated.child, "정우"); assert.equal(updated.receipts.length, 1);
  await status(await api(`/api/expenses/${one.id}`, { method: "PUT", body: form({ ...update, category: "식비", version: 2 }) }), 200);
  updated = (await list()).find(e => e.id === one.id); assert.equal(updated.child, null);
  await status(await api(`/api/expenses/${one.id}?version=1`, { method: "DELETE" }), 409);
  await status(await api(`/api/expenses/${one.id}?version=3`, { method: "DELETE" }), 200);
  await status(await api(`/api/receipts/${document.id}`), 404);
  const repeated = payload({ title: "[검증] 동시 저장" });
  const duplicates = await Promise.all([1, 2].map(() => api("/api/expenses", { method: "POST", body: form(repeated, [["receipt.png", png, "image/png"]]) })));
  for (const response of duplicates) { assert.ok([200, 201].includes(response.status), await response.clone().text()); await response.text(); }
  assert.equal((await list()).filter(e => e.id === repeated.id).length, 1);
  assert.equal((await list()).find(e => e.id === repeated.id).receipts.length, 1);
  console.log("PASS: edits, receipt removal, child normalization, optimistic conflicts, concurrent duplicate suppression");

  const stale = cookie;
  await status(await api("/api/logout", { method: "POST" }), 200);
  await status(await api("/api/expenses", { headers: { Cookie: stale } }), 401);
  await status(await jsonRequest("/api/login", { username: "owner", password: "wrong" }, false), 401);
  const login = await jsonRequest("/api/login", { username: "OWNER", password }, false); assert.equal(login.status, 200); remember(login); await login.json();
  assert.equal((await (await api("/api/session")).json()).user.username, "owner");
  for (const row of await list()) await status(await api(`/api/expenses/${row.id}?version=${row.version}`, { method: "DELETE" }), 200);
  assert.deepEqual(await list(), []);
  assert.deepEqual(await readdir(path.join(directory, "receipts")), []);
  assert.deepEqual(await readdir(path.join(directory, "incoming")), []);
  console.log("PASS: logout revocation, login, complete receipt and temporary-upload cleanup");
} finally {
  await stop(); await rm(directory, { recursive: true, force: true });
}
