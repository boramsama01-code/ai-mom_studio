import sharp, { type OverlayOptions } from "sharp";
import { Resvg } from "@resvg/resvg-js";
import type { Font } from "opentype.js";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db";
import { channels, studioCards, studioImages } from "../../shared/schema";
import { channelSlug } from "../../shared/channelKeys";
import { studioContentSchema, type StudioContent, type StudioExportCheck } from "../../shared/studio";
import { HttpError } from "../routes/util";
import { loadFonts, wrapText } from "./card";
import { zipFiles } from "./zip";

type Fit = { lines: string[]; size: number; lineHeight: number; fits: boolean };
function fit(font: Font, text: string, width: number, height: number, max: number, min: number): Fit {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapText(font, text, size, width);
    const lineHeight = Math.ceil(size * 1.35);
    if (lines.length * lineHeight <= height) return { lines, size, lineHeight, fits: true };
  }
  return { lines: wrapText(font, text, min, width), size: min, lineHeight: Math.ceil(min * 1.35), fits: false };
}
function contentLayout(content: StudioContent) {
  const fonts = loadFonts();
  const comic = content.format === "웹툰";
  return {
    title: fit(fonts.bold, content.title, comic ? 984 : 920, comic ? 120 : 500, comic ? 56 : 88, comic ? 40 : 56),
    panels: content.panels.map(panel => fit(fonts.regular, panel.dialogue, comic ? 440 : 920,
      comic ? (panel.imageId ? 126 : 430) : (panel.imageId ? 300 : 800), comic ? 32 : 48, comic ? 24 : 32)),
    source: fit(fonts.regular, content.sourceLabel, 920, 60, 24, 20),
  };
}
export function checkStudioExport(content: StudioContent): StudioExportCheck {
  const result: StudioExportCheck = { errors: [], warnings: [], pageCount: content.format === "카드뉴스" ? 6 : 1 };
  if (content.format !== "웹툰" && content.format !== "카드뉴스") {
    result.errors.push({ field: "format", message: "이 형식은 기획용입니다. 웹툰 또는 카드뉴스를 선택하면 이미지로 내보낼 수 있습니다." });
    return result;
  }
  const layout = contentLayout(content);
  if (!layout.title.fits) result.errors.push({ field: "title", message: "제목이 출력 영역을 넘습니다. 제목을 줄여 주세요." });
  if (!layout.source.fits) result.errors.push({ field: "sourceLabel", message: "출처 표기가 길어 출력 영역을 넘습니다. 기관·매체명과 날짜 위주로 줄여 주세요." });
  content.panels.forEach((panel, index) => {
    if (!panel.imageId && !panel.dialogue.trim()) result.errors.push({ field: `panels.${index}.dialogue`, message: `${index + 1}번째 본문에 글이나 그림을 추가하세요.` });
    if (!layout.panels[index].fits) result.errors.push({ field: `panels.${index}.dialogue`, message: `${index + 1}번째 본문이 출력 영역을 넘습니다. 글을 줄이거나 그림을 빼고 글 중심으로 구성해 주세요.` });
  });
  if (!content.sourceLabel) result.warnings.push("출처가 비어 있습니다. 사실·입시 정보를 담았다면 기관·매체명과 확인 날짜를 적어 주세요.");
  const unsupported = [...new Set(Array.from([content.title, content.sourceLabel, ...content.panels.map(p => p.dialogue)].join("")))].filter(c => c.trim() && loadFonts().regular.charToGlyph(c).index === 0);
  if (unsupported.length) result.errors.push({ field: "text", message: `출력 글꼴이 지원하지 않는 문자가 있습니다: ${unsupported.slice(0, 8).join(" ")}. 해당 기호를 글자로 바꿔 주세요.` });
  return result;
}
function textPaths(font: Font, block: Fit, x: number, y: number, color: string) {
  return block.lines.map((line, index) => `<path d="${font.getPath(line, x, y + index * block.lineHeight, block.size).toPathData(2)}" fill="${color}"/>`).join("");
}
function lightText(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  const linear = [value >> 16, (value >> 8) & 255, value & 255].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 < .179;
}
export async function renderStudioOutput(db: DB, cardId: number, requestedVersion?: number) {
  const [row] = await db.select().from(studioCards).where(eq(studioCards.id, cardId));
  if (!row) throw new HttpError(404, "콘텐츠를 찾을 수 없습니다.");
  if (requestedVersion !== undefined && row.version !== requestedVersion) throw new HttpError(409, "다른 곳에서 콘텐츠가 변경됐습니다. 최신 내용을 확인한 뒤 다시 내려받으세요.");
  const content = studioContentSchema.parse(row.content);
  const check = checkStudioExport(content);
  if (check.errors.length) throw new HttpError(400, check.errors[0].message, { errors: check.errors });
  const [channel] = await db.select().from(channels).where(eq(channels.slug, channelSlug(content.channel)));
  const accent = /^#[a-f\d]{6}$/i.test(channel?.accentColor ?? "") ? channel!.accentColor : "#285f6a";
  const brand = channel?.name ?? "우주펭귄상회";
  const images = new Map<number, Buffer>();
  for (const panel of content.panels) {
    if (!panel.imageId || images.has(panel.imageId)) continue;
    const [image] = await db.select().from(studioImages).where(and(eq(studioImages.id, panel.imageId), eq(studioImages.cardId, cardId)));
    if (!image) throw new HttpError(400, "이 콘텐츠의 그림을 찾을 수 없습니다. 그림을 다시 확인해 주세요.");
    images.set(panel.imageId, image.bytes);
  }
  return createStudioRenderer(content, row.version, brand, accent, images);
}

