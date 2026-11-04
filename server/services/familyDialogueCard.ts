import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Font } from "opentype.js";
import sharp, { type Sharp } from "sharp";
import { Resvg } from "@resvg/resvg-js";
import type { CardCopyV2, FamilyPage, PageDesign } from "../../shared/familyDialogue";
import { FAMILY_COLORS as C, FAMILY_PAGE_COLORS } from "../../shared/familyDialogueTheme";
import { familyDisplayDescriptors, resolveFamilyDisplay, type FamilyDisplayContext } from "../../shared/familyDisplay";
import { CardOverflowError, loadFonts, wrapText, type CardStyle } from "./card";

const W = 1080, H = 1350, SAFE = 84, INNER = W - SAFE * 2;
export const APPROVED_PARENT_LOGO_ID = "brand:space-penguin-company:20261101";
const APPROVED_PARENT_LOGO_HASH = "a66350333b86e9e0c14981154e67e26218497ecc2942dc4b826f87a48fff55ad";
type Box = { x: number; y: number; width: number; height: number };
type Weight = "regular" | "semibold" | "bold";
export type FamilyTextRun = Box & { field: string; text: string; lines: string[]; size: number; lineHeight: number; align: "center" | "left" };
type TextOptions = { field: string; size: number; min?: number; weight?: Weight; color?: string; leading?: number; maxLines?: number; vertical?: "top" | "middle"; align?: "center" | "left" };
export type FamilyCardContext = { brandName: string; accent: string; sourceCredit?: string };
type RenderOptions = { imageDataUrl?: string; imageCredit?: string; parentLogoDataUrl?: string };

const safeHex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function luminance(color: string) {
  const v = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
}
function contrast(a: string, b: string) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); }
function readable(background: string, preferred: string) {
  if (contrast(background, preferred) >= 4.5) return preferred;
  return contrast(background, "#FFFFFF") > contrast(background, "#172B34") ? "#FFFFFF" : "#172B34";
}
function fitText(font: Font, value: string, box: Box, opts: TextOptions) {
  const min = opts.min ?? opts.size, leading = opts.leading ?? 1.34;
  let size = opts.size, lines = wrapText(font, value, size, box.width);
  while (size > min && (lines.length * size * leading > box.height || (opts.maxLines !== undefined && lines.length > opts.maxLines))) {
    size = Math.max(min, size - 2); lines = wrapText(font, value, size, box.width);
  }
  if (lines.length * size * leading > box.height || (opts.maxLines !== undefined && lines.length > opts.maxLines)) {
    throw new CardOverflowError(opts.field, "이 칸의 문구가 카드 영역을 넘습니다. 문구를 줄이거나 배치를 바꿔 주세요. 입력한 내용은 자르지 않았습니다.");
  }
  return { ...box, lines, size, lineHeight: size * leading };
}

