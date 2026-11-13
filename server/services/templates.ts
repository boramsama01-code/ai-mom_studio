/**
 * 완료된 37개 카드 세트와 내 배경. 미리보기는 저장된 원고와 분리된다.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from 'sharp';
import { and, eq, isNull, or } from "drizzle-orm";
import type { DB } from "../db";
import { cardTemplates, channels, type Channel } from "../../shared/schema";
import { BUILTIN_LAYOUTS, renderCardJpeg, type CardLayout, type CardStyle } from "./card";
import { buildCardModel } from "./cardModel";
import { cardDesign } from "../../shared/cardDesigns";
import { renderCollectionPreview } from "./cardDesignSamples";
import { readingProfileForTemplateKey, readingProfileDesigns, type ReadingCardProfile } from "../../shared/readingCardProfiles";
import { highScoopTemplateCatalogOptions, templateCatalogOptions, type TemplateCatalogItem } from "../../shared/templateCatalog";
import { highScoopTemplateForKey, isHighScoopChannel } from '../../shared/highscoopTemplates';
import { defaultPageDesigns } from "../../shared/familyDialogue";
import cardnews14Layout from "../../shared/cardnews14Layout.json";
import { layoutReadingProfilePage } from "./readingCard";
import { prepareReadingArtwork } from "./readingCardImages";
import { rasterizeReadingSvg } from "./readingCardRaster";

export class TemplateNotFound extends Error {}
export class TemplatePreviewPageError extends Error {}

export async function resolveStyle(db: DB, key: string, channelId: number): Promise<CardStyle> {
  const highScoop=highScoopTemplateForKey(key);
  if(highScoop)return {layout:'magazine',highscoopTemplateKey:highScoop.key};
  // Reading profiles render from their versioned 8-page contract. Their keys
  // are valid for saved V2 copies without pretending to be Canva registrations.
  if (readingProfileForTemplateKey(key)) return { layout: "minimal" };
  if (key.startsWith("set:")) {
    const id = key.slice(4);
    if (!cardDesign(id)) throw new TemplateNotFound(`알 수 없는 템플릿: ${key}`);
    return { layout: "minimal", collection: id };
  }
  if (key.startsWith("builtin:")) {
    const layout = key.slice(8) as CardLayout;
    if (!BUILTIN_LAYOUTS.some((b) => b.key === layout)) throw new TemplateNotFound(`알 수 없는 템플릿: ${key}`);
    return { layout };
  }
  if (key.startsWith("custom:")) {
    const id = Number(key.slice(7));
    const [t] = await db
      .select()
      .from(cardTemplates)
      .where(and(eq(cardTemplates.id, id), isNull(cardTemplates.deletedAt), or(isNull(cardTemplates.channelId), eq(cardTemplates.channelId, channelId))));
    if (!t) throw new TemplateNotFound("템플릿을 찾을 수 없습니다(삭제되었거나 다른 채널 전용).");
    return { layout: (t.layout as CardLayout) === "header" ? "classic" : (t.layout as CardLayout), tone: t.textTone as "dark" | "light", overlay: t.overlay, background: t.background };
  }
  throw new TemplateNotFound(`알 수 없는 템플릿: ${key}`);
}

export async function listTemplates(db: DB, channelId: number): Promise<TemplateCatalogItem[]> {
  const [channel]=await db.select({slug:channels.slug,name:channels.name}).from(channels).where(eq(channels.id,channelId));
  // Old keys continue to resolve saved work, while new HighScoop choices use only
  // the six current category masters. Other brands retain their own catalogue.
  if(channel&&isHighScoopChannel(channel))return highScoopTemplateCatalogOptions();
  const customs = await db
    .select({ id: cardTemplates.id, name: cardTemplates.name, layout: cardTemplates.layout, textTone: cardTemplates.textTone, overlay: cardTemplates.overlay, channelId: cardTemplates.channelId, createdAt: cardTemplates.createdAt })
    .from(cardTemplates)
    .where(and(isNull(cardTemplates.deletedAt), or(isNull(cardTemplates.channelId), eq(cardTemplates.channelId, channelId))));
  return [
    ...templateCatalogOptions(),
    ...customs.map((c) => ({ key: `custom:${c.id}`, templateKey: `custom:${c.id}`, name: c.name, description: `내 배경 · ${c.textTone === "light" ? "밝은 글자" : "어두운 글자"}${c.overlay ? ` · 막 ${c.overlay}%` : ""}`, kind: "custom" as const, id: c.id, layout: c.layout, textTone: c.textTone, overlay: c.overlay, allChannels: c.channelId === null,
      format: "standard" as const, cardCopyVersion: 1 as const, pageCount: 1, previewPageCount: 1, pageCountMode: "variable" as const })),
  ];
}

const SAMPLE: Record<string, Record<string, unknown>> = {
  notice: {
    title: "OO과학고 2027학년도 신입생 입학설명회",
    category: "영재학교·과학고 입시",
    audience: "중학교 3학년 학생과 학부모",
    schedules: [
      { kind: "event", label: "입학설명회", start: { date: "2026-10-10", time: "14:00" } },
      { kind: "apply", label: "원서접수", start: { date: "2026-10-20" }, end: { date: "2026-10-24" } },
    ],
    one_line_summary: "설명회는 사전 예약제이며 원서는 10월 20일부터 받습니다.",
  },
  science_dialogue: {
    key_question: "도시의 나무는 어디에 먼저 심어야 할까?",
    background: ["나무 그늘은 한여름 땅의 온도를 낮춥니다.", "도시에는 유난히 뜨거운 곳이 있습니다.", "나무마다 필요한 공간이 다릅니다."],
    discussion_questions: ["우리 동네에서 가장 더운 곳은 어디일까?"],
  },
  current_dialogue: {
    title: "학교의 스마트폰 사용 규칙, 어떻게 정할까?",
    summary: "여러 학교가 수업 중 스마트폰 사용 규칙을 새로 정하고 있습니다. 규칙을 정하는 방식과 이유가 학교마다 다릅니다.",
    discussion_questions: ["규칙을 정할 때 누구의 의견을 들어야 할까?"],
  },
};

type SourcePreviewPage = { elements: Array<{ kind: string; field?: string; copy?: string; asset?: string }> };
const sourceLayouts = new Map<string, { pages: SourcePreviewPage[] }>();
const sourceImages = new Map<string, Buffer>();
const legacyPreviewSource: Record<string, string> = { "reading-ink-lime-v1": "ink-lime", "reading-cobalt-paper-v1": "cobalt-paper" };

function verifiedPreviewAsset(filename: string, sha256: string): Buffer {
  const hit = sourceImages.get(filename);
  if (hit) return hit;
  const bytes = fs.readFileSync(path.resolve(process.cwd(), filename));
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("디자인 예시 이미지의 원본을 확인해 주세요.");
  sourceImages.set(filename, bytes);
  return bytes;
}

/** Only versioned example copy and supplied example images enter this path.
 * No item, revision, generated image or Canva operation is read or written. */
