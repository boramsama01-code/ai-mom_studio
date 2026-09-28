import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";
import { env } from "./env";

export type DB = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: DB | null = null;

export class DbNotConfiguredError extends Error {
  constructor() {
    super("DB 미연결: APP_DATABASE_URL(또는 DATABASE_URL)이 설정되지 않았습니다.");
  }
}

export function getPool(): pg.Pool {
  if (!env.databaseUrl) throw new DbNotConfiguredError();
  if (!pool) {
    const url = env.databaseUrl;
    const needsSsl = /sslmode=require|neon\.tech|render\.com/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX || 5),
      ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export function getDb(): DB {
  if (!db) db = drizzle(getPool(), { schema });
  return db;
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = null;
  db = null;
}

export async function dbHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getPool().query("select 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof DbNotConfiguredError ? e.message : "DB 연결 실패" };
  }
}

export { schema };
