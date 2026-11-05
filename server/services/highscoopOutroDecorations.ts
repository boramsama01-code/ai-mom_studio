import { HIGHSCOOP_HANDLE, HIGHSCOOP_OUTRO_THEMES, type HighscoopOutroThemeId } from "../../shared/highscoopOutro";
import { loadFonts } from "./card";

export type HighscoopCardContext = { highscoopOutroTheme?: HighscoopOutroThemeId };
type DecorationText = { field: string; text: string; lines: string[]; size: number; lineHeight: number; x: number; y: number; width: number; height: number; align: "left" | "center"; color: string };
type DecorationOptions = { mode: "reading" | "family"; background: string; ink: string; accent: string; handle: string; measureOnly?: boolean };

function luminance(hex: string) {
  const values = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(first: string, second: string) { const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a); return (light + .05) / (dark + .05); }
const foreground = (background: string) => contrast(background, "#FFFFFF") > contrast(background, "#172B34") ? "#FFFFFF" : "#172B34";
const hex = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

/** These small additions use empty parts of the existing closing layouts.
 * The original brand line, CTA, handle and selected profile stay in place. */
export function highscoopOutroDecorations(themeId: HighscoopOutroThemeId, options: DecorationOptions) {
  const theme = HIGHSCOOP_OUTRO_THEMES[themeId], fonts = loadFonts(), elements: string[] = [], textRuns: DecorationText[] = [];
  const background = hex(options.background, theme.background), ink = hex(options.ink, theme.ink), accent = hex(options.accent, theme.accent);
  const readableAccent = contrast(background, accent) >= 3 ? accent : foreground(background), onAccent = foreground(accent);
  const addText = (text: string, field: string, x: number, y: number, width: number, size: number, color: string, align: "left" | "center" = "left") => {
    const height = size * 1.3, measured = fonts.semibold.getAdvanceWidth(text, size, { kerning: true });
    if (measured > width) throw new Error("하이스쿱 계정 안내 영역을 확인해 주세요.");
    const left = align === "center" ? x + (width - measured) / 2 : x;
    if (!options.measureOnly) elements.push(`<path d="${fonts.semibold.getPath(text, left, y + size * .94, size).toPathData(2)}" fill="${color}"/>`);
    textRuns.push({ field, text, lines: [text], size, lineHeight: height, x, y, width, height, align, color });
  };
  const top = options.mode === "reading" ? 194 : 173, bottom = options.mode === "reading" ? 1104 : 1174;
  addText(`HighScoop / ${theme.label}`, "highscoop.theme", 84, top, 710, 28, readableAccent);
  const cy = top + 20;
  if (!options.measureOnly) {
    const glyph = themeId === "camp"
      ? `<circle cx="940" cy="${cy}" r="31"/><path d="m926 ${cy + 16} 8-27 20-13-8 27Z"/>`
      : themeId === "competition"
        ? `<path d="M921 ${cy - 26}h38v24c0 26-38 26-38 0Zm-1 6h-13v14c0 12 13 14 17 14m36-28h13v14c0 12-13 14-17 14M940 ${cy + 19}v17m-18 0h36"/>`
        : `<path d="M901 ${cy + 31}h18v-21h18v-21h19v-21h25M956 ${cy - 32}h25v25"/>`;
    elements.push(`<g data-highscoop-theme="${themeId}" fill="none" stroke="${readableAccent}" stroke-width="3">${glyph}</g>`);
    elements.push(`<rect x="760" y="${bottom}" width="236" height="54" rx="27" fill="${accent}"/>`);
  }
  addText("+ 팔로우", "highscoop.follow", 778, bottom + 10, 200, 26, onAccent, "center");
  // A custom account line is retained above. The actual channel remains clear.
  addText(options.handle.trim() === HIGHSCOOP_HANDLE ? "다음 모집 소식도 함께 확인해요." : HIGHSCOOP_HANDLE,
    options.handle.trim() === HIGHSCOOP_HANDLE ? "highscoop.next" : "highscoop.officialHandle", 84, bottom + 10, 650, 26, ink);
  return { svg: elements.join(""), textRuns };
}
