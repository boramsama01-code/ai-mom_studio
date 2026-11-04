import { startCanvaJobs, stopCanvaJobs } from "./worker/canva";
import { startInlinePublish, stopInlinePublish } from "./worker/inlinePublish";
import { createApp } from "./app";
import { env } from "./env";
import { closeDb, describeDbError, getDb } from "./db";
import { runMigrations } from "./migrate";
import { seedIfNeeded } from "./seed";
import { loadStoredSecrets } from "./secretStore";
import { migrateSitesStarter } from "./services/sitesMigration";
import { kickInlineStudio, stopInlineStudio } from "./worker/studio";
import { stopInlineCollect } from "./worker/inline";
import { backfillSourceWorkspaces } from "./services/sourceWorkspace";
import { stopSourceGeneration } from "./services/sourceGeneration";
import { repairLegacyPublicationResults } from "./services/legacyPublicationRepair";

import { consolidateAlligodang } from "./services/channelConsolidation";
import { seedIdeaBank } from "./services/ideaBank";

async function main() {
  if (env.databaseUrl) {
    try {
      await runMigrations();
      const r = await seedIfNeeded(getDb());
      if (r.createdChannels.length) console.log(`초기 채널 생성: ${r.createdChannels.join(", ")}`);
      await migrateSitesStarter(getDb());
      await consolidateAlligodang(getDb());
      await seedIdeaBank(getDb());
      const workspaces = await backfillSourceWorkspaces(getDb());
      if (workspaces) console.log(`기존 초안 ${workspaces}건을 내 콘텐츠에 연결했습니다.`);
      const uncertain = await repairLegacyPublicationResults(getDb());
      if (uncertain) console.log(`게시물 ID가 없는 이전 완료 기록 ${uncertain}건을 결과 확인 대상으로 표시했습니다.`);
      const s = await loadStoredSecrets(getDb());
      if (s.loaded) console.log(`화면에서 입력한 연결 키 ${s.loaded}개를 불러왔습니다.`);
      kickInlineStudio(getDb());
      startInlinePublish(getDb());
      startCanvaJobs(getDb());
    } catch (e) {
      console.error("DB 준비 실패:", describeDbError(e));
      if (env.isProduction) process.exit(1);
    }
  } else {
    console.warn("DB 미연결: APP_DATABASE_URL이 없어 운영 API가 차단됩니다.");
  }
  const app = createApp();
  const server = app.listen(env.port, "0.0.0.0", () => console.log(`펭귄상회 Studio 서버: http://localhost:${env.port} (${env.appEnv})`));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopSourceGeneration();
    console.log("서버 종료: 새 작업을 멈추고 진행 중인 작업의 결과를 저장합니다.");
    // Render's default termination window is 30 seconds. A durable lease recovers
    // unfinished preparation; an interrupted external dispatch stays unknown.
    const deadline = setTimeout(() => {
      console.warn("종료 유예시간 만료: 미완료 작업은 저장된 lease와 전송 단계로 복구합니다.");
      server.closeAllConnections();
      process.exit(0);
    }, 25_000);
    deadline.unref();
    try {
      const connectionsClosed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeIdleConnections();
      await Promise.allSettled([stopInlinePublish(), stopInlineStudio(), stopInlineCollect(), stopCanvaJobs()]);
      await connectionsClosed;
      await closeDb();
      clearTimeout(deadline);
      process.exit(0);
    } catch {
      console.error("종료 중 일부 작업을 마무리하지 못했습니다. 다음 실행에서 저장된 상태를 확인합니다.");
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
}

main();


