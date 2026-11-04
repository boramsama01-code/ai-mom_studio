import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import type { CardCopy } from "../../shared/cardCopy";
import { cardCopySchema } from "../../shared/cardCopy";
import { channels, contentItems, contentRevisions, mediaAssets, studioCards } from "../../shared/schema";
import type { DB } from "../db";
import { audit } from "../audit";
import { HttpError } from "../routes/util";
import { assertStudioActive } from "./studio";
import { assertGenerationActive, completeGenerationResult, currentGenerationSignal } from "./generationContext";
import { generateStudioImage } from "./studioAi";
import { resolveChannelAiSettings } from "./channelAi";
import { AiServiceError } from "./llm";
import { runSourceGeneration } from "./sourceGeneration";
import { sha256 } from "./text";

export const CARD_PAGE_ARTWORK_KIND = "card_page_art";
export const CARD_PAGE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const CARD_PAGE_UPLOAD_MAX_DATA_URL = 12 * 1024 * 1024;
export const CARD_PAGE_ARTWORK_MAX_PIXELS = 40_000_000;
export type CardPageId = "cover" | `body-${number}`;
export type CardPageArtworkSource = "ai" | "upload";
export type CardPageArtworkMap = Map<number, Buffer> & { credits: Map<number, string> };
export const cardPageArtworkCredit = (source: string) => source === "ai" ? "AI 일러스트 · OpenAI" : "직접 등록 이미지";
export type CardPageArtworkInput = {
  channelId: number;
  itemId: number;
  version: number;
  requestId: string;
  pageId: CardPageId;
  mode: CardPageArtworkSource;
  instruction?: string;
  imageData?: string;
  actor: string;
};
type Background = { assetId: number; opacity?: number };
type CopyBackgrounds = { cover: { background?: Background | null }; pages: Array<{ background?: Background | null }> };

/** Asset IDs remain usable in later revisions of this item, never in another item/channel. */
export function cardPageArtworkIds(copy: CardCopy): number[] {
  const value = copy as CardCopy & CopyBackgrounds;
  const ids = [value.cover.background, ...value.pages.map(page => page.background)]
    .filter((background): background is Background => background != null)
    .map(background => background.assetId);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new HttpError(400, "페이지 배경 이미지 ID를 확인해 주세요.");
  return [...new Set(ids)];
}

/** Saving references must not transfer every JPEG out of PostgreSQL again. */
export async function assertCardPageArtworkOwnership(db: DB, itemId: number, channelId: number, copy: CardCopy) {
  const ids = cardPageArtworkIds(copy);
  if (!ids.length) return;
  const rows = await db.select({ id: mediaAssets.id, mime: mediaAssets.mime }).from(mediaAssets)
    .innerJoin(contentRevisions, and(eq(contentRevisions.id, mediaAssets.revisionId), eq(contentRevisions.contentItemId, itemId)))
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.contentItemId, itemId), eq(mediaAssets.channelId, channelId), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND)));
  if (rows.length !== ids.length || rows.some(row => row.mime !== "image/jpeg")) throw new HttpError(404, "이 콘텐츠의 페이지 배경 이미지를 찾을 수 없습니다. 다른 콘텐츠의 이미지는 사용할 수 없습니다.");
}

/** The live preview only needs the selected page's bytes; final export loads all. */
export async function loadCardPageArtworkForPage(db: DB, itemId: number, channelId: number, copy: CardCopy, pageIndex: number) {
  return loadCardPageArtwork(db, itemId, channelId, { ...copy,
    cover: pageIndex === 0 ? copy.cover : { ...copy.cover, background: undefined },
    pages: copy.pages.map((page, index) => index + 1 === pageIndex ? page : { ...page, background: undefined }),
  });
}

async function scopedArtwork(db: DB, itemId: number, channelId: number, ids: number[]) {
  if (!ids.length) return [];
  const rows = await db.select({ asset: mediaAssets }).from(mediaAssets)
    .innerJoin(contentRevisions, and(eq(contentRevisions.id, mediaAssets.revisionId), eq(contentRevisions.contentItemId, itemId)))
    .innerJoin(contentItems, and(eq(contentItems.id, mediaAssets.contentItemId), eq(contentItems.channelId, channelId)))
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.contentItemId, itemId), eq(mediaAssets.channelId, channelId), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND)));
  if (rows.length !== ids.length) throw new HttpError(404, "이 콘텐츠의 페이지 배경 이미지를 찾을 수 없습니다. 다른 콘텐츠의 이미지는 사용할 수 없습니다.");
  for (const { asset } of rows) {
    if (asset.mime !== "image/jpeg" || asset.sha256 !== sha256(asset.bytes)) throw new HttpError(409, "페이지 배경 이미지가 저장본과 다릅니다. 이미지를 다시 선택해 주세요.");
  }
  return rows.map(row => row.asset);
}

