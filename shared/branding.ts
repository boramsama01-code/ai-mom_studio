/** Display names only. Persisted slugs, channel IDs and destination bindings stay stable. */
export const BRAND_REVISION = "20261101-spacepenguin";
export const CHANNEL_BRANDS = {
  penguin: { name: "우주펭귄상회", korean: "우주펭귄상회", description: "우주펭귄 가족의 이야기와 캐릭터" },
  fryday: { name: "Fryday", korean: "프라이데이", description: "김펭귄의 감자튀김과 음식 탐구" },
  highscoop: { name: "Highscoop", korean: "하이스쿱", description: "입시·모집·새로운 배움의 기회" },
  news: { name: "Alligodang", korean: "알리고당", description: "아이와 함께 나누는 뉴스·과학·세상 이야기" },
} as const;

/** Science remains a separate collection queue under the same public brand. */
export function cardBrandName(name: string): string {
  const clean = name.replace(/^(?:아이맘|ai[\s_-]?mom)\s*[·|:]\s*/i, "").trim();
  if (/^(Highway|하이웨이|Highscoop|하이스쿱|도전·진학)(\s*[·|].*)?$/i.test(clean) || /^하루\s*10\s*분\s*[·|:]?\s*(입시|모집정보?)$/i.test(clean)) return CHANNEL_BRANDS.highscoop.name;
  if (/^(Alligodang|알리고당|와이브리프|why[\s_-]*brief)(\s*[·|].*)?$/i.test(clean) || /^하루\s*10\s*분(?:\s*[·|:]?\s*(과학|시사|뉴스|토론))?$/i.test(clean) || ["시사 채널 · 이름 미정", "과학 대화", "하루 과학 대화", "하루 시사 대화"].includes(clean)) return CHANNEL_BRANDS.news.name;
  if (/^(ai[\s_-]?mom|아이맘)(\s*(studio|스튜디오))?$/i.test(clean)) return CHANNEL_BRANDS.penguin.name;
  return clean;
}
