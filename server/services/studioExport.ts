import { altTextError, altTextFile, studioAltTexts } from "../../shared/altText";
import { checkExperienceExport, createExperienceRenderer } from "./experienceExport";
import { channelBrandName } from "../../shared/branding";
import sharp, { type OverlayOptions } from "sharp";
import { Resvg } from "@resvg/resvg-js";
import type { Font } from "opentype.js";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db";
import { channels, studioCards, studioImages, studioMedia } from "../../shared/schema";
import { channelSlug } from "../../shared/channelKeys";
import { studioContentSchema, studioPageCount, type StudioContent, type StudioExportCheck } from "../../shared/studio";
import { HttpError } from "../routes/util";
import { CardOverflowError, loadFonts, wrapText, type CardModel } from "./card";
import { checkCollectionTitle, layoutCollectionBody, renderCollectionBody, renderCollectionCover } from "./cardCollection";
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
  const altErrors = studioAltTexts(content).flatMap((value, i) => {
    const issue = altTextError(value);
    return issue ? [{field: `altTexts.${i}`, message: `${i + 1}페이지: ${issue} 기존 설명을 직접 수정해 주세요.`}] : [];
  });
  if (content.finishedDeck) return { pageCount: content.finishedDeck.pages.length, errors: [...altErrors, ...(content.finishedDeck.pages.length ? [] : [{ field: "finishedDeck", message: "완성 이미지를 한 장 이상 올려 주세요." }])], warnings: [] };
  if (content.experience) { const check = checkExperienceExport(content); check.errors.push(...altErrors); return check; }
  const result: StudioExportCheck = { errors: altErrors, warnings: [], pageCount: studioPageCount(content) };
  if (content.format !== "웹툰" && content.format !== "카드뉴스") {
    result.errors.push({ field: "format", message: "이 형식은 기획용입니다. 웹툰 또는 카드뉴스를 선택하면 이미지로 내보낼 수 있습니다." });
    return result;
  }
  const layout = contentLayout(content);
  if (content.format === "카드뉴스" && content.exportDesign.startsWith("set:")) {
    try { checkCollectionTitle(content.title, content.exportDesign.slice(4)); }
    catch (e) { if (!(e instanceof CardOverflowError)) throw e; layout.title.fits = false; }
  }
  if (!layout.title.fits) result.errors.push({ field: "title", message: "제목이 출력 영역을 넘습니다. 제목을 줄여 주세요." });
  if (!layout.source.fits) result.errors.push({ field: "sourceLabel", message: "출처 표기가 길어 출력 영역을 넘습니다. 기관·매체명과 날짜 위주로 줄여 주세요." });
  content.panels.forEach((panel, index) => {
    if (!panel.imageId && !panel.dialogue.trim()) result.errors.push({ field: `panels.${index}.dialogue`, message: `${index + 1}번째 본문에 글이나 그림을 추가하세요.` });
    let fits = layout.panels[index].fits;
    if (content.format === "카드뉴스" && content.exportDesign.startsWith("set:")) {
      try { layoutCollectionBody(collectionModel(content, index + 1, "미리보기", "#285f6a"), content.exportDesign.slice(4), { present: !!panel.imageId }); fits = true; }
      catch (e) { if (!(e instanceof CardOverflowError)) throw e; fits = false; }
    }
    if (!fits) result.errors.push({ field: `panels.${index}.dialogue`, message: `${index + 1}번째 본문이 출력 영역을 넘습니다. 글을 줄이거나 그림을 빼고 글 중심으로 구성해 주세요.` });
  });
  if (!content.sourceLabel) result.warnings.push("출처가 비어 있습니다. 사실·입시 정보를 담았다면 기관·매체명과 확인 날짜를 적어 주세요.");
  const unsupported = [...new Set(Array.from([content.title, content.sourceLabel, ...content.panels.map(p => p.dialogue)].join("")))].filter(c => c.trim() && loadFonts().regular.charToGlyph(c).index === 0);
  if (unsupported.length) result.errors.push({ field: "text", message: `출력 글꼴이 지원하지 않는 문자가 있습니다: ${unsupported.slice(0, 8).join(" ")}. 해당 기호를 글자로 바꿔 주세요.` });
  return result;
}
function collectionModel(content: StudioContent, index: number, brand: string, accent: string): CardModel {
  return { accent, brandLine: brand, badge: `${String(index + 1).padStart(2, "0")} / 05`, title: index === 0 ? content.title : `핵심 이야기 ${String(index).padStart(2, "0")}`,
    blocks: index === 0 ? [] : [{ field: `panels.${index - 1}.dialogue`, text: content.panels[index - 1].dialogue, maxLines: 30 }], footer: content.sourceLabel || brand };
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
  const brand = channel ? channelBrandName(channel) : "우주펭귄상회";
  const images = new Map<number, Buffer>();
  if (content.finishedDeck) {
    for (const p of content.finishedDeck.pages) {
      const [image] = await db.select().from(studioImages).where(and(eq(studioImages.id, p.imageId), eq(studioImages.cardId, cardId)));
      if (!image) throw new HttpError(400, "이 콘텐츠의 완성 이미지를 찾을 수 없습니다.");
      images.set(p.imageId, image.bytes);
    }
    return { version: row.version, content, pageCount: content.finishedDeck.pages.length, page: async (index: number) => {
      const p = content.finishedDeck!.pages[index];
      if (!Number.isInteger(index) || !p) throw new HttpError(400, "페이지를 확인하세요.");
      return sharp(images.get(p.imageId)!).rotate().resize(1080, 1350, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
    } };
  }
  if (content.experience) {
    const ids=[...new Set([content.experience.coverId,...content.experience.pages.map(p=>p.mediaId)].filter((id):id is number=>!!id))];
    for(const id of ids){const [media]=await db.select({preview:studioMedia.preview}).from(studioMedia).where(and(eq(studioMedia.id,id),eq(studioMedia.cardId,cardId)));
      if(!media)throw new HttpError(400,"이 작업에 속한 촬영 자료를 찾을 수 없습니다.");
      if(media.preview)images.set(id,media.preview);
    }
    return createExperienceRenderer(content,row.version,brand,accent,images);
  }
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
  if(content.experience)return createExperienceRenderer(content,version,brand,accent,images);
  const check = checkStudioExport(content);
  if (check.errors.length) throw new HttpError(400, check.errors[0].message, { errors: check.errors });
  const fonts = loadFonts();
  const layout = contentLayout(content);
  const page = async (index: number): Promise<Buffer> => {
    const comic = content.format === "웹툰";
    if (!Number.isInteger(index) || index < 0 || index >= check.pageCount) throw new HttpError(400, "내보낼 페이지를 확인하세요.");
    if (!comic && content.exportDesign.startsWith("set:")) {
      const id = content.exportDesign.slice(4);
      const model = collectionModel(content, index, brand, accent);
      const artId = content.panels[index === 0 ? 0 : index - 1].imageId;
      const art = artId ? images.get(artId) : undefined;
      if (artId && !art) throw new HttpError(400, "이 콘텐츠의 그림을 찾을 수 없습니다.");
      // Real content only: sample art is confined to the template browser.
      const rendered = index === 0 ? await renderCollectionCover(model, check.pageCount, art ?? null, "", id) : await renderCollectionBody(model, id, art);
      return sharp(rendered).png().toBuffer();
    }
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
  files.push({ name: "caption.txt", bytes: Buffer.from(output.content.caption, "utf8") }, {name:"alt-text.txt",bytes:Buffer.from(altTextFile(studioAltTexts(output.content)),"utf8")});
  if(output.content.experience){
    const selected=output.content.experience.media.map(m=>m.id);
    const media=await db.select().from(studioMedia).where(eq(studioMedia.cardId,id));
    const videos=media.filter(m=>m.kind==="video"&&selected.includes(m.id));
    for(const m of videos)files.push({name:`video-${m.id}.${m.mimeType==="video/webm"?"webm":m.mimeType==="video/quicktime"?"mov":"mp4"}`,bytes:m.bytes});
    files.push({name:"README-media.txt",bytes:Buffer.from(`카드뉴스 PNG ${output.pageCount}장과 게시용 캡션입니다.\n영상은 대표 정지 장면을 카드에 사용했습니다. 선택한 영상 원본 ${videos.length}개는 video-로 시작하는 파일입니다. 자동 편집된 릴스가 아닙니다.\n외부 게시 전 본문과 사진·영상의 공개 범위를 확인해 주세요.\n출처: ${output.content.sourceLabel||"사용자가 올린 촬영 자료"}`,"utf8")});
  }
  return { bytes: zipFiles(files), version: output.version };
}