/** Pure renderer shared by the API and visual checks; performs no network or AI calls. */
export function createStudioRenderer(content: StudioContent, version: number, brand: string, accent: string, images = new Map<number, Buffer>()) {
  const check = checkStudioExport(content);
  if (check.errors.length) throw new HttpError(400, check.errors[0].message, { errors: check.errors });
  const fonts = loadFonts();
  const layout = contentLayout(content);
  const page = async (index: number): Promise<Buffer> => {
    const comic = content.format === "웹툰";
    if (!Number.isInteger(index) || index < 0 || index >= check.pageCount) throw new HttpError(400, "내보낼 페이지를 확인하세요.");
    const darkCover = content.exportDesign === "spotlight" && !comic && (index === 0 || index === 5);
    const bg = darkCover ? accent : content.exportDesign === "editorial" ? "#faf8f3" : "#ffffff";
    const ink = darkCover ? (lightText(accent) ? "#ffffff" : "#15242c") : "#15242c";
    const muted = darkCover ? ink : "#586974";
    const parts: string[] = [];
    const overlays: OverlayOptions[] = [];
    parts.push(`<rect x="0" y="0" width="1080" height="12" fill="${accent}"/>`);
    parts.push(textPaths(fonts.semibold, fit(fonts.semibold, brand, 850, 45, 26, 18), 48, 65, muted));
    parts.push(textPaths(fonts.regular, fit(fonts.regular, `${index + 1} / ${check.pageCount}`, 130, 35, 24, 24), 930, 65, muted));
    const picture = async (imageId: number, x: number, y: number, width: number, height: number) => {
      const image = images.get(imageId);
      if (!image) throw new HttpError(400, "이 콘텐츠의 그림을 찾을 수 없습니다.");
      overlays.push({ input: await sharp(image, { limitInputPixels: 40_000_000 }).resize(width, height, { fit: "contain", background: bg }).png().toBuffer(), left: x, top: y });
    };
    if (comic) {
      parts.push(textPaths(fonts.bold, layout.title, 48, 125, ink));
      for (const [i, panel] of content.panels.entries()) {
        const x = i % 2 ? 552 : 48, y = i < 2 ? 204 : 736;
        parts.push(`<rect x="${x}" y="${y}" width="480" height="500" rx="18" fill="none" stroke="${accent}" stroke-width="2"/>`);
        if (panel.imageId) await picture(panel.imageId, x + 8, y + 8, 464, 342);
        parts.push(textPaths(fonts.regular, layout.panels[i], x + 20, y + (panel.imageId ? 386 : 55), ink));
      }
    } else if (index === 0) {
      parts.push(`<rect x="80" y="235" width="80" height="8" fill="${darkCover ? ink : accent}"/>`);
      parts.push(textPaths(fonts.bold, layout.title, 80, 365, ink));
      parts.push(textPaths(fonts.regular, fit(fonts.regular, "핵심 이야기 네 가지", 900, 65, 36, 36), 80, 1050, muted));
    } else if (index === 5) {
      parts.push(textPaths(fonts.regular, fit(fonts.regular, "다음 이야기에서 만나요", 920, 100, 44, 36), 80, 400, muted));
      parts.push(textPaths(fonts.bold, fit(fonts.bold, brand, 920, 400, 84, 40), 80, 560, ink));
      parts.push(textPaths(fonts.regular, fit(fonts.regular, "우주펭귄상회", 920, 60, 30, 30), 80, 1050, muted));
    } else {
      const panel = content.panels[index - 1];
      parts.push(textPaths(fonts.bold, fit(fonts.bold, String(index).padStart(2, "0"), 920, 130, 88, 88), 80, 225, accent));
      if (panel.imageId) await picture(panel.imageId, 80, 300, 920, 540);
      parts.push(textPaths(fonts.regular, layout.panels[index - 1], 80, panel.imageId ? 915 : 360, ink));
    }
    parts.push(`<line x1="48" x2="1032" y1="1260" y2="1260" stroke="${muted}" opacity=".25"/>`);
    if (content.sourceLabel) parts.push(textPaths(fonts.regular, layout.source, 80, 1295, muted));
    else parts.push(textPaths(fonts.regular, fit(fonts.regular, brand, 920, 50, 22, 18), 80, 1300, muted));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${parts.join("")}</svg>`;
    overlays.push({ input: new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng(), left: 0, top: 0 });
    return sharp({ create: { width: 1080, height: 1350, channels: 3, background: bg } }).composite(overlays).png().toBuffer();
  };
  return { version, content, pageCount: check.pageCount, page };
}
export async function exportStudioZip(db: DB, id: number, version?: number) {
  const output = await renderStudioOutput(db, id, version);
  if (output.content.format !== "카드뉴스") throw new HttpError(400, "카드뉴스 형식을 선택한 뒤 ZIP으로 내려받으세요.");
  const files: Array<{ name: string; bytes: Buffer }> = [];
  for (let index = 0; index < output.pageCount; index++) files.push({ name: `page-${String(index + 1).padStart(2, "0")}.png`, bytes: await output.page(index) });
  files.push({ name: "caption.txt", bytes: Buffer.from(output.content.caption, "utf8") });
  return { bytes: zipFiles(files), version: output.version };
}
