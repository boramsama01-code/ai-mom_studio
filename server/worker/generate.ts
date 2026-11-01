/**
 * 과학·시사 대화 초안 생성 (한 항목, 동기 호출)
 * 생성 성공은 검토 완료나 발행 승인이 아니다 — 항상 검토 대기로 들어간다.
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { contentItems, contentSources, sourceDocuments } from "../../shared/schema";
import { draftCurrent, draftScience, LlmBudget, PROMPT_VERSION, type LlmSource, type AiProvider } from "../services/llm";
import { createRevision } from "../content";
import { itemPrimarySource } from "../services/itemSources";

export async function generateDialogueDraft(db: DB, itemId: number, now = new Date(), provider?: AiProvider) {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
  if (!item) return { ok: false as const, error: "항목 없음" };
  if (item.kind !== "science_dialogue" && item.kind !== "current_dialogue")
    return { ok: false as const, error: "공고 항목은 '구조화 추출'을 사용하세요" };

  const docIds = new Set<number>();
  const primary = await itemPrimarySource(db, item);
  if (primary) docIds.add(primary.id);
  const linked = await db.select().from(contentSources).where(eq(contentSources.contentItemId, itemId));
  linked.filter(l => l.role !== "previous_manual" && (primary?.kind !== "manual_text" || (l.sourceDocumentId !== item.primarySourceId && l.role !== "merged_primary"))).forEach((l) => docIds.add(l.sourceDocumentId));
  const docs = docIds.size
    ? await db.select().from(sourceDocuments).where(sql`${sourceDocuments.id} in (${sql.join([...docIds].map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const sources: LlmSource[] = docs
    .filter((d) => d.fetchStatus === "ok" && d.fetchedText)
    .map((d) => ({ source_id: d.id, kind: d.kind, url: d.originalUrl, title: d.title, published: d.publishedRaw, text: d.fetchedText! }));

  if (item.kind === "current_dialogue" && !sources.length)
    return { ok: false as const, error: "시사 대화는 원문이 확보된 자료가 있어야 생성합니다(제목만으로 생성하지 않음)." };

  const budget = new LlmBudget(2); // 한 항목: 본 호출 1 + 형식 수정 재시도 1
  const r =
    item.kind === "science_dialogue"
      ? await draftScience({ topic: item.topicKey || item.title, sources, now, budget, provider })
      : await draftCurrent({ sources, now, budget, provider });
  if (!r.ok) return { ok: false as const, error: r.error };

  const payload = r.data as Record<string, unknown>;
  const evidenceCount = (payload.evidence as unknown[]).length;
  const indep = item.kind === "current_dialogue" ? Number(payload.independent_source_count ?? 0) : null;
  const evidenceStatus = !sources.length || !evidenceCount || sources.some(s => s.kind === "manual_text") ? "needs_review" : "secondary_only";

  const rev = await db.transaction(async (tx) => {
    const rev = await createRevision(tx, {
      contentItemId: itemId,
      author: "llm",
      payload,
      model: r.model,
      promptVersion: item.kind === "science_dialogue" ? PROMPT_VERSION.science : PROMPT_VERSION.current,
      usage: r.usage,
      note: [
        r.droppedEvidence ? `원문에서 찾을 수 없는 근거 구절 ${r.droppedEvidence}개 제거` : "",
        indep !== null && indep < 2 ? "독립 출처가 2개 미만 — 추가 대조 권장" : "",
        !sources.length ? "확보된 출처 없이 생성 — 과학적 근거 검토 필요" : "",
      ].filter(Boolean).join(" / "),
    });
    await tx
      .update(contentItems)
      .set({
        title: String((payload.key_question as string) || (payload.title as string) || item.title).slice(0, 200),
        evidenceStatus,
        reviewStatus: item.reviewStatus === "reviewed" ? "review_required" : item.reviewStatus,
        relevance: "relevant",
        version: sql`${contentItems.version} + 1`,
        updatedAt: now,
      })
      .where(eq(contentItems.id, itemId));
    return rev;
  });
  return { ok: true as const, revisionId: rev.id, usage: r.usage, model: r.model };
}