/** Shared by draft save, preview and final rendering. Map keys are immutable asset IDs. */
export async function loadCardPageArtwork(db: DB, itemId: number, channelId: number, copy: CardCopy): Promise<CardPageArtworkMap> {
  const rows = await scopedArtwork(db, itemId, channelId, cardPageArtworkIds(copy));
  return Object.assign(new Map(rows.map(asset => [asset.id, asset.bytes])), {
    credits: new Map(rows.map(asset => [asset.id, cardPageArtworkCredit(asset.source)])),
  });
}

export async function loadCardPageArtworkAsset(db: DB, itemId: number, channelId: number, assetId: number) {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new HttpError(400, "페이지 배경 이미지 ID를 확인해 주세요.");
  return (await scopedArtwork(db, itemId, channelId, [assetId]))[0];
}

/** Decode actual pixels, reject animated/spoofed input, and drop EXIF/XMP before storage. */
export async function normalizeCardPageArtwork(bytes: Buffer, expectedMime?: string) {
  if (!bytes.length || bytes.length > CARD_PAGE_UPLOAD_MAX_BYTES) throw new HttpError(413, "배경 이미지는 8MB 이하로 선택해 주세요.");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: CARD_PAGE_ARTWORK_MAX_PIXELS, failOn: "error", animated: true }).metadata();
    const mime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[metadata.format ?? ""];
    if (!mime || (expectedMime && mime !== expectedMime)) throw new HttpError(400, "파일의 실제 형식이 PNG·JPG·WEBP 이미지와 일치하지 않습니다.");
    if ((metadata.pages ?? 1) !== 1) throw new HttpError(400, "움직이는 이미지 대신 PNG·JPG·WEBP 정지 이미지를 선택해 주세요.");
    const { width, height } = metadata;
    if (!width || !height || width * height > CARD_PAGE_ARTWORK_MAX_PIXELS || width > 16384 || height > 16384) throw new HttpError(400, "이미지 해상도가 너무 큽니다. 4천만 화소 이하의 이미지를 선택해 주세요.");
    const normalized = await sharp(bytes, { limitInputPixels: CARD_PAGE_ARTWORK_MAX_PIXELS, failOn: "error" })
      .rotate().resize(1600, 2000, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
    if (normalized.data.length > CARD_PAGE_UPLOAD_MAX_BYTES) throw new HttpError(413, "이미지를 줄인 뒤 다시 선택해 주세요. 저장 한도는 8MB입니다.");
    return { bytes: normalized.data, width: normalized.info.width, height: normalized.info.height, mime: "image/jpeg" as const };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "이미지 파일을 읽을 수 없거나 해상도 한도를 넘었습니다. PNG·JPG·WEBP 파일을 다시 선택해 주세요.");
  }
}

export async function decodeCardPageUpload(dataUrl: string) {
  if (dataUrl.length > CARD_PAGE_UPLOAD_MAX_DATA_URL) throw new HttpError(413, "배경 이미지는 8MB 이하로 선택해 주세요.");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new HttpError(400, "PNG·JPG·WEBP 이미지 파일을 선택하거나 붙여넣어 주세요. 외부 이미지 주소는 지원하지 않습니다.");
  // Bound allocation before decoding; Buffer.from otherwise accepts oversized base64 input.
  if (match[2].length > Math.ceil(CARD_PAGE_UPLOAD_MAX_BYTES / 3) * 4) throw new HttpError(413, "배경 이미지는 8MB 이하로 선택해 주세요.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) throw new HttpError(400, "이미지 데이터 형식이 올바르지 않습니다. 파일을 다시 선택해 주세요.");
  return normalizeCardPageArtwork(bytes, match[1]);
}

function selectedPage(copy: CardCopy, pageId: CardPageId) {
  if (pageId === "cover") return copy.cover;
  // Positional body-N addresses support older saved pages with descriptive IDs.
  const match = /^body-([1-9])$/.exec(pageId);
  const page = match ? copy.pages[Number(match[1]) - 1] : undefined;
  if (!page) throw new HttpError(400, "배경을 적용할 카드 페이지를 확인해 주세요.");
  return page;
}

/** Short transaction only: no DB connection or item lock is held during provider I/O. */
async function pageSnapshot(db: DB, input: CardPageArtworkInput) {
  return db.transaction(async tx => {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, input.channelId)).for("share");
    if (!channel?.active) throw new HttpError(409, "보관된 채널입니다. 채널을 복원한 뒤 배경을 만들어 주세요.");
    const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, input.itemId), eq(contentItems.channelId, input.channelId))).for("update");
    if (!item) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    if (item.version !== input.version) throw new HttpError(409, "원고가 변경됐습니다. 최신 카드 문구를 확인한 뒤 배경을 만들어 주세요.");
    const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
    if (board) assertStudioActive(board);
    const [revision] = item.currentRevisionId ? await tx.select().from(contentRevisions)
      .where(and(eq(contentRevisions.id, item.currentRevisionId), eq(contentRevisions.contentItemId, item.id))) : [];
    const savedCopy = cardCopySchema.safeParse(revision?.payload.cardCopy);
    if (!revision || !savedCopy.success) throw new HttpError(409, "카드 문구를 먼저 저장한 뒤 페이지 배경을 만들어 주세요.");
    const page = selectedPage(savedCopy.data, input.pageId);
    await assertGenerationActive(tx as unknown as DB);
    return { item, revision, copy: savedCopy.data, page };
  });
}

