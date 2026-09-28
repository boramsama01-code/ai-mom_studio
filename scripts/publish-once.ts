/** 예약 시각이 지난 승인 건 전송 1회 후 종료: npm run publish:once (기본 DRY_RUN=true) */
import { publishOnce } from "../server/worker/run";
import { closeDb } from "../server/db";

publishOnce()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("게시 워커 실패:", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
