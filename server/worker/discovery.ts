/**
 * 수집 실행 안의 "자동 화제 발굴" 단계 (과학·시사 채널)
 * 탐색 주제 검색 → 사건 묶기 → 화제도 순위 → (Claude 선정) → 고른 화제만 수집함에 저장
 * 고른 화제의 대표 기사는 원문 확보 대상이 되고, 같은 사건을 다룬 다른 언론사 기사 몇 건은 보조 근거로 연결한다.
 */
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, contentSources, sourceDocuments, type Channel } from "../../shared/schema";
import { naverSearch, NaverError, type CallCounter, type NaverItem } from "../services/naver";
import { clusterArticles, isRecentlyCovered, rankClusters, toArticle, type Article, type Cluster } from "../services/discover";
import { curateIssues, type LlmBudget, type CuratePick } from "../services/llm";
import { normalizeUrl } from "../services/url";
import { env } from "../env";
import { resolveDiscovery, type DiscoveryInfo, type DiscoverySettings } from "../../shared/domain";

export type DiscoveryResult = {
  itemIds: number[];
  supporting: Map<number, number[]>; // itemId → 보조 원문 doc id
  counts: { discoveryQueries: number; discoveryArticles: number; discoveryClusters: number; discoveryHot: number; discoveryPicked: number };
  errors: Array<{ scope: string; message: string }>;
  fatal: boolean;
  settings: DiscoverySettings;
};

const SUPPORTING_PER_ITEM = 3;

export function channelDiscovery(channel: Pick<Channel, "contentType" | "budget">): DiscoverySettings | null {
  const d = resolveDiscovery(channel.contentType, channel.budget.discovery);
  return d && d.enabled && d.queries.length && d.picksPerRun > 0 ? d : null;
}

export async function runDiscovery(
  db: DB,
  channel: Channel,
  runId: number,
  counter: CallCounter,
  llmBudget: LlmBudget,
  now: Date,
  naverFetch?: typeof fetch,
): Promise<DiscoveryResult | null> {
  const settings = channelDiscovery(channel);
  if (!settings) return null;
  const counts = { discoveryQueries: 0, discoveryArticles: 0, discoveryClusters: 0, discoveryHot: 0, discoveryPicked: 0 };
  const errors: DiscoveryResult["errors"] = [];
  const result: DiscoveryResult = { itemIds: [], supporting: new Map(), counts, errors, fatal: false, settings };

  /* 1) 탐색 주제별 최신 뉴스 */
  const articles: Article[] = [];
  for (const q of settings.queries) {
    if (counter.naver >= counter.limit) {
      errors.push({ scope: "discovery", message: `네이버 호출 한도 도달 — 탐색 주제 "${q}" 건너뜀` });
      break;
    }
    try {
      const items = await naverSearch(q, "news", 100, counter, naverFetch);
      counts.discoveryQueries++;
      for (const it of items) articles.push(toArticle(it, q));
    } catch (e) {
      const ne = e as NaverError;
      errors.push({ scope: "discovery", message: `탐색 주제 "${q}": ${ne.message}` });
      if (ne.kind === "not_configured" || ne.kind === "auth") {
        result.fatal = true;
        return result;
      }
    }
  }
  counts.discoveryArticles = articles.length;
  if (!articles.length) return result;

  /* 2) 사건 묶기 → 순위 */
  const clusters = clusterArticles(articles);
  counts.discoveryClusters = clusters.length;
  const useClaude = !!(env.anthropicKey && env.anthropicModel);
  const recent = await db
    .select({ discovery: contentItems.discovery, title: contentItems.title })
    .from(contentItems)
    .where(and(eq(contentItems.channelId, channel.id), isNotNull(contentItems.discovery), gte(contentItems.createdAt, new Date(now.getTime() - 5 * 86400_000))))
    .orderBy(desc(contentItems.createdAt))
    .limit(60);
  const recentHeadlines = recent.map((r) => (r.discovery as DiscoveryInfo | null)?.headline ?? r.title);
  const ranked = rankClusters(clusters, { strictTopic: !useClaude }).filter((c) => !isRecentlyCovered(c, recentHeadlines));
  counts.discoveryHot = ranked.filter((c) => c.score >= 2).length;
  if (!ranked.length) return result;

  /* 3) 선정 — Claude(연결 시) 또는 화제도 순 */
  let chosen: Array<{ cluster: Cluster; pick: CuratePick | null }> = [];
  if (useClaude) {
    const pool = ranked.slice(0, 15);
    const r = await curateIssues({
      kind: channel.contentType as "science_dialogue" | "current_dialogue",
      channelDescription: channel.description,
      editorialGuide: channel.editorialGuide,
      candidates: pool.map((c) => ({
        id: c.id,
        outlets: c.score,
        articles: c.articles.length,
        titles: c.articles.slice(0, 3).map((a) => a.title),
        snippet: c.representative.description,
      })),
      picks: settings.picksPerRun,
      recentTopics: recentHeadlines,
      budget: llmBudget,
    });
    if (r.ok) {
      const byId = new Map(pool.map((c) => [c.id, c]));
      chosen = r.data.picks.map((p) => ({ cluster: byId.get(p.candidate_id)!, pick: p }));
    } else {
      errors.push({ scope: "discovery", message: `Claude 화제 선정 실패 — 화제도 순으로 대신 고름: ${r.error}` });
      chosen = rankClusters(ranked, { strictTopic: true }).slice(0, settings.picksPerRun).map((cluster) => ({ cluster, pick: null }));
    }
  } else {
    chosen = ranked.slice(0, settings.picksPerRun).map((cluster) => ({ cluster, pick: null }));
  }

  /* 4) 저장 */
  for (const { cluster, pick } of chosen) {
    const saved = await saveCluster(db, channel, runId, cluster, pick, now);
    if (!saved) continue;
    result.itemIds.push(saved.itemId);
    result.supporting.set(saved.itemId, saved.supportingDocIds);
    counts.discoveryPicked++;
  }
  return result;
}

