// Stable aliases keep existing content attached when display names change.
export const studioKey = (slug: string) => slug === "opportunities" ? "highway" : slug === "current-dialogue" ? "news" : slug;
export const channelSlug = (key: string) => key === "highway" ? "opportunities" : key === "news" ? "current-dialogue" : key;
