import { studioKey } from "./channelKeys";

/** Shared operating taxonomy; independent of legacy admission extraction categories. */
export const CHANNEL_CATEGORIES: Record<string, readonly string[]> = {
  highscoop: ["중등입시", "고등입시", "전국대회", "캠프·체험 선발모집"],
  news: ["과학", "사회", "정치", "예술", "여행", "최신이슈"],
  fryday: ["감자튀김 맛집", "감자튀김 이슈·토픽", "온라인커뮤니티 인기글"],
  penguin: ["웹툰"],
};
export const UNCLASSIFIED = "미분류";
export function channelCategories(channel: string): readonly string[] {
  return channel === "all" ? [...new Set(Object.values(CHANNEL_CATEGORIES).flat())] : CHANNEL_CATEGORIES[studioKey(channel)] ?? [];
}
export function validSubcategory(channel: string, value?: string | null): boolean {
  return !value || channelCategories(channel).includes(value);
}
export function categoryLabel(value?: string | null): string { return value || UNCLASSIFIED; }
