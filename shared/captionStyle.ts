/** Applied only when proposing a new caption. Saved operator copy stays untouched. */
export const CAPTION_EMOJI_GUIDE = `게시용 캡션은 짧은 문단으로 나누고 주제와 의미가 맞는 서로 다른 이모지 3~6개를 자연스럽게 사용하세요. 짧은 캡션은 1~3개면 충분합니다.
이모지는 문단·소제목 앞에 하나씩 두어 읽는 순서를 돕습니다. 예: 입시 🎓, 캠프 🏕️, 대회 🏆, 과학 🔬, 뉴스 📰, 일정 📅, 대상 👥, 대화 💬, 저장 🔖. 매번 같은 이모지만 반복하거나 한 문장에 여러 개를 나열하지 마세요.
이모지 때문에 사실·날짜·핵심 문구를 바꾸지 마세요. 정확히 유지해야 하는 중심 질문(coreQuestion) 같은 구조화 필드에는 이모지를 붙이지 말고 완성 캡션의 문단 앞에서만 사용하세요. 대체텍스트와 카드 본문에는 이 캡션용 장식을 적용하지 않습니다.
사망·참사·피해·전쟁처럼 무거운 주제는 이모지를 줄이거나 생략하세요. 사용자가 이모지 없는 문체를 요청했거나 기존 문구를 그대로 유지하라고 한 경우 그 요청을 우선하세요.`;

export type CaptionSection = { text: string | null | undefined; emoji?: string };
const emojiCharacters = /\p{Extended_Pictographic}/gu;

export function isSoberCaption(text: string): boolean {
  return /사망|숨졌|참사|희생자|전쟁|성폭력|성범죄|학대|실종|자살|재난|재해|피해자|유가족/.test(text);
}

export function captionTopicEmoji(text: string, kind?: string): string {
  if (/캠프|체험|탐방|camp/i.test(text)) return "🏕️";
  if (/입시|입학|전형|진학|신입생|과학고|영재학교/i.test(text)) return "🎓";
  if (/대회|올림피아드|경시|공모전|contest/i.test(text)) return "🏆";
  if (/우주|천문|별자리|행성|위성|로켓/.test(text)) return "🌌";
  if (/지구|환경|생태|기후|나무|식물/.test(text)) return "🌱";
  if (/예술|미술|전시|그림/.test(text)) return "🎨";
  if (/음악|공연|연주/.test(text)) return "🎵";
  if (/여행|방문|관광/.test(text)) return "🧭";
  if (/감자튀김|fryday|fries/i.test(text)) return "🍟";
  if (kind === "science_dialogue") return "🔬";
  return kind === "notice" ? "📣" : "📰";
}

/** Keep every word and source intact, adding at most one diverse marker per selected section. */
export function composeReadableCaption(sections: CaptionSection[], context = ""): string {
  const included = sections.filter((section): section is CaptionSection & { text: string } => !!section.text?.trim());
  const fullText = included.map(section => section.text).join("\n\n");
  if (isSoberCaption(`${context}\n${fullText}`)) return fullText;
  const existing = fullText.match(emojiCharacters) ?? [];
  const used = new Set(existing);
  let remaining = Math.max(0, 6 - existing.length);
  return included.map(({ text, emoji }) => {
    if (!emoji || !remaining || /^\s*\p{Extended_Pictographic}/u.test(text) || used.has(emoji.replace(/\uFE0F/g, ""))) return text;
    remaining--; used.add(emoji.replace(/\uFE0F/g, ""));
    return `${emoji} ${text}`;
  }).join("\n\n");
}
