import type { Font } from "opentype.js";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { cardDesign } from "../../shared/cardDesigns";
import { NEWS_EDITORIAL_LABELS, type NewsEditorialRole } from "../../shared/newsEditorial";
import { CardOverflowError, loadFonts, wrapText, type CardModel, type CardStyle } from "./card";

const W = 1080, H = 1350, SAFE = 84, INNER = W - SAFE * 2;
type Box = { x: number; y: number; width: number; height: number };
type Weight = "regular" | "semibold" | "bold";
export type EditorialTextRun = Box & { field: string; text: string; lines: string[]; size: number; lineHeight: number; align: "center" };
type TextOptions = { field: string; size: number; min?: number; weight?: Weight; color?: string; leading?: number; maxLines?: number; vertical?: "top" | "middle" };
type EditorialPalette = { background: string; ink: string; accent: string; onAccent: string; panel: string; muted: string };
type RenderOptions = { imageDataUrl?: string; imageOpacity?: number; credit?: string };

const hex = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function luminance(color: string): number {
  const values = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}
function contrast(a: string, b: string) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }
function readable(background: string, preferred: string): string {
  if (contrast(background, preferred) >= 4.5) return preferred;
  return contrast(background, "#FFFFFF") > contrast(background, "#172B34") ? "#FFFFFF" : "#172B34";
}
function colors(model: CardModel, style: CardStyle): EditorialPalette {
  const design = style.collection ? cardDesign(style.collection) : undefined;
  const background = hex(design?.bg ?? "#F5F2EB", "#F5F2EB");
  const ink = readable(background, hex(design?.ink ?? "#183B3E", "#183B3E"));
  const accent = hex(design?.accent ?? model.accent, "#245C58");
  return { background, ink, accent, onAccent: readable(accent, hex(design?.onAccent ?? "#FFFFFF", "#FFFFFF")), panel: hex(design?.soft ?? "#E3E9DF", "#E3E9DF"), muted: ink };
}

/** Measurement and drawing share this plan; long manual copy fails with a field instead of being clipped. */
function fitText(font: Font, value: string, box: Box, opts: TextOptions): Omit<EditorialTextRun, "field" | "text" | "align"> {
  const min = opts.min ?? opts.size, leading = opts.leading ?? 1.36;
  let size = opts.size, lines = wrapText(font, value, size, box.width);
  while (size > min && (lines.length * size * leading > box.height || (opts.maxLines !== undefined && lines.length > opts.maxLines))) {
    size = Math.max(min, size - 2);
    lines = wrapText(font, value, size, box.width);
  }
  if (lines.length * size * leading > box.height || (opts.maxLines !== undefined && lines.length > opts.maxLines)) {
    throw new CardOverflowError(opts.field, `문구가 ${lines.length}줄로 8장 카드의 영역을 넘습니다. 이 장의 문구를 줄여 주세요. 내용은 자르지 않았습니다.`);
  }
  return { ...box, lines, size, lineHeight: size * leading };
}

