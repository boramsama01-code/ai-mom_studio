import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { defaultPageDesigns } from "../shared/familyDialogue";
import { familyDialogueCardFixture, scientificFamilyCardFixture } from "../tests/fixtures/familyDialogueCard";
import { planCarousel, renderCarouselPages } from "../server/services/cardCarousel";
import { renderFamilyDialogueCard } from "../server/services/familyDialogueCard";
import type { CardStyle } from "../server/services/card";

/** Reproducible local draft examples. No provider, database or publication calls. */
const directory = path.resolve("test-results/family-dialogue"), style: CardStyle = { layout: "minimal", collection: "n03" };
await fs.mkdir(directory, { recursive: true });
const copy = familyDialogueCardFixture(), pageDesigns = defaultPageDesigns();
// An existing original fictional illustration demonstrates the photo treatment.
// 88001 is an isolated in-memory ID, never a production media reference.
pageDesigns.cover.background = { ...pageDesigns.cover.background, kind: "image", assetId: 88001, focalX: 55, brightness: 72, overlay: 45 };
const pageImages = Object.assign(new Map([[88001, await fs.readFile(path.resolve("assets/card-art/lab.jpg"))]]), { credits: new Map([[88001, "이미지: AI 생성 · 연출 이미지"]]) });
const plan = planCarousel({ kind: "current_dialogue", payload: { cardCopy: copy, pageDesigns }, channelName: "ALLligodang", channelSlug: "news", accent: "#285E54", sourceOrg: "제공된 인터뷰 기사 · 수동 편집 제안", checkedDate: "2026-11-04" }, style);
const pages = await renderCarouselPages(plan, style, null, "", pageImages);
const thumbnails = [];
for (const [index, page] of pages.entries()) {
  await fs.writeFile(path.join(directory, `${String(index + 1).padStart(2, "0")}-${copy.pages[index].id}.jpg`), page.bytes);
  const input = await sharp(page.bytes).resize(270, 338).png().toBuffer();
  thumbnails.push({ input, left: 14 + index % 4 * 284, top: 14 + Math.floor(index / 4) * 352 });
}
const sheet = await sharp({ create: { width: 1150, height: 718, channels: 3, background: "#D8DDDA" } }).composite(thumbnails).png().toBuffer();
await fs.writeFile(path.join(directory, "contact-sheet.png"), sheet);
await fs.mkdir(path.resolve("docs/assets"), { recursive: true });
await fs.writeFile(path.resolve("docs/assets/family-dialogue-v2-preview.png"), sheet);
const scientific = scientificFamilyCardFixture().pages[5];
await fs.writeFile(path.join(directory, "scientific-concept-layout.jpg"), await renderFamilyDialogueCard(scientific, pageDesigns.concept, { brandName: "ALLligodang", accent: "#285E54", sourceCredit: "레이아웃 검증용 가상 예시 · 게시용 아님" }, style));
await fs.writeFile(path.join(directory, "metadata.json"), JSON.stringify({ kind: "manual-editorial-proposal", productionChanged: false, paidAiCalls: 0, rendererProvider: "builtin", note: "가이드 v1.1의 v2 필드를 확인하는 수동 편집 제안. Canva 최종 내보내기가 아닙니다.", copy, pageDesigns }, null, 2));
console.log(JSON.stringify({ pages: pages.length, output: directory, committedPreview: "docs/assets/family-dialogue-v2-preview.png", paidAiCalls: 0 }));
