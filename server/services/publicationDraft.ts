import { and, eq, inArray } from "drizzle-orm";
import { channelSlug } from "../../shared/channelKeys";
import { publicationKstDate, samePublicationDestinations, samePublicationOptions, type PublicationDraft, type PublicationDraftSave, type PublicationOptions, type StudioPublicationDraft, type StudioPublicationDraftSave } from "../../shared/publicationDraft";
import { channels, contentItems, destinations, studioCards } from "../../shared/schema";
import { audit } from "../audit";
import type { DB } from "../db";
import { conflict, HttpError } from "../routes/util";
import { revokePublicationEligibility } from "./publicationState";
import { assertStudioActive, loadStudioCard } from "./studio";
import { lockStudioPublication } from "./studioPublicationState";

type ApprovalIntent = {
  publicationDraftVersion?: number;
  destinationIds?: number[];
  timing?: "now" | "later";
  scheduledAt: Date;
};

/** Run again under the content/card lock after any provider verification awaits. */
export function assertPublicationDraftIntent(draft: StudioPublicationDraft | null | undefined, intent: ApprovalIntent, now = new Date()) {
  if (intent.publicationDraftVersion !== undefined && intent.publicationDraftVersion !== (draft?.version ?? 0)) {
    throw new HttpError(409, "게시 준비가 다른 화면에서 변경됐습니다. 저장된 최신 캡션·게시 계정·시각을 확인하세요.");
  }
  const options = draft?.options;
  if (!options) return; // Existing caption-only clients and drafts remain compatible.
  if (intent.publicationDraftVersion === undefined) throw new HttpError(409, "저장된 게시 준비 버전을 확인한 뒤 다시 승인하세요.");
  if (!options.destinationIds.length) throw new HttpError(400, "게시할 계정을 선택하고 게시 준비를 저장해 주세요.");
  if (!intent.destinationIds || !samePublicationDestinations(options.destinationIds, intent.destinationIds) || options.timing !== intent.timing) {
    throw new HttpError(409, "저장된 게시 계정·시점과 승인 요청이 다릅니다. 게시 준비를 저장하고 다시 확인하세요.");
  }
  if (options.timing === "later") {
    const scheduledAt = publicationKstDate(options.scheduledAtKst);
    if (!scheduledAt) throw new HttpError(400, "예약 시간을 입력하고 게시 준비를 저장해 주세요.");
    if (scheduledAt.getTime() <= now.getTime()) throw new HttpError(400, "예약 시간은 현재 이후로 선택해 주세요. 게시 준비를 저장하고 다시 확인하세요.");
    if (scheduledAt.getTime() !== intent.scheduledAt.getTime()) throw new HttpError(409, "저장된 한국 시간 예약 시각과 승인 요청이 다릅니다. 게시 준비를 다시 확인하세요.");
  }
}

/** Saving incomplete inputs is safe; account existence/ownership is still mandatory. */
async function validateDraftDestinations(db: DB, channelId: number, options: PublicationOptions, instagramOnly = false) {
  if (instagramOnly && options.destinationIds.length > 1) throw new HttpError(400, "직접 제작 콘텐츠의 인스타그램 게시 계정은 하나만 선택해 주세요.");
  if (!options.destinationIds.length) return;
  const selected = await db.select().from(destinations).where(and(eq(destinations.channelId, channelId), inArray(destinations.id, options.destinationIds))).for("share");
  if (selected.length !== options.destinationIds.length) throw new HttpError(400, "이 채널에 없는 게시 계정이 포함됐습니다. 계정 선택을 다시 확인하세요.");
  if (selected.some(row => instagramOnly ? row.platform !== "instagram" : !["instagram", "telegram_channel"].includes(row.platform))) {
    throw new HttpError(400, "지원하는 게시 계정을 선택해 주세요.");
  }
  // Disabled/unconfigured accounts may stay in a draft. Approval verifies them
  // separately and must never substitute a different destination silently.
}

export async function saveItemPublicationDraft(db: DB, itemId: number, channelId: number, input: PublicationDraftSave, actor: string): Promise<PublicationDraft> {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, itemId), eq(contentItems.channelId, channelId))).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    if (item.origin === "studio") {
      const [card] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
      if (card?.importedMeta?.studioPublication) throw new HttpError(409, "직접 제작한 콘텐츠의 게시 준비는 제작보드에서 저장해 주세요.", { canonicalStudioCardId: card.id });
    }
    const version = item.publicationDraft?.version ?? 0;
    if (version !== input.version) conflict({ publicationDraft: item.publicationDraft });
    if (input.options) await validateDraftDestinations(tx as unknown as DB, channelId, input.options);
    const options = input.options ?? item.publicationDraft?.options;
    const previous = item.publicationDraft;
    if (previous && previous.captions.instagram === input.captions.instagram && previous.captions.telegram === input.captions.telegram && samePublicationOptions(previous.options, options)) return previous;
    await revokePublicationEligibility(tx as unknown as DB, item.id, "게시 준비 변경 — 저장된 캡션·계정·시각을 다시 확인하고 승인해 주세요.", actor);
    const publicationDraft: PublicationDraft = { version: version + 1, captions: input.captions, ...(options ? { options } : {}) };
    await tx.update(contentItems).set({ publicationDraft, updatedAt: new Date() }).where(eq(contentItems.id, item.id));
    await audit(tx, { actor, action: "save_publication_draft", entity: "content_item", entityId: item.id, channelId, detail: { version: publicationDraft.version } });
    return publicationDraft;
  });
}

function assertStudioDraftOwner(card: typeof studioCards.$inferSelect) {
  if (card.sourceItemId && !card.importedMeta?.studioPublication) throw new HttpError(409, "수집한 콘텐츠의 게시 준비는 원고 편집 화면에서 저장해 주세요.");
}

export async function getStudioPublicationDraft(db: DB, cardId: number): Promise<StudioPublicationDraft> {
  const card = await loadStudioCard(db, cardId);
  assertStudioDraftOwner(card);
  return card.publicationDraft ?? { version: 0 };
}

export async function saveStudioPublicationDraft(db: DB, cardId: number, input: StudioPublicationDraftSave, actor: string): Promise<StudioPublicationDraft> {
  return db.transaction(async tx => {
    const dbtx = tx as unknown as DB;
    const card = await lockStudioPublication(dbtx, cardId);
    assertStudioActive(card);
    assertStudioDraftOwner(card);
    const version = card.publicationDraft?.version ?? 0;
    if (version !== input.version) conflict({ publicationDraft: card.publicationDraft ?? { version: 0 } });
    const [channel] = await tx.select().from(channels).where(eq(channels.slug, channelSlug(card.content.channel)));
    if (!channel) throw new HttpError(404, "채널을 찾을 수 없습니다.");
    await validateDraftDestinations(dbtx, channel.id, input.options, true);
    if (card.publicationDraft && samePublicationOptions(card.publicationDraft.options, input.options)) return card.publicationDraft;
    if (card.sourceItemId) await revokePublicationEligibility(dbtx, card.sourceItemId, "게시 계정·시각 변경 — 게시 준비를 다시 확인하고 승인해 주세요.", actor);
    const publicationDraft: StudioPublicationDraft = { version: version + 1, options: input.options };
    await tx.update(studioCards).set({ publicationDraft, updatedAt: new Date() }).where(eq(studioCards.id, card.id));
    await audit(tx, { actor, action: "save_publication_draft", entity: "studio_card", entityId: card.id, channelId: channel.id, detail: { version: publicationDraft.version } });
    return publicationDraft;
  });
}
