import { validSubcategory } from "../../shared/channelCategories";
/**
 * 수집 실행 1회 (채널 단위)
 * 1) 설정 스냅샷 → 2) 공식 게시판 → 3) 공개 뉴스 검색·저장 → 4) 원문 확보 → 5) 선택적 구조화 추출
 * 실패를 "정상 0건"으로 숨기지 않는다. 처리하지 못한 자료는 사유와 함께 보존한다.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  channels,
  contentItems,
  contentRevisions,
  officialSources,
  runs,
  searchRules,
  sourceDocuments,
  type Channel,
  type SearchRule,
} from "../../shared/schema";
import { naverSearch, applyExcludeTerms, NaverError, searchCalls, type CallCounter, type NaverItem } from "../services/naver";
import { createNewsSearch, type RssLoader } from "../services/newsSearch";
import { normalizeUrl } from "../services/url";
import { extractPdf } from "../services/extract";
import { fetchPublisherArticle as fetchAndExtract } from "../services/publisherLookup";
import { sourceFetchUrl } from "../services/sourceFetchUrl";
import { safeFetch } from "../services/safeFetch";
import { extractNotice, generateCardCopy, LlmBudget, PROMPT_VERSION, type LlmSource, type AiProvider } from "../services/llm";
import { channelAiAvailability, channelAiSelection } from "../services/channelAi";
import type { AiSelection } from "../../shared/channelAi";
import { computeScheduleStatus } from "../services/dates";
import { computeEvidenceStatus, materialChange } from "./evidence";
import { createRevision } from "../content";
import { sendReviewMessage } from "../services/telegram";
import { getSetting } from "../seed";
import { env } from "../env";
import { sha256 } from "../services/text";
import { fetchBoardList, parseBoardDate, type BoardConfig } from "../services/boardAdapter";
import { kstDateStartIso } from "../services/dates";
import { categoryForSchoolType } from "../../shared/domain";
import { runDiscovery, upsertNaverDoc } from "./discovery";
import { generateDialogueDraft } from "./generate";
import { persistSourceFetchAttempt } from "../services/sourceFetchPersistence";
import { assertGenerationActive, completeGenerationResult, currentGenerationSignal } from "../services/generationContext";
import type { NoticePayload } from "../../shared/payloads";
import { classifyNotice, noticeSearchQuery } from "../../shared/noticeIntent";
import { itemPrimarySource } from "../services/itemSources";
import { preserveCardCopy } from "../../shared/cardCopy";
import { readingProfileForTemplateKey } from "../../shared/readingCardProfiles";
import { boardMatchesCategory, officialCategory, officialConfig, officialFirstSearchLimit } from "../services/officialCatalog";
import { generateFamilySourceDraft } from "../services/familySourceDraft";
import type { AiExecutionPlan } from "../../shared/aiProvenance";

export type CollectOptions = {
  trigger: "manual" | "worker" | "cli" | "schedule";
  now?: Date;
  naverFetch?: typeof fetch; // 테스트용 주입
  rssLoad?: RssLoader; // 공개 RSS 수집 테스트용 주입
  fetchSource?: typeof fetchAndExtract; // 테스트용 주입
  fetchBoard?: typeof fetchBoardList; // 테스트용 주입
  heartbeat?: () => Promise<unknown>;
  collectionOnly?: boolean;
  subcategory?: string;
};

export type CollectSummary = {
  runId: number;
  status: string;
  counts: Record<string, number>;
  errors: Array<{ scope: string; message: string }>;
};

export async function runCollect(db: DB, channelId: number, opts: CollectOptions): Promise<CollectSummary> {
  currentGenerationSignal()?.throwIfAborted();
  const now = opts.now ?? new Date();
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) throw new Error("채널 없음");
  if (!channel.active) throw new Error("보관된 채널 — 수집하지 않음");
  if (await getSetting(db, "global_stop", false)) throw new Error("전역 정지 상태 — 수집하지 않음");
  // Pin both roles for this entire collection. Settings edited while fetching
  // sources take effect on the next run, never halfway through this one.
  const ai = env.autoGenerate && !opts.collectionOnly
    ? { summary: channelAiSelection(channel, "summary"), copy: channelAiSelection(channel, "copy") } : null;
  const summaryConfigured = !!ai && channelAiAvailability()[ai.summary.provider];

  if (!validSubcategory(channel.slug, opts.subcategory, channel.categories)) throw new Error("이 채널의 소분류를 선택해 주세요.");
  const rules = await db
    .select()
    .from(searchRules)
    .where(and(eq(searchRules.channelId, channelId), eq(searchRules.enabled, true), isNull(searchRules.deletedAt), opts.subcategory ? eq(searchRules.subcategory, opts.subcategory) : undefined))
    .orderBy(sql`${searchRules.lastRunAt} asc nulls first`, asc(searchRules.priority), asc(searchRules.id));

  const budget = channel.budget;
  const plannedNaver = rules.length; // 규칙 1개 = 호출 1회 (news/blog 각각 별도 규칙)
  let selected = rules.slice(0, budget.naverCallsPerRun);
  const skippedRules = rules.slice(budget.naverCallsPerRun);

  const officials = await db.select().from(officialSources).where(eq(officialSources.channelId, channelId)).orderBy(sql`${officialSources.lastCheckedAt} asc nulls first`, asc(officialSources.id));
  const unconnected = officials.filter((o) => o.enabled && !o.adapter).map((o) => o.name);
  const boards = officials.filter((o) => o.enabled && o.adapter === "generic_board" && o.verifiedAt && o.domain && o.boardUrl && boardMatchesCategory(channel.slug, o, opts.subcategory, channel.categories));

  const snapshot = {
    sourcePolicy: "official_first",
    officialSources: boards.map(o => ({ id: o.id, name: o.name, url: o.boardUrl, config: officialConfig(o) })),
    subcategory: opts.subcategory ?? null,
    channel: { id: channel.id, slug: channel.slug, budget, cardTemplate: channel.cardTemplate },
    ai,
    rules: selected.map(r => ({ ...ruleSnapshot(r), searchQuery: channel.contentType === "notice" && r.endpoint === "news" ? noticeSearchQuery(r.query) : r.query })),
    skippedRules: skippedRules.map(ruleSnapshot),
    flags: { dryRun: env.dryRun, autoGenerate: env.autoGenerate },
  };
  const [run] = await db
    .insert(runs)
    .values({
      channelId,
      kind: "collect",
      trigger: opts.trigger,
      snapshot,
      plannedCalls: { naver: plannedNaver, naverAllowed: selected.length, fetch: budget.fetchCallsPerRun, llm: budget.llmCallsPerRun },
      unconnectedSources: unconnected,
    })
    .returning();

  const counts: Record<string, number> = { rules: selected.length, rulesSkippedByBudget: skippedRules.length, results: 0, newItems: 0, duplicates: 0, excluded: 0, fetchedOk: 0, fetchFailed: 0, extracted: 0, extractFailed: 0, closed: 0 };
  const errors: Array<{ scope: string; message: string }> = [];
  const counter: CallCounter = { naver: 0, limit: budget.naverCallsPerRun };
  const newItemIds: number[] = [];
  const publicSearch = createNewsSearch({ now, loadXml: opts.rssLoad, recruitment: channel.contentType === "notice" });
  // Existing Naver fixtures exercise the same storage pipeline; production uses public RSS.
  const selectedSearch = opts.naverFetch ? ((q: string, e: "news" | "blog", d: number, c: CallCounter) => naverSearch(q, e, d, c, opts.naverFetch)) : publicSearch.search;
  const search: typeof publicSearch.search = (...args) => { currentGenerationSignal()?.throwIfAborted(); return selectedSearch(...args); };
  const llmBudget = new LlmBudget(budget.llmCallsPerRun);
  let fetchCalls = 0;

  try {
  /* 1) 공식 목록 우선. 목록에 전체 예산을 소진하지 않도록 본문 조회 예산을 남긴다. */
  counts.officialBoards = boards.length;
  counts.officialChecked = 0;
  counts.officialSucceeded = 0;
  counts.officialFailed = 0;
  counts.officialNew = 0;
  counts.officialDuplicates = 0;
  const boardLimit = Math.min(boards.length, Math.floor(budget.fetchCallsPerRun / 2));
  const officialTargets: number[][] = [];
  for (const o of boards) {
    currentGenerationSignal()?.throwIfAborted();
    if (counts.officialChecked >= boardLimit || counts.results >= budget.resultsPerRun) {
      counts.officialDeferred = (counts.officialDeferred ?? 0) + 1;
      continue;
    }
    counts.officialChecked++;
    fetchCalls++;
    const config = officialConfig(o);
    let r: Awaited<ReturnType<typeof fetchBoardList>>;
    try { r = await (opts.fetchBoard ?? fetchBoardList)(o.boardUrl!, o.domain!, config); }
    catch (error) { currentGenerationSignal()?.throwIfAborted(); r = { ok: false, error: error instanceof Error ? error.message : "게시판 조회 실패" }; }
    if (!r.ok || !r.entries.length) {
      const message = r.ok ? "목록을 찾지 못했습니다. 게시판 구조·접근 상태를 확인하세요." : r.error;
      counts.officialFailed++;
      errors.push({ scope: `official:${o.id}`, message: `${o.name}: ${message} · 직접 확인: ${o.boardUrl}` });
      await db.update(officialSources).set({ lastCheckedAt: now, lastStatus: "failed", lastError: message, lastNewCount: 0 }).where(eq(officialSources.id, o.id));
      await opts.heartbeat?.();
      continue;
    }
    counts.officialSucceeded++;
    let sourceNew = 0;
    const targets: number[] = [];
    // Reserve diversity even when a single feed has hundreds of entries.
    const sourceLimit = Math.max(1, Math.ceil(budget.resultsPerRun / Math.max(2, boardLimit)));
    let accepted = 0;
    for (const e of r.entries) {
      currentGenerationSignal()?.throwIfAborted();
      if (counts.results >= budget.resultsPerRun || accepted >= sourceLimit) {
        counts.officialResultsDeferred = (counts.officialResultsDeferred ?? 0) + 1;
        continue;
      }
      const category = officialCategory(channel.slug, o, e.title, channel.categories);
      if (opts.subcategory && category !== opts.subcategory) continue;
      const day = parseBoardDate(e.dateText);
      if (day && config.maxAgeDays && now.getTime() - Date.parse(`${day}T00:00:00+09:00`) > config.maxAgeDays * 86400_000) {
        counts.officialOldSkipped = (counts.officialOldSkipped ?? 0) + 1;
        continue;
      }
      if (channel.contentType === "notice") {
        const intent = classifyNotice(e.title);
        if (intent === "retrospective" || intent === "off_topic" || (config.recruitmentOnly && intent !== "candidate")) {
          counts.noticeReportsSkipped = (counts.noticeReportsSkipped ?? 0) + 1;
          continue;
        }
      }
      counts.results++;
      accepted++;
      const saved = await saveOfficialEntry(db, channel, o.id, o.schoolType, run.id, e, category);
      if (saved?.isNew) {
        sourceNew++;
        counts.officialNew++;
        counts.newItems++;
      } else if (saved) { counts.officialDuplicates++; counts.duplicates++; }
      if (saved && (saved.isNew || saved.needsFetch)) targets.push(saved.itemId);
    }
    officialTargets.push(targets);
    await db.update(officialSources).set({ lastCheckedAt: now, lastStatus: "ok", lastError: null, lastNewCount: sourceNew }).where(eq(officialSources.id, o.id));
    await opts.heartbeat?.();
  }
  if (counts.officialDeferred) errors.push({ scope: "official_budget", message: `공식 출처 ${counts.officialDeferred}곳은 호출·결과 한도로 다음 실행에서 먼저 확인합니다.` });
  // Round robin gives every board a first body fetch before one board gets a second.
  while (officialTargets.some(ids => ids.length)) for (const ids of officialTargets) {
    const id = ids.shift(); if (id && !newItemIds.includes(id)) newItemIds.push(id);
  }

  /* 2) 뉴스는 보완. 공식 경로가 모두 실패하면 기존 검색 한도로 복원한다. */
  counter.limit = officialFirstSearchLimit(channel.contentType, budget.naverCallsPerRun, counts.officialSucceeded);
  selected = selected.slice(0, counter.limit);
  counts.supplementSearchLimit = counter.limit;
  counts.rules = selected.length;
  counts.rulesSkippedByPolicy = Math.max(0, Math.min(rules.length, budget.naverCallsPerRun) - selected.length);
  // Keep at least half the search budget for operator keywords when discovery is enabled.
  const discoveryCounter = counter;
  const searchLimit = counter.limit;
  if (rules.length && counts.officialSucceeded > 0) counter.limit = Math.floor(searchLimit / 2);
  const disc = opts.subcategory || counts.results >= budget.resultsPerRun ? null : await runDiscovery(db, channel, run.id, discoveryCounter, llmBudget, now, search, opts.collectionOnly, budget.resultsPerRun - counts.results);
  counter.limit = searchLimit;
  if (disc) {
    Object.assign(counts, disc.counts);
    errors.push(...disc.errors);
    counts.newItems += disc.itemIds.length;
    counts.results += disc.itemIds.length;
    newItemIds.push(...disc.itemIds);
    await opts.heartbeat?.();
  }

  /* 3) 검색 → 저장 */
  counts.rulesProcessed = 0;
  counts.rulesSucceeded = 0;
  for (const rule of selected) {
    currentGenerationSignal()?.throwIfAborted();
    if (searchCalls(counter) >= counter.limit) break;
    if (counts.results >= budget.resultsPerRun) {
      errors.push({ scope: `rule:${rule.id}`, message: "이번 실행 결과 한도 도달 — 남은 검색어 건너뜀" });
      break;
    }
    let items: NaverItem[] = [];
    let ruleNew = 0;
    counts.rulesProcessed++;
    try {
      items = await search(rule.query, rule.endpoint as "news" | "blog", rule.display, counter);
      counts.rulesSucceeded++;
    } catch (e) {
      currentGenerationSignal()?.throwIfAborted();
      const ne = e as NaverError;
      errors.push({ scope: `rule:${rule.id}`, message: `${rule.query}(${rule.endpoint}): ${ne.message}` });
      await db.update(searchRules).set({ lastRunAt: now, lastRunStatus: "failed", lastRunError: ne.message, lastRunNewCount: 0 }).where(eq(searchRules.id, rule.id));
      continue;
    }
    for (const it of items) {
      currentGenerationSignal()?.throwIfAborted();
      if (counts.results >= budget.resultsPerRun) break;
      counts.results++;
      if (channel.contentType === "notice") {
        const intent = classifyNotice(it.title, it.description);
        if (intent === "retrospective" || intent === "off_topic") {
          counts.noticeReportsSkipped = (counts.noticeReportsSkipped ?? 0) + 1;
          continue;
        }
      }
      const saved = await saveSearchItem(db, channel, rule, run.id, it);
      if (!saved) continue;
      if (saved.excluded) counts.excluded++;
      if (saved.isNew) {
        counts.newItems++;
        ruleNew++;
        if (!saved.excluded) newItemIds.push(saved.itemId);
      } else counts.duplicates++;
    }
    await db
      .update(searchRules)
      .set({ lastRunAt: now, lastRunStatus: "ok", lastRunError: null, lastRunNewCount: ruleNew })
      .where(eq(searchRules.id, rule.id));
    await opts.heartbeat?.();
  }

  /* 4) 원문 확보 */
  const fetchTargets = newItemIds.slice(0, budget.fetchTargetsPerRun);
  if (newItemIds.length > fetchTargets.length)
    errors.push({ scope: "fetch", message: `원문 확보 대상 한도(${budget.fetchTargetsPerRun}) 초과 — ${newItemIds.length - fetchTargets.length}건은 제목·요약만 저장했습니다. 필요한 자료에서 원문을 추가 확인하세요.` });
  const fetcher = opts.fetchSource ?? fetchAndExtract;
  const fetchedOk: number[] = [];
  for (const itemId of fetchTargets) {
    currentGenerationSignal()?.throwIfAborted();
    if (fetchCalls >= budget.fetchCallsPerRun) {
      errors.push({ scope: "fetch", message: "원문 호출 한도 도달" });
      break;
    }
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
    fetchCalls++; // Reserve the primary request before any redirect/feed/attachment request.
    const r = await fetchDoc(db, item.primarySourceId!, fetcher, now, () => (fetchCalls < budget.fetchCallsPerRun && !opts.fetchSource ? (fetchCalls++, true) : false));
    if (!r.ok) {
      counts.fetchFailed++;
      await db.update(contentItems).set({ evidenceStatus: "fetch_failed", updatedAt: now }).where(eq(contentItems.id, itemId));
      continue;
    }
    counts.fetchedOk++;
    fetchedOk.push(itemId);
    await opts.heartbeat?.();
  }

  /* 4-2) 발굴한 화제의 보조 기사(다른 언론사) — 시사 초안의 독립 근거용 */
  if (disc) {
    for (const itemId of disc.itemIds) {
      for (const docId of (disc.supporting.get(itemId) ?? []).slice(0, 2)) {
        currentGenerationSignal()?.throwIfAborted();
        if (fetchCalls >= budget.fetchCallsPerRun) break;
        fetchCalls++;
        const r = await fetchDoc(db, docId, fetcher, now, () => false);
        if (r.ok) counts.supportingFetched = (counts.supportingFetched ?? 0) + 1;
      }
    }
  }

  /* 5) 구조화 추출 — 공고 채널 + AI 설정 시 */
  if (channel.contentType === "notice" && fetchedOk.length) {
    if (!env.autoGenerate || opts.collectionOnly) {
      counts.extractionSkippedAutoGenerateOff = fetchedOk.length;
    } else if (!ai || !summaryConfigured) {
      errors.push({ scope: "llm", message: "채널의 기사 요약 AI 미연결 — 구조화 추출 건너뜀(수집함에서 수동 편집 가능)" });
    } else {
      for (const itemId of fetchedOk) {
        currentGenerationSignal()?.throwIfAborted();
        const r = await extractForItem(db, itemId, llmBudget, now, officials, undefined, channel.cardTemplate, ai);
        if (r.ok) {
          counts.extracted++;
          if (r.scheduleStatus === "closed") counts.closed++;
          if (r.warnings.length) {
            counts.copyIncomplete = (counts.copyIncomplete ?? 0) + 1;
            errors.push(...r.warnings.map(message => ({ scope: `item:${itemId}:copy`, message })));
          }
        } else {
          counts.extractFailed++;
          errors.push({ scope: `item:${itemId}`, message: r.error });
          if (r.kind === "budget" || r.kind === "not_configured") break;
          if (r.kind === "api" && /인증|모델/.test(r.error)) break;
        }
        await opts.heartbeat?.();
      }
    }
  }

  /* 5-2) 발굴한 화제로 대화 초안 자동 생성(AI 연결 + 채널 설정이 켜져 있을 때) — 생성돼도 검토 대기 */
  if (disc?.settings.autoDraft && disc.itemIds.length) {
    if (!env.autoGenerate || opts.collectionOnly) {
      counts.draftSkippedAutoGenerateOff = disc.itemIds.length;
    } else if (!ai || !summaryConfigured) {
      // 오류가 아니라 안내 — 화제는 저장됐고 초안만 건너뜀
      counts.draftSkippedNoAi = disc.itemIds.length;
    } else {
      counts.drafted = 0;
      for (const itemId of disc.itemIds) {
        currentGenerationSignal()?.throwIfAborted();
        if (llmBudget.used >= llmBudget.limit) {
          errors.push({ scope: "llm", message: "AI 호출 한도 도달 — 남은 화제는 초안 없이 저장" });
          break;
        }
        const r = await generateDialogueDraft(db, itemId, now, undefined, channel.cardTemplate, { budget: llmBudget, ...ai });
        if (r.ok) {
          counts.drafted++;
          if (r.warnings.length) {
            counts.copyIncomplete = (counts.copyIncomplete ?? 0) + 1;
            errors.push(...r.warnings.map(message => ({ scope: `item:${itemId}:copy`, message })));
          }
        } else {
          errors.push({ scope: `item:${itemId}`, message: `초안 생성 실패: ${r.error}` });
          if (/인증|모델|미연결/.test(r.error)) break;
        }
        await opts.heartbeat?.();
      }
    }
  }

  /* 6) 실행 결과 확정 */
  currentGenerationSignal()?.throwIfAborted();
  counts.rulesDeferred = rules.length - counts.rulesProcessed;
  Object.assign(counts, publicSearch.counts);
  errors.push(...publicSearch.warnings);
  const discoveryRan = !!disc && disc.counts.discoveryQueries + disc.errors.length > 0;
  const status = (counts.rulesSucceeded + (disc?.counts.discoveryQueries ?? 0) + counts.officialSucceeded === 0 && (boards.length > 0 || selected.length > 0 || discoveryRan) && errors.length)
    ? "failed"
    : errors.length
      ? "partial"
      : counts.newItems === 0
        ? "ok_zero"
        : "ok";
  await db
    .update(runs)
    .set({
      status,
      counts,
      errors,
      actualCalls: { naver: counter.naver, rss: publicSearch.counts.rssRequests, search: searchCalls(counter), fetch: fetchCalls, llm: llmBudget.used },
      llmUsage: { inputTokens: llmBudget.inputTokens, outputTokens: llmBudget.outputTokens, calls: llmBudget.used, usageStatus: llmBudget.usageUnknown ? "usage_unknown" : "known" },
      finishedAt: new Date(),
    })
    .where(eq(runs.id, run.id));

  /* 7) 개인 검토 알림 — 실패해도 저장은 유지 */
  if (!opts.collectionOnly && env.collectReviewNotifications && counts.newItems - counts.excluded > 0 && env.telegramReviewChatId) {
    currentGenerationSignal()?.throwIfAborted();
    const msg = await buildReviewDigest(db, channel, newItemIds);
    const tg = await sendReviewMessage(msg);
    if (!tg.ok) {
      errors.push({ scope: "telegram_review", message: `검토 알림 실패: ${tg.error}` });
      await db.update(runs).set({ errors, status: status === "ok" ? "partial" : status }).where(eq(runs.id, run.id));
    }
  }

  return { runId: run.id, status, counts, errors };
  } catch (error) {
    const cancelled = currentGenerationSignal()?.aborted;
    errors.push({ scope: cancelled ? "collection_cancelled" : "collection", message: cancelled
      ? "수집 작업이 중단됐습니다. 이미 확보한 자료는 보존했고 추가 조회·생성을 시작하지 않았습니다."
      : "수집 처리 중 오류가 발생했습니다. 이미 확보한 자료는 보존했습니다. 실행 기록을 확인해 주세요." });
    Object.assign(counts, publicSearch.counts);
    await db.update(runs).set({ status: counts.newItems > 0 ? "partial" : "failed", counts, errors,
      actualCalls: { naver: counter.naver, rss: publicSearch.counts.rssRequests, search: searchCalls(counter), fetch: fetchCalls, llm: llmBudget.used },
      llmUsage: { inputTokens: llmBudget.inputTokens, outputTokens: llmBudget.outputTokens, calls: llmBudget.used, usageStatus: llmBudget.usageUnknown ? "usage_unknown" : "known" }, finishedAt: new Date(),
    }).where(eq(runs.id, run.id));
    throw error;
  }
}

