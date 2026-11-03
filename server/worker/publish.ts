import { expectedInstagramUsername, instagramAccountMismatch, normalizeInstagramUsername } from "../../shared/channelInstagram";
import { cardAltTextState } from "../services/cardAccessibility";
import { altTextError } from "../../shared/altText";
import { itemPrimarySource } from "../services/itemSources";
/**
 * 카드 생성 · 최종 승인 · 목적지별 전송
 *
 * - 최종 승인 = 콘텐츠 revision + 실제 카드 해시 + 목적지별 캡션 + 예약 시각. 하나라도 바뀌면 무효 → 재승인.
 * - 승인한 파일을 게시 시 다시 생성하지 않는다(DB에 고정 저장된 JPEG를 그대로 사용).
 * - 게시 직전 다시 검사: 전역 정지, 승인 유효, revision 최신, 카드 해시, 마감, 일일 게시 한도, 목적지 활성.
 * - DRY_RUN=true(기본)면 외부로 생성/게시 POST를 보내지 않고 succeeded로 저장하지 않는다.
 * - 응답 유실은 unknown. Telegram은 자동 재전송하지 않는다. exactly-once를 보장하지 않는다.
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  approvals,
  channels,
  contentItems,
  contentRevisions,
  deliveries,
  deliveryAttemptEvents,
  destinations,
  mediaAssets,
  sourceDocuments,
  studioCards,
  type Delivery,
} from "../../shared/schema";
import { payloadSchemaFor } from "../../shared/payloads";
import { collectionUsesArt } from "../../shared/cardDesigns";
import { validateCaptions } from "../services/cardModel";
import { CardOverflowError, CardFontError } from "../services/card";
import { sha256 } from "../services/text";
import { computeScheduleStatus, kstToday, KST_OFFSET_MIN } from "../services/dates";
import { env } from "../env";
import { getSetting } from "../seed";
import { resolveSecrets } from "../services/secrets";
import { loadPublicationReadiness, publicationReadinessFor } from "../services/publishReadiness";
import { capturePublicationDestinations, publicationDestinationError } from "../services/publicationDestination";
import { lockDeliveryPublication, publicationEligibilityError, recomputePublicationStatus } from "../services/publicationState";
import { beginDeliveryDispatch, claimPublicationDelivery, finishDeliveryAttempt as finish, parkContainerWait, recoverPublicationAttempts, savePreparedContainer, withDeliveryLease } from "../services/publicationAttempts";
import { withPublisherHeartbeat } from "../services/publicationHealth";
import { uploadCard } from "../services/cloudinary";
import { sendPhotoToChannel, sendAlbumToChannel, telegramPostUrl } from "../services/telegram";
import * as ig from "../services/instagram";
import { audit } from "../audit";
import { resolveStyle } from "../services/templates";
import { cardApprovalHash, loadCardPages, planCarousel, renderCarouselCover, renderCarouselPages } from "../services/cardCarousel";
import { generateStudioImage } from "../services/studioAi";
import { assertStudioActive, createStudioCard } from "../services/studio";
import { studioContentSchema } from "../../shared/studio";
import { studioKey } from "../../shared/channelKeys";
import type { CardCarousel } from "../../shared/carousel";
import { HttpError } from "../routes/util";
import { cardCopySchema } from "../../shared/cardCopy";
export { reconcileDelivery, confirmDeliveryPosted, confirmDeliveryNotPosted } from "../services/publicationReconciliation";

export async function currentRevision(db: DB, itemId: number) {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
  if (!item) return null;
  if (!item.currentRevisionId) return { item, rev: null };
  const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId));
  return { item, rev };
}

export async function sourceOrgFor(db: DB, item: { id?: number; primarySourceId: number | null }, payload: Record<string, any>) {
  if (payload.organization) return String(payload.organization);
  const doc = item.id ? await itemPrimarySource(db, { id:item.id, primarySourceId:item.primarySourceId }) : item.primarySourceId ? (await db.select().from(sourceDocuments).where(eq(sourceDocuments.id,item.primarySourceId)))[0] : null;
  if (!doc) return null;
  try {
    return new URL(doc.originalUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ───────────── 카드 생성 ───────────── */
type CardRenderOptions = { version?: number; coverMode?: "ai" | "typography" | "reuse"; actor?: string };

/** Editing typography must not buy another illustration for unchanged source facts. */
export async function findReusableCardCover(db: DB, itemId: number, payload: Record<string, unknown>) {
  const source = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "cardCopy").sort(([a], [b]) => a.localeCompare(b))));
  const expected = source(payload);
  const candidates = await db.select({ id: mediaAssets.id, payload: contentRevisions.payload }).from(mediaAssets)
    .innerJoin(contentRevisions, eq(contentRevisions.id, mediaAssets.revisionId))
    .where(and(eq(mediaAssets.contentItemId, itemId), eq(mediaAssets.kind, "cover_art"))).orderBy(desc(mediaAssets.id)).limit(30);
  const match = candidates.find(candidate => source(candidate.payload) === expected);
  if (!match) return null;
  const [art] = await db.select({ bytes: mediaAssets.bytes, templateKey: mediaAssets.templateKey }).from(mediaAssets).where(eq(mediaAssets.id, match.id));
  return art ?? null;
}

