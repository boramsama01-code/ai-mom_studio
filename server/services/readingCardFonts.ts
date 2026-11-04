import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import opentype from 'opentype.js';
import manifest from '../../assets/fonts/cardnews14/manifest.json';
import { CardFontError } from './card';

type Family = 'Noto Sans KR' | 'Noto Serif KR';
type VariableFont = opentype.Font & {
  variation: { getTransform(glyph: opentype.Glyph, coordinates: { wght: number }): opentype.Glyph };
};
export type ReadingFont = {
  family: Family;
  weight: number;
  sha256: string;
  measure(text: string, size: number, letterSpacing?: number): number;
  path(text: string, x: number, baseline: number, size: number, letterSpacing?: number): string;
  baseline(size: number, lineHeight: number): number;
};
const files: Record<Family, string> = {
  'Noto Sans KR': 'NotoSansKR-Variable.ttf',
  'Noto Serif KR': 'NotoSerifKR-Variable.ttf',
};
const fonts = new Map<Family, { font: VariableFont; sha256: string }>();
const faces = new Map<string, ReadingFont>();

/** opentype.js 2's toPathData decimal formatter concatenates exponent strings;
 * tiny floating-point residues such as 5e-14 become `5e-14e+2` and emit NaN.
 * Serialise the already generated finite outline commands without that rounder.
 * An invalid coordinate is a render error, never a partially missing sentence. */
export function readingPathData(commands:opentype.PathCommand[]):string {
  const number=(value:number)=>{
    if(!Number.isFinite(value))throw new CardFontError('글자 윤곽에 올바르지 않은 좌표가 있습니다. 원고는 보존되었으며 이미지를 만들지 않았습니다.');
    return String(Number(value.toFixed(2)));
  };
  return commands.map(command=>{
    switch(command.type){
      case 'M':case 'L':return `${command.type}${number(command.x)} ${number(command.y)}`;
      case 'Q':return `Q${number(command.x1)} ${number(command.y1)} ${number(command.x)} ${number(command.y)}`;
      case 'C':return `C${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)}`;
      case 'Z':return 'Z';
      default:throw new CardFontError('글자 윤곽 형식을 확인해 주세요.');
    }
  }).join('');
}

/** The two original OFL variable fonts are bundled and checked by hash. Do not
 * substitute Pretendard or a system font: that would change the fixed slots.
 * Explicit variation coordinates avoid changing the font's global defaults. */
export function loadReadingFont(family: string | undefined, weight: number): ReadingFont {
  if (family !== 'Noto Sans KR' && family !== 'Noto Serif KR') {
    throw new CardFontError('카드뉴스 스타일의 한글 서체가 등록되지 않았습니다.');
  }
  if (!Number.isFinite(weight) || weight < (family === 'Noto Serif KR' ? 200 : 100) || weight > 900) {
    throw new CardFontError('카드뉴스 스타일의 글자 굵기를 확인해 주세요.');
  }
  const key = `${family}:${weight}`;
  const saved = faces.get(key);
  if (saved) return saved;
  let loaded = fonts.get(family);
  if (!loaded) {
    const filename = files[family], entry = manifest.files.find(file => file.file === filename);
    const candidates = [path.resolve(process.cwd(), 'assets/fonts/cardnews14', filename), path.resolve(import.meta.dirname ?? '.', '../../assets/fonts/cardnews14', filename)];
    const filenameOnDisk = candidates.find(candidate => fs.existsSync(candidate));
    if (!entry || !filenameOnDisk) throw new CardFontError(`${family} 원본 폰트 파일을 찾을 수 없습니다. 배포 자산 복구 후 다시 시도해 주세요.`);
    const bytes = fs.readFileSync(filenameOnDisk), sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.bytes || sha256 !== entry.sha256) throw new CardFontError(`${family} 폰트의 무결성 검사에 실패했습니다. 등록된 원본을 복구해 주세요.`);
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as VariableFont;
    if (!font.variation || font.charToGlyph('한').index === 0) throw new CardFontError(`${family}의 한글 가변 서체를 읽을 수 없습니다.`);
    loaded = { font, sha256 }; fonts.set(family, loaded);
  }
  const { font, sha256 } = loaded;
  const advanceWidths = new Map<number, number>();
  const measurementCache = new Map<string, number>();
  const face: ReadingFont = {
    family, weight, sha256,
    measure(text, size, letterSpacing = 0) {
      const cacheKey = `${size}:${letterSpacing}:${text}`;
      const cached = measurementCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const glyphs = font.stringToGlyphs(text);
      let units = 0;
      for (let index = 0; index < glyphs.length; index++) {
        const glyph = glyphs[index];
        let advance = advanceWidths.get(glyph.index);
        if (advance === undefined) {
          advance = font.variation.getTransform(glyph, { wght: weight }).advanceWidth ?? 0;
          advanceWidths.set(glyph.index, advance);
        }
        units += advance;
        if (index < glyphs.length - 1) units += font.getKerningValue(glyph, glyphs[index + 1]);
      }
      const width = units / font.unitsPerEm * size + Math.max(0, glyphs.length - 1) * letterSpacing;
      if (measurementCache.size >= 512) measurementCache.clear();
      measurementCache.set(cacheKey, width);
      return width;
    },
    path(text, x, baseline, size, letterSpacing = 0) {
      // opentype.js 2 implements variation; its DefinitelyTyped declaration is
      // still 1.x. A typed variable retains the checked standard options too.
      const options = { kerning: true, variation: { wght: weight }, letterSpacing: letterSpacing / size };
      return readingPathData(font.getPath(text, x, baseline, size, options).commands);
    },
    baseline(size, lineHeight) {
      // CSS puts the font's ascender/descender in the centre of the line box.
      // This uses the bundled font's metrics, not an arbitrary Latin baseline.
      return (lineHeight + (font.ascender + font.descender) / font.unitsPerEm * size) / 2;
    },
  };
  faces.set(key, face);
  return face;
}

/** Preserve intentional blank lines and manual line breaks. A long token is
 * wrapped by code point; its text is never truncated or its size reduced. */
export function wrapReadingText(font: ReadingFont, text: string, size: number, width: number, letterSpacing = 0): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    let line = '';
    const chunks = paragraph.match(/\S+|\s+/gu) ?? [];
    for (const chunk of chunks) {
      if (font.measure(line + chunk, size, letterSpacing) <= width) { line += chunk; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      // Whitespace at a new soft-wrapped line has no visible content.
      if (!chunk.trim()) continue;
      for (const character of Array.from(chunk)) {
        if (line && font.measure(line + character, size, letterSpacing) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
