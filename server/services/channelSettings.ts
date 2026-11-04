import { and, eq, inArray, sql } from "drizzle-orm";
import { channelCategories } from "../../shared/channelCategories";
import { channelStoredKeys } from "../../shared/channelKeys";
import { DEFAULT_BUDGET } from "../../shared/domain";
import { channels, contentItems, searchRules, studioCards, type Channel, type ChannelBudget } from "../../shared/schema";
import type { DB } from "../db";
import { HttpError } from "../routes/util";
import { slugToEnvPart } from "./secrets";

/** Creation alone starts no jobs and enables no social destination. */
export function newChannelBudget(contentType: string): ChannelBudget {
  return {
    ...DEFAULT_BUDGET,
    ...(contentType === "manual" ? { naverCallsPerRun: 0, resultsPerRun: 0, fetchTargetsPerRun: 0, fetchCallsPerRun: 0, llmCallsPerRun: 0 } : {}),
    dailyPublishLimit: 0,
    discovery: { enabled: false, autoDraft: false },
  };
}

/** Caller holds the channel-directory advisory lock; legacy underscore keys also count. */
export async function assertAvailableChannelSlug(db: DB, slug: string) {
  const existing = await db.select({ slug: channels.slug }).from(channels);
  if (existing.some(channel => channel.slug === slug)) throw new HttpError(409, "이미 사용하는 채널 주소입니다. 다른 주소를 입력해 주세요.");
  const prefix = slugToEnvPart(slug);
  if (existing.some(channel => slugToEnvPart(channel.slug) === prefix)) throw new HttpError(409, "기존 채널과 연결 설정의 이름이 겹칩니다. 다른 채널 주소를 입력해 주세요.");
}

/** Removing a live label must not make existing content or search rules uneditable. */
export async function assertCategoryRemovalSafe(db: DB, current: Channel, next: readonly string[] | null) {
  const allowed = channelCategories(current.slug, next);
  const removed = channelCategories(current.slug, current.categories).filter(value => !allowed.includes(value));
  if (!removed.length) return;
  const [items, rules, cards] = await Promise.all([
    db.select({ category: contentItems.subcategory }).from(contentItems).where(and(eq(contentItems.channelId, current.id), inArray(contentItems.subcategory, removed))),
    db.select({ category: searchRules.subcategory }).from(searchRules).where(and(eq(searchRules.channelId, current.id), inArray(searchRules.subcategory, removed))),
    db.select({ category: sql<string>`${studioCards.content}->>'subcategory'` }).from(studioCards).where(and(
      inArray(sql<string>`${studioCards.content}->>'channel'`, channelStoredKeys(current.slug)),
      inArray(sql<string>`${studioCards.content}->>'subcategory'`, removed),
    )),
  ]);
  const used = [...new Set([...items, ...rules, ...cards].flatMap(row => row.category ? [row.category] : []))];
  if (used.length) throw new HttpError(409, `사용 중인 소분류는 지울 수 없습니다: ${used.join(", ")}. 콘텐츠와 검색어의 분류를 먼저 변경해 주세요.`, { usedCategories: used });
}
