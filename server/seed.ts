/**
 * 최초 시드. 한 번만 적용되며 이후 사용자의 변경을 덮어쓰지 않는다.
 * - 채널: slug가 없을 때만 생성
 * - 검색 규칙·공식 출처 후보: 해당 채널이 이번 호출에서 새로 생성된 경우에만 추가
 */
import { eq } from "drizzle-orm";
import type { DB } from "./db";
import { channels, officialSources, searchRules, appSettings } from "../shared/schema";
import {
  CANDIDATE_RULES,
  CHANNEL_SEEDS,
  DEFAULT_BUDGET,
  INITIAL_ACTIVE_RULES,
  SCHOOL_SEEDS,
  normalizeQuery,
} from "../shared/domain";

export async function seedIfNeeded(db: DB): Promise<{ createdChannels: string[] }> {
  const createdChannels: string[] = [];
  await db.transaction(async (tx) => {
    for (const c of CHANNEL_SEEDS) {
      const inserted = await tx
        .insert(channels)
        .values({
          slug: c.slug,
          name: c.name,
          description: c.description,
          contentType: c.contentType,
          accentColor: c.accentColor,
          budget: DEFAULT_BUDGET,
        })
        .onConflictDoNothing({ target: channels.slug })
        .returning({ id: channels.id });
      if (inserted.length === 0) continue;
      createdChannels.push(c.slug);
      const channelId = inserted[0].id;

      if (c.slug === "opportunities") {
        const rules = [
          ...INITIAL_ACTIVE_RULES.map((r, i) => ({ ...r, enabled: true, priority: 10 + i })),
          ...CANDIDATE_RULES.map((r, i) => ({ ...r, enabled: false, priority: 100 + i })),
        ];
        await tx
          .insert(searchRules)
          .values(
            rules.map((r) => ({
              channelId,
              query: r.query,
              normalizedQuery: normalizeQuery(r.query),
              endpoint: r.endpoint,
              categoryHint: r.categoryHint,
              enabled: r.enabled,
              priority: r.priority,
              memo: r.enabled ? "초기 활성 검색어" : "비활성 후보 — 필요하면 켜세요",
            })),
          )
          .onConflictDoNothing();

        // 공식 출처 후보: 도메인·게시판 미확인, 어댑터 미연결 상태로 등록
        await tx
          .insert(officialSources)
          .values(
            SCHOOL_SEEDS.map((s) => ({
              channelId,
              name: s.name,
              aliases: s.aliases,
              schoolType: s.schoolType,
              enabled: false,
              verificationNote: "초기 조사 목록 — 학교 분류·도메인·게시판을 공식 자료로 확인 필요",
            })),
          )
          .onConflictDoNothing();
      }
    }
    for (const c of [
      { slug: "penguin", name: "우주펭귄상회", description: "웹툰 · 캐릭터 IP", accentColor: "#51635A" },
      { slug: "fryday", name: "Fryday", description: "감자튀김 · 음식 탐구", accentColor: "#BD742B" },
    ]) await tx.insert(channels).values({ ...c, contentType: "manual", audience: "일반 독자",
      budget: { naverCallsPerRun: 0, resultsPerRun: 0, fetchTargetsPerRun: 0, fetchCallsPerRun: 0, llmCallsPerRun: 0, dailyPublishLimit: 0, discovery: { enabled: false, autoDraft: false } },
    }).onConflictDoNothing({ target: channels.slug });
    await tx
      .insert(appSettings)
      .values({ key: "global_stop", value: false })
      .onConflictDoNothing({ target: appSettings.key });
  });
  return { createdChannels };
}

export async function getSetting<T>(db: DB, key: string, def: T): Promise<T> {
  const r = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return r.length ? (r[0].value as T) : def;
}

