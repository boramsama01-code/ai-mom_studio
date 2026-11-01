import { lockStudioPublication, invalidateStudioPublication } from "./studioPublicationState";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { studioCards, studioImages, studioRevisions } from "../../shared/schema";
import { STUDIO_IMAGE_MAX_BYTES } from "../../shared/studioImageImport";
import { studioContentSchema } from "../../shared/studio";
import { conflict, HttpError } from "../routes/util";
import { assertStudioActive, studioCardDto } from "./studio";
import { audit } from "../audit";

/** Decode and re-encode raster bytes, stripping metadata and never fetching a pasted URL. */
export async function normalizeStudioImage(bytes: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new HttpError(400, "PNG·JPG·WEBP 이미지 파일을 올려 주세요.");
  if (bytes.length > STUDIO_IMAGE_MAX_BYTES) throw new HttpError(413, "이미지는 한 장당 12MB까지 저장할 수 있습니다.");
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
    const meta = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw new Error("unsupported");
    return await image.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new HttpError(400, "이미지를 읽을 수 없습니다. 4천만 픽셀 이하의 정지 PNG·JPG·WEBP 파일을 선택해 주세요.");
  }
}

export async function importStudioPanelImage(db: DB, cardId: number, panelIndex: number, version: number, bytes: Buffer, actor: string) {
  const png = await normalizeStudioImage(bytes);
  return db.transaction(async tx => {
    const current = await lockStudioPublication(tx as unknown as DB, cardId);
    if (!current) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
    assertStudioActive(current);
    if (current.version !== version) conflict(studioCardDto(current));
    await invalidateStudioPublication(tx as unknown as DB, current);
    const [image] = await tx.insert(studioImages).values({ cardId, panelIndex, bytes: png, mimeType: "image/png", model: "manual-import" }).returning({ id: studioImages.id });
    const content = studioContentSchema.parse({ ...current.content, panels: current.content.panels.map((p, i) => i === panelIndex ? { ...p, imageId: image.id } : p) });
    const [saved] = await tx.update(studioCards).set({ content, version: version + 1, updatedAt: new Date() }).where(eq(studioCards.id, cardId)).returning();
    await tx.insert(studioRevisions).values({ cardId, version: saved.version, snapshot: content, instruction: `${panelIndex + 1}컷 이미지 가져오기` });
    await audit(tx, { actor, action: "update", entity: "studio_card", entityId: cardId, detail: { version: saved.version, panelIndex, imageId: image.id, source: "manual-import" } });
    return studioCardDto(saved);
  });
}

