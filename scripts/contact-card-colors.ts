import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts } from '../server/services/card';
import { CARD_DESIGNS } from '../shared/cardDesigns';

const root = path.resolve(process.argv[2] ?? '../card-color-collection');
const index = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
const fonts = loadFonts();
const label = (text: string, x: number, y: number, size: number, color = '#172932', bold = false) => `<path d="${fonts[bold ? 'bold' : 'regular'].getPath(text, x, y, size).toPathData(2)}" fill="${color}"/>`;
const raster = (svg: string, w: number, h: number) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`).render().asPng();
const overview: OverlayOptions[] = [];
let overviewText = label('선택한 5가지 디자인, 30가지 컬러', 36, 52, 29, '#172932', true);
overviewText += label('각 컬러는 표지 1장 + 본문 4장으로 구성됩니다 · 문구와 사진은 디자인 예시입니다', 36, 85, 17, '#63727C');
for (const [row, design] of CARD_DESIGNS.entries()) {
  const variants = index.filter((d: any) => d.layoutId === design.id);
  const layers: OverlayOptions[] = [];
  let svg = label(`${design.id.toUpperCase()} / ${design.name}`, 36, 54, 31, '#172932', true);
  svg += label('오리지널 + 컬러 5가지 · 표지와 본문 전체에 같은 컬러가 적용됩니다', 36, 89, 18, '#63727C');
  overviewText += label(`${design.id.toUpperCase()}  ${design.name}`, 36, 124 + row * 297, 20, '#172932', true);
  for (let i = 0; i < variants.length; i++) {
    const d = variants[i], x = 36 + (i % 3) * 352, y = 122 + Math.floor(i / 3) * 475;
    layers.push({ input: await sharp(path.join(root, d.pages[0].path)).resize(328, 410).toBuffer(), left: x, top: y });
    svg += label(`${String(i + 1).padStart(2, '0')}  ${d.colorName}`, x, y + 441, 22, '#172932', true);
    const ox = 36 + i * 184, oy = 142 + row * 297;
    overview.push({ input: await sharp(path.join(root, d.pages[0].path)).resize(168, 210).toBuffer(), left: ox, top: oy });
    overviewText += label(d.colorName, ox, oy + 236, 16, '#172932');
    const strip: OverlayOptions[] = [];
    for (let p = 0; p < 5; p++) strip.push({ input: await sharp(path.join(root, d.pages[p].path)).resize(300, 375).toBuffer(), left: 24 + p * 316, top: 75 });
    strip.push({ input: raster(label(`${design.id.toUpperCase()} / ${design.name} · ${d.colorName} · 표지 + 본문 4장`, 24, 45, 25, '#172932', true), 1612, 474), left: 0, top: 0 });
    await sharp({ create: { width: 1612, height: 474, channels: 3, background: '#F1F3F4' } }).composite(strip).png().toFile(path.join(root, `${d.id}-full-set.png`));
  }
  layers.push({ input: raster(svg, 1104, 1080), left: 0, top: 0 });
  await sharp({ create: { width: 1104, height: 1080, channels: 3, background: '#F1F3F4' } }).composite(layers).png().toFile(path.join(root, `${design.id}-colors.png`));
}
overview.push({ input: raster(overviewText, 1156, 1615), left: 0, top: 0 });
await sharp({ create: { width: 1156, height: 1615, channels: 3, background: '#F1F3F4' } }).composite(overview).png().toFile(path.join(root, 'card-colors-overview.png'));