/** Local draft renderer only. Canva exports have their own immutable final assets. */
export function layoutFamilyDialogueCard(page: FamilyPage, design: PageDesign, context: FamilyCardContext, style: CardStyle, options: RenderOptions = {}) {
  const fonts = loadFonts(), elements: string[] = [], textRuns: FamilyTextRun[] = [];
  const display = resolveFamilyDisplay(page, { ...context, imageCredit: options.imageCredit });
  const displayField = (key: string) => `cardCopy.pages.${page.page - 1}.displayOverrides.${key}`;
  const bg = design.background.kind === "none" ? C.white : safeHex(design.background.color, FAMILY_PAGE_COLORS[page.id]);
  const ink = readable(bg, C.paper), accent = readable(bg, C.butter), muted = readable(bg, C.muted);
  const panel = C.panel, panelInk = C.paper;
  const field = (key: string) => `cardCopy.pages.${page.page - 1}.fields.${key}`;
  const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 0, opacity = 1) => elements.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" opacity="${opacity}"/>`);
  const line = (x: number, y: number, width: number, color = ink, opacity = .23, stroke = 1) => elements.push(`<path d="M${x} ${y}h${width}" fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}"/>`);
  function text(value: string, box: Box, opts: TextOptions) {
    if (!value) return;
    const font = fonts[opts.weight ?? "regular"], run = fitText(font, value, box, opts), align = opts.align ?? design.alignment;
    const offset = opts.vertical === "top" ? 0 : Math.max(0, (box.height - run.lines.length * run.lineHeight) / 2);
    run.lines.forEach((value, i) => {
      const x = align === "center" ? box.x + (box.width - font.getAdvanceWidth(value, run.size, { kerning: true })) / 2 : box.x;
      const y = box.y + offset + run.size * .94 + i * run.lineHeight;
      elements.push(`<path d="${font.getPath(value, x, y, run.size).toPathData(2)}" fill="${opts.color ?? ink}"/>`);
    });
    textRuns.push({ ...run, field: opts.field, text: value, align });
  }
  const centered = (value: string, y: number, height: number, opts: TextOptions, width = 858) => text(value, { x: (W - width) / 2, y, width, height }, opts);
  const tag = (value: string, y: number, opts: Partial<TextOptions> = {}) => centered(value, y, 48, { field: displayField("kicker"), size: 27, weight: "semibold", maxLines: 1, color: ink, align: "center", ...opts });
  const title = (value: string, y = 268, height = 150) => centered(value, y, height, { field: field("title"), size: 62, min: 42, weight: "bold", maxLines: 3, leading: 1.23 });
  function panelText(label: string, body: string, y: number, height: number, prefix: string, options: { x?: number; width?: number; bodySize?: number; labelSize?: number; fill?: string } = {}) {
    const x = options.x ?? 91, width = options.width ?? 898;
    const fill = options.fill ?? C.panel, foreground = readable(fill, C.paper);
    rect(x, y, width, height, fill, 25);
    text(label, { x: x + 38, y: y + 25, width: width - 76, height: 67 }, { field: field(`${prefix}.label`), size: options.labelSize ?? 32, min: 26, weight: "bold", maxLines: 2, color: C.butter });
    line(x + 60, y + 109, width - 120, C.muted, .25);
    text(body, { x: x + 42, y: y + 132, width: width - 84, height: height - 157 }, { field: field(`${prefix}.body`), size: options.bodySize ?? 48, min: 32, maxLines: 8, leading: 1.36, color: foreground });
  }

  rect(0, 0, W, H, bg);
  if (options.imageDataUrl) {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(options.imageDataUrl)) throw new Error("배경은 서버에서 읽은 JPEG 데이터만 사용할 수 있습니다.");
    elements.push(`<image width="${W}" height="${H}" href="${options.imageDataUrl}"/>`);
    rect(0, 0, W, H, bg, 0, design.background.overlay / 100);
    if (page.type === "cover") {
      // Full bleed photography remains visible. No opaque headline plate or
      // image frame is added; this gradient is shared by preview and export.
      elements.push(`<defs><linearGradient id="reading-shade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.charcoal}" stop-opacity=".50"/><stop offset=".45" stop-color="${C.charcoal}" stop-opacity=".35"/><stop offset="1" stop-color="${C.charcoal}" stop-opacity=".75"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#reading-shade)"/>`);
    } else {
      rect(58, 193, 964, 991, bg, 12, .9);
      rect(0, 0, W, 164, bg, 0, .94); rect(0, 1210, W, 140, bg, 0, .94);
    }
  }
  text(display.brandName, { x: SAFE, y: 63, width: 715, height: 62 }, { field: displayField("brandName"), size: 35, min: 22, weight: "bold", maxLines: 2, align: "left" });
  text(display.pageNumber, { x: 872, y: 68, width: 124, height: 42 }, { field: displayField("pageNumber"), size: 24, align: "center", maxLines: 1 });
  line(SAFE, 144, INNER);

  if (page.type === "cover") {
    const f = page.fields;
    tag(display.kicker, 229, { color: accent, weight: "semibold" }); line(479, 322, 122, accent, .8, 2);
    centered(f.headline, 397, 442, { field: field("headline"), size: 116, min: 62, weight: "bold", maxLines: 3, leading: 1.2, color: accent }, 864);
    centered(f.subtitle, 895, 174, { field: field("subtitle"), size: 38, min: 30, maxLines: 4, leading: 1.42, color: ink }, 804);
  } else if (page.type === "news_summary") {
    const f = page.fields; tag(display.kicker, 207); title(f.title);
    const hasCaveat = !!f.caveat, start = 453, available = hasCaveat ? 537 : 660, gap = 22, height = (available - gap * (f.facts.length - 1)) / f.facts.length;
    f.facts.forEach((fact, index) => {
      const y = start + index * (height + gap);
      line(90, y + height + 8, 900, muted, .24);
      text(display[("factIndex" + (index + 1)) as "factIndex1" | "factIndex2" | "factIndex3"], { x: 111, y: y + 22, width: 62, height: 41 }, { field: displayField("factIndex" + (index + 1)), size: 26, color: accent, weight: "bold", align: "center", maxLines: 1 });
      text(fact, { x: 190, y: y + 21, width: 751, height: height - 42 }, { field: field(`facts.${index}`), size: 47, min: 34, weight: "semibold", maxLines: 4, color: ink });
    });
    if (f.caveat) centered(f.caveat, 1026, 115, { field: field("caveat"), size: 34, min: 28, maxLines: 4, leading: 1.35, color: muted }, 820);
  } else if (page.type === "implication") {
    const f = page.fields; tag(display.kicker, 211); title(f.title, 286, 142); line(479, 477, 122, accent, .8, 2);
    centered(f.takeaway, 539, 478, { field: field("takeaway"), size: 81, min: 46, weight: "bold", maxLines: 7, leading: 1.3, color: accent }, 860);
  } else if (page.type === "discussion") {
    const f = page.fields; tag(display.kicker, 211); title(f.title, 284, 140);
    if (f.scenario) {
      line(124, 456, 832, muted, .25);
      centered(f.scenario, 482, 152, { field: field("scenario"), size: 39, min: 30, maxLines: 4, color: muted }, 802);
    }
    centered(f.question, f.scenario ? 718 : 499, f.scenario ? 379 : 535, { field: field("question"), size: 79, min: 44, weight: "bold", maxLines: 7, leading: 1.31, color: ink }, 836);
  } else if (page.type === "perspectives") {
    const f = page.fields; tag(display.kicker, 211); title(f.title);
    if (page.layout === "columns") {
      panelText(f.viewA.label, f.viewA.body, 487, 607, "viewA", { x: 76, width: 447, bodySize: 44 });
      panelText(f.viewB.label, f.viewB.body, 487, 607, "viewB", { x: 557, width: 447, bodySize: 44 });
    } else {
      panelText(f.viewA.label, f.viewA.body, 458, 300, "viewA");
      panelText(f.viewB.label, f.viewB.body, 796, 300, "viewB");
    }
  } else if (page.type === "concept") {
    const f = page.fields; tag(display.kicker, 209); title(f.title, 267, 124);
    centered(f.concept, 397, 92, { field: field("concept"), size: 49, min: 32, weight: "bold", maxLines: 2, color: accent }, 694);
    if (f.mode === "value_definition") {
      for (const [index, value] of [f.definitionA, f.definitionB].entries()) {
        const y = 503 + index * 169; rect(92, y, 896, 146, panel, 21);
        text(index === 0 ? display.definitionIndexA : display.definitionIndexB, { x: 115, y: y + 41, width: 66, height: 58 }, { field: displayField(index === 0 ? "definitionIndexA" : "definitionIndexB"), size: 31, color: C.butter, weight: "bold", align: "center", maxLines: 1 });
        text(value, { x: 200, y: y + 22, width: 742, height: 102 }, { field: field(index === 0 ? "definitionA" : "definitionB"), size: 40, min: 30, maxLines: 3, color: panelInk });
      }
      centered(f.boundaryCase, 866, 137, { field: field("boundaryCase"), size: 37, min: 29, maxLines: 4 });
      line(465, 1028, 150, accent, 1, 3);
      centered(f.fillIn, 1052, 115, { field: field("fillIn"), size: 37, min: 29, maxLines: 3, weight: "semibold" });
    } else {
      rect(92, 512, 896, 267, panel, 12);
      centered(f.acceptedDefinition, 545, 201, { field: field("acceptedDefinition"), size: 47, min: 34, maxLines: 5, weight: "semibold", color: panelInk }, 810);
      centered(f.exampleOrNonExample, 830, 174, { field: field("exampleOrNonExample"), size: 40, min: 30, maxLines: 4 });
      line(465, 1028, 150, accent, 1, 3);
      centered(f.fillIn, 1052, 115, { field: field("fillIn"), size: 37, min: 29, maxLines: 3, weight: "semibold" });
    }
  } else if (page.type === "activity") {
    const f = page.fields; tag(display.kicker, 211); title(f.title);
    centered(display.duration, 420, 28, { field: displayField("duration"), size: 20, min: 18, maxLines: 1, color: muted });
    const activity = (value: typeof f.homeActivity, y: number, height: number, prefix: string, size: number) => {
      rect(91, y, 898, height, panel, 12);
      centered(value.label, y + 25, 68, { field: field(`${prefix}.label`), size: 33, min: 27, weight: "bold", maxLines: 2, color: C.butter }, 790);
      line(152, y + 112, 776, C.muted, .25);
      centered(value.action, y + 138, height - 156, { field: field(`${prefix}.action`), size, min: 33, maxLines: 8, color: panelInk, leading: 1.36 }, 805);
    };
    if (f.optionalActivity) {
      activity(f.homeActivity, 451, 299, "homeActivity", 43);
      activity(f.optionalActivity, 792, 313, "optionalActivity", 43);
    } else activity(f.homeActivity, 484, 583, "homeActivity", 60);
    centered(display.activityHelp, 1120, 62, { field: displayField("activityHelp"), size: 26, min: 20, maxLines: 2, color: muted });
  } else {
    const f = page.fields;
    if (options.parentLogoDataUrl) {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(options.parentLogoDataUrl)) throw new Error("승인된 부모 브랜드 자산만 사용할 수 있습니다.");
      elements.push(`<image x="380" y="193" width="320" height="240" preserveAspectRatio="xMidYMid meet" href="${options.parentLogoDataUrl}"/>`);
    }
    centered(f.brandName, 456, 125, { field: field("brandName"), size: 82, min: 42, weight: "bold", maxLines: 2 }, 900);
    centered(f.parentBrand, 587, 60, { field: field("parentBrand"), size: 31, min: 24, maxLines: 2 });
    line(466, 695, 148, accent, .8, 2);
    centered(f.brandLine, 735, 157, { field: field("brandLine"), size: 48, min: 32, weight: "semibold", maxLines: 4 });
    centered(f.cta, 969, 88, { field: field("cta"), size: 35, min: 28, color: accent, weight: "semibold", maxLines: 2 }, 748);
    centered(f.handle, 1116, 49, { field: field("handle"), size: 28, min: 21, maxLines: 1, color: muted });
  }

  if (display.imageCredit) centered(display.imageCredit, 1191, 30, { field: displayField("imageCredit"), size: 20, min: 17, maxLines: 1, align: "center" });
  line(SAFE, 1232, INNER);
  if (display.sourceCredit && page.type !== "outro") centered(display.sourceCredit, 1252, 65, { field: displayField("sourceCredit"), size: 22, min: 17, maxLines: 2, align: "center" }, 912);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${elements.join("")}</svg>`, textRuns };
}

let parentLogo: string | undefined;
function approvedParentLogo(page: FamilyPage): string | undefined {
  if (page.type !== "outro" || !page.fields.logoAssetId) return undefined;
  if (page.fields.logoAssetId !== APPROVED_PARENT_LOGO_ID) throw new Error("승인 목록에 없는 브랜드 자산입니다. 원고는 유지했습니다.");
  if (!parentLogo) {
    const bytes = fs.readFileSync(path.resolve(process.cwd(), "assets/branding/space-penguin-company.png"));
    if (createHash("sha256").update(bytes).digest("hex") !== APPROVED_PARENT_LOGO_HASH) throw new Error("승인된 브랜드 이미지가 변경됐습니다. 이미지 생성 전에 자산을 확인해 주세요.");
    parentLogo = `data:image/png;base64,${bytes.toString("base64")}`;
  }
  return parentLogo;
}

export function checkFamilyDialogueCard(page: FamilyPage, design: PageDesign, context: FamilyCardContext, style: CardStyle) {
  return layoutFamilyDialogueCard(page, design, context, style).textRuns;
}

/** Crop around the chosen focal point; contain preserves the complete image. */
export async function prepareFamilyPageImage(bytes: Buffer, design: PageDesign): Promise<Buffer> {
  const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
  const normalized = await source.toBuffer(), meta = await sharp(normalized).metadata();
  if (!meta.width || !meta.height) throw new Error("배경 이미지 크기를 확인할 수 없습니다.");
  const bg = safeHex(design.background.color, C.charcoal), settings = design.background;
  let output: Sharp;
  if (settings.fit === "contain") output = sharp(normalized).resize(W, H, { fit: "contain", background: bg });
  else {
    const scale = Math.max(W / meta.width, H / meta.height), width = Math.max(W, Math.round(meta.width * scale)), height = Math.max(H, Math.round(meta.height * scale));
    const left = Math.round((width - W) * settings.focalX / 100), top = Math.round((height - H) * settings.focalY / 100);
    output = sharp(normalized).resize(width, height, { fit: "fill" }).extract({ left, top, width: W, height: H });
  }
  return output.modulate({ brightness: settings.brightness / 100 }).flatten({ background: bg }).toColorspace("srgb").jpeg({ quality: 88 }).toBuffer();
}

export async function renderFamilyDialogueCard(page: FamilyPage, design: PageDesign, context: FamilyCardContext, style: CardStyle, image: Buffer | null = null, imageCredit = "") {
  const data = image ? await prepareFamilyPageImage(image, design) : null;
  const { svg } = layoutFamilyDialogueCard(page, design, context, style, {
    imageDataUrl: data ? `data:image/jpeg;base64,${data.toString("base64")}` : undefined,
    imageCredit, parentLogoDataUrl: approvedParentLogo(page),
  });
  return sharp(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()).flatten({ background: "#FFFFFF" }).toColorspace("srgb").removeAlpha().jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

export function familyPageTitle(page: FamilyPage): string {
  if (page.type === "cover") return page.fields.headline;
  if (page.type === "outro") return page.fields.brandName;
  return page.fields.title;
}

/** Only visible text, never internal IDs, is offered to alt-text tooling. */
export function familyPageText(page: FamilyPage, context: FamilyDisplayContext = {}): string[] {
  const values: string[] = [];
  function visit(value: unknown, key = "") {
    if (["mode", "resourceId", "logoAssetId"].includes(key)) return;
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(v => visit(v));
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => visit(v, k));
  }
  visit(page.fields);
  const display = resolveFamilyDisplay(page, context);
  values.push(...familyDisplayDescriptors(page).map(descriptor => display[descriptor.key]).filter(Boolean));
  return values;
}

export const familyBrandName = (copy: CardCopyV2, fallback: string) => {
  const outro = copy.pages.find(page => page.type === "outro");
  return outro?.type === "outro" ? outro.fields.brandName : fallback;
};
