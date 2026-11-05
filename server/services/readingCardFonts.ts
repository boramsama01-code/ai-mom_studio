import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import opentype from 'opentype.js';
import manifest from '../../assets/fonts/cardnews14/static-manifest.json';
import { CardFontError } from './card';

type Family = 'Noto Sans KR' | 'Noto Serif KR';
export type ReadingFont = {
  family: Family;
  weight: number;
  sha256: string;
  measure(text: string, size: number, letterSpacing?: number): number;
  path(text: string, x: number, baseline: number, size: number, letterSpacing?: number): string;
  baseline(size: number, lineHeight: number): number;
};
const faces = new Map<string, ReadingFont>();
const MAX_CACHED_FACES=5;
/** Operational diagnostics contain only public font identities, no copy text. */
export function readingFontCacheState(){return {limit:MAX_CACHED_FACES,faces:[...faces.keys()]};}

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

/** Full-Unicode weight instances are built from the untouched bundled OFL
 * sources. Parsing the original variable fonts eagerly allocates every glyph's
 * variation metadata even with lowMemory enabled. Static weights avoid that
 * allocation; an LRU bounds cached faces across repeated style changes. */
export function loadReadingFont(family: string | undefined, weight: number): ReadingFont {
  if (family !== 'Noto Sans KR' && family !== 'Noto Serif KR') {
    throw new CardFontError('카드뉴스 스타일의 한글 서체가 등록되지 않았습니다.');
  }
  if (!Number.isFinite(weight) || weight < (family === 'Noto Serif KR' ? 200 : 100) || weight > 900) {
    throw new CardFontError('카드뉴스 스타일의 글자 굵기를 확인해 주세요.');
  }
  const key = `${family}:${weight}`;
  const saved = faces.get(key);
  if(saved){faces.delete(key);faces.set(key,saved);return saved;}
  const entry=manifest.files.find(file=>file.family===family&&file.weight===weight);
  if(!entry)throw new CardFontError(`${family} ${weight} 굵기의 등록된 폰트가 없습니다.`);
  const candidates=[path.resolve(process.cwd(),'assets/fonts/cardnews14',entry.file),path.resolve(import.meta.dirname??'.','../../assets/fonts/cardnews14',entry.file)];
  const filenameOnDisk=candidates.find(candidate=>fs.existsSync(candidate));
  if(!filenameOnDisk)throw new CardFontError(`${family} ${weight} 폰트 파일을 찾을 수 없습니다. 배포 자산 복구 후 다시 시도해 주세요.`);
  // Evict before allocating a new face. No rendered page retains a font object.
  if(faces.size>=MAX_CACHED_FACES)faces.delete(faces.keys().next().value!);
  const bytes=fs.readFileSync(filenameOnDisk),sha256=createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==entry.bytes||sha256!==entry.sha256)throw new CardFontError(`${family} 폰트의 무결성 검사에 실패했습니다. 등록된 원본을 복구해 주세요.`);
  const buffer=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const font=opentype.parse(buffer,{lowMemory:true});
  if(font.tables.fvar||font.tables.gvar||font.charToGlyph('한').index===0)throw new CardFontError(`${family}의 검증된 한글 정적 서체를 읽을 수 없습니다.`);
  const measurementCache = new Map<string, number>();
  // Repeated previews/decks reuse identical outlines. Bound retained UTF-16
  // strings to about 1 MiB per face instead of rebuilding thousands of short
  // command objects for the same line on every render.
  const outlines=new Map<string,string>();let outlineChars=0;
  const MAX_OUTLINE_CHARS=512_000;
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
        units += glyph.advanceWidth??0;
        if (index < glyphs.length - 1) units += font.getKerningValue(glyph, glyphs[index + 1]);
      }
      const width = units / font.unitsPerEm * size + Math.max(0, glyphs.length - 1) * letterSpacing;
      if (measurementCache.size >= 512) measurementCache.clear();
      measurementCache.set(cacheKey, width);
      return width;
    },
    path(text, x, baseline, size, letterSpacing = 0) {
      const key=JSON.stringify([text,x,baseline,size,letterSpacing]),cached=outlines.get(key);
      if(cached!==undefined){outlines.delete(key);outlines.set(key,cached);return cached;}
      const options = { kerning: true, letterSpacing: letterSpacing / size };
      const data=readingPathData(font.getPath(text, x, baseline, size, options).commands),chars=key.length+data.length;
      if(chars<=MAX_OUTLINE_CHARS){
        while(outlines.size&&(outlineChars+chars>MAX_OUTLINE_CHARS||outlines.size>=128)){
          const oldest=outlines.keys().next().value!;outlineChars-=oldest.length+outlines.get(oldest)!.length;outlines.delete(oldest);
        }
        outlines.set(key,data);outlineChars+=chars;
      }
      return data;
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
