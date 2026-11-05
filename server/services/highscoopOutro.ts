import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { cardDesign } from "../../shared/cardDesigns";
import { HIGHSCOOP_HANDLE, HIGHSCOOP_OUTRO_THEMES, HIGHSCOOP_PROFILE_ASSET_ID, type HighscoopOutroThemeId } from "../../shared/highscoopOutro";
import { CardOverflowError, loadFonts, wrapText, type CardModel, type CardStyle } from "./card";
import { registeredProfileDataUrl } from "./characterVariantAssets";

type TextRun = { field: string; text: string; size: number; x: number; y: number; width: number; height: number; lines: string[] };
const safeHex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

/** A real final card, not a replacement for the operator's closing copy.
 * Every original title, subtitle, body block and source credit stays visible. */
export function layoutHighscoopOutro(model: CardModel, style: CardStyle, themeId: HighscoopOutroThemeId, profileDataUrl?: string) {
  const theme = HIGHSCOOP_OUTRO_THEMES[themeId], design = style.collection ? cardDesign(style.collection) : undefined;
  const colors = design ? { background: design.bg, ink: design.ink, accent: design.accent, soft: design.soft, onAccent: design.onAccent, onSoft: design.onSoft ?? design.ink }
    : { background: theme.background, ink: theme.ink, accent: theme.accent, soft: theme.soft, onAccent: theme.background, onSoft: theme.ink };
  const fonts = loadFonts(), elements: string[] = [], textRuns: TextRun[] = [];
  const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 0) => elements.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`);
  const text = (value: string, field: string, x: number, y: number, width: number, height: number, size: number, min = size, color = colors.ink, weight: keyof typeof fonts = "regular", align: "left" | "center" | "right" = "left", leading = 1.3) => {
    if (!value) return;
    const font = fonts[weight];
    let lines = wrapText(font, value, size, width);
    while (size > min && lines.length * size * leading > height) { size = Math.max(min, size - 2); lines = wrapText(font, value, size, width); }
    if (lines.length * size * leading > height) throw new CardOverflowError(field, "하이스쿱 뒷표지의 문구가 영역을 넘습니다. 마지막 장의 문구를 나누거나 줄여 주세요. 원문은 자르지 않았습니다.");
    for (const [index, line] of lines.entries()) {
      const lineWidth = font.getAdvanceWidth(line, size, { kerning: true });
      const left = align === "center" ? x + (width - lineWidth) / 2 : align === "right" ? x + width - lineWidth : x;
      elements.push(`<path d="${font.getPath(line, left, y + size * .94 + index * size * leading, size).toPathData(2)}" fill="${color}"/>`);
    }
    textRuns.push({ field, text: value, size, x, y, width, height, lines });
  };
  rect(0, 0, 1080, 1350, colors.background);
  rect(0, 0, 14, 1350, colors.accent);
  rect(80, 132, 920, 2, colors.accent);
  text("HighScoop", "highscoop.brand", 80, 60, 530, 50, 36, 36, colors.ink, "bold");
  text(model.badge, "badge", 800, 69, 200, 33, 24, 24, colors.ink, "regular", "right");
  text(theme.label, "highscoop.theme", 80, 185, 690, 45, 29, 29, colors.accent, "semibold");
  // Small original geometric signs distinguish experiences, school choices and contests.
  const stroke = safeHex(colors.accent, "#BCE5DF");
  if (themeId === "camp") elements.push(`<g fill="none" stroke="${stroke}" stroke-width="3"><circle cx="935" cy="205" r="46"/><path d="m915 224 12-39 28-18-12 39Z"/><path d="M866 205h22m94 0h18M935 137v22m0 92v22"/></g>`);
  else if (themeId === "competition") elements.push(`<g fill="none" stroke="${stroke}" stroke-width="3"><path d="M907 161h56v37c0 36-56 36-56 0Zm-1 8h-19v20c0 17 19 19 24 19m53-39h19v20c0 17-19 19-24 19M935 225v26m-26 0h52"/></g>`);
  else elements.push(`<g fill="none" stroke="${stroke}" stroke-width="3"><path d="M873 251h25v-30h26v-30h27v-31h35M950 158h36v36"/></g>`);
  text(model.title, "title", 80, 269, 920, 174, 68, 40, colors.ink, "bold", "left", 1.23);
  if (model.subtitle) text(model.subtitle, "subtitle", 82, 453, 916, 73, 32, 26, colors.ink, "semibold");

  const start = model.subtitle ? 552 : 490, available = 924 - start, content = model.blocks.filter(block => block.text.trim());
  const blockLabel = (block: CardModel["blocks"][number]) => block.label && block.label !== model.subtitle ? block.label : "";
  const heightAt = (size: number) => content.reduce((sum, block) => sum + (blockLabel(block) ? 40 : 0) + wrapText(fonts.regular, block.text, size, 872).length * size * 1.42 + 24, -24);
  let bodySize = 38;
  while (bodySize > 27 && heightAt(bodySize) > available) bodySize--;
  if (heightAt(bodySize) > available) throw new CardOverflowError(content.at(-1)?.field ?? "body", "하이스쿱 뒷표지의 본문이 너무 깁니다. 마지막 장의 문구를 나누거나 줄여 주세요. 입력한 내용은 유지했습니다.");
  let cursor = start;
  for (const block of content) {
    const label = blockLabel(block);
    if (label) { text(label, `${block.field}.label`, 104, cursor, 872, 36, 25, 25, colors.accent, "semibold"); cursor += 40; }
    const height = wrapText(fonts.regular, block.text, bodySize, 872).length * bodySize * 1.42;
    text(block.text, block.field, 104, cursor, 872, height + .01, bodySize, bodySize, colors.ink, "regular", "left", 1.42);
    cursor += height + 24;
  }
  rect(80, 951, 920, 2, colors.accent);
  text(theme.action, "highscoop.action", 80, 984, 920, 84, 30, 28, colors.ink, "semibold");
  rect(80, 1095, 920, 145, colors.soft, 24);
  // A white avatar disc keeps the exact dark/blue account artwork readable on every palette.
  elements.push('<circle cx="164" cy="1167" r="58" fill="#FFFFFF"/>');
  if (profileDataUrl) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(profileDataUrl)) throw new Error("등록된 하이스쿱 프로필 원본을 확인해 주세요.");
    elements.push(`<image x="112" y="1115" width="104" height="104" preserveAspectRatio="xMidYMid meet" href="${profileDataUrl}"/>`);
  }
  text("HighScoop", "highscoop.accountName", 244, 1120, 475, 44, 32, 32, colors.onSoft, "bold");
  text(HIGHSCOOP_HANDLE, "highscoop.handle", 244, 1170, 475, 40, 28, 26, colors.onSoft);
  rect(754, 1122, 218, 90, colors.accent, 45);
  text("+ 팔로우", "highscoop.follow", 774, 1146, 178, 43, 30, 30, colors.onAccent, "bold", "center");
  text(model.footer, "footer", 80, 1276, 920, 50, 21, 18, colors.ink, "regular", "center", 1.28);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">${elements.join("")}</svg>`, textRuns, colors };
}

export const checkHighscoopOutro = (model: CardModel, style: CardStyle, theme: HighscoopOutroThemeId) => layoutHighscoopOutro(model, style, theme).textRuns;
export async function renderHighscoopOutro(model: CardModel, style: CardStyle, theme: HighscoopOutroThemeId) {
  const { svg } = layoutHighscoopOutro(model, style, theme, registeredProfileDataUrl(HIGHSCOOP_PROFILE_ASSET_ID));
  return sharp(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()).flatten({ background: "#FFFFFF" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
