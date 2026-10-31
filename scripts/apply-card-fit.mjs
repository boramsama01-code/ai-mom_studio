import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const path = 'server/services/card.ts';
let source = readFileSync(path, 'utf8');
const bytes = Buffer.from(source);
const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (sha !== 'b2a0f2755acd066b44c634654b8e5ea5e23ade55') throw new Error('Card renderer changed; review before applying this patch.');
source = source.replace('import { TOKENS } from "../../shared/tokens";', 'import { TOKENS } from "../../shared/tokens";\nimport { fitCardBody } from "./cardBodyFit";');
source = source.replace(' * - 폭 기준 줄바꿈, 최대 줄 수 초과 시 "편집 필요"(CardOverflowError)로 돌려보낸다.', ' * - 제목·본문 높이를 먼저 측정하고 여백·글자 크기를 자동 조절한다. 원고를 자르지 않는다.');
const start = source.indexOf('function drawBlocks(');
const end = source.indexOf('\nfunction drawFooter(', start);
if (start < 0 || end < 0) throw new Error('Renderer integration boundaries not found');
source = source.slice(0, start) + `function drawBlocks(c: Ctx, model: CardModel, y: number, footerTop: number, opts: { emphasisBox?: boolean; labelColor?: string } = {}): number {
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
` + source.slice(end);
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error('Unexpected layout anchor: ' + before);
  source = source.replace(before, after);
}
replaceOnce('export function layoutCard(model: CardModel, style: CardStyle = { layout: "classic" }): string {', `/** Try the original title first, then bounded smaller titles; never clip or change the text. */
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

function layoutCardAtSize(model: CardModel, style: CardStyle, titleSize: number): string {`);
replaceOnce('const titleLines = wrapText(fonts.bold, model.title, 62, INNER_W);', 'const titleLines = wrapText(fonts.bold, model.title, titleSize, INNER_W);');
replaceOnce('titleLines.length * 62 * 1.28', 'titleLines.length * titleSize * 1.28');
replaceOnce('drawTitle(c, model.title, y, 62, "#FFFFFF");', 'drawTitle(c, model.title, y, titleSize, "#FFFFFF");');
replaceOnce('drawTitle(c, model.title, y, 74, P.text, "bold", 3)', 'drawTitle(c, model.title, y, titleSize, P.text, "bold", 3)');
replaceOnce('drawTitle(c, model.title, y, 58, P.text, "semibold", 3)', 'drawTitle(c, model.title, y, titleSize, P.text, "semibold", 3)');
replaceOnce('drawTitle(c, model.title, y, 60, P.text)', 'drawTitle(c, model.title, y, titleSize, P.text)');
writeFileSync(path, source);
const appPath = 'server/app.ts';
let app = readFileSync(appPath, 'utf8');
const before = 'sourceResolver: "google-news-redirect-v2"';
if (app.split(before).length !== 2) throw new Error('Unexpected deployment marker baseline');
app = app.replace(before, before + ', cardRenderer: "adaptive-body-v1"');
writeFileSync(appPath, app);
console.log('Applied measured card layout without altering source text, approvals or publishing.');
