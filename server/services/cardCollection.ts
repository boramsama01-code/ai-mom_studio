import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { cardDesign, type CardDesign } from "../../shared/cardDesigns";
import { CardOverflowError, loadFonts, wrapText, type CardModel } from "./card";

const W = 1080, H = 1350;
type TextOptions = { size?: number; min?: number; color?: string; weight?: "regular" | "semibold" | "bold"; align?: "left" | "center"; field?: string; leading?: number };
function canvas(d: CardDesign) {
  const fonts = loadFonts(), els: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0, extra = "") => els.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`);
  const line = (x: number, y: number, w: number, color = d.ink, thickness = 1) => rect(x, y, w, thickness, color);
  const text = (value: string, x: number, y: number, w: number, h: number, o: TextOptions = {}) => {
    const f = fonts[o.weight ?? "regular"], leading = o.leading ?? 1.26;
    let size = o.size ?? 32;
    const min = o.min ?? size;
    let lines = wrapText(f, value, size, w);
    while (lines.length * size * leading > h && size > min) { size = Math.max(min, size - 2); lines = wrapText(f, value, size, w); }
    if (lines.length * size * leading > h) throw new CardOverflowError(o.field ?? "title", `문구가 ${Math.round(w)}×${Math.round(h)} 영역을 넘습니다.`);
    lines.forEach((s, i) => {
      const left = o.align === "center" ? x + (w - f.getAdvanceWidth(s, size, { kerning: true })) / 2 : x;
      els.push(`<path d="${f.getPath(s, left, y + size * .94 + i * size * leading, size).toPathData(2)}" fill="${o.color ?? d.ink}"/>`);
    });
    return y + lines.length * size * leading;
  };
  const pill = (label: string, x: number, y: number, color = d.onAccent, bg = d.accent) => {
    const width = Math.min(840, fonts.semibold.getAdvanceWidth(label, 25) + 40);
    rect(x, y, width, 48, bg, 24); text(label, x + 20, y + 9, width - 40, 32, { size: 25, weight: "semibold", color });
  };
  const grid = (color = d.soft) => { for (let x = 0; x < W; x += 48) line(x, 0, 1, color, H); for (let y = 0; y < H; y += 48) line(0, y, W, color); };
  const header = (brand: string, label: string, color = d.ink) => {
    text(brand, 80, 56, 750, 48, { size: 34, min: 18, weight: "bold", color, field: "brandLine" });
    text(label, 860, 62, 140, 37, { size: 24, color });
  };
  const footer = (model: CardModel, credit = "", color = d.ink) => {
    if (credit) text(credit, 80, 1188, 920, 32, { size: 21, min: 16, color, field: "footer" });
    line(80, 1230, 920, color);
    text(model.footer, 80, 1250, 920, 66, { size: 23, min: 20, color, field: "footer", leading: 1.35 });
  };
  return { fonts, els, rect, line, text, pill, grid, header, footer, svg: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${els.join("")}</svg>` };
}
function getDesign(id: string) { const d = cardDesign(id); if (!d) throw new Error(`알 수 없는 카드 세트: ${id}`); return d; }
async function jpeg(svg: string) {
  return sharp(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()).flatten({ background: "#fff" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

const COVER_TITLES: Record<string, { x: number; y: number; w: number; h: number; size: number; inverse?: boolean; center?: boolean }> = {
  f01: { x:80,y:652,w:920,h:380,size:112 },
  r01: { x:80,y:254,w:910,h:310,size:98 }, r02: { x:80,y:398,w:920,h:460,size:122 },
  r03: { x:108,y:316,w:864,h:345,size:100 }, r04: { x:92,y:292,w:880,h:350,size:102 },
  r05: { x:80,y:845,w:920,h:245,size:88 }, r06: { x:108,y:712,w:735,h:330,size:96 },
  r07: { x:124,y:383,w:832,h:375,size:92,center:true }, r08: { x:108,y:329,w:864,h:375,size:108,inverse:true },
  r09: { x:80,y:282,w:920,h:345,size:106 }, r10: { x:80,y:367,w:920,h:380,size:102 },
  n01: { x:80,y:655,w:920,h:380,size:112 }, n02: { x:80,y:352,w:920,h:300,size:98 },
  n03: { x:80,y:820,w:920,h:278,size:91 }, n04: { x:80,y:571,w:920,h:380,size:102 },
  n05: { x:80,y:833,w:920,h:258,size:88 }, n06: { x:80,y:276,w:920,h:340,size:102 },
  n07: { x:80,y:416,w:920,h:448,size:108 }, n08: { x:120,y:507,w:840,h:330,size:96 },
  n09: { x:80,y:335,w:920,h:363,size:101 }, n10: { x:80,y:409,w:920,h:450,size:116 },
};
function drawHeadline(c: ReturnType<typeof canvas>, title: string, d: CardDesign, min = 54) {
  const s = COVER_TITLES[d.layoutId ?? d.id];
  return c.text(title, s.x, s.y, s.w, s.h, { size: s.size, min, weight: 'bold', color: s.inverse ? d.onAccent : d.ink, align: s.center ? 'center' : 'left' });
}
export function checkCollectionTitle(title: string, id: string) { const d = getDesign(id); drawHeadline(canvas(d), title, d); }

/** Every cover has its own composition; all text is measured before rasterization. */
export async function renderCollectionCover(model: CardModel, count: number, art: Buffer | null, credit: string, id: string): Promise<Buffer> {
  const d = getDesign(id), c = canvas(d);
  const { rect, line, text, pill, els } = c;
  rect(0, 0, W, H, d.bg);
  let artUsed = false;
  const photo = async (x: number, y: number, w: number, h: number, r = 0) => {
    if (art) {
      const bytes = await sharp(art, { limitInputPixels: 40_000_000 }).rotate().resize(w, h, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
      const clip = `photo-${els.length}`;
      els.push(`<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath></defs><image x="${x}" y="${y}" width="${w}" height="${h}" clip-path="url(#${clip})" href="data:image/jpeg;base64,${bytes.toString("base64")}"/>`);
      artUsed = true;
    } else {
      rect(x, y, w, h, d.soft, r);
      line(x + 40, y + 42, Math.min(100, w - 80), d.accent, 5);
      text(d.family === "recruitment" ? "EXPLORE\nYOUR NEXT." : "CONTEXT\nMATTERS.", x + 40, y + h * .3, w - 80, h * .6, { size: Math.min(70, w / 7), min: 26, weight: "bold", color: d.ink });
    }
  };
  const headline = () => drawHeadline(c, model.title, d, model.subtitle === undefined ? 54 : 40);
  const cue = (x = 80, y = 1112, color = d.ink) => model.subtitle === undefined
    ? text(d.family === "recruitment" ? "대상 · 일정 · 신청 안내  →" : "핵심 사실부터 맥락까지  →", x, y, 840, 50, { size: 30, weight: "semibold", color })
    : model.subtitle && text(model.subtitle, x, Math.min(y, 1098), 840, 72, { size: 30, min: 22, weight: "semibold", color, field: "cardCopy.cover.subtitle" });
  // A badge describes the source. We never invent a deadline, quote, statistic or a breaking-news claim.
  const tag = model.badge || (d.family === "recruitment" ? "모집 안내" : "뉴스 브리핑");
  const page = `01 / ${String(count).padStart(2, "0")}`;
  switch (d.layoutId ?? id) {
    case "f01":
      if (art) {
        await photo(0, 0, W, H);
        els.push(`<defs><linearGradient id="fry-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.bg}" stop-opacity=".52"/><stop offset=".45" stop-color="${d.bg}" stop-opacity=".28"/><stop offset=".78" stop-color="${d.bg}" stop-opacity=".95"/><stop offset="1" stop-color="${d.bg}"/></linearGradient></defs>`);
        rect(0,0,W,H,"url(#fry-shade)");
      } else {
        // Original vector motif, never passed off as a food photograph.
        for (let i=0;i<6;i++) els.push(`<rect x="${470+i*96}" y="${175+(i%3)*38}" width="59" height="350" rx="15" fill="${d.accent}" transform="rotate(19 ${500+i*96} 350)" opacity="${1-i*.07}"/>`);
      }
      c.header(model.brandLine, page); line(80,127,920,d.ink);
      pill("FRYDAY / FOOD & CULTURE",80,169);
      text("한 입에서 시작하는 이야기",80,579,850,54,{size:31,weight:"semibold",color:d.accent});
      headline();
      if (model.subtitle === undefined) text("알고 먹으면 더 재밌는 한 입  →",80,1100,900,54,{size:30,weight:"semibold"}); else cue(80, 1100);
      break;
    case "r01":
      c.header(model.brandLine, page); line(80, 127, 920, d.ink);
      pill(tag, 80, 169); headline();
      await photo(80, 597, 920, 448, 8); cue(); break;
    case "r02":
      c.header(model.brandLine, page); text("OPEN CALL", 80, 165, 920, 150, { size: 112, weight: "bold", color: d.accent });
      line(80, 330, 920, d.ink, 3); headline();
      rect(80, 955, 920, 190, d.accent, 6); text(tag, 120, 990, 840, 48, { size: 32, weight: "semibold", color: d.onAccent }); cue(120, 1074, d.onAccent); break;
    case "r03":
      c.header(model.brandLine, page); rect(60, 160, 960, 997, "#FFFDF7", 24);
      rect(60, 160, 960, 98, d.accent, 24); rect(60, 206, 960, 52, d.accent);
      text("YOUR NEXT JOURNEY", 100, 184, 840, 45, { size: 31, weight: "semibold", color: d.onAccent });
      headline(); await photo(668, 668, 304, 260, 4);
      text("작은 호기심,\n큰 가능성.", 108, 728, 500, 150, { size: 43, weight: "semibold" });
      els.push(`<path d="M60 975H1020" stroke="${d.accent}" stroke-width="2" stroke-dasharray="10 10"/><circle cx="60" cy="975" r="22" fill="${d.bg}"/><circle cx="1020" cy="975" r="22" fill="${d.bg}"/>`);
      text(tag, 108, 1012, 864, 48, { size: 30, weight: "semibold" }); cue(108, 1081); break;
    case "r04":
      c.grid(); rect(56, 142, 968, 1026, d.bg, 4); c.header(model.brandLine, page);
      text("FIELD NOTES / 모집", 92, 184, 880, 44, { size: 30, weight: "semibold", color: d.accent });
      headline(); await photo(92, 682, 604, 382, 4);
      text("배우고\n탐구하고\n발견하기", 742, 713, 230, 280, { size: 41, weight: "semibold" }); cue(92, 1101); break;
    case "r05":
      await photo(0, 0, W, H);
      els.push(`<defs><linearGradient id="orbit-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.bg}" stop-opacity=".65"/><stop offset=".23" stop-color="${d.bg}" stop-opacity=".10"/><stop offset=".47" stop-color="${d.bg}" stop-opacity=".18"/><stop offset=".64" stop-color="${d.bg}" stop-opacity=".86"/><stop offset="1" stop-color="${d.bg}" stop-opacity=".97"/></linearGradient></defs>`);
      rect(0, 0, W, H, "url(#orbit-shade)"); c.header(model.brandLine, page);
      pill(tag, 80, 166);
      headline(); cue(80, 1120, d.accent); break;
    case "r06":
      c.header(model.brandLine, page); pill(tag, 80, 166);
      await photo(250, 239, 750, 590, 12);
      rect(68, 652, 814, 438, "#FFFDF6", 3); rect(98, 631, 206, 36, "#D9A856", 0, 'opacity=".65"');
      headline(); cue(108, 1110); break;
    case "r07":
      rect(42, 42, 996, 130, d.bg); rect(62, 144, 956, 1028, "none", 0, `stroke="${d.accent}" stroke-width="2"`);
      rect(74, 156, 932, 1004, "none", 0, `stroke="${d.accent}" stroke-width="1"`); c.header(model.brandLine, page);
      text("AN INVITATION", 118, 218, 844, 60, { size: 40, weight: "semibold", align: "center" }); line(435, 316, 210, d.accent, 2);
      headline();
      text(tag, 124, 858, 832, 65, { size: 34, align: "center" });
      line(435, 984, 210, d.accent, 2);
      if (model.subtitle === undefined) text("다음 가능성으로의 초대", 124, 1054, 832, 55, { size: 33, align: "center" });
      else if (model.subtitle) text(model.subtitle, 124, 1018, 832, 123, { size: 33, min: 24, align: "center", field: "cardCopy.cover.subtitle" });
      break;
    case "r08":
      c.header(model.brandLine, page); rect(64, 164, 952, 610, d.accent, 28);
      text("NEXT / OPEN", 108, 208, 864, 60, { size: 36, weight: "semibold", color: d.onAccent });
      headline();
      await photo(64, 799, 465, 351, 24); rect(553, 799, 463, 351, "#F6FBD9", 24);
      text(tag, 591, 848, 383, 145, { size: 38, min: 30, weight: "semibold" });
      if (model.subtitle === undefined) text("다음 장에서\n자세히 알아보기 →", 591, 1040, 383, 85, { size: 29, weight: "semibold" });
      else if (model.subtitle) text(model.subtitle, 591, 1007, 383, 128, { size: 28, min: 22, weight: "semibold", field: "cardCopy.cover.subtitle" });
      break;
    case "r09":
      rect(0, 0, 38, H, d.accent); c.header(model.brandLine, page); pill(tag, 80, 170);
      headline(); await photo(240, 684, 760, 360, 8);
      line(126, 690, 3, d.accent, 355);
      [714, 864, 1014].forEach((y, i) => { rect(95, y - 22, 66, 66, d.accent, 33); text(String(i + 1).padStart(2, "0"), 106, y - 10, 46, 44, { size: 31, weight: "bold", color: d.onAccent }); }); cue(); break;
    case "r10":
      c.header(model.brandLine, page); line(80, 173, 70, d.accent, 5);
      text(tag, 80, 223, 920, 66, { size: 32, weight: "semibold", color: d.accent });
      headline(); await photo(660, 812, 340, 305, 0);
      if (model.subtitle === undefined) text("새로운 배움은\n작은 시작에서.", 80, 901, 510, 155, { size: 43, weight: "semibold" });
      else if (model.subtitle) text(model.subtitle, 80, 865, 510, 252, { size: 43, min: 26, weight: "semibold", field: "cardCopy.cover.subtitle" });
      break;
    case "n01":
      await photo(0, 0, W, 1170); rect(0, 0, W, 1170, d.overlay ?? "#070E19", 0, 'opacity=".65"');
      c.header(model.brandLine, page); rect(80, 164, 440, 70, d.accent); text("NEWS / BRIEF", 106, 178, 390, 48, { size: 34, weight: "bold", color: d.onAccent });
      headline(); cue(80, 1100, "#FFFFFF"); break;
    case "n02":
      c.header(model.brandLine, page); text("THE DAILY BRIEF", 80, 142, 920, 126, { size: 94, min: 80, weight: "bold", align: "center" });
      line(80, 293, 920, d.ink, 5); line(80, 307, 920, d.ink);
      headline(); await photo(80, 712, 920, 340);
      line(80, 1091, 920, d.ink); cue(80, 1124); break;
    case "n03":
      c.header(model.brandLine, page); await photo(0, 140, W, 560);
      pill("NEWS DISPATCH", 80, 733); headline();
      if (model.subtitle) text(model.subtitle, 80, 1110, 920, 60, { size: 28, min: 22, weight: "semibold", field: "cardCopy.cover.subtitle" });
      break;
    case "n04":
      c.header(model.brandLine, page); text("WHY IT", 80, 166, 920, 160, { size: 126, weight: "bold" });
      if (d.onSoft) rect(66, 292, 782, 157, d.soft);
      text("MATTERS", 80, 299, 920, 160, { size: 126, weight: "bold", color: d.onSoft ?? d.ink });
      line(80, 494, 920, d.ink, 5); headline();
      rect(80, 1046, 920, 110, d.accent, 2); cue(114, 1076, d.onAccent); break;
    case "n05":
      c.header(model.brandLine, page); await photo(508, 176, 492, 580, 4);
      text("SIGNAL\nDESK", 80, 178, 390, 206, { size: 76, weight: "bold", color: d.accent });
      line(80, 443, 348, d.accent, 2); text("정보를 읽고\n맥락을 잇다", 80, 490, 348, 155, { size: 39, weight: "semibold" });
      headline(); cue(80, 1122, d.accent); break;
    case "n06":
      c.header(model.brandLine, page); pill("NEWS TIMELINE", 80, 163);
      headline(); await photo(340, 693, 660, 373, 12);
      line(96, 715, 3, d.accent, 358);
      ["배경", "핵심", "다음"].forEach((v, i) => { els.push(`<circle cx="98" cy="${739 + 130 * i}" r="12" fill="${d.accent}"/>`); text(v, 135, 717 + 130 * i, 160, 62, { size: 37, weight: "semibold" }); }); cue(); break;
    case "n07":
      c.header(model.brandLine, page); text("한 문장으로 읽는 오늘", 80, 205, 920, 65, { size: 37, weight: "semibold", color: d.accent });
      line(80, 336, 920, d.accent, 2); headline();
      line(80, 966, 920, d.accent, 2); cue(80, 1067, d.accent); break;
    case "n08":
      c.header(model.brandLine, page); text("FACT", 64, 130, 952, 285, { size: 225, weight: "bold", color: d.accent });
      rect(80, 441, 920, 554, "#FFFFFF", 18); headline();
      line(120, 901, 80, d.accent, 7); text("확인된 사실 · 아직 남은 질문", 240, 880, 700, 75, { size: 32, weight: "semibold", color: d.accent }); cue(); break;
    case "n09":
      rect(540, 140, 540, 1030, "#DDE6ED"); c.header(model.brandLine, page);
      text("CONTEXT / 관점", 80, 193, 920, 64, { size: 34, weight: "semibold" });
      headline(); await photo(80, 786, 430, 270, 8);
      text("사실을 먼저.\n관점은 넓게.", 591, 807, 409, 190, { size: 48, weight: "semibold" }); cue(); break;
    case "n10":
      c.header(model.brandLine, page); els.push(`<circle cx="94" cy="218" r="12" fill="${d.accent}"/>`);
      text("NEWS UPDATE", 126, 195, 874, 54, { size: 35, weight: "semibold", color: d.accent });
      headline(); line(80, 1011, 920, d.ink); cue(80, 1085); break;
  }
  c.footer(model, artUsed ? credit : "");
  return jpeg(c.svg());
}

type BodyEntry = { block: CardModel["blocks"][number]; lines: string[]; labelLines: string[]; labelHeight: number; y: number; h: number; size: number };
/** Body geometry is also the overflow check used by the carousel paginator. */
export function layoutCollectionBody(model: CardModel, id: string, picture?: { data?: string; present: boolean }): string {
  const d = getDesign(id), c = canvas(d), { rect, line, text } = c;
  rect(0, 0, W, H, d.bg);
  if (d.body === "notes") c.grid();
  if (d.body === "framed") { rect(43, 143, 994, 1047, "none", 0, `stroke="${d.accent}" stroke-width="2"`); }
  c.header(model.brandLine, model.badge);
  const pageNo = /^\d{2}\s*\//.test(model.badge) ? model.badge.split("/")[0].trim() : "02";
  const titleX = d.body === "index" ? 230 : 80;
  if (d.body === "index") text(pageNo, 70, 171, 140, 150, { size: 96, weight: "bold", color: d.accent });
  if (d.body === "bands") { rect(0, 143, W, 263, d.accent); }
  const titleEnd = text(model.title, titleX, 184, 1000 - titleX, 200, { size: 72, min: model.subtitle === undefined ? 54 : 44, weight: "bold", color: d.body === "bands" ? d.onAccent : d.ink });
  let top = Math.max(422, titleEnd + 60);
  if (d.body !== "bands") line(titleX, top - 36, d.body === "plain" ? 920 : 92, d.accent, d.body === "plain" ? 2 : 6);
  if (picture?.present) {
    if (picture.data) c.els.push(`<image x="80" y="${top}" width="920" height="350" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${picture.data}"/>`);
    top += 390;
  }
  const blocks = model.blocks.filter(b => b.text.trim());
  const ledger = d.body === "ledger", timeline = d.body === "timeline", framed = d.body === "framed";
  const split = d.body === "split" && blocks.length === 2 && blocks.every(b => b.text.length < 150);
  const x = ledger ? 325 : timeline ? 166 : framed ? 121 : 80;
  const right = framed ? 959 : 1000;
  const boxed = ["panels", "spotlight", "split"].includes(d.body);
  const inset = boxed ? 30 : 0;
  const width = split ? 380 : right - x - inset * 2;
  const available = 1170 - top;
  let entries: BodyEntry[] | null = null;
  for (let size = split ? 46 : 54; size >= 40; size -= 2) {
    let y = top; const candidate: BodyEntry[] = [];
    for (const block of blocks) {
      const lines = wrapText(c.fonts.regular, block.text, size, width);
      const labelLines = block.label ? wrapText(c.fonts.semibold, block.label, ledger ? 28 : 26, ledger ? 205 : width) : [];
      const labelHeight = !ledger && labelLines.length ? 46 + (labelLines.length - 1) * 34 : 0;
      // The ledger caption occupies its own column, so a long edited caption
      // must contribute to the row height even when the body is only one line.
      const h = Math.max(lines.length * size * 1.42 + labelHeight + (boxed ? 55 : 0), ledger ? labelLines.length * 28 * 1.26 + 4 : 0);
      candidate.push({ block, lines, labelLines, labelHeight, y, h, size }); y += h + 42;
    }
    const total = split ? Math.max(...candidate.map(e => e.h), 0) : y - top - 42;
    if (total <= available) { entries = candidate; break; }
  }
  if (!entries) throw new CardOverflowError(blocks[0]?.field ?? "본문", "읽기 좋은 글자 크기를 유지하려면 다음 페이지가 필요합니다.");
  entries.forEach((e, i) => {
    const left = split ? 80 + i * 480 : x;
    const y = split ? top : e.y;
    const boxWidth = split ? 440 : right - x;
    const emphasis = d.body === "spotlight" && i === 0;
    const ink = emphasis ? d.onAccent : boxed ? d.onSoft ?? d.ink : d.ink;
    if (boxed) rect(left, y, boxWidth, e.h, emphasis ? d.accent : d.soft, d.body === "split" ? 4 : 16);
    if (timeline) {
      if (i < entries!.length - 1) rect(105, y + 35, 2, e.h + 42, d.accent);
      rect(80, y, 52, 52, d.accent, 26);
      text(String(i + 1).padStart(2, "0"), 89, y + 10, 40, 38, { size: 26, weight: "bold", color: d.onAccent });
    }
    if (ledger) {
      text(e.block.label ?? String(i + 1).padStart(2, "0"), 80, y + 4, 205, e.h - 4, { size: 28, weight: "semibold", color: d.accent, field: e.block.field.replace(/\.body$/, ".subtitle") });
      line(80, y + e.h + 21, 920, d.soft, 2);
    }
    const labelY = y + (boxed ? 25 : 0);
    if (e.block.label && !ledger) e.labelLines.forEach((label, index) => text(label, left + inset, labelY + index * 34, width, 37, { size: 26, weight: "semibold", color: ink, field: e.block.field.replace(/\.body$/, ".subtitle") }));
    const bodyY = labelY + e.labelHeight;
    e.lines.forEach((s, j) => text(s, left + inset, bodyY + j * e.size * 1.42, width, e.size * 1.45, { size: e.size, color: ink, field: e.block.field }));
    if (d.body === "notes" || d.body === "plain" || d.body === "index") line(left, y + e.h + 21, right - left, d.soft, 2);
  });
  c.footer(model);
  return c.svg();
}
export async function renderCollectionBody(model: CardModel, id: string, art?: Buffer) {
  const data = art ? (await sharp(art, { limitInputPixels: 40_000_000 }).rotate().resize(920, 350, { fit: "inside" }).png().toBuffer()).toString("base64") : undefined;
  return jpeg(layoutCollectionBody(model, id, { present: !!art, data }));
}
