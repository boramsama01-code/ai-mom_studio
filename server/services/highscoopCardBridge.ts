/** The generic card editor and Notion use the same HighScoop page geometry. */
import sharp from "sharp";
import { highScoopTemplateForKey } from "../../shared/highscoopTemplates";
import { CardOverflowError, type CardModel } from "./card";
import { CanvaRestError } from "./canvaRest";
import { buildNotionCanvaPptx, type NotionCanvaDocument, type NotionCanvaPhoto } from "./notionCanva";
import { HttpError } from "../routes/util";

export type HighScoopCardBridge = { templateKey: string; document: NotionCanvaDocument };

/** Preserve the generic editor's correctable overflow contract at the native boundary. */
function validateTextLengths(document: NotionCanvaDocument) {
  const check = (text: string | undefined, max: number, field: string) => {
    if (text && text.length > max) throw new CardOverflowError(field, `문구가 ${max}자를 넘습니다. 문구를 줄이거나 장을 나눠 주세요. 원고는 유지했습니다.`);
  };
  check(document.title, 255, "title");
  document.pages.forEach((page, index) => {
    const field = (name: string) => index === 0 ? name === "title" ? "title" : `cardCopy.cover.${name}` : `cardCopy.pages.${index - 1}.${name}`;
    check(page.title, 300, field("title"));
    check(page.body, 2400, field("body"));
    check(page.interiorSubtitle, 500, field("subtitle"));
    check(page.footnote, 1000, "footer");
    check(page.sourceLabel, 300, "footer");
  });
}

/** Keep every original page and block. The editor's last page is never replaced by a CTA. */
export function highScoopCardDocument(templateKey: string, cover: CardModel, pages: CardModel[]): HighScoopCardBridge {
  const kit = highScoopTemplateForKey(templateKey);
  if (!kit) throw new HttpError(422, "하이스쿱 카테고리 템플릿을 다시 선택해 주세요.");
  const document: NotionCanvaDocument = {
    title: cover.title,
    coverStyle: "A",
    category: kit.category,
    categoryColor: kit.color,
    pages: [
      { title: cover.title, body: cover.subtitle, footnote: cover.footer },
      ...pages.map(page => ({
        title: page.title,
        interiorTemplate: "text" as const,
        interiorSubtitle: page.subtitle ?? (page.blocks.length === 1 ? page.blocks[0].label : undefined),
        body: page.blocks.map(block => page.blocks.length > 1 && block.label ? `${block.label}\n${block.text}` : block.text).join("\n\n"),
        footnote: page.footer,
      })),
    ],
  };
  return { templateKey: kit.key, document };
}

/** Native Canva SVG is also the generic editor preview and publication raster source. */
export async function highScoopCardPageSvg(bridge: HighScoopCardBridge, pageIndex: number, art: Buffer | null, credit: string) {
  const document: NotionCanvaDocument = {
    ...bridge.document,
    pages: bridge.document.pages.map((page, index) => index === 0 ? {
      ...page,
      ...(art ? { imageId: "generic_cover" } : {}),
      ...((credit || page.sourceLabel) ? { sourceLabel: [page.sourceLabel, credit].filter(Boolean).join("\n") } : {}),
    } : { ...page }),
  };
  const photos: NotionCanvaPhoto[] = [];
  validateTextLengths(document);
  if (art && pageIndex === 0) {
    // Normalize a copy, leaving the selected source artwork and saved media untouched.
    const bytes = await sharp(art, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
    photos.push({ id: "generic_cover", bytes, mimeType: "image/jpeg" });
  }
  try {
    const result = await buildNotionCanvaPptx(document, photos, { previewPage: pageIndex, previewOnly: true, includeOutro: false });
    if (!result.previewSvg || result.pageCount !== document.pages.length) throw new HttpError(500, "하이스쿱 페이지 수를 확인할 수 없습니다. 저장한 원고는 유지했습니다.");
    return result.previewSvg;
  } catch (error) {
    if (error instanceof CanvaRestError && error.status === 422) {
      if (/원고가 페이지에 너무 깁니다|글자가 텍스트 폭보다 큽니다/.test(error.message)) {
        const field = /각주|출처/.test(error.message) ? "footer" : /제목/.test(error.message) ? pageIndex === 0 ? "title" : `cardCopy.pages.${pageIndex - 1}.title` : pageIndex === 0 ? "cardCopy.cover.subtitle" : `cardCopy.pages.${pageIndex - 1}.body`;
        throw new CardOverflowError(field, error.message);
      }
      throw new HttpError(422, error.message);
    }
    throw error;
  }
}

export async function renderHighScoopCardPage(bridge: HighScoopCardBridge, pageIndex: number, art: Buffer | null, credit: string) {
  const svg = await highScoopCardPageSvg(bridge, pageIndex, art, credit);
  return sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
