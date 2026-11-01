export type EditorialIdea = {
  key: string; number: number; title: string; category: string; angle: string;
  format: "카드뉴스" | "웹툰"; beats: string[]; references: Array<{ label: string; url: string }>;
  verification: string;
};
export function readIdea(value: unknown): EditorialIdea | null {
  const idea = (value as { idea?: EditorialIdea } | null)?.idea;
  return idea && typeof idea.title === "string" && Array.isArray(idea.beats) && Array.isArray(idea.references) ? idea : null;
}
export function isIdeaChannel(channel?: { slug: string; name: string; contentType: string } | null) {
  return !!channel && (channel.slug === "fryday" || (channel.contentType === "manual" && /웹툰|webtoon/i.test(channel.name + channel.slug)));
}
