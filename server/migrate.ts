import path from "node:path";
import fs from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./db";

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
  await migrate(getDb(), { migrationsFolder: migrationsFolder() });
}
