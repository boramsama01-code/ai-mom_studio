/**
 * 초기 채널·검색어 시드(한 번만): npm run db:seed
 * 개발용 샘플 자료:            npm run db:seed -- --sample   (운영 환경에서는 거부)
 * 샘플은 is_sample=true로 실제 자료와 격리되며, 샘플 모드 로그인에서만 보입니다.
 */
import { getDb, closeDb } from "../server/db";
import { seedIfNeeded } from "../server/seed";
import { env } from "../server/env";
import { contentItems, sourceDocuments } from "../shared/schema";
import { createRevision } from "../server/content";
import { emptyPayload } from "../shared/payloads";

async function sample() {
  if (env.isProduction) throw new Error("운영 환경에서는 샘플 자료를 넣을 수 없습니다.");
  const db = getDb();
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      normalizedUrl: "https://sample.invalid/notice/1",
      originalUrl: "https://sample.invalid/notice/1",
      kind: "manual",
      title: "[샘플] 가상의 과학고 입학설명회 안내",
      snippet: "샘플 모드 · 실제 정보 아님",
      fetchStatus: "ok",
      fetchedText: "[샘플 · 실제 정보 아님] 가상의 OO과학고는 2099년 10월 10일 입학설명회를 연다. 원서접수는 2099년 10월 20일부터 24일까지다.",
      isSample: true,
    })
    .onConflictDoNothing()
    .returning();
  if (!doc) return console.log("샘플이 이미 있습니다.");
  const [item] = await db
    .insert(contentItems)
    .values({ channelId: 1, kind: "notice", origin: "collected", primarySourceId: doc.id, title: "[샘플] 가상의 과학고 입학설명회 안내", isSample: true, relevance: "relevant" })
    .returning();
  await createRevision(db, {
    contentItemId: item.id,
    author: "system",
    payload: { ...emptyPayload("notice", "[샘플] 가상의 과학고 입학설명회"), relevance: "relevant", organization: "가상의 OO과학고", schedules: [{ kind: "apply", label: "원서접수", start: { date: "2099-10-20" }, end: { date: "2099-10-24" }, raw: "10월 20일부터 24일까지" }], deadline_type: "fixed" },
    note: "샘플 모드 · 실제 정보 아님",
  });
  console.log("샘플 자료 1건을 넣었습니다(샘플 모드 로그인에서만 보임).");
}

(async () => {
  try {
    const r = await seedIfNeeded(getDb());
    console.log(r.createdChannels.length ? `새로 만든 채널: ${r.createdChannels.join(", ")}` : "이미 시드됨 — 변경 없음");
    if (process.argv.includes("--sample")) await sample();
  } catch (e) {
    console.error("시드 실패:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
})();
