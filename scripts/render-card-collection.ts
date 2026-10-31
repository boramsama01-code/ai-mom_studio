import fs from 'node:fs/promises';
import path from 'node:path';
import { CARD_DESIGNS } from '../shared/cardDesigns';
import { collectionSample, collectionSampleArt } from '../server/services/cardDesignSamples';
import { renderCarouselPages } from '../server/services/cardCarousel';
const output = path.resolve(process.argv[2] ?? '../card-design-collection');
await fs.mkdir(output, { recursive: true });
const index = [];
for (const d of CARD_DESIGNS) {
  const { plan, style } = collectionSample(d.id);
  const pages = await renderCarouselPages(plan, style, collectionSampleArt(d.id), '이미지: AI 생성 · 연출 이미지');
  if (pages.length !== 5) throw new Error(`${d.id}: Expected 5 pages, got ${pages.length}`);
  const folder = path.join(output, d.family, d.id.toUpperCase());
  await fs.mkdir(folder, { recursive: true });
  for (let i = 0; i < pages.length; i++) await fs.writeFile(path.join(folder, `${String(i + 1).padStart(2, '0')}-${i ? 'body' : 'cover'}.jpg`), pages[i].bytes);
  index.push({ ...d, pages: pages.map((p, i) => ({ title: p.title, path: `${d.family}/${d.id.toUpperCase()}/${String(i + 1).padStart(2, '0')}-${i ? 'body' : 'cover'}.jpg` })) });
  console.log(`${d.id} ${d.name}: ${pages.length} pages`);
}
await fs.writeFile(path.join(output, 'index.json'), JSON.stringify(index, null, 2));
