/** 수집 1회 실행 후 종료: npm run collect:once [-- --channel opportunities] */
import { collectOnce } from "../server/worker/run";
import { closeDb } from "../server/db";

const i = process.argv.indexOf("--channel");
const channelSlug = i > 0 ? process.argv[i + 1] : undefined;
collectOnce({ channelSlug, isSchedule: process.env.GITHUB_EVENT_NAME === "schedule" })
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("수집 워커 실패:", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
