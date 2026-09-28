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

/**
 * 붙여넣기 실수 보정: 앞뒤 공백·따옴표, "psql '...'" 명령 형태에서 주소만 꺼낸다.
 * sslmode/channel_binding 파라미터는 떼고 SSL은 아래에서 직접 설정한다(인증서 검증 유지).
 */
export function cleanDatabaseUrl(raw: string): { url: string; ssl: boolean; note: string | null } {
  let note: string | null = null;
  const trimmed = raw.trim();
  const m = trimmed.match(/postgres(?:ql)?:\/\/[^\s'"]+/);
  if (!m) throw new Error("APP_DATABASE_URL 형식 오류: postgresql:// 로 시작하는 주소가 아닙니다.");
  if (m[0] !== trimmed) note = "APP_DATABASE_URL에 주소 외 글자(따옴표·psql 명령 등)가 있어 주소 부분만 사용했습니다.";
  const u = new URL(m[0]);
  const sslmode = u.searchParams.get("sslmode");
  const ssl = !!sslmode && sslmode !== "disable" ? true : /neon\.tech|render\.com|supabase/.test(u.hostname);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  return { url: u.toString(), ssl, note };
}

/** 오류에서 비밀값 없이 원인만 추출 */
export function describeDbError(e: unknown): string {
  const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
  const inner = err.cause ?? err;
  const code = inner.code ?? "";
  const msg = (inner.message ?? String(e)).replace(/postgres(ql)?:\/\/\S+/g, "postgresql://***");
  const hint =
    code === "28P01" || /password authentication failed/i.test(msg) ? " → DB 비밀번호가 틀렸습니다. Neon에서 주소를 다시 복사하세요." :
    code === "ENOTFOUND" || /getaddrinfo/i.test(msg) ? " → DB 주소(호스트)를 찾을 수 없습니다. 주소를 잘못 붙여 넣었는지 확인하세요." :
    code === "3D000" ? " → 데이터베이스 이름이 없습니다. 주소 끝의 /neondb 부분을 확인하세요." :
    code === "42501" ? " → 권한 부족: Neon의 소유자(owner) 계정 주소를 사용하세요." :
    /timeout|ETIMEDOUT|ECONNREFUSED/i.test(msg) ? " → DB에 연결할 수 없습니다. Neon 프로젝트가 켜져 있는지, 주소가 맞는지 확인하세요." : "";
  return `${code ? `[${code}] ` : ""}${msg}${hint}`;
}

export function getPool(): pg.Pool {
  if (!env.databaseUrl) throw new DbNotConfiguredError();
  if (!pool) {
    const { url, ssl: needsSsl, note } = cleanDatabaseUrl(env.databaseUrl);
    if (note) console.warn(note);
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
    return { ok: false, error: e instanceof DbNotConfiguredError || /형식 오류/.test((e as Error).message) ? (e as Error).message : "DB 연결 실패" };
  }
}

export { schema };