export function readingPreviewSample(profile: ReadingCardProfile, page: number) {
  const source = cardnews14Layout.styles.find(style => style.id === (profile.sourceStyleId ?? legacyPreviewSource[profile.id]));
  if (!source) throw new TemplateNotFound("이 카드 세트의 미리보기 원본이 없습니다.");
  let layout = sourceLayouts.get(source.id);
  if (!layout) {
    const bytes = fs.readFileSync(path.resolve(process.cwd(), source.sourceLayoutPath));
    if (createHash("sha256").update(bytes).digest("hex") !== source.sourceLayoutSha256) throw new Error("디자인 예시 레이아웃의 원본을 확인해 주세요.");
    layout = JSON.parse(bytes.toString("utf8")) as { pages: SourcePreviewPage[] };
    sourceLayouts.set(source.id, layout);
  }
  const sourcePage = layout.pages[page];
  if (!sourcePage) throw new TemplatePreviewPageError("미리보기 페이지를 찾을 수 없습니다.");
  const values = Object.fromEntries(sourcePage.elements.filter(element => element.kind === "text" && element.field).map(element => [element.field!, element.copy ?? ""]));
  return { source, sourcePage, values };
}

async function renderReadingPreview(profile: ReadingCardProfile, page: number): Promise<Buffer> {
  // Admission happens before image decoding and font path construction, just
  // as it does for actual eight-page exports on memory-limited workers.
  return rasterizeReadingSvg(async () => {
    const { source, sourcePage, values } = readingPreviewSample(profile, page);
    const layout = profile.pages[page];
    const designs = readingProfileDesigns(profile, defaultPageDesigns());
    const images = new Map<string, string>();
    let profileDataUrl: string | undefined, imageDataUrl: string | undefined;
    for (const slot of layout.imageBoxes) {
      if (slot.kind === "profile") {
        const bytes = verifiedPreviewAsset(profile.profileImagePath, profile.profileImageSha256);
        profileDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
        images.set(slot.field, profileDataUrl);
        continue;
      }
      const assetKey = sourcePage.elements.find(element => element.kind === "image" && element.field === slot.field)?.asset;
      const asset = source.sourceAssets.find(asset => asset.key === assetKey);
      if (!asset) throw new Error("이 카드의 디자인 예시 사진을 찾을 수 없습니다.");
      const photo = verifiedPreviewAsset(`assets/cardnews14/${asset.path}`, asset.sha256);
      const bytes = await prepareReadingArtwork(photo, designs[slot.pageId], slot, layout.background);
      const data = `data:image/png;base64,${bytes.toString("base64")}`;
      images.set(slot.field, data);
      imageDataUrl ??= data;
    }
    return layoutReadingProfilePage(profile, page + 1, values, { images, imageDataUrl, profileDataUrl }).svg;
  });
}

