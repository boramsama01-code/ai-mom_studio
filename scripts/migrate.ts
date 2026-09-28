import { runMigrations } from "../server/migrate";
import { closeDb } from "../server/db";

runMigrations()
  .then(() => console.log("마이그레이션 완료"))
  .catch((e) => {
    console.error("마이그레이션 실패:", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