/** Create an immutable proposal; applying it is an explicit, versioned card-copy save. */
export async function createCardPageArtwork(db: DB, input: CardPageArtworkInput) {
  const imageSelection = input.mode === "ai" ? await resolveChannelAiSettings(db, input.channelId, "image") : undefined;
  const intent = {
    pageBackground: true,
    pageId: input.pageId,
    mode: input.mode,
    instruction: input.instruction?.trim() ?? "",
    uploadHash: input.imageData ? sha256(input.imageData) : null,
  };
  return runSourceGeneration(db, { type: "card_render", channelId: input.channelId, itemId: input.itemId, version: input.version,
    requestId: input.requestId, intent, configuration: imageSelection ? { image: imageSelection } : undefined, actor: input.actor }, async () => {
    const snapshot = await pageSnapshot(db, input);
    let normalized: Awaited<ReturnType<typeof normalizeCardPageArtwork>>;
    let model: string | null = null;
    if (input.mode === "upload") {
      if (!input.imageData) throw new HttpError(400, "배경으로 사용할 이미지를 선택해 주세요.");
      normalized = await decodeCardPageUpload(input.imageData);
    } else {
      const background = (snapshot.page as typeof snapshot.page & { background?: Background | null }).background;
      const previous = background ? await loadCardPageArtworkAsset(db, input.itemId, input.channelId, background.assetId) : null;
      try {
        const generated = await generateStudioImage({ provider: "openai", model: imageSelection!.model, purpose: "cover",
          prompt: JSON.stringify({ use: "An original editorial background with a calm, uncluttered central area for separately rendered Korean text. No lettering, diagrams with invented values, logos, or documentary-style depictions of real events.", articleTitle: snapshot.item.title, pageTitle: snapshot.page.title, subtitle: snapshot.page.subtitle, body: "body" in snapshot.page ? snapshot.page.body : "", role: "role" in snapshot.page ? snapshot.page.role : "cover", perspectives: "columns" in snapshot.page ? snapshot.page.columns : undefined }),
          instruction: input.instruction?.trim(),
          referenceImages: previous ? [`data:image/jpeg;base64,${previous.bytes.toString("base64")}`] : undefined,
          signal: currentGenerationSignal(),
        });
        normalized = await normalizeCardPageArtwork(generated.bytes, generated.mimeType ?? "image/png");
        model = generated.model;
      } catch (error) {
        if (error instanceof AiServiceError) throw new HttpError(error.kind === "not_configured" ? 503 : 422, error.message);
        throw error;
      }
    }
    return db.transaction(async tx => {
      const [channel] = await tx.select().from(channels).where(eq(channels.id, input.channelId)).for("share");
      if (!channel?.active) throw new HttpError(409, "채널이 보관돼 새 배경을 적용하지 않았습니다. 기존 작업은 유지했습니다.");
      const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, input.itemId), eq(contentItems.channelId, input.channelId))).for("update");
      if (!item || item.version !== input.version || item.currentRevisionId !== snapshot.revision.id) throw new HttpError(409, "배경을 만드는 동안 원고가 바뀌었습니다. 최신 원고와 기존 배경은 유지했습니다.");
      const [board] = await tx.select().from(studioCards).where(eq(studioCards.sourceItemId, item.id));
      if (board) assertStudioActive(board);
      await assertGenerationActive(tx as unknown as DB);
      const hash = sha256(normalized.bytes);
      await tx.insert(mediaAssets).values({ channelId: input.channelId, contentItemId: input.itemId, revisionId: snapshot.revision.id,
        kind: CARD_PAGE_ARTWORK_KIND, source: input.mode, templateKey: model, sha256: hash, ...normalized,
      }).onConflictDoNothing({ target: [mediaAssets.revisionId, mediaAssets.sha256] });
      const [asset] = await tx.select({ id: mediaAssets.id, source: mediaAssets.source }).from(mediaAssets)
        .where(and(eq(mediaAssets.revisionId, snapshot.revision.id), eq(mediaAssets.sha256, hash), eq(mediaAssets.channelId, input.channelId), eq(mediaAssets.contentItemId, input.itemId), eq(mediaAssets.kind, CARD_PAGE_ARTWORK_KIND)));
      if (!asset) throw new HttpError(409, "배경 이미지 저장이 충돌했습니다. 기존 작업은 유지했습니다. 최신 상태를 확인해 주세요.");
      const source: CardPageArtworkSource = asset.source === "ai" ? "ai" : "upload";
      const response = { assetId: asset.id, version: input.version, pageId: input.pageId, source,
        credit: cardPageArtworkCredit(source) };
      await audit(tx, { actor: input.actor, action: "create_card_page_background", entity: "media_asset", entityId: asset.id, channelId: input.channelId,
        detail: { itemId: input.itemId, revisionId: snapshot.revision.id, pageId: input.pageId, source, model } });
      await completeGenerationResult(tx as unknown as DB, response);
      return response;
    });
  });
}
