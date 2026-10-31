/** Deterministic layout only: never summarize, truncate, mutate source text, or call an AI. */
export const MIN_CARD_BODY_SIZE = 28;
export type CardBodyBlock = {
  field: string; label?: string; text: string;
  /** Preferred line count from legacy templates, not a clipping boundary. */
  maxLines: number; emphasis?: boolean;
};
export type FittedCardBlock = {
  block: CardBodyBlock; lines: string[]; size: number; lineHeight: number;
  labelY: number | null; textY: number; inset: number;
  box: { top: number; height: number } | null; endY: number;
};
export type CardBodyFit =
  | { ok: true; blocks: FittedCardBlock[]; endY: number; adjusted: boolean; bodySize: number }
  | { ok: false; field: string; detail: string };
type Wrap = (text: string, size: number, width: number, emphasis: boolean) => string[];
type Profile = { body: number; emphasis: number; leading: number; labelGap: number; blockGap: number; boxGap: number };
const normal: Profile = { body: 34, emphasis: 40, leading: 1.5, labelGap: 52, blockGap: 48, boxGap: 24 };
const compact = (body: number): Profile => ({ body, emphasis: body + 6, leading: 1.38, labelGap: 44, blockGap: 32, boxGap: 16 });

/** Keep the normal design when it fits. Then reduce spacing, then type size down to 28px.
 * All fields are measured together, including labels, emphasis boxes and the footer safety gap.
 * maxLines is deliberately not a hard failure: seven lines can fit where six were prescribed.
 */
export function fitCardBody(
  blocks: readonly CardBodyBlock[],
  options: { width: number; startY: number; footerTop: number; emphasisBox?: boolean; wrap: Wrap },
): CardBodyFit {
  const { width, startY, footerTop, emphasisBox = false, wrap } = options;
  const active = blocks.filter(block => block.text.trim());
  if (!active.length) return { ok: true, blocks: [], endY: startY, adjusted: false, bodySize: normal.body };
  if (![width, startY, footerTop].every(Number.isFinite) || width <= 56 || startY >= footerTop - 10)
    return { ok: false, field: active[0].field, detail: "제목 아래 본문을 배치할 공간이 부족합니다. 제목을 짧게 하거나 다른 템플릿을 선택해 주세요." };
  const profiles = [normal, ...Array.from({ length: normal.body - MIN_CARD_BODY_SIZE + 1 }, (_, i) => compact(normal.body - i))];
  let failedField = active[0].field;
  for (let attempt = 0; attempt < profiles.length; attempt++) {
    const profile = profiles[attempt], planned: FittedCardBlock[] = [];
    let y = startY;
    for (const block of active) {
      const boxed = !!block.emphasis && emphasisBox;
      const size = block.emphasis ? profile.emphasis : profile.body;
      const lineHeight = size * profile.leading;
      const lines = wrap(block.text, size, width - (boxed ? 56 : 0), !!block.emphasis);
      const labelY = block.label ? y : null;
      let textY: number, box: FittedCardBlock["box"] = null;
      if (boxed) {
        box = { top: y - 40, height: profile.labelGap + 34 + lines.length * lineHeight };
        textY = y + profile.labelGap + 4 + size * 0.35;
        y += box.height + profile.boxGap;
      } else {
        if (block.label) y += profile.labelGap;
        textY = y + size * 0.35;
        y += lines.length * lineHeight + profile.blockGap - lineHeight * 0.35;
      }
      planned.push({ block, lines, size, lineHeight, labelY, textY, inset: boxed ? 28 : 0, box, endY: y });
      if (y > footerTop - 10) { failedField = block.field; break; }
    }
    if (planned.length === active.length && y <= footerTop - 10)
      return { ok: true, blocks: planned, endY: y, adjusted: attempt > 0, bodySize: profile.body };
  }
  return { ok: false, field: failedField,
    detail: `여백과 글자 크기(본문 최소 ${MIN_CARD_BODY_SIZE}px)를 자동 조절해도 한 장에 담기 어렵습니다. 내용은 자르지 않았습니다. 해당 내용을 나누거나 더 짧게 편집해 주세요.` };
}