/** Original artwork-free layout. Background images are accepted only as already-loaded bytes, never URLs. */
export function layoutEditorialCard(model: CardModel, style: CardStyle, options: RenderOptions = {}) {
  const meta = model.editorial;
  if (!meta) throw new Error("8장 카드 레이아웃 정보가 없습니다.");
  if (options.imageDataUrl && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(options.imageDataUrl)) throw new Error("배경은 서버에서 읽은 JPEG 이미지만 사용할 수 있습니다.");
  const p = colors(model, style), fonts = loadFonts(), elements: string[] = [], textRuns: EditorialTextRun[] = [];
  const isCover = meta.role === "cover", isClosing = meta.role === "closing", hasImage = !!options.imageDataUrl;
  const darkPicture = isCover && hasImage;
  const ink = darkPicture ? "#FFFFFF" : p.ink;
  const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 0, attributes = "") => elements.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" ${attributes}/>`);
  const line = (x: number, y: number, width: number, color = ink, opacity = 1, thickness = 1) => rect(x, y, width, thickness, color, 0, `fill-opacity="${opacity}"`);
  const text = (value: string, box: Box, opts: TextOptions): EditorialTextRun => {
    const font = fonts[opts.weight ?? "regular"], run: EditorialTextRun = { ...fitText(font, value, box, opts), field: opts.field, text: value, align: "center" };
    const height = run.lines.length * run.lineHeight;
    const top = box.y + (opts.vertical === "top" ? 0 : Math.max(0, (box.height - height) / 2));
    run.lines.forEach((value, index) => {
      const x = box.x + (box.width - font.getAdvanceWidth(value, run.size, { kerning: true })) / 2;
      const baseline = top + run.size * .94 + index * run.lineHeight;
      elements.push(`<path d="${font.getPath(value, x, baseline, run.size, { kerning: true }).toPathData(2)}" fill="${opts.color ?? ink}"/>`);
    });
    textRuns.push(run);
    return run;
  };
  const centered = (value: string, y: number, height: number, opts: TextOptions, width = INNER) => text(value, { x: (W - width) / 2, y, width, height }, opts);
  const naturalCentered = (value: string, y: number, maxHeight: number, opts: TextOptions, width: number) => {
    const measured = fitText(fonts[opts.weight ?? "regular"], value, { x: (W - width) / 2, y, width, height: maxHeight }, opts);
    const height = measured.lines.length * measured.lineHeight;
    centered(value, y, height, { ...opts, size: measured.size, min: measured.size, vertical: "top" }, width);
    return height;
  };
  const badge = (label: string, y = 191, color = ink) => {
    const width = Math.max(236, Math.min(650, fonts.semibold.getAdvanceWidth(label, 27) + 62));
    rect((W - width) / 2, y, width, 55, hasImage && !isCover ? p.background : "none", 27, `stroke="${color}" stroke-opacity=".45" stroke-width="1.5"`);
    centered(label, y + 8, 38, { field: "editorial.role", size: 27, weight: "semibold", color, maxLines: 1 }, width - 40);
  };
  const subtitle = (y: number, height: number, size = 31, min = 27) => {
    if (model.subtitle) centered(model.subtitle, y, height, { field: isCover ? "cardCopy.cover.subtitle" : `cardCopy.pages.${meta.page - 2}.subtitle`, size, min, color: ink, maxLines: 3 }, 854);
  };
  const titleField = isCover ? "cardCopy.cover.title" : `cardCopy.pages.${meta.page - 2}.title`;
  const bodyField = `cardCopy.pages.${meta.page - 2}.body`;
  const body = model.blocks.map(block => block.text).join("\n\n");

  rect(0, 0, W, H, darkPicture ? "#10202A" : p.background);
  if (hasImage) {
    elements.push(`<image x="0" y="0" width="${W}" height="${H}" href="${options.imageDataUrl}" opacity="${Math.max(0, Math.min(100, options.imageOpacity ?? 100)) / 100}"/>`);
    if (isCover) {
      elements.push('<defs><linearGradient id="editorial-cover-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#071B25" stop-opacity=".79"/><stop offset=".32" stop-color="#071B25" stop-opacity=".57"/><stop offset=".68" stop-color="#071B25" stop-opacity=".85"/><stop offset="1" stop-color="#071B25" stop-opacity=".97"/></linearGradient></defs>');
      rect(0, 0, W, H, "url(#editorial-cover-shade)");
    } else {
      // Header/footer and text retain an opaque reading surface regardless of picture contrast.
      rect(0, 0, W, 169, p.background);
      rect(0, 1187, W, H - 1187, p.background);
      rect(52, 274, 976, 894, p.background, 38, 'fill-opacity=".97"');
    }
  }

  // Consistent masthead and page number stay inside Instagram's 4:5 safe area.
  text(model.brandLine, { x: 160, y: 52, width: 700, height: 60 }, { field: "brandLine", size: 36, min: 20, weight: "bold", color: ink, maxLines: 2 });
  text(`${String(meta.page).padStart(2, "0")} / ${String(meta.count).padStart(2, "0")}`, { x: 885, y: 68, width: 116, height: 37 }, { field: "editorial.page", size: 24, color: ink, maxLines: 1 });
  line(SAFE, 141, INNER, ink, .38);

  if (isCover) {
    if (!hasImage) {
      elements.push(`<circle cx="540" cy="660" r="390" fill="${p.panel}" opacity=".38"/><circle cx="540" cy="660" r="325" fill="none" stroke="${p.accent}" stroke-width="1.5" opacity=".19"/>`);
      rect(481, 320, 118, 8, p.accent, 4);
    }
    badge("오늘의 뉴스, 우리의 질문", 206);
    centered(model.title, 402, 424, { field: titleField, size: 106, min: 58, weight: "bold", maxLines: 4, leading: 1.19 }, 882);
    subtitle(875, 160, 37, 31);
    line(484, 1095, 112, ink, .8, 3);
    centered("읽고, 묻고, 내 생각으로", 1121, 46, { field: "editorial.coverCue", size: 27, weight: "semibold", maxLines: 1 }, 700);
  } else if (isClosing) {
    // An original conversation mark and channel wordmark, without another publisher's logo.
    elements.push(`<rect x="452" y="278" width="154" height="116" rx="36" fill="${p.accent}"/><path d="M480 381v47l49-40" fill="${p.accent}"/><rect x="508" y="315" width="128" height="95" rx="31" fill="${p.background}" stroke="${p.ink}" stroke-width="3"/><path d="M604 401v35l-38-31" fill="${p.background}" stroke="${p.ink}" stroke-width="3" stroke-linejoin="round"/>`);
    centered(model.brandLine, 481, 110, { field: "editorial.brandWordmark", size: 76, min: 38, weight: "bold", maxLines: 2 }, 880);
    line(469, 627, 142, p.accent, 1, 5);
    centered(model.title, 691, 175, { field: titleField, size: 60, min: 42, weight: "bold", maxLines: 3, leading: 1.25 }, 864);
    centered(body, 887, 173, { field: bodyField, size: 39, min: 32, maxLines: 4, leading: 1.42 }, 846);
    subtitle(1077, 88, 29, 25);
  } else {
    const roleLabel = meta.role === "implication" ? "뉴스의 의미 · 해석" : meta.role === "summary" ? "뉴스 요약 · 원문 기반" : NEWS_EDITORIAL_LABELS[meta.role as NewsEditorialRole];
    badge(roleLabel);
    if (meta.columns?.length) {
      let nextY = 283;
      nextY += naturalCentered(model.title, nextY, 132, { field: titleField, size: 58, min: 40, weight: "bold", maxLines: 3, leading: 1.22 }, 878) + 14;
      if (model.subtitle) nextY += naturalCentered(model.subtitle, nextY, 80, { field: `cardCopy.pages.${meta.page - 2}.subtitle`, size: 30, min: 26, maxLines: 3 }, 854) + 14;
      nextY += naturalCentered(body, nextY, 105, { field: bodyField, size: 35, min: 28, maxLines: 3, leading: 1.32 }, 862) + 28;
      const xValues = [76, 558], panelWidth = 446, panelY = Math.max(520, nextY), panelHeight = 1152 - panelY;
      meta.columns.forEach((column, index) => {
        const x = xValues[index], columnInk = readable(p.panel, p.ink), field = `cardCopy.pages.${meta.page - 2}.columns.${index}`;
        rect(x, panelY, panelWidth, panelHeight, p.panel, 24);
        rect(x + 29, panelY + 24, 58, 43, p.accent, 21);
        text(meta.role === "concept" ? (index === 0 ? "A" : "B") : String(index + 1).padStart(2, "0"), { x: x + 35, y: panelY + 29, width: 46, height: 33 }, { field: `${field}.label`, size: 23, weight: "bold", color: p.onAccent, maxLines: 1, leading: 1.25 });
        text(column.title, { x: x + 31, y: panelY + 81, width: panelWidth - 62, height: 83 }, { field: `${field}.title`, size: 35, min: 28, weight: "bold", color: columnInk, maxLines: 3, leading: 1.27 });
        line(x + 41, panelY + 177, panelWidth - 82, columnInk, .2);
        text(column.body, { x: x + 31, y: panelY + 196, width: panelWidth - 62, height: panelHeight - 222 }, { field: `${field}.body`, size: 40, min: 28, color: columnInk, leading: 1.42 });
      });
    } else if (meta.role === "implication" || meta.role === "discussion") {
      centered(model.title, 296, 158, { field: titleField, size: 47, min: 37, weight: "semibold", maxLines: 3, leading: 1.27 }, 854);
      line(486, 485, 108, p.accent, 1, 6);
      centered(body, 540, 433, { field: bodyField, size: meta.role === "implication" ? 78 : 70, min: 44, weight: "bold", maxLines: 7, leading: 1.3 }, 860);
      subtitle(1031, 132, 32, 27);
    } else {
      centered(model.title, 302, 212, { field: titleField, size: 65, min: 42, weight: "bold", maxLines: 3, leading: 1.24 }, 872);
      subtitle(535, 107, 32, 27);
      line(489, 675, 102, p.accent, 1, 6);
      centered(body, 731, 421, { field: bodyField, size: 49, min: 35, maxLines: 8, leading: 1.43 }, 864);
    }
  }

  if (options.credit) centered(options.credit, 1190, 31, { field: "editorial.imageCredit", size: 21, min: 17, color: ink, maxLines: 1 });
  line(SAFE, 1232, INNER, ink, .28);
  centered(model.footer, 1250, 67, { field: "footer", size: 23, min: 18, color: ink, maxLines: 2, leading: 1.34 });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${elements.join("")}</svg>`, textRuns };
}

export function checkEditorialCard(model: CardModel, style: CardStyle) {
  return layoutEditorialCard(model, style).textRuns;
}

/** Sequential callers bound memory; each loaded image is re-encoded to a safe fixed-size JPEG. */
export async function renderEditorialCard(model: CardModel, style: CardStyle, art: Buffer | null, credit = "") {
  const image = art ? await sharp(art, { limitInputPixels: 40_000_000 }).rotate().resize(W, H, { fit: "cover" }).flatten({ background: "#FFFFFF" }).jpeg({ quality: 86 }).toBuffer() : null;
  const { svg } = layoutEditorialCard(model, style, { imageDataUrl: image ? `data:image/jpeg;base64,${image.toString("base64")}` : undefined, imageOpacity: model.editorial?.background?.opacity, credit });
  return sharp(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()).flatten({ background: "#FFFFFF" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
