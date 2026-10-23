/**
 * 카드 생성 · 최종 승인 · 목적지별 전송
 *
 * - 최종 승인 = 콘텐츠 revision + 실제 카드 해시 + 목적지별 캡션 + 예약 시각. 하나라도 바뀌면 무효 → 재승인.
 * - 승인한 파일을 게시 시 다시 생성하지 않는다(DB에 고정 저장된 JPEG를 그대로 사용).
 * - 게시 직전 다시 검사: 전역 정지, 승인 유효, revision 최신, 카드 해시, 마감, 일일 게시 한도, 목적지 활성.
 * - DRY_RUN=true(기본)면 외부로 생성/게시 POST를 보내지 않고 succeeded로 저장하지 않는다.
 * - 응답 유실은 unknown. Telegram은 자동 재전송하지 않는다. exactly-once를 보장하지 않는다.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  approvals,
  channels,
  contentItems,
  contentRevisions,
  deliveries,
  destinations,
  mediaAssets,
  sourceDocuments,
  type Delivery,
} from "../../shared/schema";
import { payloadSchemaFor } from "../../shared/payloads";
import { buildCardModel, validateCaptions } from "../services/cardModel";
import { renderCardJpeg, CardOverflowError, CardFontError } from "../services/card";
import { sha256 } from "../services/text";
import { computeScheduleStatus, kstToday, KST_OFFSET_MIN } from "../services/dates";
import { env } from "../env";
import { getSetting } from "../seed";
import { resolveSecrets } from "../services/secrets";
import { uploadCard } from "../services/cloudinary";
import { sendPhotoToChannel, telegramPostUrl } from "../services/telegram";
import * as ig from "../services/instagram";
import { audit } from "../audit";
import { resolveStyle } from "../services/templates";

export async function currentRevision(db: DB, itemId: number) {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId));
  if (!item) return null;
  if (!item.currentRevisionId) return { item, rev: null };
  const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, item.currentRevisionId));
  return { item, rev };
}

export async function sourceOrgFor(db: DB, item: { primarySourceId: number | null }, payload: Record<string, any>) {
  if (payload.organization) return String(payload.organization);
  if (!item.primarySourceId) return null;
  const [doc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, item.primarySourceId));
  if (!doc) return null;
  try {
    return new URL(doc.originalUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ───────────── 카드 생성 ───────────── */
export async function renderCardForItem(db: DB, itemId: number, now = new Date(), templateKey?: string | null) {
  const cr = await currentRevision(db, itemId);
  if (!cr) return { ok: false as const, code: "not_found", error: "항목 없음" };
  const { item, rev } = cr;
  if (!rev) return { ok: false as const, code: "no_revision", error: "초안이 없습니다. 먼저 추출·작성하세요." };
  const parsed = payloadSchemaFor(item.kind).safeParse(rev.payload);
  if (!parsed.success) return { ok: false as const, code: "invalid_payload", error: "초안 형식이 올바르지 않습니다. 편집 화면에서 필수 항목을 채우세요." };
  const [ch] = await db.select().from(channels).where(eq(channels.id, item.channelId));
  const payload = rev.payload as Record<string, any>;
  const title = payload.title || payload.key_question;
  if (!title || !String(title).trim()) return { ok: false as const, code: "invalid_payload", error: "카드 제목(제목/핵심 질문)이 비어 있습니다." };
  const model = buildCardModel({
    kind: item.kind,
    payload,
    channelName: ch.name,
    accent: ch.accentColor,
    sourceOrg: await sourceOrgFor(db, item, payload),
    checkedDate: kstToday(now),
  });
  const key = templateKey || ch.cardTemplate || "builtin:classic";
  let style;
  try {
    style = await resolveStyle(db, key, ch.id);
  } catch (e) {
    return { ok: false as const, code: "template", error: (e as Error).message };
  }
  let out;
  try {
    out = await renderCardJpeg(model, style);
  } catch (e) {
    if (e instanceof CardOverflowError) return { ok: false as const, code: "overflow", field: e.field, error: `편집 필요: ${e.message}` };
    if (e instanceof CardFontError) return { ok: false as const, code: "font", error: e.message };
    return { ok: false as const, code: "render", error: `카드 렌더러 오류: ${(e as Error).message}` };
  }
  const hash = sha256(out.jpeg);
  await db
    .insert(mediaAssets)
    .values({ channelId: item.channelId, contentItemId: item.id, revisionId: rev.id, sha256: hash, width: out.width, height: out.height, bytes: out.jpeg, source: key.startsWith("custom:") ? "custom" : "builtin", templateKey: key })
    .onConflictDoNothing();
  const [asset] = await db
    .select({ id: mediaAssets.id, sha256: mediaAssets.sha256, revisionId: mediaAssets.revisionId, createdAt: mediaAssets.createdAt, source: mediaAssets.source, templateKey: mediaAssets.templateKey })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.revisionId, rev.id), eq(mediaAssets.sha256, hash)));
  return { ok: true as const, asset };
}

