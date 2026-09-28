import { runMigrations } from "../server/migrate";
import { closeDb, describeDbError } from "../server/db";

runMigrations()
  .then(() => console.log("마이그레이션 완료"))
  .catch((e) => {
    console.error("마이그레이션 실패:", describeDbError(e));
    process.exitCode = 1;
  })
  .finally(closeDb);
