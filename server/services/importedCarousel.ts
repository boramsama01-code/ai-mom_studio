import sharp from "sharp";
import { ALT_TEXT_LIMIT, altTextError } from "../../shared/altText";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { studioImages } from "../../shared/schema";
import { loadStudioCard, assertStudioActive } from "./studio";
import { HttpError } from "../routes/util";
import { env } from "../env";
import { AiServiceError, type AiProvider } from "./llm";
import { describeCardImages } from "./cardImageAi";
import { getSetting } from "../seed";

export async function importedCard(db: DB, id: number, version?: number) {
  const card = await loadStudioCard(db, id);
  assertStudioActive(card);
  if (!card.content.finishedDeck?.pages.length) throw new HttpError(400, "완성 이미지를 먼저 가져와 주세요.");
  if (version !== undefined && version !== card.version) throw new HttpError(409, "내용이 변경됐습니다. 최신 저장본을 확인해 주세요.");
  const ids = card.content.finishedDeck.pages.map(p => p.imageId);
  const rows = await db.select().from(studioImages).where(and(eq(studioImages.cardId, card.id), inArray(studioImages.id, ids)));
  if (rows.length !== ids.length) throw new HttpError(409, "가져온 카드뉴스의 이미지를 찾을 수 없습니다.");
  return { card, pages: ids.map(id => rows.find(row => row.id === id)!) };
}

export const importedProposalSchema = z.object({ caption: z.string().trim().min(1).max(2200), altTexts: z.array(z.string().trim().min(1).max(ALT_TEXT_LIMIT).refine(text => !altTextError(text), "대체텍스트는 1~2문장, 공백 포함 최대 125자입니다.")).min(1).max(10) }).strict();
const active = new Set<number>();
export async function suggestImportedCaption(db: DB, id: number, version: number, instruction: string, options: { provider?: AiProvider; mode?: "all" | "alt" } = {}) {
  if (active.has(id)) throw new HttpError(409, "이 카드뉴스의 AI 초안을 작성 중입니다. 잠시 기다려 주세요.");
  if (await getSetting(db, "global_stop", false)) throw new HttpError(409, "전역 정지 상태입니다.");
  active.add(id);
  try {
    const { card, pages } = await importedCard(db, id, version);
    const images: Buffer[] = [];
    for (const page of pages) images.push(await sharp(page.bytes).rotate().resize({ width: 900, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer());
    const provider = options.provider ?? env.aiProvider;
    const raw = await describeCardImages({ provider, instruction, images, altOnly: options.mode === "alt", context: JSON.stringify({ title: card.content.title, channel: card.content.channel, existingCaption: card.content.caption, reference: card.content.memo }) });
    let proposal: { caption: string; altTexts: string[] };
    try {
      const alt = z.object({ altTexts: importedProposalSchema.shape.altTexts }).parse(raw);
      proposal = options.mode === "alt" ? { caption: card.content.caption, altTexts: alt.altTexts } : importedProposalSchema.parse(raw);
      if (proposal.altTexts.length !== pages.length) throw new Error();
    } catch { throw new AiServiceError("AI 결과가 장수·문장 수·대체텍스트 125자 제한을 지키지 않아 적용하지 않았습니다.", "parse"); }
    await importedCard(db, id, version);
    return { ...proposal, version, provider, mode: options.mode ?? "all" };
  } finally { active.delete(id); }
}