/* ───────────── 최종 승인 ───────────── */
export async function approveItem(
  db: DB,
  a: { itemId: number; revisionId: number; mediaAssetId: number; captions: { instagram: string; telegram: string }; scheduledAt: Date; actor: string; now?: Date },
) {
  const now = a.now ?? new Date();
  const cr = await currentRevision(db, a.itemId);
  if (!cr?.rev) return { ok: false as const, error: "초안이 없습니다." };
  const { item, rev } = cr;
  if (rev.id !== a.revisionId) return { ok: false as const, error: "최신 버전이 아닙니다. 새로고침 후 다시 확인하세요." };
  if (item.reviewStatus !== "reviewed") return { ok: false as const, error: "먼저 '검토 완료'로 표시해야 최종 승인할 수 있습니다." };
  if (item.relevance === "irrelevant" || item.excluded) return { ok: false as const, error: "관련 없음/제외 항목은 승인할 수 없습니다." };
  const [asset] = await db.select({ id: mediaAssets.id, revisionId: mediaAssets.revisionId, sha256: mediaAssets.sha256 }).from(mediaAssets).where(eq(mediaAssets.id, a.mediaAssetId));
  if (!asset || asset.revisionId !== rev.id) return { ok: false as const, error: "현재 버전으로 만든 카드가 아닙니다. 카드를 다시 생성하세요." };
  if (item.kind === "notice") {
    const st = computeScheduleStatus((rev.payload as any).schedules, now);
    if (st === "closed") return { ok: false as const, error: "접수가 마감된 공고는 승인할 수 없습니다." };
  }
  const capErr = validateCaptions(a.captions);
  if (capErr.length) return { ok: false as const, error: capErr.join(" ") };
  const dests = await db.select().from(destinations).where(and(eq(destinations.channelId, item.channelId), eq(destinations.enabled, true)));

  const approval = await db.transaction(async (tx) => {
    // 기존 활성 승인은 새 승인으로 대체
    const prev = await tx.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.contentItemId, item.id), eq(approvals.status, "active")));
    if (prev.length) {
      const ids = prev.map((p) => p.id);
      await tx.update(approvals).set({ status: "invalidated", invalidatedReason: "새 승인으로 대체", updatedAt: now }).where(inArray(approvals.id, ids));
      await tx.update(deliveries).set({ status: "cancelled", lastError: "새 승인으로 대체", updatedAt: now }).where(and(inArray(deliveries.approvalId, ids), eq(deliveries.status, "scheduled")));
    }
    const [ap] = await tx
      .insert(approvals)
      .values({ channelId: item.channelId, contentItemId: item.id, revisionId: rev.id, mediaAssetId: asset.id, cardSha256: asset.sha256, captions: a.captions, scheduledAt: a.scheduledAt, approvedBy: a.actor })
      .returning();
    for (const d of dests) {
      await tx.insert(deliveries).values({ channelId: item.channelId, approvalId: ap.id, destinationId: d.id, status: "scheduled" }).onConflictDoNothing();
    }
    await tx.update(contentItems).set({ publishStatus: dests.length ? "scheduled" : "waiting", updatedAt: now }).where(eq(contentItems.id, item.id));
    await audit(tx, { actor: a.actor, action: "approve", entity: "content_item", entityId: item.id, channelId: item.channelId, detail: { approvalId: ap.id, revisionId: rev.id, cardSha256: asset.sha256, destinations: dests.map((d) => d.id), scheduledAt: a.scheduledAt } });
    return ap;
  });
  return { ok: true as const, approval, destinations: dests.length };
}

export async function cancelApproval(db: DB, approvalId: number, actor: string) {
  return db.transaction(async (tx) => {
    const [ap] = await tx.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!ap || ap.status !== "active") return { ok: false as const, error: "취소할 수 있는 승인이 아닙니다." };
    const processing = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.approvalId, approvalId), inArray(deliveries.status, ["processing", "succeeded", "unknown"])));
    await tx.update(deliveries).set({ status: "cancelled", lastError: "운영자 취소", updatedAt: new Date() }).where(and(eq(deliveries.approvalId, approvalId), eq(deliveries.status, "scheduled")));
    await tx.update(approvals).set({ status: "cancelled", updatedAt: new Date() }).where(eq(approvals.id, approvalId));
    if (!processing.length) await tx.update(contentItems).set({ publishStatus: "cancelled" }).where(eq(contentItems.id, ap.contentItemId));
    await audit(tx, { actor, action: "cancel_approval", entity: "approval", entityId: approvalId, channelId: ap.channelId, detail: { alreadyProcessing: processing.length } });
    return { ok: true as const, alreadyProcessing: processing.length };
  });
}

