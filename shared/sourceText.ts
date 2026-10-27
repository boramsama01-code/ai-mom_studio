export const SOURCE_TEXT_LIMIT = 50_000;
export const SOURCE_QUOTE_LIMIT = 400;
export const SOURCE_QUOTE_COUNT = 8;

/** Exact excerpts for review, never inferred facts or application dates. */
export function suggestSourceQuotes(text: string): string[] {
  const seen = new Set<string>();
  const candidates = text.split(/\n|(?<=[.!?。！？])\s+/).map((line, index) => {
    const quote = line.trim().slice(0, SOURCE_QUOTE_LIMIT).trim();
    const score = /모집|접수|신청|대상|자격|기간|마감|발표|연구|개발|밝혔|설명했/.test(quote) ? 1 : 0;
    return { quote, score, index };
  }).filter(({ quote }) => {
    if (quote.length < 20 || /^(무단\s*전재|저작권|Copyright|광고|구독하기)/i.test(quote) || seen.has(quote)) return false;
    seen.add(quote); return true;
  });
  return candidates.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5).sort((a, b) => a.index - b.index).map(c => c.quote);
}
