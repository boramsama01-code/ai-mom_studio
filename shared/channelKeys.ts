/** Only historical built-in aliases are special; user-created keys pass through. */
const STUDIO_ALIASES: Readonly<Record<string, string>> = {
  highway: "highscoop", opportunities: "highscoop",
  "science-dialogue": "news", "current-dialogue": "news",
};
export const normalizeStudioChannel = (key: string) => Object.hasOwn(STUDIO_ALIASES, key) ? STUDIO_ALIASES[key] : key;
export const studioKey = normalizeStudioChannel;

// Database IDs and collection slugs stay stable to preserve sources and approvals.
export const channelSlug = (key: string) => {
  const normalized = normalizeStudioChannel(key);
  return normalized === "highscoop" ? "opportunities" : normalized === "news" ? "current-dialogue" : normalized;
};

/** Reserved aliases cannot be added as distinct channels with shared credentials. */
export const RESERVED_CHANNEL_KEYS = ["all", "penguin", "fryday", "highscoop", "highway", "news", "opportunities", "science-dialogue", "current-dialogue"] as const;
export function channelStoredKeys(slug: string): string[] {
  const canonical = channelSlug(slug);
  return [...new Set([slug, canonical, studioKey(slug), ...Object.keys(STUDIO_ALIASES).filter(key => channelSlug(key) === canonical)])];
}