/* ───────────── 전송 워커 ───────────── */

type PublishStats = { processed: number; succeeded: number; failed: number; unknown: number; dryRun: number; skipped: number; notes: string[] };

function kstDayStart(now: Date): Date {
  return new Date(Date.parse(`${kstToday(now)}T00:00:00Z`) - KST_OFFSET_MIN * 60_000);
}

export async function publishDue(db: DB, opts: { now?: Date; limit?: number; actor?: string } = {}): Promise<PublishStats> {
  const now = opts.now ?? new Date();
  const stats: PublishStats = { processed: 0, succeeded: 0, failed: 0, unknown: 0, dryRun: 0, skipped: 0, notes: [] };
  if (await getSetting(db, "global_stop", false)) {
    stats.notes.push("전역 정지 상태 — 게시하지 않음");
    return stats;
  }
  if (!env.autoPublish && !env.dryRun) {
    stats.notes.push("AUTO_PUBLISH=false — 실제 게시하지 않음(DRY_RUN=true로 모의 실행하거나 AUTO_PUBLISH를 켜세요)");
    return stats;
  }
  const due = await db
    .select({ d: deliveries, ap: approvals })
    .from(deliveries)
    .innerJoin(approvals, eq(deliveries.approvalId, approvals.id))
    .where(and(eq(deliveries.status, "scheduled"), eq(approvals.status, "active"), lte(approvals.scheduledAt, now)))
    .orderBy(approvals.scheduledAt, deliveries.id)
    .limit(opts.limit ?? 10);

  for (const { d } of due) {
    // 원자적 claim: scheduled → processing (다른 워커와 중복 방지)
    const claimed = await db
      .update(deliveries)
      .set({ status: "processing", attempts: sql`${deliveries.attempts} + 1`, requestStartedAt: now, updatedAt: now })
      .where(and(eq(deliveries.id, d.id), eq(deliveries.status, "scheduled")))
      .returning();
    if (!claimed.length) continue;
    stats.processed++;
    const res = await processDelivery(db, claimed[0], now);
    stats[res]++;
  }
  // 인스타그램 컨테이너 처리 대기 중이던 전송 이어가기
  const resumable = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.status, "processing"), sql`${deliveries.externalContainerId} is not null`, sql`${deliveries.externalId} is null`, sql`${deliveries.updatedAt} < now() - interval '2 minutes'`))
    .limit(5);
  for (const d of resumable) {
    stats.processed++;
    const res = await processDelivery(db, d, now);
    stats[res]++;
  }
  return stats;
}

async function finish(db: DB, d: Delivery, patch: Partial<Delivery>) {
  await db.update(deliveries).set({ ...patch, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
  // 승인 단위 집계
  const all = await db.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.approvalId, d.approvalId));
  const st = all.map((x) => x.status);
  const terminal = st.every((s) => ["succeeded", "failed", "unknown", "cancelled", "dry_run"].includes(s));
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, d.approvalId));
  const agg = st.includes("unknown") ? "unknown" : st.includes("failed") ? "failed" : st.includes("processing") || st.includes("scheduled") ? "processing" : st.every((s) => s === "succeeded") ? "succeeded" : st.includes("succeeded") ? "failed" : "waiting";
  await db.update(contentItems).set({ publishStatus: agg, updatedAt: new Date(), ...(agg === "succeeded" ? { lastUsedAt: new Date() } : {}) }).where(eq(contentItems.id, ap.contentItemId));
  if (terminal && st.every((s) => s === "succeeded")) await db.update(approvals).set({ status: "completed", updatedAt: new Date() }).where(eq(approvals.id, ap.id));
}

