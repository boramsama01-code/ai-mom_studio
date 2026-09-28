/**
 * 수집 실행 1회 (채널 단위)
 * 1) 설정 스냅샷 고정 → 2) 네이버 검색 → 3) 원문 캐시·수집함 저장 → 4) 원문 확보 → 5) 구조화 추출(공고 채널, 키가 있을 때)
 * 실패를 "정상 0건"으로 숨기지 않는다. 처리하지 못한 자료는 사유와 함께 보존한다.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  channels,
  contentItems,
  officialSources,
  runs,
  searchRules,
  sourceDocuments,
  type Channel,
  type SearchRule,
} from "../../shared/schema";
import { naverSearch, applyExcludeTerms, NaverError, type CallCounter, type NaverItem } from "../services/naver";
import { normalizeUrl } from "../services/url";
import { fetchAndExtract, extractPdf } from "../services/extract";
import { safeFetch } from "../services/safeFetch";
import { extractNotice, LlmBudget, PROMPT_VERSION, type LlmSource } from "../services/llm";
import { computeScheduleStatus } from "../services/dates";
import { computeEvidenceStatus, materialChange } from "./evidence";
import { createRevision } from "../content";
import { sendReviewMessage } from "../services/telegram";
import { getSetting } from "../seed";
import { env } from "../env";
import { sha256 } from "../services/text";
import type { NoticePayload } from "../../shared/payloads";

export type CollectOptions = {
  trigger: "manual" | "worker" | "cli" | "schedule";
  now?: Date;
  naverFetch?: typeof fetch; // 테스트용 주입
  fetchSource?: typeof fetchAndExtract; // 테스트용 주입
  heartbeat?: () => Promise<unknown>;
};

export type CollectSummary = {
  runId: number;
  status: string;
  counts: Record<string, number>;
  errors: Array<{ scope: string; message: string }>;
};

export async function runCollect(db: DB, channelId: number, opts: CollectOptions): Promise<CollectSummary> {
  const now = opts.now ?? new Date();
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) throw new Error("채널 없음");
  if (await getSetting(db, "global_stop", false)) throw new Error("전역 정지 상태 — 수집하지 않음");

  const rules = await db
    .select()
    .from(searchRules)
    .where(and(eq(searchRules.channelId, channelId), eq(searchRules.enabled, true), isNull(searchRules.deletedAt)))
    .orderBy(asc(searchRules.priority), asc(searchRules.id));

  const budget = channel.budget;
  const plannedNaver = rules.length; // 규칙 1개 = 호출 1회 (news/blog 각각 별도 규칙)
  const selected = rules.slice(0, budget.naverCallsPerRun);
  const skippedRules = rules.slice(budget.naverCallsPerRun);

  const officials = await db.select().from(officialSources).where(eq(officialSources.channelId, channelId));
  const unconnected = officials.filter((o) => o.enabled && !o.adapter).map((o) => o.name);

  const snapshot = {
    channel: { id: channel.id, slug: channel.slug, budget },
    rules: selected.map(ruleSnapshot),
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
  let fatal = false;

  /* 2~3) 검색 → 저장 */
  for (const rule of selected) {
    if (counts.results >= budget.resultsPerRun) {
      errors.push({ scope: `rule:${rule.id}`, message: "이번 실행 결과 한도 도달 — 남은 검색어 건너뜀" });
      break;
    }
    let items: NaverItem[] = [];
    let ruleNew = 0;
    try {
      items = await naverSearch(rule.query, rule.endpoint as "news" | "blog", rule.display, counter, opts.naverFetch);
    } catch (e) {
      const ne = e as NaverError;
      errors.push({ scope: `rule:${rule.id}`, message: `${rule.query}(${rule.endpoint}): ${ne.message}` });
      await db.update(searchRules).set({ lastRunAt: now, lastRunStatus: "failed", lastRunError: ne.message, lastRunNewCount: 0 }).where(eq(searchRules.id, rule.id));
      if (ne.kind === "not_configured" || ne.kind === "auth") {
        fatal = true;
        break;
      }
      continue;
    }
    for (const it of items) {
      if (counts.results >= budget.resultsPerRun) break;
      counts.results++;
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
  let fetchCalls = 0;
  const fetchTargets = newItemIds.slice(0, budget.fetchTargetsPerRun);
  if (newItemIds.length > fetchTargets.length)
    errors.push({ scope: "fetch", message: `원문 확보 대상 한도(${budget.fetchTargetsPerRun}) 초과 — ${newItemIds.length - fetchTargets.length}건은 다음 실행/수동 처리` });
  const fetcher = opts.fetchSource ?? fetchAndExtract;
  const fetchedOk: number[] = [];
  for (const itemId of fetchTargets) {
    if (fetchCalls >= budget.fetchCallsPerRun) {
      errors.push({ scope: "fetch", message: "원문 호출 한도 도달" });
      break;
    }
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
    const [doc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId!));
    const meta = doc.meta as { fetchUrl?: string };
    fetchCalls++;
    const r = await fetcher(meta.fetchUrl || doc.originalUrl);
    if (!r.ok) {
      counts.fetchFailed++;
      await db
        .update(sourceDocuments)
        .set({ fetchStatus: r.status, fetchError: r.error, attachments: r.attachments ?? doc.attachments, lastFetchedAt: now, updatedAt: now })
        .where(eq(sourceDocuments.id, doc.id));
      await db.update(contentItems).set({ evidenceStatus: "fetch_failed", updatedAt: now }).where(eq(contentItems.id, itemId));
      continue;
    }
    let text = r.text;
    const attachments = [...r.attachments];
    // 텍스트 PDF 첨부 1건까지 추가 확보(예산 내)
    const pdf = attachments.find((a) => a.kind === "pdf" && a.status === "pending");
    if (pdf && fetchCalls < budget.fetchCallsPerRun && !opts.fetchSource) {
      fetchCalls++;
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
    const hash = sha256(text);
    await db
      .update(sourceDocuments)
      .set({ fetchStatus: "ok", fetchError: null, fetchedText: text, contentHash: hash, attachments, lastFetchedAt: now, updatedAt: now, meta: { ...(doc.meta as object), finalUrl: r.finalUrl, pageTitle: r.title } })
      .where(eq(sourceDocuments.id, doc.id));
    counts.fetchedOk++;
    fetchedOk.push(itemId);
    await opts.heartbeat?.();
  }

  /* 5) 구조화 추출 — 공고 채널 + Claude 설정 시 */
  const llmBudget = new LlmBudget(budget.llmCallsPerRun);
  if (channel.contentType === "notice" && fetchedOk.length) {
    if (!env.anthropicKey || !env.anthropicModel) {
      errors.push({ scope: "llm", message: "Claude API 미연결 — 구조화 추출 건너뜀(수집함에서 수동 편집 가능)" });
    } else {
      for (const itemId of fetchedOk) {
        const r = await extractForItem(db, itemId, llmBudget, now, officials);
        if (r.ok) {
          counts.extracted++;
          if (r.scheduleStatus === "closed") counts.closed++;
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

  /* 6) 실행 결과 확정 */
  const status = fatal || (counter.naver === 0 && selected.length > 0 && errors.length)
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
      actualCalls: { naver: counter.naver, fetch: fetchCalls, llm: llmBudget.used },
      llmUsage: { inputTokens: llmBudget.inputTokens, outputTokens: llmBudget.outputTokens, calls: llmBudget.used },
      finishedAt: new Date(),
    })
    .where(eq(runs.id, run.id));

  /* 7) 개인 검토 알림 — 실패해도 저장은 유지 */
  if (counts.newItems - counts.excluded > 0 && env.telegramReviewChatId) {
    const msg = await buildReviewDigest(db, channel, newItemIds);
    const tg = await sendReviewMessage(msg);
    if (!tg.ok) {
      errors.push({ scope: "telegram_review", message: `검토 알림 실패: ${tg.error}` });
      await db.update(runs).set({ errors, status: status === "ok" ? "partial" : status }).where(eq(runs.id, run.id));
    }
  }

  return { runId: run.id, status, counts, errors };
}

function ruleSnapshot(r: SearchRule) {
  return { id: r.id, version: r.version, query: r.query, endpoint: r.endpoint, display: r.display, excludeTerms: r.excludeTerms, excludeScope: r.excludeScope, categoryHint: r.categoryHint };
}

async function saveSearchItem(db: DB, channel: Channel, rule: SearchRule, runId: number, it: NaverItem) {
  const identityUrl = it.endpoint === "news" && it.originallink ? it.originallink : it.link;
  let normalized: string;
  try {
    normalized = normalizeUrl(identityUrl);
  } catch {
    return null;
  }
  const fetchUrl = it.endpoint === "news" && /n\.news\.naver\.com/.test(it.link) ? it.link : identityUrl;
  const kind = it.endpoint === "news" ? "naver_news" : "naver_blog";
  await db
    .insert(sourceDocuments)
    .values({
      normalizedUrl: normalized,
      originalUrl: identityUrl,
      kind,
      title: it.title,
      snippet: it.description,
      meta: { naverLink: it.link, originallink: it.originallink ?? null, bloggername: it.bloggername ?? null, bloggerlink: it.bloggerlink ?? null, fetchUrl, raw: it.raw },
      publishedRaw: it.published.raw,
      publishedAt: it.published.iso ? new Date(it.published.iso) : null,
      publishedPrecision: it.published.precision,
    })
    .onConflictDoNothing();
  const [doc] = await db
    .select()
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.normalizedUrl, normalized), eq(sourceDocuments.isSample, false)));
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

/** 한 항목 구조화 추출 — 운영자 편집값·기존 승인을 덮어쓰지 않는다 */
export async function extractForItem(
  db: DB,
  itemId: number,
  budget: LlmBudget,
  now: Date,
  officials?: Awaited<ReturnType<typeof loadOfficials>>,
) {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
  const [doc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId!));
  if (doc.fetchStatus !== "ok" || !doc.fetchedText) return { ok: false as const, kind: "no_source", error: "원문 미확보 — 추출하지 않음" };
  const offs = officials ?? (await loadOfficials(db, item.channelId));
  const sources: LlmSource[] = [
    { source_id: doc.id, kind: doc.kind, url: doc.originalUrl, title: doc.title, published: doc.publishedRaw, text: doc.fetchedText },
  ];
  const r = await extractNotice({ sources, sourceHint: item.category, now, budget });
  if (!r.ok) {
    await db.update(contentItems).set({ updatedAt: now }).where(eq(contentItems.id, itemId));
    return r;
  }
  const payload = r.data;
  const scheduleStatus = computeScheduleStatus(payload.schedules, now);
  const evidenceStatus = computeEvidenceStatus(doc, payload, offs);
  const previous = item.extracted as NoticePayload | null;

  await db.transaction(async (tx) => {
    // 현재 버전이 운영자 편집본이면 current를 바꾸지 않고 LLM 결과만 보관
    const cur = item.currentRevisionId
      ? (await tx.execute(sql`select author from content_revisions where id = ${item.currentRevisionId}`)).rows[0] as { author: string } | undefined
      : undefined;
    const operatorOwned = cur?.author === "operator";
    await createRevision(tx, {
      contentItemId: itemId,
      author: "llm",
      payload,
      model: r.model,
      promptVersion: PROMPT_VERSION.notice,
      usage: r.usage,
      note: r.droppedEvidence ? `원문에서 찾을 수 없는 근거 구절 ${r.droppedEvidence}개 제거` : "",
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
  });
  return { ok: true as const, scheduleStatus };
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