export async function renderCardForItem(db: DB, itemId: number, now = new Date(), templateKey?: string | null, options: CardRenderOptions = {}) {
  // Serialize per item across web processes: concurrent clicks reuse the same cover art.
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193202, ${itemId})`);
    return renderCarouselForItem(tx as unknown as DB, itemId, now, templateKey, options);
  });
}
async function renderCarouselForItem(db: DB, itemId: number, now: Date, templateKey: string | null | undefined, options: CardRenderOptions) {
  const cr = await currentRevision(db, itemId);
  if (!cr) return { ok: false as const, code: "not_found", error: "항목 없음" };
  const { item, rev } = cr;
  if (options.version !== undefined && options.version !== item.version) return { ok: false as const, code: "conflict", error: "다른 곳에서 원고가 변경됐습니다. 최신 문구를 확인한 뒤 카드를 만들어 주세요." };
  const [existingBoard] = await db.select().from(studioCards).where(eq(studioCards.sourceItemId, itemId));
  if (existingBoard) assertStudioActive(existingBoard);
  if (!rev) return { ok: false as const, code: "no_revision", error: "초안이 없습니다. 먼저 추출·작성하세요." };
  const parsed = payloadSchemaFor(item.kind).safeParse(rev.payload);
  if (!parsed.success) return { ok: false as const, code: "invalid_payload", error: "초안 형식이 올바르지 않습니다. 편집 화면에서 필수 항목을 채우세요." };
  const [ch] = await db.select().from(channels).where(eq(channels.id, item.channelId));
  if (!ch?.active) return { ok: false as const, code: "channel", error: "채널을 복원한 뒤 카드를 만들어 주세요." };
  const savedCopy = cardCopySchema.safeParse(rev.payload.cardCopy);
  const key = templateKey || (savedCopy.success ? savedCopy.data.templateKey : null) || ch.cardTemplate || "builtin:classic";
  const copy = savedCopy.success ? { ...savedCopy.data, templateKey: key } : undefined;
  const payload = { ...rev.payload, ...(copy ? { cardCopy: copy } : {}) } as Record<string, any>;
  const title = copy?.cover.title || payload.title || payload.key_question;
  if (!title || !String(title).trim()) return { ok: false as const, code: "invalid_payload", error: "카드 제목(제목/핵심 질문)이 비어 있습니다." };
  let style;
  try { style = await resolveStyle(db, key, ch.id); }
  catch (e) { return { ok: false as const, code: "template", error: (e as Error).message }; }
  const typographyOnly = !!style.collection && !collectionUsesArt(style.collection);
  const cachedArt = typographyOnly || options.coverMode === "typography" ? null : await findReusableCardCover(db, item.id, payload);
  const coverMode = typographyOnly ? "typography" : options.coverMode === "reuse" ? (cachedArt ? "ai" : "typography") : options.coverMode ?? (copy ? (cachedArt ? "ai" : "typography") : env.openaiKey ? "ai" : "typography");
  if (coverMode === "ai" && !cachedArt && !env.openaiKey) return { ok: false as const, code: "ai_not_configured", error: "AI 표지는 OpenAI 이미지 연결이 필요합니다. 연결 설정에서 키를 입력하거나 글자 중심 표지를 선택하세요." };
  if (coverMode === "ai" && !cachedArt && await getSetting(db, "global_stop", false)) return { ok: false as const, code: "global_stop", error: "전역 정지 상태입니다. 정지를 해제한 뒤 AI 표지를 만들어 주세요." };
  let output;
  let newCoverArt: { bytes: Buffer; model: string } | null = null;
  let cover: CardCarousel["cover"] = { kind: "typography", credit: style.background ? "이미지: 내 배경 템플릿" : "우주펭귄상회 스튜디오" };
  try {
    const plan = planCarousel({ kind: item.kind, payload, channelName: ch.name, accent: ch.accentColor, sourceOrg: await sourceOrgFor(db, item, payload), checkedDate: kstToday(now) }, style);
    // Check the title and source line before spending an image-generation call.
    await renderCarouselCover(plan.base, plan.count, null, cover.credit, style);
    let art: Buffer | null = null;
    if (coverMode === "ai") {
      const cached = cachedArt;
      if (cached) {
        art = cached.bytes;
        cover = { kind: "ai", credit: "표지: AI 생성 · OpenAI", model: cached.templateKey ?? undefined };
      } else {
        const generated = await generateStudioImage({ purpose: "cover", prompt: JSON.stringify({ title, topic: payload.topic, summary: payload.summary ?? payload.one_line_summary ?? payload.background, channel: ch.name }) });
        art = generated.bytes;
        newCoverArt = { bytes: art, model: generated.model };
        cover = { kind: "ai", credit: "표지: AI 생성 · OpenAI", model: generated.model };
      }
    }
    output = await renderCarouselPages(plan, style, art, cover.credit);
  } catch (e) {
    if (e instanceof CardOverflowError) return { ok: false as const, code: "overflow", field: e.field, error: `편집 필요: ${e.message}` };
    if (e instanceof CardFontError) return { ok: false as const, code: "font", error: e.message };
    return { ok: false as const, code: "render", error: `카드뉴스를 완성하지 못했습니다: ${(e as Error).message}` };
  }
  const [fresh] = await db.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
  if (fresh.currentRevisionId !== rev.id || (options.version !== undefined && fresh.version !== options.version)) return { ok: false as const, code: "conflict", error: "생성 중 원고가 변경됐습니다. 최신 원고를 확인한 뒤 다시 만들어 주세요." };
  const [freshBoard] = await db.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id)).for("update");
  if (freshBoard) assertStudioActive(freshBoard);
  if (freshBoard && (!existingBoard || freshBoard.version !== existingBoard.version)) throw new HttpError(409, "생성 중 보드의 작업 상태가 변경되어 결과를 반영하지 않았습니다. 최신 작업에서 다시 생성하세요.");
  // Acquire the source/card locks before inserting assets (and their foreign-key locks).
  if (newCoverArt) await db.insert(mediaAssets).values({ channelId: ch.id, contentItemId: item.id, revisionId: rev.id, kind: "cover_art", source: "ai", templateKey: newCoverArt.model, mime: "image/png", width: 1024, height: 1024, bytes: newCoverArt.bytes, sha256: sha256(newCoverArt.bytes) }).onConflictDoNothing();
  const pages: CardCarousel["pages"] = [];
  for (const [index, page] of output.entries()) {
    const hash = sha256(page.bytes);
    await db.insert(mediaAssets).values({ channelId: ch.id, contentItemId: item.id, revisionId: rev.id, kind: index === 0 ? "card" : "carousel_page", sha256: hash, width: 1080, height: 1350, bytes: page.bytes, source: key.startsWith("custom:") ? "custom" : "builtin", templateKey: key }).onConflictDoNothing();
    const [stored] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.revisionId, rev.id), eq(mediaAssets.sha256, hash)));
    pages.push({ id: stored.id, sha256: hash, title: page.title, altText:page.altText });
  }
  const [previous]=await db.select({carousel:mediaAssets.carousel}).from(mediaAssets).where(eq(mediaAssets.id,pages[0].id));
  const carousel: CardCarousel = previous?.carousel?.pages.length===pages.length && previous.carousel.pages.every((p,i)=>p.id===pages[i].id) ? {...previous.carousel,pages:pages.map((p,i)=>({...p,altText:previous.carousel!.pages[i].altText||p.altText})), ...(copy ? { copy } : {})} : { version: 1, pages, cover, ...(copy ? { copy } : {}) };
  await db.update(mediaAssets).set({ carousel }).where(eq(mediaAssets.id, pages[0].id));
  const board = await createStudioCard(db, studioContentSchema.parse({ title: String(title).slice(0, 160), channel: studioKey(ch.slug), format: "카드뉴스", stage: "review" }), options.actor ?? "system", item.id);
  // Keep all manually edited board fields and version history; only its generated output changes.
  await db.update(studioCards).set({ updatedAt: now, importedMeta: sql`coalesce(${studioCards.importedMeta}, '{}'::jsonb) || ${JSON.stringify({ generatedAssetId: pages[0].id })}::jsonb` }).where(eq(studioCards.id, board.id));
  return { ok: true as const, asset: { id: pages[0].id, sha256: pages[0].sha256, revisionId: rev.id, createdAt: now, source: key.startsWith("custom:") ? "custom" : "builtin", templateKey: key, carousel, studioCardId: board.id } };
}

/* ───────────── 최종 승인 ───────────── */
export type PublicationTargetPreflight = Awaited<ReturnType<typeof loadPublicationReadiness>> & {
  targets: Extract<Awaited<ReturnType<typeof capturePublicationDestinations>>, { ok: true }>;
};
export async function approveItem(
  db: DB,
  a: { requestId?: string; timing?: "now" | "later"; destinationIds?: number[]; publicationDraftVersion?: number; itemId: number; revisionId: number; mediaAssetId: number; altTextVersion?:number; captions: { instagram: string; telegram: string }; scheduledAt: Date; actor: string; now?: Date },
  preflight?: PublicationTargetPreflight,
) {
  const now = a.now ?? new Date();
  const requestHash = a.requestId ? sha256(JSON.stringify({ itemId: a.itemId, revisionId: a.revisionId, mediaAssetId: a.mediaAssetId, altTextVersion: a.altTextVersion ?? null,
    publicationDraftVersion: a.publicationDraftVersion ?? null, captions: { instagram: a.captions.instagram, telegram: a.captions.telegram }, destinationIds: a.destinationIds?.slice().sort((x, y) => x - y) ?? null,
    schedule: a.timing === "now" ? "now" : a.scheduledAt.toISOString() })) : null;
  if (a.requestId) {
    const replay = await findApprovalRequest(db, a.requestId, requestHash!);
    if (replay) return { ok: true as const, approval: replay.approval, destinations: replay.destinations, replayed: true };
  }
  const cr = await currentRevision(db, a.itemId);
  if (!cr?.rev) return { ok: false as const, error: "초안이 없습니다." };
  const { item, rev } = cr;
  if (rev.id !== a.revisionId) return { ok: false as const, error: "최신 버전이 아닙니다. 새로고침 후 다시 확인하세요." };
  if (item.reviewStatus !== "reviewed") return { ok: false as const, error: "먼저 '검토 완료'로 표시해야 최종 승인할 수 있습니다." };
  if (item.relevance === "irrelevant" || item.excluded) return { ok: false as const, error: "관련 없음/제외 항목은 승인할 수 없습니다." };
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, a.mediaAssetId));
  if (!asset || asset.kind !== "card" || asset.revisionId !== rev.id) return { ok: false as const, error: "현재 버전으로 만든 카드가 아닙니다. 카드를 다시 생성하세요." };
  if(a.altTextVersion!==undefined && a.altTextVersion!==cardAltTextState(asset,item.title).version)throw new HttpError(409,"대체텍스트가 변경됐습니다. 최신 설명을 확인하고 다시 승인해 주세요.");
  const altValues = cardAltTextState(asset, item.title).values;
  const invalidPage = altValues.findIndex(value => !!altTextError(value));
  if (invalidPage >= 0) return { ok: false as const, error: `${invalidPage + 1}페이지: ${altTextError(altValues[invalidPage])} 수정한 뒤 다시 승인해 주세요.` };
  let approvedHash: string;
  try { approvedHash = cardApprovalHash(await loadCardPages(db, asset)); }
  catch (e) { return { ok: false as const, error: (e as Error).message }; }
  if (item.kind === "notice") {
    const st = computeScheduleStatus((rev.payload as any).schedules, now);
    if (st === "closed") return { ok: false as const, error: "접수가 마감된 공고는 승인할 수 없습니다." };
  }
  const { channel, selected: dests, readiness } = preflight ?? await loadPublicationReadiness(db, item.channelId, a.destinationIds);
  if (!readiness.ready || !channel) return { ok: false as const, error: readiness.blockers.join(" "), publicationReadiness: readiness };
  if (channel.id !== item.channelId) throw new HttpError(409, "게시 확인 중 채널이 변경됐습니다. 다시 확인하세요.");
  const capErr = validateCaptions({
    instagram: dests.some(destination => destination.platform === "instagram") ? a.captions.instagram : "",
    telegram: dests.some(destination => destination.platform === "telegram_channel") ? a.captions.telegram : "",
  });
  if (capErr.length) return { ok: false as const, error: capErr.join(" ") };
  const targets = preflight?.targets ?? await capturePublicationDestinations(channel, dests, now);
  if (!targets.ok) return { ok: false as const, error: targets.error };
  const approval = await db.transaction(async (tx) => {
    const [freshItem] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id)).for("update");
    if (a.requestId) {
      const replay = await findApprovalRequest(tx as unknown as DB, a.requestId, requestHash!);
      if (replay) return replay.approval;
    }
    if (freshItem.currentRevisionId !== rev.id || freshItem.reviewStatus !== "reviewed" || freshItem.excluded || freshItem.relevance === "irrelevant") throw new HttpError(409, "승인 전에 콘텐츠가 변경됐습니다. 다시 확인하세요.");
    if (a.publicationDraftVersion !== undefined && a.publicationDraftVersion !== (freshItem.publicationDraft?.version ?? 0)) throw new HttpError(409, "게시 문구가 다른 화면에서 변경됐습니다. 저장된 최신 캡션을 확인하세요.");
    if (freshItem.publicationDraft && (freshItem.publicationDraft.captions.instagram !== a.captions.instagram || freshItem.publicationDraft.captions.telegram !== a.captions.telegram)) throw new HttpError(409, "저장된 캡션과 승인할 캡션이 다릅니다. 문구를 저장하고 다시 확인하세요.");
    // Lock every existing delivery across revisions, including failed rows:
    // a concurrent worker claim or retry must finish before this decision, or
    // wait until approval replacement has committed. Item locking also prevents
    // two new approvals from both observing an empty delivery history.
    const priorDeliveries = await tx.select({ id: deliveries.id, status: deliveries.status, revisionId: approvals.revisionId, needsReconciliation: deliveries.needsReconciliation }).from(deliveries)
      .innerJoin(approvals, eq(approvals.id, deliveries.approvalId))
      .where(eq(approvals.contentItemId, item.id))
      .orderBy(deliveries.id).for("update", { of: deliveries });
    if (priorDeliveries.some(delivery => delivery.status === "unknown" || delivery.needsReconciliation)) throw new HttpError(409, "이전 버전을 포함해 게시 결과가 확인되지 않은 전송이 있습니다. 발행함에서 실제 게시 여부를 먼저 확인하세요.");
    if (priorDeliveries.some(delivery => delivery.status === "processing")) throw new HttpError(409, "이전 버전을 포함해 전송 중인 작업이 있습니다. 발행함에서 결과를 먼저 확인하세요.");
    const sameRevision = priorDeliveries.filter(delivery => delivery.revisionId === rev.id);
    if (sameRevision.some(delivery => delivery.status === "succeeded")) throw new HttpError(409, "이 버전은 이미 게시됐습니다. 전송 상태에서 게시물을 확인하세요.");
    if (sameRevision.some(delivery => delivery.status === "scheduled")) throw new HttpError(409, "이 버전은 이미 예약돼 있습니다. 전송 상태에서 기존 예약을 취소한 뒤 다시 승인하세요.");
    const [freshChannel] = await tx.select().from(channels).where(eq(channels.id, channel.id)).for("share");
    const freshDestinations: typeof dests = [];
    for (const selected of dests) {
      const [freshDestination] = await tx.select().from(destinations).where(eq(destinations.id, selected.id)).for("share");
      const snapshot = targets.snapshots.get(selected.id)!;
      const error = publicationDestinationError(snapshot, freshDestination, freshChannel);
      if (error || freshDestination?.version !== selected.version) throw new HttpError(409, error ?? "승인 중 게시 목적지 설정이 변경됐습니다. 계정을 다시 확인하세요.");
      freshDestinations.push(freshDestination);
    }
    const freshReadiness = publicationReadinessFor(freshChannel, freshDestinations, await getSetting(tx as unknown as DB, "global_stop", false));
    if (!freshReadiness.ready) throw new HttpError(409, freshReadiness.blockers.join(" "));
    const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
    if (board) { assertStudioActive(board); if (board.importedMeta?.studioPublication && rev.payload.studioVersion !== board.version) throw new HttpError(409, "제작보드가 수정됐습니다. 미리보기를 다시 준비하세요."); }
    const [freshAsset]=await tx.select().from(mediaAssets).where(eq(mediaAssets.id,asset.id));
    if(JSON.stringify(cardAltTextState(freshAsset,item.title))!==JSON.stringify(cardAltTextState(asset,item.title)))throw new HttpError(409,"대체텍스트가 변경됐습니다. 최신 설명을 확인하고 다시 승인해 주세요.");
    // 기존 활성 승인은 새 승인으로 대체
    const prev = await tx.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.contentItemId, item.id), eq(approvals.status, "active")));
    if (prev.length) {
      const ids = prev.map((p) => p.id);
      await tx.update(approvals).set({ status: "invalidated", invalidatedReason: "새 승인으로 대체", updatedAt: now }).where(inArray(approvals.id, ids));
      await tx.update(deliveries).set({ status: "cancelled", lastError: "새 승인으로 대체", updatedAt: now }).where(and(inArray(deliveries.approvalId, ids), eq(deliveries.status, "scheduled")));
    }
    const [ap] = await tx
      .insert(approvals)
      .values({ channelId: item.channelId, contentItemId: item.id, revisionId: rev.id, mediaAssetId: asset.id, cardSha256: approvedHash, captions: {...a.captions,altTexts:cardAltTextState(asset,item.title).values}, requestId: a.requestId, requestHash, scheduledAt: a.scheduledAt, approvedBy: a.actor })
      .returning();
    for (const d of dests) {
      await tx.insert(deliveries).values({ channelId: item.channelId, approvalId: ap.id, destinationId: d.id, destinationSnapshot: targets.snapshots.get(d.id)!, status: "scheduled", phase: "queued" }).onConflictDoNothing();
    }
    await tx.update(contentItems).set({ publishStatus: dests.length ? "scheduled" : "waiting", updatedAt: now }).where(eq(contentItems.id, item.id));
    await audit(tx, { actor: a.actor, action: "approve", entity: "content_item", entityId: item.id, channelId: item.channelId, detail: { approvalId: ap.id, revisionId: rev.id, cardSha256: approvedHash, destinations: dests.map((d) => d.id), scheduledAt: a.scheduledAt } });
    return ap;
  });
  return { ok: true as const, approval, destinations: dests.length, publicationReadiness: readiness };
}

async function findApprovalRequest(db: DB, requestId: string, hash: string) {
  const [approval] = await db.select().from(approvals).where(eq(approvals.requestId, requestId));
  if (!approval) return null;
  if (approval.requestHash !== hash) throw new HttpError(409, "같은 요청 ID로 다른 게시 내용을 보낼 수 없습니다. 최신 내용을 확인하고 새 승인 요청을 만들어 주세요.");
  const rows = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.approvalId, approval.id));
  return { approval, destinations: rows.length };
}

export async function cancelApproval(db: DB, approvalId: number, actor: string) {
  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!initial) return { ok: false as const, error: "취소할 수 있는 승인이 아닙니다." };
    // Match approveItem/retryDelivery lock order. A worker claim and cancellation
    // cannot both change the same scheduled delivery after this locked snapshot.
    await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, initial.contentItemId)).for("update");
    const pending = await tx.select().from(deliveries).where(eq(deliveries.approvalId, approvalId)).orderBy(deliveries.id).for("update");
    const [ap] = await tx.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
    if (!ap || ap.status !== "active") return { ok: false as const, error: "취소할 수 있는 승인이 아닙니다. 최신 전송 상태를 확인하세요." };
    const started = pending.filter(d => ["processing", "succeeded", "unknown"].includes(d.status));
    const scheduled = pending.filter(d => d.status === "scheduled");
    if (started.length && !scheduled.length) return { ok: false as const, error: "이미 전송이 시작되었거나 게시 결과 확인이 필요한 건은 취소할 수 없습니다. 전송 상태와 게시 계정을 확인하세요." };
    const now = new Date();
    const cancelled = await tx.update(deliveries).set({ status: "cancelled", phase: "finished", lastError: "운영자 예약 취소", updatedAt: now })
      .where(and(eq(deliveries.approvalId, approvalId), eq(deliveries.status, "scheduled"))).returning({ id: deliveries.id });
    // Keep a mixed approval active: an in-flight request must finish normally and
    // must never appear as cancelled merely because another destination was queued.
    const approvalCancelled = !started.length;
    if (approvalCancelled) {
      await tx.update(approvals).set({ status: "cancelled", updatedAt: now }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "active")));
    }
    for (const row of cancelled) await tx.insert(deliveryAttemptEvents).values({ deliveryId: row.id, attemptId: pending.find(d => d.id === row.id)?.lastAttemptId, event: "reservation_cancelled", phase: "finished", status: "cancelled", source: "operator", actor, note: "운영자 예약 취소" });
    await recomputePublicationStatus(tx as unknown as DB, approvalId, now);
    await audit(tx, { actor, action: "cancel_approval", entity: "approval", entityId: approvalId, channelId: ap.channelId, detail: { cancelled: cancelled.length, alreadyProcessing: started.length, approvalCancelled } });
    return { ok: true as const, cancelled: cancelled.length, alreadyProcessing: started.length, approvalCancelled,
      message: approvalCancelled ? "예약을 취소했습니다. 이 승인으로 더 이상 전송하지 않습니다." : `대기 중인 ${cancelled.length}건만 취소했습니다. 이미 시작된 ${started.length}건은 취소되지 않았으므로 전송 결과를 확인해 주세요.` };
  });
}

/* ───────────── 전송 워커 ───────────── */

type PublishStats = { processed: number; succeeded: number; failed: number; unknown: number; dryRun: number; skipped: number; notes: string[] };

export type PublishTarget = { approvalId: number; deliveryId?: never } | { deliveryId: number; approvalId?: never };
export async function publishDue(db: DB, opts: { now?: Date; limit?: number; actor?: string; approvalId?: number; deliveryId?: number } = {}): Promise<PublishStats> {
  return withPublisherHeartbeat(db, opts.actor ?? "publisher", () => runPublicationSweep(db, opts));
}

async function runPublicationSweep(db: DB, opts: { now?: Date; limit?: number; actor?: string; approvalId?: number; deliveryId?: number }): Promise<PublishStats> {
  const now = opts.now ?? new Date(), actor = opts.actor ?? "publisher";
  const stats: PublishStats = { processed: 0, succeeded: 0, failed: 0, unknown: 0, dryRun: 0, skipped: 0, notes: [] };
  const stopped = await getSetting(db, "global_stop", false);
  const allowed = !stopped && (env.autoPublish || env.dryRun) && !env.canonicalRedirectUrl;
  const recovered = await recoverPublicationAttempts(db, { ...opts, now, actor, claimSafe: allowed });
  stats.unknown += recovered.unknown;
  stats.processed += recovered.unknown;
  if (!allowed) {
    stats.notes.push(stopped ? "전역 정지 상태 — 게시하지 않음" : "실제 게시 또는 현재 서버의 게시 처리가 중지돼 있습니다.");
    return stats;
  }
  for (const delivery of recovered.resumed) {
    stats.processed++;
    stats[await withDeliveryLease(db, delivery, () => processDelivery(db, delivery, now))]++;
  }
  const due = await db.select({ id: deliveries.id }).from(deliveries).innerJoin(approvals, eq(deliveries.approvalId, approvals.id))
    .where(and(eq(deliveries.status, "scheduled"), eq(deliveries.needsReconciliation, false), eq(approvals.status, "active"), lte(approvals.scheduledAt, now),
      opts.approvalId !== undefined ? eq(deliveries.approvalId, opts.approvalId) : undefined,
      opts.deliveryId !== undefined ? eq(deliveries.id, opts.deliveryId) : undefined))
    .orderBy(approvals.scheduledAt, deliveries.id).limit(opts.limit ?? 10);
  for (const row of due) {
    const claimed = await claimPublicationDelivery(db, row.id, actor, now);
    if (!claimed) continue;
    stats.processed++;
    stats[await withDeliveryLease(db, claimed, () => processDelivery(db, claimed, now))]++;
  }
  return stats;
}

async function processDelivery(db: DB, d: Delivery, now: Date): Promise<"succeeded" | "failed" | "unknown" | "dryRun" | "skipped"> {
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, d.approvalId));
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, ap.contentItemId));
  const [dest] = await db.select().from(destinations).where(eq(destinations.id, d.destinationId));
  const [ch] = await db.select().from(channels).where(eq(channels.id, d.channelId));
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ap.mediaAssetId));
  const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, ap.revisionId));

  const block = async (msg: string) => {
    await finish(db, d, { status: "cancelled", lastError: msg, errorKind: "approval_required" });
    return "skipped" as const;
  };
  // 게시 직전 재검사
  const [board] = await db.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
  if (board?.importedMeta?.studioPublication && rev.payload.studioVersion !== board.version) return block("제작보드 수정 — 재승인 필요");
  if (board?.trashedAt) return block("휴지통에 있는 콘텐츠 — 게시 중단");
  if (!ch?.active) return block("보관된 채널 — 게시 중단");
  if (ap.status !== "active") return block("승인이 더 이상 유효하지 않음");
  if (item.currentRevisionId !== ap.revisionId) return block("승인 이후 콘텐츠가 수정됨 — 재승인 필요");
  const eligibility = publicationEligibilityError(item, ap);
  if (eligibility) return block(eligibility);
  if (!asset) return block("카드 파일 없음");
  let cardPages;
  try { cardPages = await loadCardPages(db, asset); }
  catch { return block("카드뉴스 파일이 승인본과 다름"); }
  if (cardApprovalHash(cardPages) !== ap.cardSha256) return block("카드 파일이 승인본과 다름");
  if (!dest?.enabled) return block("목적지 비활성");
  const targetError = publicationDestinationError(d.destinationSnapshot, dest, ch);
  if (targetError) return block(targetError);
  if (dest.channelId !== ch.id || item.channelId !== ch.id || asset.channelId !== ch.id) return block("콘텐츠 채널과 게시 계정의 채널이 다릅니다.");
  if (item.kind === "notice" && computeScheduleStatus((rev.payload as any).schedules, now) === "closed") return block("접수 마감 — 게시 중단");
  const sec = resolveSecrets(dest.platform, ch.slug, dest.secretRefs);
  if (sec.invalid.length || sec.missing.length) {
    await finish(db, d, { status: "failed", errorKind: "auth", lastError: `목적지 설정 미완료: ${[...sec.invalid.map((f) => `${f}(허용되지 않은 이름)`), ...sec.missing].join(", ")}` });
    return "failed";
  }

  if (env.dryRun) {
    await finish(db, d, { status: "dry_run", lastError: "DRY_RUN — 외부로 전송하지 않음(모든 사전 검사 통과)", completedAt: new Date() });
    return "dryRun";
  }

  if (dest.platform === "telegram_channel") {
    const dispatch = await beginDeliveryDispatch(db, d);
    if (!dispatch.ok) {
      if (dispatch.stale) return "skipped";
      if (dispatch.uncertain) { await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: dispatch.error }); return "unknown"; }
      return block(dispatch.error);
    }
    const chatId = d.destinationSnapshot!.accountId;
    const r = cardPages.length > 1 ? await sendAlbumToChannel(chatId, cardPages.map(p => p.bytes), ap.captions.telegram) : await sendPhotoToChannel(chatId, asset.bytes, ap.captions.telegram);
    if (r.ok) {
      await finish(db, d, { status: "succeeded", externalId: String(r.messageId), externalUrl: telegramPostUrl(r.chatUsername, r.messageId), completedAt: new Date(), lastError: null });
      return "succeeded";
    }
    if (r.kind === "unknown") {
      await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: `${r.error} — 채널에서 직접 확인 후 처리하세요(자동 재전송 안 함)` });
      return "unknown";
    }
    await finish(db, d, { status: "failed", errorKind: r.kind, lastError: r.error });
    return "failed";
  }

  if (dest.platform === "instagram") {
    const invalidAltPage = ap.captions.altTexts?.findIndex(value => !!altTextError(value)) ?? -1;
    if (invalidAltPage >= 0) return block(`${invalidAltPage + 1}페이지 대체텍스트가 125자·2문장 기준을 초과해 게시를 중단했습니다. 다시 검토·승인해 주세요.`);
    const token = sec.values.accessToken, userId = sec.values.userId;
    const authMode = (sec.values.authMode ?? "instagram") as ig.InstagramAuthMode;
    {
      const expected = d.destinationSnapshot!.username ?? expectedInstagramUsername(ch.slug) ?? undefined;
      const identity = await ig.accountIdentity(token, authMode, expected);
      if (!identity.ok) { await finish(db, d, { status: "failed", errorKind: "auth", lastError: identity.error }); return "failed"; }
      if (identity.userId !== userId) return block("저장된 게시 계정과 토큰의 계정이 다릅니다.");
      const mismatch = instagramAccountMismatch(ch.slug, identity.username);
      if (mismatch) return block(mismatch);
      if (expected && normalizeInstagramUsername(identity.username) !== expected) return block("승인한 인스타그램 계정과 현재 토큰의 계정이 다릅니다. 계정을 확인하고 다시 승인하세요.");
    }
    let containerId = d.externalContainerId;
    if (!containerId) {
      const urls: string[] = [];
      try {
        for (const [index, page] of cardPages.entries()) {
          let url = page.cloudinaryUrl;
          if (!url) {
            const up = await uploadCard(page.bytes, `spacepenguin/${ch.slug}/approval-${ap.id}-${ap.cardSha256.slice(0, 12)}-${index + 1}`);
            url = up.url;
            await db.update(mediaAssets).set({ cloudinaryPublicId: up.publicId, cloudinaryUrl: up.url }).where(eq(mediaAssets.id, page.id));
          }
          urls.push(url);
        }
      } catch (e) {
        await finish(db, d, { status: "failed", errorKind: "transient", lastError: `이미지 업로드 실패: ${(e as Error).message}` });
        return "failed";
      }
      const c = urls.length > 1 ? await ig.createCarouselContainer(userId, token, urls, ap.captions.instagram, ap.captions.altTexts, authMode) : await ig.createContainer(userId, token, urls[0], ap.captions.instagram, ap.captions.altTexts?.[0], authMode);
      if (!c.ok) {
        // 컨테이너 생성 응답 유실은 게시가 아니므로(발행 전 단계) 실패로 기록
        await finish(db, d, { status: "failed", errorKind: c.err.kind, lastError: c.err.error });
        return "failed";
      }
      containerId = c.containerId;
      if (!await savePreparedContainer(db, d, containerId)) return "skipped";
    }
    const w = await ig.waitForContainer(containerId, token, 90_000, authMode);
    if (w.state === "IN_PROGRESS") {
      await parkContainerWait(db, d);
      return "skipped";
    }
    if (w.state === "PUBLISHED") {
      await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: "컨테이너가 이미 게시됨 — 게시물 ID를 확인하세요" });
      return "unknown";
    }
    if (w.state !== "FINISHED") {
      // ERROR/EXPIRED cannot be published again. Keep an unreadable container,
      // however: its next status check may reveal an already published post.
      const unusable = w.state === "ERROR" || w.state === "EXPIRED";
      await finish(db, d, { status: "failed", errorKind: w.err?.kind ?? "terminal", lastError: w.err?.error ?? `컨테이너 상태 ${w.state} ${w.detail ?? ""}`, ...(unusable ? { externalContainerId: null } : {}) });
      return "failed";
    }
    const dispatch = await beginDeliveryDispatch(db, d);
    if (!dispatch.ok) {
      if (dispatch.stale) return "skipped";
      if (dispatch.uncertain) { await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: dispatch.error }); return "unknown"; }
      return block(dispatch.error);
    }
    const p = await ig.publishContainer(userId, token, containerId, authMode);
    if (!p.ok) {
      if (p.lost) {
        await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: "게시 요청 응답 유실 — 계정에서 게시 여부 확인 필요" });
        return "unknown";
      }
      await finish(db, d, { status: "failed", errorKind: p.err.kind, lastError: p.err.error });
      return "failed";
    }
    // Persist the post ID before the optional permalink GET can time out or the process exits.
    await finish(db, d, { status: "succeeded", externalId: p.mediaId, completedAt: new Date(), lastError: null });
    const link = await ig.mediaPermalink(p.mediaId, token, authMode).catch(() => null);
    if (link) await db.update(deliveries).set({ externalUrl: link }).where(and(eq(deliveries.id, d.id), eq(deliveries.status, "succeeded"), eq(deliveries.externalId, p.mediaId)));
    return "succeeded";
  }
  await finish(db, d, { status: "failed", errorKind: "terminal", lastError: `알 수 없는 플랫폼 ${dest.platform}` });
  return "failed";
}

/** 실패한 목적지만 재시도(결과 불명은 운영자가 '게시 안 됨'을 확인한 경우에만) */
export async function retryDelivery(db: DB, deliveryId: number, actor: string, confirmNotPosted = false) {
  return db.transaction(async tx => {
    const [initial] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    if (!initial) return { ok: false as const, error: "전송 기록 없음" };
    const [initialApproval] = await tx.select().from(approvals).where(eq(approvals.id, initial.approvalId));
    if (!initialApproval) return { ok: false as const, error: "승인 기록이 없습니다." };
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, initialApproval.contentItemId)).for("update");
    const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId)).for("update");
    const [ap] = await tx.select().from(approvals).where(eq(approvals.id, initial.approvalId)).for("update");
    if (!d || !["failed", "unknown", "dry_run"].includes(d.status) || d.externalId) return { ok: false as const, error: "이미 처리 중이거나 다시 전송할 수 없는 상태입니다. 최신 전송 상태를 확인하세요." };
    if (d.needsReconciliation) return { ok: false as const, code: "confirmation_required" as const, error: "이전 시도의 게시 응답을 먼저 대조하세요. 결과 확인이 끝나기 전에는 재전송하지 않습니다." };
    if (d.status === "unknown" && !confirmNotPosted) return { ok: false as const, code: "confirmation_required" as const, error: "결과 불명 전송은 실제로 게시되지 않았음을 확인한 뒤 다시 전송하세요." };
    if (!ap || ap.status !== "active" || !item || item.currentRevisionId !== ap.revisionId || item.reviewStatus !== "reviewed" || item.excluded || item.relevance === "irrelevant") {
      return { ok: false as const, error: "승인 이후 콘텐츠나 승인 상태가 바뀌었습니다. 최신 내용을 확인하고 다시 승인하세요." };
    }
    if (!d.destinationSnapshot) return { ok: false as const, code: "approval_required" as const, error: "이전 승인에는 게시 계정 확인 기록이 없습니다. 최신 내용을 확인하고 다시 승인하세요." };
    const prior = await tx.select({ status: deliveries.status, revisionId: approvals.revisionId, needsReconciliation: deliveries.needsReconciliation }).from(deliveries)
      .innerJoin(approvals, eq(approvals.id, deliveries.approvalId)).where(eq(approvals.contentItemId, item.id));
    if (prior.some(row => row.revisionId !== ap.revisionId && (["processing", "unknown"].includes(row.status) || row.needsReconciliation))) return { ok: false as const, error: "이전 버전의 전송 결과를 먼저 확인하세요. 결과가 미확정인 동안에는 새 버전을 전송하지 않습니다." };
    const proof = await tx.select({ id: deliveryAttemptEvents.id }).from(deliveryAttemptEvents).where(and(eq(deliveryAttemptEvents.deliveryId, d.id), eq(deliveryAttemptEvents.source, "provider"), eq(deliveryAttemptEvents.status, "succeeded"))).limit(1);
    if (proof.length) return { ok: false as const, code: "confirmation_required" as const, error: "저장된 외부 게시 성공 응답이 있습니다. 게시 결과를 다시 확인하세요." };
    const now = new Date();
    // Older failures retained these terminal container IDs. Discard only our
    // explicit terminal-state record, never a generic auth/transport failure.
    const unusableContainer = d.status === "failed" && /^컨테이너 상태 (?:ERROR|EXPIRED)(?:\s|$)/.test(d.lastError ?? "");
    await tx.insert(deliveryAttemptEvents).values({ deliveryId: d.id, attemptId: d.lastAttemptId, event: d.status === "unknown" ? "operator_confirmed_not_posted_and_retry" : "retry_requested", phase: d.phase, status: d.status, source: "operator", actor,
      externalContainerId: d.externalContainerId, note: d.status === "unknown" ? "운영자가 게시되지 않았음을 확인하고 재전송을 요청했습니다." : "운영자가 이 목적지만 재전송을 요청했습니다." });
    const changed = await tx.update(deliveries).set({ status: "scheduled", phase: "queued", lastError: null, errorKind: null, completedAt: null, requestStartedAt: null, dispatchStartedAt: null,
      leaseToken: null, leaseOwner: null, leaseExpiresAt: null, outcomeSource: null, resolutionNote: null,
      externalUrl: null, externalContainerId: d.status === "unknown" || d.outcomeSource === "operator_not_posted" || unusableContainer ? null : d.externalContainerId, updatedAt: now })
      .where(and(eq(deliveries.id, d.id), eq(deliveries.approvalId, ap.id), eq(deliveries.status, d.status))).returning({ id: deliveries.id });
    if (!changed.length) return { ok: false as const, error: "전송 상태가 이미 변경됐습니다. 최신 상태를 확인하세요." };
    await recomputePublicationStatus(tx as unknown as DB, ap.id, now);
    await audit(tx, { actor, action: "retry_delivery", entity: "delivery", entityId: d.id, channelId: d.channelId, detail: { from: d.status, confirmNotPosted } });
    return { ok: true as const, deliveryId: d.id, approvalId: ap.id };
  });
}
