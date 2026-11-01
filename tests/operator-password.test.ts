import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeEach, expect, it } from "vitest";
import { login, resetDb, setTestEnv, TEST_PASSWORD } from "./helpers";

setTestEnv();
const { createApp } = await import("../server/app");
const { getPool, closeDb } = await import("../server/db");
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const NEW_PASSWORD = "my own new password 2026";
beforeEach(async () => { setTestEnv(); await resetDb(); });
afterAll(closeDb);
async function resetLink({ version = 0, expired = false, username = "admin" } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  await getPool().query("insert into operator_password_resets(token_hash,username,credential_version,expires_at) values ($1,$2,$3,$4)", [hash(token),username,version,new Date(Date.now() + (expired ? -60_000 : 60_000))]);
  return token;
}

it("requires the current password and CSRF, persists the new password and revokes every old session", async () => {
  const app = createApp(), owner = await login(app), another = await login(app);
  const originalHash = process.env.ADMIN_PASSWORD_HASH;
  const preserved = (await getPool().query("select (select count(*) from channels) as channels,(select count(*) from stored_secrets) as secrets")).rows[0];
  const input = { currentPassword: TEST_PASSWORD, password: NEW_PASSWORD };
  expect((await request(app).post("/api/auth/password").send(input)).status).toBe(401);
  expect((await owner.agent.post("/api/auth/password").send(input)).status).toBe(403);
  expect((await owner.agent.post("/api/auth/password").set("x-csrf-token",owner.csrf).set("Origin","https://other.example").send(input)).status).toBe(403);
  expect((await owner.agent.post("/api/auth/password").set("x-csrf-token",owner.csrf).send({ ...input,currentPassword:"wrong" })).status).toBe(400);
  expect((await owner.agent.post("/api/auth/password").set("x-csrf-token",owner.csrf).send(input)).status).toBe(200);
  expect((await owner.agent.get("/api/channels")).status).toBe(401);
  expect((await another.agent.get("/api/auth/me")).body.user).toBeNull();
  expect((await another.agent.get("/api/channels")).status).toBe(401);
  const fresh = request.agent(createApp());
  expect((await fresh.post("/api/auth/login").send({ username:"admin",password:TEST_PASSWORD })).status).toBe(401);
  expect((await fresh.post("/api/auth/login").send({ username:"admin",password:NEW_PASSWORD })).status).toBe(200);
  expect((await fresh.get("/api/channels")).status).toBe(200);
  const row = (await getPool().query("select * from operator_credentials")).rows[0];
  expect(row.version).toBe(1); expect(bcrypt.compareSync(NEW_PASSWORD,row.password_hash)).toBe(true);
  expect(process.env.ADMIN_PASSWORD_HASH).toBe(originalHash);
  expect((await getPool().query("select (select count(*) from channels) as channels,(select count(*) from stored_secrets) as secrets")).rows[0]).toEqual(preserved);
  const audit = JSON.stringify((await getPool().query("select * from audit_logs where entity='operator_account'")).rows);
  expect(audit).not.toContain(NEW_PASSWORD); expect(audit).not.toContain(row.password_hash);
});

it("checks a recovery link without consuming it, then accepts one password and blocks replay and prior links", async () => {
  const app = createApp(), token = await resetLink(), unused = await resetLink();
  const privateToken = crypto.randomBytes(32).toString("base64url");
  process.env.APP_PRIVATE_LINK_SHA256 = hash(privateToken);
  const old = request.agent(app);
  expect((await old.post("/api/auth/private-link").send({ token:privateToken })).status).toBe(200);
  const check = await request(app).post("/api/auth/password-reset/check").send({ token });
  expect(check.status).toBe(200); expect(check.body.username).toBe("admin");
  expect(check.body).not.toHaveProperty("token"); expect(check.headers["cache-control"]).toBe("no-store");
  expect((await getPool().query("select used_at from operator_password_resets where token_hash=$1",[hash(token)])).rows[0].used_at).toBeNull();
  expect((await request(app).post("/api/auth/password-reset").set("Origin","https://other.example").send({ token,password:NEW_PASSWORD })).status).toBe(403);
  const reset = request.agent(app);
  expect((await reset.post("/api/auth/password-reset").send({ token,password:NEW_PASSWORD })).status).toBe(200);
  expect((await reset.get("/api/auth/me")).body.user).toBeNull();
  expect((await request(app).post("/api/auth/password-reset").send({ token,password:"different password 2026" })).status).toBe(400);
  expect((await request(app).post("/api/auth/password-reset/check").send({ token:unused })).status).toBe(400);
  expect((await old.get("/api/channels")).status).toBe(401);
  expect((await request(app).post("/api/auth/private-link").send({ token:privateToken })).status).toBe(404);
  expect((await request(app).post("/api/auth/login").send({ username:"admin",password:NEW_PASSWORD })).status).toBe(200);
  expect((await getPool().query("select used_at from operator_password_resets where token_hash=$1",[hash(token)])).rows[0].used_at).not.toBeNull();
});

it("rejects invalid, expired, mismatched-account links and unsafe password lengths without changing credentials", async () => {
  const app = createApp();
  for (const token of ["bad",crypto.randomBytes(32).toString("base64url"),await resetLink({ expired:true }),await resetLink({ username:"someone-else" })]) {
    expect((await request(app).post("/api/auth/password-reset").send({ token,password:NEW_PASSWORD })).status).toBe(400);
  }
  const token = await resetLink();
  for (const password of ["short"," ".repeat(12),"가".repeat(25),"a".repeat(73)]) expect((await request(app).post("/api/auth/password-reset").send({ token,password })).status).toBe(400);
  expect((await getPool().query("select * from operator_credentials")).rows).toHaveLength(0);
  expect((await request(app).post("/api/auth/password-reset/check").send({ token })).status).toBe(200);
});

it("allows only one of two concurrent reset submissions to consume a link", async () => {
  const app = createApp(), token = await resetLink();
  const results = await Promise.all([1,2].map(n => request(app).post("/api/auth/password-reset").send({ token,password:`a sufficiently long password ${n}` })));
  expect(results.map(r => r.status).sort()).toEqual([200,400]);
  expect((await getPool().query("select version from operator_credentials")).rows[0].version).toBe(1);
});

it("invalidates pending recovery links after an authenticated password change", async () => {
  const app = createApp(), token = await resetLink(), owner = await login(app);
  expect((await owner.agent.post("/api/auth/password").set("x-csrf-token",owner.csrf).send({ currentPassword:TEST_PASSWORD,password:NEW_PASSWORD })).status).toBe(200);
  expect((await request(app).post("/api/auth/password-reset/check").send({ token })).status).toBe(400);
});

it("allows the new password after recovering from login attempt lockout and rate-limits recovery checks", async () => {
  const app = createApp(), token = await resetLink();
  for (let i=0;i<5;i++) expect((await request(app).post("/api/auth/login").send({username:"admin",password:"wrong"})).status).toBe(401);
  expect((await request(app).post("/api/auth/login").send({username:"admin",password:TEST_PASSWORD})).status).toBe(429);
  expect((await request(app).post("/api/auth/password-reset").send({ token,password:NEW_PASSWORD })).status).toBe(200);
  expect((await request(app).post("/api/auth/login").send({username:"admin",password:NEW_PASSWORD})).status).toBe(200);
  for(let i=0;i<29;i++) await request(app).post("/api/auth/password-reset/check").send({token:"bad"});
  expect((await request(app).post("/api/auth/password-reset/check").send({token:"bad"})).status).toBe(429);
});