/** 미리보기(예시 문구) — 페이지별 캐시, 같은 이미지의 동시 요청 합치기 */
const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
export async function renderPreview(db: DB, key: string, channel: Channel, page = 0): Promise<Buffer> {
  const kit=highScoopTemplateForKey(key);
  if(kit){
    if(!Number.isInteger(page)||page<0||page>=kit.pageCount)throw new TemplatePreviewPageError(`이 템플릿의 미리보기는 ${kit.pageCount}장입니다.`);
    const slug=kit.key.slice('highscoop:'.length),file=path.resolve(process.cwd(),`client/public/highscoop/current/${slug}-page-${page+1}.webp`);
    if(!fs.existsSync(file))throw new TemplateNotFound('최신 카테고리 마스터의 미리보기를 준비 중입니다.');
    return sharp(fs.readFileSync(file)).jpeg({quality:88}).toBuffer();
  }
  const ck = `${key}|${page}|${channel.id}|${channel.accentColor}|${channel.name}|${channel.contentType}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const inflight = pending.get(ck);
  if (inflight) return inflight;
  const work = (async () => {
    const style = await resolveStyle(db, key, channel.id);
    const profile = readingProfileForTemplateKey(key);
    const pageCount = profile ? profile.pages.length : style.collection ? 5 : 1;
    if (!Number.isInteger(page) || page < 0 || page >= pageCount) throw new TemplatePreviewPageError(`이 템플릿의 미리보기는 ${pageCount}장입니다.`);
    let jpeg: Buffer;
    if (profile) jpeg = await renderReadingPreview(profile, page);
    else if (style.collection) jpeg = await renderCollectionPreview(style.collection, page, channel.name, channel.slug);
    else {
      const model = buildCardModel({ kind: channel.contentType, payload: SAMPLE[channel.contentType] ?? SAMPLE.notice, channelName: channel.name, channelSlug: channel.slug, accent: channel.accentColor, sourceOrg: "예시 기관", checkedDate: "2026-09-29" });
      jpeg = (await renderCardJpeg(model, style)).jpeg;
    }
    if (cache.size >= 60) cache.delete(cache.keys().next().value!);
    cache.set(ck, jpeg);
    return jpeg;
  })();
  pending.set(ck, work);
  try { return await work; } finally { pending.delete(ck); }
}

export function clearPreviewCache() {
  cache.clear();
}

