import { getDb, closeDb } from "../server/db";
import { seedIfNeeded } from "../server/seed";

seedIfNeeded(getDb())
  .then((r) =>
    console.log(r.createdChannels.length ? `새로 만든 채널: ${r.createdChannels.join(", ")}` : "이미 시드됨 — 변경 없음"),
  )
  .catch((e) => {
    console.error("시드 실패:", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