function ruleSnapshot(r: SearchRule) {
  return { id: r.id, version: r.version, query: r.query, endpoint: r.endpoint, display: r.display, excludeTerms: r.excludeTerms, excludeScope: r.excludeScope, categoryHint: r.categoryHint, subcategory: r.subcategory };
}

async function saveSearchItem(db: DB, channel: Channel, rule: SearchRule, runId: number, it: NaverItem) {
  const doc = await upsertNaverDoc(db, it);
  if (!doc) return null;
  const reason = applyExcludeTerms(it, rule.excludeTerms, rule.excludeScope as "title" | "title_and_snippet");
  const inserted = await db
    .insert(contentItems)
    .values({
      channelId: channel.id,
      kind: channel.contentType,
      origin: "collected",
      primarySourceId: doc.id,
      ruleId: rule.id,
      runId,
      title: it.title || "(제목 없음)",
      category: rule.categoryHint,
      subcategory: rule.subcategory,
      excluded: !!reason,
      excludedReason: reason,
      scheduleStatus: channel.contentType === "notice" ? "unknown" : "not_applicable",
      evidenceStatus: "needs_review",
    })
    .onConflictDoNothing()
    .returning({ id: contentItems.id });
  if (inserted.length) return { itemId: inserted[0].id, isNew: true, excluded: !!reason };
  const [existing] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(eq(contentItems.channelId, channel.id), eq(contentItems.primarySourceId, doc.id)));
  return { itemId: existing.id, isNew: false, excluded: false };
}

