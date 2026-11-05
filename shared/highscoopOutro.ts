import { studioKey } from "./channelKeys";

/** The operator's supplied account logo is embedded unchanged, including alpha. */
export const HIGHSCOOP_PROFILE_ASSET_ID = "brand:highscoop:original:20261101" as const;
export const HIGHSCOOP_PROFILE_ASSET = {
  id: HIGHSCOOP_PROFILE_ASSET_ID, label: "HighScoop 계정 로고 · 원본", kind: "profile" as const,
  serverPath: "assets/branding/highscoop-original.png",
  sha256: "936ce7f841eb2f275dfc32a7062aee1ad51e93dbc99419fa3b58239a8f91b173",
  libraryId: "libfile_252d8ac63af88191b27cb990db40ec4e",
} as const;
export const HIGHSCOOP_HANDLE = "@highscoop.official";
export const HIGHSCOOP_OUTRO_THEME_IDS = ["middle_admission", "high_admission", "competition", "camp", "opportunity"] as const;
export type HighscoopOutroThemeId = typeof HIGHSCOOP_OUTRO_THEME_IDS[number];
export const HIGHSCOOP_OUTRO_THEMES = {
  middle_admission: { label: "중등입시", cue: "다음 학교로, 한 걸음.", action: "준비할 일정은 저장하고,\n다음 입시 소식도 함께 확인해요.", background: "#142641", ink: "#F1F6FF", accent: "#B4D8FF", soft: "#243954" },
  high_admission: { label: "고등입시", cue: "나에게 맞는 다음 선택.", action: "학교별 일정은 저장하고,\n다음 입시 소식도 함께 확인해요.", background: "#20273A", ink: "#FBF7EE", accent: "#F4D39A", soft: "#333A4A" },
  competition: { label: "전국대회", cue: "도전할 기회를 발견해요.", action: "관심 있는 대회는 저장하고,\n다음 도전 소식도 함께 확인해요.", background: "#302426", ink: "#FFF2EC", accent: "#F3B19A", soft: "#493335" },
  camp: { label: "캠프·체험", cue: "호기심이 경험이 되는 곳.", action: "가보고 싶은 경험은 저장하고,\n다음 모집 소식도 함께 확인해요.", background: "#122C35", ink: "#F0F8F5", accent: "#A8E5C8", soft: "#24414A" },
  opportunity: { label: "새로운 기회", cue: "우리의 다음 도전을 찾아요.", action: "관심 있는 기회는 저장하고,\n다음 모집 소식도 함께 확인해요.", background: "#172B36", ink: "#EFF8F7", accent: "#BCE5DF", soft: "#2A414C" },
} as const;

export function isHighscoopChannel(channelSlug?: string | null): boolean {
  return !!channelSlug && studioKey(channelSlug) === "highscoop";
}

/** A saved operating category outranks words appearing incidentally in the title.
 * This selects a visual theme only; it never changes the source's factual fields. */
export function highscoopOutroTheme(subcategory?: string | null, payload: Record<string, unknown> = {}): HighscoopOutroThemeId {
  const known: Record<string, HighscoopOutroThemeId> = { "중등입시": "middle_admission", "고등입시": "high_admission", "전국대회": "competition", "캠프·체험 선발모집": "camp" };
  if (subcategory && Object.hasOwn(known, subcategory)) return known[subcategory];
  const category = typeof payload.category === "string" ? payload.category : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  for (const text of [category, title]) {
    if (/캠프|체험/.test(text)) return "camp";
    if (/대회|올림피아드|경시/.test(text)) return "competition";
    if (/중등입시|중학교.*(?:입시|입학|신입생)/.test(text)) return "middle_admission";
    if (/고등입시|고등학교|과학고|영재학교|자사고|외고|국제고|입시|입학설명회/.test(text)) return "high_admission";
  }
  return "opportunity";
}