async function processDelivery(db: DB, d: Delivery, now: Date): Promise<"succeeded" | "failed" | "unknown" | "dryRun" | "skipped"> {
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, d.approvalId));
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, ap.contentItemId));
  const [dest] = await db.select().from(destinations).where(eq(destinations.id, d.destinationId));
  const [ch] = await db.select().from(channels).where(eq(channels.id, d.channelId));
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ap.mediaAssetId));
  const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, ap.revisionId));

  const block = async (msg: string) => {
    await finish(db, d, { status: "cancelled", lastError: msg, errorKind: "terminal" });
    return "skipped" as const;
  };
  // 게시 직전 재검사
  if (!ch?.active) return block("보관된 채널 — 게시 중단");
  if (ap.status !== "active") return block("승인이 더 이상 유효하지 않음");
  if (item.currentRevisionId !== ap.revisionId) return block("승인 이후 콘텐츠가 수정됨 — 재승인 필요");
  if (!asset || sha256(asset.bytes) !== ap.cardSha256) return block("카드 파일이 승인본과 다름");
  if (!dest?.enabled) return block("목적지 비활성");
  if (item.kind === "notice" && computeScheduleStatus((rev.payload as any).schedules, now) === "closed") return block("접수 마감 — 게시 중단");
  if (!d.externalContainerId) {
    const [{ c }] = (await db.execute(sql`
      select count(*)::int as c from deliveries where channel_id = ${d.channelId} and id <> ${d.id}
      and status in ('succeeded','processing','unknown') and request_started_at >= ${kstDayStart(now).toISOString()}
    `)).rows as Array<{ c: number }>;
    if (Number(c) >= ch.budget.dailyPublishLimit) {
      await db.update(deliveries).set({ status: "scheduled", lastError: "오늘 게시 한도 도달 — 다음 실행에서 처리", updatedAt: new Date() }).where(eq(deliveries.id, d.id));
      return "skipped";
    }
  }
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
    const r = await sendPhotoToChannel(sec.values.chatId, asset.bytes, ap.captions.telegram);
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
    const token = sec.values.accessToken, userId = sec.values.userId;
    let containerId = d.externalContainerId;
    if (!containerId) {
      let url = asset.cloudinaryUrl;
      if (!url) {
        try {
          const up = await uploadCard(asset.bytes, `ai-mom/${ch.slug}/approval-${ap.id}-${ap.cardSha256.slice(0, 12)}`);
          url = up.url;
          await db.update(mediaAssets).set({ cloudinaryPublicId: up.publicId, cloudinaryUrl: up.url }).where(eq(mediaAssets.id, asset.id));
        } catch (e) {
          await finish(db, d, { status: "failed", errorKind: "transient", lastError: `이미지 업로드 실패: ${(e as Error).message}` });
          return "failed";
        }
      }
      const c = await ig.createContainer(userId, token, url, ap.captions.instagram);
      if (!c.ok) {
        // 컨테이너 생성 응답 유실은 게시가 아니므로(발행 전 단계) 실패로 기록
        await finish(db, d, { status: "failed", errorKind: c.err.kind, lastError: c.err.error });
        return "failed";
      }
      containerId = c.containerId;
      await db.update(deliveries).set({ externalContainerId: containerId, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
    }
    const w = await ig.waitForContainer(containerId, token);
    if (w.state === "IN_PROGRESS") {
      await db.update(deliveries).set({ lastError: "인스타그램 이미지 처리 중 — 다음 실행에서 이어서 확인", updatedAt: new Date() }).where(eq(deliveries.id, d.id));
      return "skipped";
    }
    if (w.state === "PUBLISHED") {
      await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: "컨테이너가 이미 게시됨 — 게시물 ID를 확인하세요" });
      return "unknown";
    }
    if (w.state !== "FINISHED") {
      await finish(db, d, { status: "failed", errorKind: w.err?.kind ?? "terminal", lastError: w.err?.error ?? `컨테이너 상태 ${w.state} ${w.detail ?? ""}` });
      return "failed";
    }
    const p = await ig.publishContainer(userId, token, containerId);
    if (!p.ok) {
      if (p.lost) {
        await finish(db, d, { status: "unknown", errorKind: "unknown", lastError: "게시 요청 응답 유실 — 계정에서 게시 여부 확인 필요" });
        return "unknown";
      }
      await finish(db, d, { status: "failed", errorKind: p.err.kind, lastError: p.err.error });
      return "failed";
    }
    const link = await ig.mediaPermalink(p.mediaId, token);
    await finish(db, d, { status: "succeeded", externalId: p.mediaId, externalUrl: link, completedAt: new Date(), lastError: null });
    return "succeeded";
  }
  await finish(db, d, { status: "failed", errorKind: "terminal", lastError: `알 수 없는 플랫폼 ${dest.platform}` });
  return "failed";
}

/** 실패한 목적지만 재시도(결과 불명은 운영자가 '게시 안 됨'을 확인한 경우에만) */
export async function retryDelivery(db: DB, deliveryId: number, actor: string, confirmNotPosted = false) {
  const [d] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!d) return { ok: false as const, error: "전송 기록 없음" };
  if (d.status === "unknown" && !confirmNotPosted) return { ok: false as const, error: "결과 불명 전송은 실제로 게시되지 않았음을 확인한 뒤 재시도하세요." };
  if (!["failed", "unknown", "dry_run"].includes(d.status)) return { ok: false as const, error: "재시도할 수 없는 상태입니다." };
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, d.approvalId));
  if (ap.status !== "active") return { ok: false as const, error: "승인이 유효하지 않습니다. 다시 승인하세요." };
  await db.update(deliveries).set({ status: "scheduled", lastError: null, errorKind: null, externalContainerId: d.status === "unknown" ? null : d.externalContainerId, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
  await audit(db, { actor, action: "retry_delivery", entity: "delivery", entityId: d.id, channelId: d.channelId, detail: { from: d.status, confirmNotPosted } });
  return { ok: true as const };
}