async function saveOfficialEntry(db: DB, channel: Channel, officialId: number, schoolType: string | null, runId: number, e: { url: string; title: string; dateText: string | null }, subcategory: string | null) {
  let normalized: string;
  try {
    normalized = normalizeUrl(e.url);
  } catch {
    return null;
  }
  const ymd = parseBoardDate(e.dateText);
  await db
    .insert(sourceDocuments)
    .values({
      normalizedUrl: normalized,
      originalUrl: e.url,
      kind: "official",
      title: e.title,
      meta: { officialSourceId: officialId, fetchUrl: e.url, boardDateText: e.dateText },
      publishedRaw: e.dateText,
      publishedAt: ymd && kstDateStartIso(ymd) ? new Date(kstDateStartIso(ymd)!) : null,
      publishedPrecision: ymd ? "date" : "unknown",
    })
    .onConflictDoNothing();
  const [doc] = await db.select().from(sourceDocuments).where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
  const inserted = await db
    .insert(contentItems)
    .values({ channelId: channel.id, kind: channel.contentType, origin: "collected", primarySourceId: doc.id, runId, title: e.title, category: schoolType ? categoryForSchoolType(schoolType) : null, subcategory, scheduleStatus: channel.contentType === "notice" ? "unknown" : "not_applicable" })
    .onConflictDoNothing()
    .returning({ id: contentItems.id });
  if (inserted.length) return { itemId: inserted[0].id, isNew: true, needsFetch: true };
  const [existing] = await db.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.channelId, channel.id), eq(contentItems.primarySourceId, doc.id)));
  return existing ? { itemId: existing.id, isNew: false, needsFetch: !doc.fetchedText && doc.fetchStatus === "not_fetched" } : null;
}

