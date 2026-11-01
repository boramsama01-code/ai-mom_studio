import { afterAll, expect, it } from "vitest";
import { setTestEnv } from "./helpers";
setTestEnv();
process.env.DB_POOL_MAX = "1";
const { getPool, closeDb } = await import("../server/db");
const { runMigrations } = await import("../server/migrate");
afterAll(async () => { await closeDb(); delete process.env.DB_POOL_MAX; });

it("serializes concurrent startups without requiring an extra database connection", async () => {
  await getPool().query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await Promise.all([runMigrations(),runMigrations()]);
  expect((await getPool().query("select count(*)::int as n from operator_credentials")).rows[0].n).toBe(0);
  const applied = (await getPool().query("select count(*)::int as n,count(distinct hash)::int as distinct_n from drizzle.__drizzle_migrations")).rows[0];
  expect(applied.n).toBeGreaterThan(0); expect(applied.n).toBe(applied.distinct_n);
});