/** 네이버 검색 결과 1건을 원문 캐시에 넣고 doc id를 돌려준다(이미 있으면 기존 것) */
export async function upsertNaverDoc(db: DB, it: NaverItem): Promise<{ id: number } | null> {
  const identityUrl = it.endpoint === "news" && it.originallink ? it.originallink : it.link;
  let normalized: string;
  try {
    normalized = normalizeUrl(identityUrl);
  } catch {
    return null;
  }
  const fetchUrl = it.endpoint === "news" && /n\.news\.naver\.com/.test(it.link) ? it.link : identityUrl;
  await db
    .insert(sourceDocuments)
    .values({
      normalizedUrl: normalized,
      originalUrl: identityUrl,
      kind: it.endpoint === "news" ? "naver_news" : "naver_blog",
      title: it.title,
      snippet: it.description,
      meta: { naverLink: it.link, originallink: it.originallink ?? null, bloggername: it.bloggername ?? null, bloggerlink: it.bloggerlink ?? null, fetchUrl, raw: it.raw },
      publishedRaw: it.published.raw,
      publishedAt: it.published.iso ? new Date(it.published.iso) : null,
      publishedPrecision: it.published.precision,
    })
    .onConflictDoNothing();
  const [doc] = await db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
  return doc ?? null;
}

async function saveCluster(db: DB, channel: Channel, runId: number, c: Cluster, pick: CuratePick | null, now: Date) {
  const rep = await upsertNaverDoc(db, c.representative);
  if (!rep) return null;
  const info: DiscoveryInfo = {
    score: c.score,
    articleCount: c.articles.length,
    outlets: c.outlets.slice(0, 12),
    pickedBy: pick ? "claude" : "buzz",
    reason: pick?.reason ?? null,
    angle: pick?.angle ?? null,
    query: c.query,
    headline: c.representative.title,
    discoveredAt: now.toISOString(),
  };
  const inserted = await db
    .insert(contentItems)
    .values({
      channelId: channel.id,
      kind: channel.contentType,
      origin: "discovered",
      primarySourceId: rep.id,
      runId,
      title: c.representative.title || "(제목 없음)",
      category: c.query,
      topicKey: pick?.angle ?? c.representative.title,
      scheduleStatus: "not_applicable",
      evidenceStatus: "needs_review",
      discovery: info,
    })
    .onConflictDoNothing()
    .returning({ id: contentItems.id });
  if (!inserted.length) return null; // 같은 대표 기사가 이미 수집함에 있음
  const itemId = inserted[0].id;
  // 같은 사건을 다룬 다른 언론사 기사(보조 근거) — 언론사당 1건
  const supportingDocIds: number[] = [];
  const usedOutlets = new Set([c.representative.outlet]);
  for (const a of c.articles) {
    if (supportingDocIds.length >= SUPPORTING_PER_ITEM) break;
    if (usedOutlets.has(a.outlet)) continue;
    usedOutlets.add(a.outlet);
    const d = await upsertNaverDoc(db, a);
    if (!d || d.id === rep.id) continue;
    await db.insert(contentSources).values({ contentItemId: itemId, sourceDocumentId: d.id, role: "supporting" }).onConflictDoNothing();
    supportingDocIds.push(d.id);
  }
  return { itemId, supportingDocIds };
}
