import path from "node:path";
import fs from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "./db";

/** migrations 폴더 위치: 소스 실행(tsx)과 번들 실행(dist) 모두 지원 */
function migrationsFolder(): string {
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(import.meta.dirname ?? ".", "../../migrations"),
    path.resolve(import.meta.dirname ?? ".", "../migrations"),
  ];
  const found = candidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json")));
  if (!found) throw new Error("migrations 폴더를 찾을 수 없습니다.");
  return found;
}

export async function runMigrations() {
  // Both current and legacy Render services can deploy against the same DB.
  const lock = await getPool().connect();
  try {
    await lock.query("select pg_advisory_lock(71791108112026)");
    await migrate(drizzle(lock), { migrationsFolder: migrationsFolder() });
  } finally {
    try { await lock.query("select pg_advisory_unlock(71791108112026)"); }
    finally { lock.release(); }
  }
}

