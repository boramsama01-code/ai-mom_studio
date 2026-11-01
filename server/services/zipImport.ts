import crypto from "node:crypto";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { channels, studioCards, studioImages, studioRevisions } from "../../shared/schema";
import { studioContentSchema } from "../../shared/studio";
import { channelSlug } from "../../shared/channelKeys";
import { readCardNewsZip, type ZipImportResult } from "../../shared/zipImport";
import { HttpError } from "../routes/util";
import { audit } from "../audit";

const hash = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");
export async function importCardNewsZip(db: DB, archive: Buffer, channel: string, actor: string): Promise<ZipImportResult> {
  const [ch] = await db.select().from(channels).where(eq(channels.slug, channelSlug(channel)));
  if (!ch?.active) throw new HttpError(400, "사용 중인 채널을 선택해 주세요.");
  let parsed: ReturnType<typeof readCardNewsZip>;
  try { parsed = readCardNewsZip(archive); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const mimeTypes = new Map<string, string>();
  // Decode every image before the transaction. Keep the exact originals; the existing renderer fits them without cropping.
  for (const post of parsed.posts) for (const page of post.pages) {
    try {
      const input = sharp(page.bytes, { limitInputPixels: 40_000_000, failOn: "warning" }), m = await input.metadata();
      if (!m.width || !m.height || !["png", "jpeg", "webp"].includes(m.format || "") || (m.pages ?? 1) !== 1) throw new Error();
      await input.resize(32, 32, { fit: "inside" }).raw().toBuffer();
      mimeTypes.set(page.name, `image/${m.format}`);
    } catch { throw new HttpError(400, `‘${page.name}’ 이미지를 읽을 수 없습니다. 정상적인 정지 이미지로 다시 저장해 주세요.`); }
  }
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193203)`);
    const [active] = await tx.select().from(channels).where(eq(channels.id, ch.id)).for("share");
    if (!active.active) throw new HttpError(409, "보관된 채널입니다. 채널을 복원해 주세요.");
    const result: ZipImportResult = { imported: 0, skipped: 0, pageCount: parsed.pageCount, cards: [] };
    for (const post of parsed.posts) {
      const externalId = `zip-v1:${ch.id}:${hash(post.pages.map(p => hash(p.bytes)).join(":"))}`;
      const [existing] = await tx.select().from(studioCards).where(eq(studioCards.externalId, externalId));
      if (existing) { result.skipped++; result.cards.push({ id: existing.id, title: existing.content.title, pages: existing.content.finishedDeck?.pages.length ?? post.pages.length, duplicate: true, trashed: !!existing.trashedAt }); continue; }
      const content = studioContentSchema.parse({ title: post.title, channel, format: "카드뉴스", stage: "review", caption: post.caption, memo: parsed.notes, characters: [], finishedDeck: { pages: [] } });
      const [card] = await tx.insert(studioCards).values({ content, externalId, importedMeta: { zipImport: true, folder: post.folder, pageCount: post.pages.length } }).returning();
      for (const [i, page] of post.pages.entries()) {
        const [image] = await tx.insert(studioImages).values({ cardId: card.id, panelIndex: i, bytes: Buffer.from(page.bytes), mimeType: mimeTypes.get(page.name)!, model: "zip-original" }).returning({ id: studioImages.id });
        content.finishedDeck!.pages.push({ imageId: image.id, name: page.name.split("/").at(-1)!.slice(0, 200), altText: "" });
      }
      await tx.update(studioCards).set({ content }).where(eq(studioCards.id, card.id));
      await tx.insert(studioRevisions).values({ cardId: card.id, version: 1, snapshot: content, instruction: "완성 카드뉴스 ZIP 가져오기" });
      await audit(tx, { actor, action: "import_zip", entity: "studio_card", entityId: card.id, channelId: ch.id, detail: { pages: post.pages.length } });
      result.imported++; result.cards.push({ id: card.id, title: post.title, pages: post.pages.length, duplicate: false, trashed: false });
    }
    return result;
  });
}
