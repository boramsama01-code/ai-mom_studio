import { createApp } from "./app";
import { env } from "./env";
import { describeDbError, getDb } from "./db";
import { runMigrations } from "./migrate";
import { seedIfNeeded } from "./seed";

async function main() {
  if (env.databaseUrl) {
    try {
      await runMigrations();
      const r = await seedIfNeeded(getDb());
      if (r.createdChannels.length) console.log(`초기 채널 생성: ${r.createdChannels.join(", ")}`);
    } catch (e) {
      console.error("DB 준비 실패:", describeDbError(e));
      if (env.isProduction) process.exit(1);
    }
  } else {
    console.warn("DB 미연결: APP_DATABASE_URL이 없어 운영 API가 차단됩니다.");
  }
  const app = createApp();
  app.listen(env.port, "0.0.0.0", () => console.log(`아이맘 스튜디오 서버: http://localhost:${env.port} (${env.appEnv})`));
}

main();
