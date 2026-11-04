import type { FamilyPageId } from "./familyDialogue";

/** Shared editorial palette. These are defaults, never a replacement for saved operator choices. */
export const FAMILY_COLORS = {
  charcoal: "#1B2023", deepGreen: "#202725", paper: "#F3F0E7",
  butter: "#F4D66A", muted: "#B9C2BD", panel: "#29312E", white: "#FFFFFF",
} as const;
export const FAMILY_PAGE_COLORS: Record<FamilyPageId, string> = {
  cover: FAMILY_COLORS.deepGreen, news_summary: FAMILY_COLORS.charcoal, implication: FAMILY_COLORS.deepGreen,
  discussion: FAMILY_COLORS.charcoal, perspectives: FAMILY_COLORS.deepGreen, concept: FAMILY_COLORS.charcoal,
  activity: FAMILY_COLORS.deepGreen, outro: FAMILY_COLORS.charcoal,
};
