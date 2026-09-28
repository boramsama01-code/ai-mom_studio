/** 대기 작업 처리 1회 후 종료: npm run jobs:once */
import { jobsOnce } from "../server/worker/run";
import { closeDb } from "../server/db";

jobsOnce()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("작업 워커 실패:", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
