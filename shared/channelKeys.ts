// Read old backups and saved revisions without reviving the former public name.
export const normalizeStudioChannel = (key: string) => key === "highway" ? "highscoop" : key === "science-dialogue" ? "news" : key;
export const studioKey = (slug: string) => slug === "opportunities" ? "highscoop" : slug === "current-dialogue" ? "news" : normalizeStudioChannel(slug);
// Database IDs and collection slugs stay stable to preserve sources and approvals.
export const channelSlug = (key: string) => normalizeStudioChannel(key) === "highscoop" ? "opportunities" : normalizeStudioChannel(key) === "news" ? "current-dialogue" : key;