/** 한 항목 구조화 추출 — 운영자 편집값·기존 승인을 덮어쓰지 않는다 */
export async function extractForItem(
  db: DB,
  itemId: number,
  budget: LlmBudget,
  now: Date,
  officials?: Awaited<ReturnType<typeof loadOfficials>>,
  provider?: AiProvider,
  templateKey?: string,
  selections?: { summary: AiSelection; copy: AiSelection; familyPlan?: AiExecutionPlan; explicitRetry?: boolean; requestId?: string },
) {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
  if (!item) return { ok: false as const, kind: "no_source", error: "항목 없음" };
  const doc = await itemPrimarySource(db, item);
  if (!doc || doc.fetchStatus !== "ok" || !doc.fetchedText) return { ok: false as const, kind: "no_source", error: "원문 미확보 — 추출하지 않음" };
  const offs = officials ?? (await loadOfficials(db, item.channelId));
  const sources: LlmSource[] = [
    { source_id: doc.id, kind: doc.kind, url: doc.originalUrl, title: doc.title, published: doc.publishedRaw, text: doc.fetchedText },
  ];
  const [channel] = await db.select().from(channels).where(eq(channels.id, item.channelId));
  if (!channel) return { ok: false as const, kind: "no_source", error: "채널을 찾을 수 없습니다." };
  const summaryAi = selections?.summary ?? channelAiSelection(channel, "summary", { provider });
  const copyAi = selections?.copy ?? channelAiSelection(channel, "copy");
  const r = await extractNotice({ sources, sourceHint: item.category, now, budget, ...summaryAi });
  currentGenerationSignal()?.throwIfAborted();
  if (!r.ok) {
    await db.update(contentItems).set({ updatedAt: now }).where(eq(contentItems.id, itemId));
    return r;
  }
  const { cardCopy: _summaryCopy, ...facts } = r.data;
  const payload: NoticePayload = { ...facts };
  const [priorRevision] = item.currentRevisionId ? await db.select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId)) : [];
  const selectedTemplate = templateKey ?? channel.cardTemplate;
  if (!priorRevision?.payload.cardCopy && payload.relevance !== "irrelevant" && readingProfileForTemplateKey(selectedTemplate)) {
    const scheduleStatus = computeScheduleStatus(payload.schedules, now);
    const family = await generateFamilySourceDraft(db, item, channel, selectedTemplate!, { budget, plan: selections?.familyPlan, explicitRetry: selections?.explicitRetry, requestId: selections?.requestId, initialPayload: payload, noticeState: { scheduleStatus, evidenceStatus: computeEvidenceStatus(doc, payload, offs), relevance: payload.relevance } });
    return family.ok ? { ...family, scheduleStatus } : { ok: false as const, kind: "api" as const, error: family.error };
  }
  const warnings: string[] = [];
  let copyModel: string | null = null;
  const totalUsage = { ...r.usage };
  if (!priorRevision?.payload.cardCopy && payload.relevance !== "irrelevant") {
    const copy = await generateCardCopy({ kind: item.kind, title: item.title, payload, templateKey: selectedTemplate, channelName: channel.name, channelSlug: channel.slug, sources, budget, ...copyAi });
    if (copy.usage) { totalUsage.inputTokens += copy.usage.inputTokens; totalUsage.outputTokens += copy.usage.outputTokens; }
    if (copy.ok) { payload.cardCopy = copy.data; copyModel = copy.model; }
    else warnings.push(`기사 요약은 저장했습니다. 카드 문구는 완성하지 못했습니다: ${copy.error} 카드 편집에서 문구만 다시 제안받을 수 있습니다.`);
  }
  payload.aiWorkflow = { version: 1, summary: { provider: summaryAi.provider, model: r.model }, copy: copyModel ? { provider: copyAi.provider, model: copyModel } : null, warnings };
  const scheduleStatus = computeScheduleStatus(payload.schedules, now);
  const evidenceStatus = computeEvidenceStatus(doc, payload, offs);
  const previous = item.extracted as NoticePayload | null;

  const applied = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId)).for("update");
    await assertGenerationActive(tx as unknown as DB);
    if (!locked || locked.version !== item.version || locked.currentRevisionId !== item.currentRevisionId) return false;
    // 현재 버전이 운영자 편집본이면 current를 바꾸지 않고 LLM 결과만 보관
    const [cur] = locked.currentRevisionId ? await tx.select().from(contentRevisions).where(eq(contentRevisions.id, locked.currentRevisionId)) : [];
    const operatorOwned = cur?.author === "operator";
    const savedPayload = preserveCardCopy(payload, cur?.payload);
    await createRevision(tx, {
      contentItemId: itemId,
      author: "llm",
      payload: savedPayload,
      model: r.model,
      promptVersion: PROMPT_VERSION.notice,
      usage: totalUsage,
      note: [r.droppedEvidence ? `원문에서 찾을 수 없는 근거 구절 ${r.droppedEvidence}개 제거` : "",
        cur?.payload.cardCopy ? "원문 요약을 새로 작성했습니다. 저장된 카드 문구는 유지했으니 바뀐 원문과 맞는지 검토해 주세요." : "", ...warnings].filter(Boolean).join(" / "),
      makeCurrent: !operatorOwned,
    });
    const changed = materialChange(previous, payload);
    await tx
      .update(contentItems)
      .set({
        extracted: payload,
        title: operatorOwned ? item.title : payload.title || item.title,
        category: operatorOwned ? item.category : payload.category ?? item.category,
        schoolType: operatorOwned ? item.schoolType : payload.school_type ?? item.schoolType,
        relevance: payload.relevance,
        evidenceStatus,
        scheduleStatus: operatorOwned ? item.scheduleStatus : scheduleStatus,
        reviewStatus: changed && item.reviewStatus !== "pending" ? "review_required" : item.reviewStatus,
        version: sql`${contentItems.version} + 1`,
        updatedAt: now,
      })
      .where(eq(contentItems.id, itemId));
    const [freshItem] = await tx.select().from(contentItems).where(eq(contentItems.id, itemId));
    await completeGenerationResult(tx as unknown as DB, { ...freshItem, generationWarnings: warnings });
    return true;
  });
  if (!applied) return { ok: false as const, kind: "conflict", error: "생성 중 원고가 변경되었습니다. 새 편집본을 유지했습니다. 새로고침 후 다시 생성해 주세요." };
  return { ok: true as const, scheduleStatus, warnings };
}

