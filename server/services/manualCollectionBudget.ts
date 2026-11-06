import type { ChannelBudget } from '../../shared/schema';
import type { DiscoverySettings } from '../../shared/domain';
import type { BoardConfig } from './boardAdapter';

// Existing adapter contracts: Naver tries two key formats, with three bounded
// attempts each; news may then use one RSS search. Publisher lookup performs at
// most five reads, followed by at most one PDF attachment. GED visits ten pages.
const SEARCH_ATTEMPTS_PER_QUERY = 2 * 3 + 1;
const ARTICLE_READS_WITH_ATTACHMENT = 5 + 1;
const SUPPORTING_ARTICLES_PER_PICK = 2;
const safe = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('선택한 수집 작업량을 안전한 유한 범위로 계산할 수 없습니다.');
  return value;
};
export const manualSearchCalls = (queries: number) => safe(safe(queries) * SEARCH_ATTEMPTS_PER_QUERY);
export function manualBoardWorkload(config: BoardConfig) {
  const perPage = config.format === 'ged_selection'
    ? [100, 50, 40, 30, 20, 10].find(n => n <= (config.maxItems ?? 100)) ?? 10
    : Math.min(100, Math.max(1, Math.floor(config.maxItems ?? 20)));
  const pages = config.format === 'ged_selection' ? 10 : 1;
  return { pages, results: safe(perPage * pages) };
}

/** Only explicit collection-only jobs use this plan; persisted/scheduled budgets
 * remain untouched. Every allowance corresponds to selected finite work. */
export function manualCollectionBudget(
  stored: ChannelBudget,
  rules: ReadonlyArray<{ display: number }>,
  boards: ReadonlyArray<BoardConfig>,
  discovery: DiscoverySettings | null,
) {
  const discoveryQueries = discovery?.enabled && discovery.picksPerRun > 0 ? discovery.queries.length : 0;
  const discoveryPicks = Math.min(Math.max(0, Math.floor(discovery?.picksPerRun ?? 0)), discoveryQueries * 100);
  const boardWork = boards.map(manualBoardWorkload);
  const boardCalls = safe(boardWork.reduce((n, b) => n + b.pages, 0));
  const boardResults = safe(boardWork.reduce((n, b) => n + b.results, 0));
  const searchResults = safe(rules.reduce((n, r) => n + Math.min(100, Math.max(1, Math.floor(r.display))), 0));
  const results = safe(boardResults + searchResults + discoveryPicks);
  const fetchCalls = safe(boardCalls + results * ARTICLE_READS_WITH_ATTACHMENT + discoveryPicks * SUPPORTING_ARTICLES_PER_PICK);
  return {
    budget: { ...stored, naverCallsPerRun: manualSearchCalls(rules.length + discoveryQueries), resultsPerRun: results,
      fetchTargetsPerRun: results, fetchCallsPerRun: fetchCalls },
    boardCalls, boardResults, discoveryQueries, discoveryPicks,
  };
}
