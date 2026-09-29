/**
 * 카드 이미지 생성 (1080×1350, RGB JPEG)
 *
 * 렌더링 방식: 한글 폰트(Pretendard, OFL)를 opentype.js로 읽어 글자를 벡터 경로로 바꾸고,
 * SVG를 resvg로 래스터화한 뒤 sharp로 RGB JPEG을 만든다.
 * - 브라우저(Chromium) 없이 Render 무료 서버에서도 같은 결과가 나온다.
 * - 폰트 파일이 없으면 영문 기본 폰트로 대체하지 않고 생성 실패로 처리한다.
 * - 폭 기준 줄바꿈, 최대 줄 수 초과 시 "편집 필요"(CardOverflowError)로 돌려보낸다.
 */
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { TOKENS } from "../../shared/tokens";

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
  brandLine: string; // "아이맘 스튜디오 · 도전·진학"
  badge: string; // 카테고리
  title: string;
  blocks: Array<{ field: string; label?: string; text: string; maxLines: number; emphasis?: boolean }>;
  footer: string; // "출처: 기관 · 확인 2026-09-28"
};

function pathFor(font: opentype.Font, text: string, x: number, y: number, size: number, color: string): string {
  const p = font.getPath(text, x, y, size, { kerning: true });
  return `<path d="${p.toPathData(2)}" fill="${color}"/>`;
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
  for (const b of model.blocks) {
    if (!b.text.trim()) continue;
    const size = b.emphasis ? 40 : 34;
    const font: keyof Fonts = b.emphasis ? "semibold" : "regular";
    const lh = size * 1.5;
    const lines = wrapText(c.fonts[font], b.text, size, c.w - (b.emphasis && opts.emphasisBox ? 56 : 0));
    if (lines.length > b.maxLines) throw new CardOverflowError(b.field, `${lines.length}줄(최대 ${b.maxLines}줄)`);
    if (b.emphasis && opts.emphasisBox) {
      const boxH = 52 + 34 + lines.length * lh;
      c.els.push(`<rect x="${c.x}" y="${y - 40}" width="${c.w}" height="${boxH}" rx="18" fill="${c.accent}" fill-opacity="0.09"/>`);
      if (b.label) c.els.push(pathFor(c.fonts.semibold, b.label, c.x + 28, y, 26, c.accent));
      let yy = y + 56;
      for (const l of lines) {
        c.els.push(pathFor(c.fonts[font], l, c.x + 28, yy + size * 0.35, size, c.text));
        yy += lh;
      }
      y += boxH + 24;
    } else {
      if (b.label) {
        c.els.push(pathFor(c.fonts.semibold, b.label, c.x, y, 26, opts.labelColor ?? c.muted));
        y += 52;
      }
      for (const l of lines) {
        c.els.push(pathFor(c.fonts[font], l, c.x, y + size * 0.35, size, c.text));
        y += lh;
      }
      y += 48 - lh * 0.35;
    }
    if (y > footerTop - 10) throw new CardOverflowError(b.field, "본문이 카드 아래 영역을 넘음");
  }
  return y;
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

export function layoutCard(model: CardModel, style: CardStyle = { layout: "classic" }): string {
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
    const titleLines = wrapText(fonts.bold, model.title, 62, INNER_W);
    if (titleLines.length > 3) throw new CardOverflowError("title", `제목이 ${titleLines.length}줄(최대 3줄)`);
    const headerH = PAD + 30 + 60 + (model.badge ? 60 : 0) + titleLines.length * 62 * 1.28 + 64;
    els.push(`<rect width="${CARD_W}" height="${headerH}" fill="${model.accent}"/>`);
    let y = PAD + 30;
    els.push(pathFor(fonts.semibold, model.brandLine, PAD, y, 30, "#FFFFFF"));
    y += 60;
    if (model.badge) {
      drawBadge(c, model.badge, PAD, y, "#FFFFFF", "#FFFFFF", 0.18);
      y += 60;
    }
    drawTitle(c, model.title, y, 62, "#FFFFFF");
    y = headerH + 80;
    drawBlocks(c, model, y, footerTop, { labelColor: model.accent });
    drawFooter(c, model.footer, footerTop, TOKENS.border, 1);
  } else if (layout === "magazine") {
    // 왼쪽 색 막대 + 큰 제목 + 강조 상자
    if (!hasBg) els.push(`<rect width="28" height="${CARD_H}" fill="${model.accent}"/>`);
    let y = PAD + 30;
    els.push(pathFor(fonts.semibold, model.brandLine, PAD, y, 28, hasBg ? P.muted : model.accent));
    if (model.badge) {
      const bw = measure(fonts.semibold, model.badge, 28);
      els.push(pathFor(fonts.semibold, model.badge, CARD_W - PAD - bw, y, 28, P.muted));
    }
    y += 40;
    y = drawTitle(c, model.title, y, 74, P.text, "bold", 3);
    y += 70;
    drawBlocks(c, model, y, footerTop, { emphasisBox: true });
    drawFooter(c, model.footer, footerTop, P.border, P.borderOpacity);
  } else if (layout === "minimal") {
    let y = PAD + 70;
    els.push(pathFor(fonts.regular, model.brandLine, PAD, y, 26, P.muted));
    if (model.badge) {
      y += 50;
      els.push(pathFor(fonts.semibold, model.badge, PAD, y, 28, hasBg ? P.text : model.accent));
    }
    y += 20;
    y = drawTitle(c, model.title, y, 58, P.text, "semibold", 3);
    y += 40;
    els.push(`<rect x="${PAD}" y="${y}" width="96" height="6" rx="3" fill="${hasBg ? P.text : model.accent}"/>`);
    y += 90;
    drawBlocks(c, model, y, footerTop);
    drawFooter(c, model.footer, footerTop, P.border, P.borderOpacity);
  } else {
    // classic (배경 이미지 템플릿에서 header를 고르면 classic 배치를 사용)
    if (!hasBg) els.push(`<rect width="${CARD_W}" height="16" fill="${model.accent}"/>`);
    let y = PAD + 30;
    els.push(pathFor(fonts.semibold, model.brandLine, PAD, y, 30, hasBg ? P.text : model.accent));
    y += 60;
    if (model.badge) {
      drawBadge(c, model.badge, PAD, y, hasBg ? P.text : model.accent, hasBg ? P.text : model.accent, hasBg ? 0.16 : 0.12);
      y += 60;
    }
    y = drawTitle(c, model.title, y, 60, P.text);
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
