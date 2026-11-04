/** Reproduce the manually written Studio 28 review proposal. No DB/AI/API calls.
 * Run: npx tsx scripts/render-news-editorial.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { aiDiscussionCardCopySchema } from "../shared/cardCopy";
import { planCarousel, renderCarouselPages } from "../server/services/cardCarousel";
import { studio28EditorialProposal } from "../tests/fixtures/studio28EditorialProposal";

const outputDir = path.resolve("test-results/editorial-cards");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "studio-28-proposal.json"), JSON.stringify({ note: "원문을 검토한 수동 편집 제안. 유료 AI 출력이나 운영 콘텐츠 변경이 아님.", copy: studio28EditorialProposal() }, null, 2));
for (const collection of ["n03", "n04"]) {
  const copy = studio28EditorialProposal(`set:${collection}`); aiDiscussionCardCopySchema.parse(copy);
  const style = { layout: "minimal" as const, collection };
  const plan = planCarousel({ kind: "current_dialogue", payload: { title: "빌 게이츠의 AI 전망", summary: "인터뷰 발언과 전망을 구분하는 수동 편집 제안.", cardCopy: copy }, channelName: "Alligodang", channelSlug: "news", accent: "#32756b", sourceOrg: "빌 게이츠 인터뷰를 전한 원문", checkedDate: "2026-11-04" }, style);
  const pages = await renderCarouselPages(plan, style, null, "");
  const thumbnails = [];
  for (const [index, page] of pages.entries()) {
    await writeFile(path.join(outputDir, `studio-28-${collection}-${index + 1}.jpg`), page.bytes);
    thumbnails.push({ input: await sharp(page.bytes).resize(340, 425).png().toBuffer(), left: 14 + (index % 4) * 354, top: 14 + Math.floor(index / 4) * 439 });
  }
  const contact = await sharp({ create: { width: 1430, height: 892, channels: 3, background: "#e4e7e5" } }).composite(thumbnails).png().toBuffer();
  await writeFile(path.join(outputDir, `studio-28-${collection}-contact.png`), contact);
  console.log(`${collection}: ${pages.length} real JPEGs and contact sheet written to ${outputDir}`);
}
