/**
 * 카드 이미지 생성 (1080×1350, RGB JPEG)
 *
 * 렌더링 방식: 한글 폰트(Pretendard, OFL)를 opentype.js로 읽어 글자를 벡터 경로로 바꾸고,
 * SVG를 resvg로 래스터화한 뒤 sharp로 RGB JPEG을 만든다.
 * - 브라우저(Chromium) 없이 Render 무료 서버에서도 같은 결과가 나온다.
 * - 폰트 파일이 없으면 영문 기본 폰트로 대체하지 않고 생성 실패로 처리한다.
 * - 제목·본문 높이를 먼저 측정하고 여백·글자 크기를 자동 조절한다. 원고를 자르지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { TOKENS } from "../../shared/tokens";
import { fitCardBody } from "./cardBodyFit";

export const CARD_W = 1080;
export const CARD_H = 1350;
const PAD = 84;
const INNER_W = CARD_W - PAD * 2;

export class CardFontError extends Error {}
export class CardOverflowError extends Error {
  constructor(public field: string, public detail: string) {
    super(`카드 영역 넘침: ${field} — ${detail}`);
  }
}

type Fonts = { regular: opentype.Font; semibold: opentype.Font; bold: opentype.Font };
let fontCache: Fonts | null = null;

function fontDir(): string {
  const candidates = [path.resolve(process.cwd(), "assets/fonts"), path.resolve(import.meta.dirname ?? ".", "../../assets/fonts")];
  const d = candidates.find((p) => fs.existsSync(path.join(p, "Pretendard-Regular.ttf")));
  if (!d) throw new CardFontError("한글 폰트 파일(assets/fonts/Pretendard-*.ttf)을 찾을 수 없음 — 카드 생성 불가");
  return d;
}

export function loadFonts(): Fonts {
  if (fontCache) return fontCache;
  const dir = fontDir();
  const load = (f: string) => {
    const buf = fs.readFileSync(path.join(dir, f));
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };
  const fonts = { regular: load("Pretendard-Regular.ttf"), semibold: load("Pretendard-SemiBold.ttf"), bold: load("Pretendard-Bold.ttf") };
  // 한글 글리프가 실제로 있는지 확인
  for (const [k, f] of Object.entries(fonts)) {
    if (f.charToGlyph("한").index === 0) throw new CardFontError(`${k} 폰트에 한글 글리프 없음`);
  }
  fontCache = fonts;
  return fonts;
}

function measure(font: opentype.Font, text: string, size: number): number {
  return font.getAdvanceWidth(text, size, { kerning: true });
}

/** 어절(공백) 단위 줄바꿈. 한 어절이 폭보다 길면 글자 단위로 자른다. */
export function wrapText(font: opentype.Font, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (measure(font, cand, size) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line) lines.push(line);
      if (measure(font, w, size) <= maxWidth) {
        line = w;
      } else {
        let chunk = "";
        for (const ch of Array.from(w)) {
          if (measure(font, chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}


export type CardModel = {
  accent: string;
  brandLine: string; // "우주펭귄상회 스튜디오 · 도전·진학"
  badge: string; // 카테고리
  title: string;
  blocks: Array<{ field: string; label?: string; text: string; maxLines: number; emphasis?: boolean }>;
  footer: string; // "출처: 기관 · 확인 2026-09-28"
};

function pathFor(font: opentype.Font, text: string, x: number, y: number, size: number, color: string): string {
  const p = font.getPath(text, x, y, size, { kerning: true });
  return `<path d="${p.toPathData(2)}" fill="${color}"/>`;
}

/** Approved original mascot, used only when generating new cards. */
let brandImage: string | null = null;
function drawBrand(c: Ctx, label: string, y: number, color: string, maxWidth = c.w) {
  brandImage ??= fs.readFileSync(path.resolve(process.cwd(), "assets/branding/space-penguin-company.png")).toString("base64");
  const iconSize = 46;
  c.els.push(`<svg x="${c.x}" y="${y - 35}" width="${iconSize}" height="${iconSize}" viewBox="420 55 640 650"><image width="1448" height="1086" href="data:image/png;base64,${brandImage}"/></svg>`);
  const textWidth = maxWidth - iconSize - 14;
  let size = 28;
  while (size > 18 && measure(c.fonts.semibold, label, size) > textWidth) size--;
  if (measure(c.fonts.semibold, label, size) > textWidth) throw new CardOverflowError("brandLine", "브랜드 표기가 영역을 넘음");
  c.els.push(pathFor(c.fonts.semibold, label, c.x + iconSize + 14, y, size, color));
}

export type CardLayout = "classic" | "header" | "magazine" | "minimal";
export type CardStyle = {
  layout: CardLayout;
  tone?: "dark" | "light"; // 글자색 계열(배경 이미지 템플릿용)
  background?: Buffer | null; // 내 템플릿 배경(이미지)
  overlay?: number; // 0~80, 가독성용 반투명 막
};

export const BUILTIN_LAYOUTS: Array<{ key: CardLayout; name: string; description: string }> = [
  { key: "classic", name: "기본", description: "흰 바탕, 위쪽 색 띠와 분류 표시" },
  { key: "header", name: "컬러 헤더", description: "위쪽을 채널 색으로 채우고 제목을 흰 글씨로" },
  { key: "magazine", name: "매거진", description: "큰 제목과 강조 상자, 왼쪽 색 막대" },
  { key: "minimal", name: "미니멀", description: "여백을 넓게, 얇은 강조선만" },
];

function palette(tone: "dark" | "light") {
  return tone === "light"
    ? { text: "#FFFFFF", muted: "#E7EBF1", border: "#FFFFFF", borderOpacity: 0.35 }
    : { text: TOKENS.text, muted: TOKENS.muted, border: TOKENS.border, borderOpacity: 1 };
}

type Ctx = { fonts: Fonts; els: string[]; x: number; w: number; text: string; muted: string; accent: string };

function drawTitle(c: Ctx, title: string, y: number, size: number, color: string, font: keyof Fonts = "bold", maxLines = 3): number {
  const lines = wrapText(c.fonts[font], title, size, c.w);
  if (lines.length > maxLines) throw new CardOverflowError("title", `제목이 ${lines.length}줄(최대 ${maxLines}줄)`);
  for (const l of lines) {
    y += size * 1.28;
    c.els.push(pathFor(c.fonts[font], l, c.x, y, size, color));
  }
  return y;
}

function drawBlocks(c: Ctx, model: CardModel, y: number, footerTop: number, opts: { emphasisBox?: boolean; labelColor?: string } = {}): number {
  const fit = fitCardBody(model.blocks, {
    width: c.w, startY: y, footerTop, emphasisBox: opts.emphasisBox,
    wrap: (text, size, width, emphasis) => wrapText(c.fonts[emphasis ? "semibold" : "regular"], text, size, width),
  });
  if (!fit.ok) throw new CardOverflowError(fit.field, fit.detail);
  // Draw only a complete successful plan. Text and output geometry share this single plan.
  for (const entry of fit.blocks) {
    const { block, lines, size, lineHeight, inset, labelY, textY, box } = entry;
    const font = block.emphasis ? c.fonts.semibold : c.fonts.regular;
    if (box) c.els.push('<rect x="' + c.x + '" y="' + box.top + '" width="' + c.w + '" height="' + box.height + '" rx="18" fill="' + c.accent + '" fill-opacity="0.09"/>');
    if (block.label && labelY !== null) c.els.push(pathFor(c.fonts.semibold, block.label, c.x + inset, labelY, 26, box ? c.accent : opts.labelColor ?? c.muted));
    lines.forEach((line, index) => c.els.push(pathFor(font, line, c.x + inset, textY + index * lineHeight, size, c.text)));
  }
  return fit.endY;
}

function drawFooter(c: Ctx, footer: string, footerTop: number, borderColor: string, borderOpacity: number) {
  c.els.push(`<rect x="${c.x}" y="${footerTop}" width="${c.w}" height="2" fill="${borderColor}" fill-opacity="${borderOpacity}"/>`);
  const lines = wrapText(c.fonts.regular, footer, 26, c.w);
  if (lines.length > 2) throw new CardOverflowError("footer", "출처 표기가 2줄을 넘음");
  lines.forEach((l, i) => c.els.push(pathFor(c.fonts.regular, l, c.x, footerTop + 48 + i * 38, 26, c.muted)));
}

function drawBadge(c: Ctx, text: string, x: number, y: number, fg: string, bg: string, bgOpacity: number) {
  const bw = measure(c.fonts.semibold, text, 28) + 40;
  c.els.push(`<rect x="${x}" y="${y - 38}" width="${bw}" height="52" rx="10" fill="${bg}" fill-opacity="${bgOpacity}"/>`);
  c.els.push(pathFor(c.fonts.semibold, text, x + 20, y - 3, 28, fg));
}

/** Try the original title first, then bounded smaller titles; never clip or change the text. */
export function layoutCard(model: CardModel, style: CardStyle = { layout: "classic" }): string {
  const initialSize = style.layout === "magazine" ? 74 : style.layout === "minimal" ? 58 : style.layout === "header" && !style.background ? 62 : 60;
  let lastError: CardOverflowError | null = null;
  for (let size = initialSize; size >= 46; size -= 2) {
    try { return layoutCardAtSize(model, style, size); }
    catch (e) {
      if (!(e instanceof CardOverflowError) || (e.field !== "title" && !model.blocks.some(b => b.field === e.field))) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new CardOverflowError("title", "제목을 배치할 수 없습니다.");
}

function layoutCardAtSize(model: CardModel, style: CardStyle, titleSize: number): string {
  const fonts = loadFonts();
  const els: string[] = [];
  const hasBg = !!style.background;
  const tone = hasBg ? style.tone ?? "dark" : "dark";
  const P = palette(tone);
  const c: Ctx = { fonts, els, x: PAD, w: INNER_W, text: P.text, muted: P.muted, accent: model.accent };
  const footerTop = CARD_H - PAD - 70;

  if (!hasBg) els.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="${TOKENS.surface}"/>`);
  else if (style.overlay) els.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="${tone === "light" ? "#000000" : "#FFFFFF"}" fill-opacity="${Math.min(style.overlay, 80) / 100}"/>`);

  const layout = style.layout;
  if (layout === "header" && !hasBg) {
    // 위쪽 색 블록 안에 브랜드·분류·제목(흰 글씨)
    const titleLines = wrapText(fonts.bold, model.title, titleSize, INNER_W);
    if (titleLines.length > 3) throw new CardOverflowError("title", `제목이 ${titleLines.length}줄(최대 3줄)`);
    const headerH = PAD + 30 + 60 + (model.badge ? 60 : 0) + titleLines.length * titleSize * 1.28 + 64;
    els.push(`<rect width="${CARD_W}" height="${headerH}" fill="${model.accent}"/>`);
    let y = PAD + 30;
    drawBrand(c, model.brandLine, y, "#FFFFFF");
    y += 60;
    if (model.badge) {
      drawBadge(c, model.badge, PAD, y, "#FFFFFF", "#FFFFFF", 0.18);
      y += 60;
    }
    drawTitle(c, model.title, y, titleSize, "#FFFFFF");
    y = headerH + 80;
    drawBlocks(c, model, y, footerTop, { labelColor: model.accent });
    drawFooter(c, model.footer, footerTop, TOKENS.border, 1);
  } else if (layout === "magazine") {
    // 왼쪽 색 막대 + 큰 제목 + 강조 상자
    if (!hasBg) els.push(`<rect width="28" height="${CARD_H}" fill="${model.accent}"/>`);
    let y = PAD + 30;
    const badgeWidth = model.badge ? measure(fonts.semibold, model.badge, 28) + 32 : 0;
    drawBrand(c, model.brandLine, y, hasBg ? P.muted : model.accent, INNER_W - badgeWidth);
    if (model.badge) {
      const bw = measure(fonts.semibold, model.badge, 28);
      els.push(pathFor(fonts.semibold, model.badge, CARD_W - PAD - bw, y, 28, P.muted));
    }
    y += 40;
    y = drawTitle(c, model.title, y, titleSize, P.text, "bold", 3);
    y += 70;
    drawBlocks(c, model, y, footerTop, { emphasisBox: true });
    drawFooter(c, model.footer, footerTop, P.border, P.borderOpacity);
  } else if (layout === "minimal") {
    let y = PAD + 70;
    drawBrand(c, model.brandLine, y, P.muted);
    if (model.badge) {
      y += 50;
      els.push(pathFor(fonts.semibold, model.badge, PAD, y, 28, hasBg ? P.text : model.accent));
    }
    y += 20;
    y = drawTitle(c, model.title, y, titleSize, P.text, "semibold", 3);
    y += 40;
    els.push(`<rect x="${PAD}" y="${y}" width="96" height="6" rx="3" fill="${hasBg ? P.text : model.accent}"/>`);
    y += 90;
    drawBlocks(c, model, y, footerTop);
    drawFooter(c, model.footer, footerTop, P.border, P.borderOpacity);
  } else {
    // classic (배경 이미지 템플릿에서 header를 고르면 classic 배치를 사용)
    if (!hasBg) els.push(`<rect width="${CARD_W}" height="16" fill="${model.accent}"/>`);
    let y = PAD + 30;
    drawBrand(c, model.brandLine, y, hasBg ? P.text : model.accent);
    y += 60;
    if (model.badge) {
      drawBadge(c, model.badge, PAD, y, hasBg ? P.text : model.accent, hasBg ? P.text : model.accent, hasBg ? 0.16 : 0.12);
      y += 60;
    }
    y = drawTitle(c, model.title, y, titleSize, P.text);
    y += 36;
    els.push(`<rect x="${PAD}" y="${y}" width="${INNER_W}" height="2" fill="${P.border}" fill-opacity="${P.borderOpacity}"/>`);
    y += 56;
    drawBlocks(c, model, y, footerTop);
    drawFooter(c, model.footer, footerTop, P.border, P.borderOpacity);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${els.join("")}</svg>`;
}

/** 업로드한 배경 이미지를 1080×1350으로 맞춰 JPEG로 정규화 */
export async function normalizeBackground(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("이미지를 읽을 수 없습니다.");
  if (meta.width < 540 || meta.height < 540) throw new Error("이미지가 너무 작습니다(최소 540px, 권장 1080×1350).");
  return sharp(input).rotate().resize(CARD_W, CARD_H, { fit: "cover", position: "centre" }).flatten({ background: "#ffffff" }).toColorspace("srgb").jpeg({ quality: 92 }).toBuffer();
}

export async function renderCardJpeg(model: CardModel, style: CardStyle = { layout: "classic" }): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const svg = layoutCard(model, style);
  const png = new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false }, background: style.background ? "rgba(0,0,0,0)" : undefined }).render().asPng();
  const base = style.background
    ? sharp(style.background).resize(CARD_W, CARD_H, { fit: "cover" }).composite([{ input: png }])
    : sharp(png).flatten({ background: "#ffffff" });
  const jpeg = await sharp(await base.png().toBuffer()).flatten({ background: "#ffffff" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  if (meta.width !== CARD_W || meta.height !== CARD_H || meta.channels !== 3) throw new Error("카드 결과 검증 실패(크기/채널)");
  return { jpeg, width: CARD_W, height: CARD_H };
}

