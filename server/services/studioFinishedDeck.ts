import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { studioCards, studioImages, studioRevisions } from "../../shared/schema";
import { studioContentSchema } from "../../shared/studio";
import { conflict, HttpError } from "../routes/util";
import { assertStudioActive, studioCardDto } from "./studio";
import { normalizeStudioImage } from "./studioImageImport";
import { invalidateStudioPublication, lockStudioPublication } from "./studioPublicationState";
import { sha256 } from "./text";
import { audit } from "../audit";

export async function appendFinishedImage(db: DB, id: number, version: number, name: string, uploadId: string, bytes: Buffer, actor: string) {
  const png = await normalizeStudioImage(bytes);
  return db.transaction(async tx => {
    const card = await lockStudioPublication(tx as unknown as DB, id);
    assertStudioActive(card);
    const content = studioContentSchema.parse(card.content);
    if (!content.finishedDeck || content.experience) throw new HttpError(400, "완성 이미지 작업에서만 사용할 수 있습니다.");
    const prior = content.finishedDeck.pages.find(p => p.uploadId === uploadId);
    if (prior) {
      const [image] = await tx.select().from(studioImages).where(eq(studioImages.id, prior.imageId));
      if (!image || sha256(image.bytes) !== sha256(png)) throw new HttpError(409, "다른 파일에 사용한 업로드 요청입니다.");
      return studioCardDto(card);
    }
    if (card.version !== version) conflict(studioCardDto(card));
    if (content.finishedDeck.pages.length >= 10) throw new HttpError(400, "한 게시물에는 이미지를 최대 10장까지 넣을 수 있습니다.");
    await invalidateStudioPublication(tx as unknown as DB, card);
    const [image] = await tx.insert(studioImages).values({ cardId: id, panelIndex: content.finishedDeck.pages.length, bytes: png, mimeType: "image/png", model: "finished-image-import" }).returning({ id: studioImages.id });
    content.finishedDeck.pages.push({ imageId: image.id, name, altText: "", uploadId });
    const [saved] = await tx.update(studioCards).set({ content, version: version + 1, updatedAt: new Date() }).where(eq(studioCards.id, id)).returning();
    await tx.insert(studioRevisions).values({ cardId: id, version: saved.version, snapshot: content, instruction: `완성 이미지 ${content.finishedDeck.pages.length}장째 추가` });
    await audit(tx, { actor, action: "import_image", entity: "studio_card", entityId: id, detail: { imageId: image.id, version: saved.version } });
    return studioCardDto(saved);
  });
}
