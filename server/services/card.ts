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

type Block = { field: string; text: string; font: keyof Fonts; size: number; color: string; maxLines: number; gapAfter: number; lineHeight?: number; label?: string };

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

export function layoutCard(model: CardModel): string {
  const fonts = loadFonts();
  const els: string[] = [];
  const T = TOKENS;
  els.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="${T.surface}"/>`);
  els.push(`<rect width="${CARD_W}" height="16" fill="${model.accent}"/>`);

  let y = PAD + 30;
  // 브랜드 줄
  els.push(pathFor(fonts.semibold, model.brandLine, PAD, y, 30, model.accent));
  y += 60;

  // 카테고리 배지
  if (model.badge) {
    const bw = measure(fonts.semibold, model.badge, 28) + 40;
    els.push(`<rect x="${PAD}" y="${y - 38}" width="${bw}" height="52" rx="10" fill="${model.accent}" fill-opacity="0.12"/>`);
    els.push(pathFor(fonts.semibold, model.badge, PAD + 20, y - 3, 28, model.accent));
    y += 60;
  }

  // 제목
  const titleSize = 60;
  const titleLines = wrapText(fonts.bold, model.title, titleSize, INNER_W);
  if (titleLines.length > 3) throw new CardOverflowError("title", `제목이 ${titleLines.length}줄(최대 3줄)`);
  for (const l of titleLines) {
    y += titleSize * 1.28;
    els.push(pathFor(fonts.bold, l, PAD, y, titleSize, T.text));
  }
  y += 36;
  els.push(`<rect x="${PAD}" y="${y}" width="${INNER_W}" height="2" fill="${T.border}"/>`);
  y += 56;

  const footerTop = CARD_H - PAD - 70;
  const blocks: Block[] = model.blocks.map((b) => ({
    field: b.field,
    label: b.label,
    text: b.text,
    font: b.emphasis ? "semibold" : "regular",
    size: b.emphasis ? 40 : 34,
    color: T.text,
    maxLines: b.maxLines,
    gapAfter: 48,
  }));
  for (const b of blocks) {
    if (!b.text.trim()) continue;
    if (b.label) {
      els.push(pathFor(fonts.semibold, b.label, PAD, y, 26, T.muted));
      y += 52;
    }
    const lh = b.size * 1.5;
    const lines = wrapText(fonts[b.font], b.text, b.size, INNER_W);
    if (lines.length > b.maxLines) throw new CardOverflowError(b.field, `${lines.length}줄(최대 ${b.maxLines}줄)`);
    for (const l of lines) {
      els.push(pathFor(fonts[b.font], l, PAD, y + b.size * 0.35, b.size, b.color));
      y += lh;
    }
    y += b.gapAfter - lh * 0.35;
    if (y > footerTop - 10) throw new CardOverflowError(b.field, "본문이 카드 아래 영역을 넘음");
  }

  // 하단: 출처·확인일
  els.push(`<rect x="${PAD}" y="${footerTop}" width="${INNER_W}" height="2" fill="${T.border}"/>`);
  const footLines = wrapText(fonts.regular, model.footer, 26, INNER_W);
  if (footLines.length > 2) throw new CardOverflowError("footer", "출처 표기가 2줄을 넘음");
  footLines.forEach((l, i) => els.push(pathFor(fonts.regular, l, PAD, footerTop + 48 + i * 38, 26, T.muted)));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${els.join("")}</svg>`;
}

export async function renderCardJpeg(model: CardModel): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const svg = layoutCard(model);
  const png = new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng();
  const jpeg = await sharp(png).flatten({ background: "#ffffff" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  if (meta.width !== CARD_W || meta.height !== CARD_H || meta.channels !== 3) throw new Error("카드 결과 검증 실패(크기/채널)");
  return { jpeg, width: CARD_W, height: CARD_H };
}