export async function loadOfficials(db: DB, channelId: number) {
  return db.select().from(officialSources).where(eq(officialSources.channelId, channelId));
}

async function buildReviewDigest(db: DB, channel: Channel, itemIds: number[]): Promise<string> {
  const rows = itemIds.length
    ? await db
        .select({ id: contentItems.id, title: contentItems.title, category: contentItems.category, excluded: contentItems.excluded })
        .from(contentItems)
        .where(sql`${contentItems.id} in (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const list = rows.filter((r) => !r.excluded).slice(0, 15);
  const lines = list.map((r) => `• [${r.category ?? "미분류"}] ${r.title}\n  ${env.baseUrl}/items/${r.id}`);
  return [`📥 ${channel.name} — 새 수집 ${list.length}건 (검토 대기)`, "", ...lines, rows.length > 15 ? `…외 ${rows.length - 15}건` : "", "", `검토: ${env.baseUrl}/inbox`].join("\n");
}

/** 원문 1건 확보(+텍스트 PDF 첨부 1건). takeExtraCall()이 true일 때만 첨부를 추가로 받는다. */
async function fetchDoc(db: DB, docId: number, fetcher: typeof fetchAndExtract, now: Date, takeExtraCall: () => boolean): Promise<{ ok: boolean }> {
  currentGenerationSignal()?.throwIfAborted();
  const [doc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, docId));
  if (!doc) return { ok: false };
  if (doc.fetchStatus === "ok" && doc.fetchedText) return { ok: true }; // 이미 확보(다른 실행·채널)
  const attemptStartedAt = new Date();
  const r = await fetcher(sourceFetchUrl(doc), undefined, { title: doc.title, publisherUrl: typeof doc.meta.publisherUrl === "string" ? doc.meta.publisherUrl : undefined, takeExtraCall });
  currentGenerationSignal()?.throwIfAborted();
  if (!r.ok) {
    const saved = await persistSourceFetchAttempt(db, doc.id, r, { attemptStartedAt });
    return { ok: saved.hasUsableBody };
  }
  let text = r.text;
  const attachments = [...r.attachments];
  const pdf = attachments.find((a) => a.kind === "pdf" && a.status === "pending");
  if (pdf && takeExtraCall()) {
    currentGenerationSignal()?.throwIfAborted();
    try {
      const res = await safeFetch(pdf.url, { maxBytes: 8 * 1024 * 1024, accept: "application/pdf" });
      const t = await extractPdf(res.body);
      if (t.length >= 50) {
        text += `\n\n[첨부 PDF: ${pdf.name}]\n${t}`;
        pdf.status = "ok";
      } else {
        pdf.status = "manual_check";
        pdf.reason = "텍스트 없는 PDF(스캔본 가능성)";
      }
    } catch (e) {
      pdf.status = "failed";
      pdf.reason = (e as Error).message;
    }
  }
  currentGenerationSignal()?.throwIfAborted();
  const saved = await persistSourceFetchAttempt(db, doc.id, { ...r, text, hash: sha256(text), attachments }, { attemptStartedAt });
  return { ok: saved.hasUsableBody };
}


