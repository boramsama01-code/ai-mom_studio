import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts } from '../server/services/card';
const root = path.resolve('../card-design-collection');
const index = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
const fonts = loadFonts();
const label = (text: string, x: number, y: number, size: number, color = '#172932', bold = false) => `<path d="${fonts[bold ? 'bold' : 'regular'].getPath(text, x, y, size).toPathData(2)}" fill="${color}"/>`;
for (const family of ['recruitment', 'news']) {
  const designs = index.filter((d: any) => d.family === family);
  const coverLayers = [], bodyLayers = [];
  let svg = label(family === 'recruitment' ? 'RECRUITMENT / 모집정보 10세트' : 'NEWS / 뉴스·속보 10세트', 40, 62, 34, '#172932', true);
  svg += label('표지 1장 + 본문 4장  ·  1080 × 1350  ·  모든 문구는 디자인 예시입니다', 40, 102, 20, '#63727C');
  let bodySvg = label(family === 'recruitment' ? '모집정보 / 본문 40장' : '뉴스·속보 / 본문 40장', 32, 58, 32, '#172932', true);
  for (let i = 0; i < designs.length; i++) {
    const d = designs[i], x = 40 + (i % 5) * 312, y = 145 + Math.floor(i / 5) * 435;
    coverLayers.push({ input: await sharp(path.join(root, d.pages[0].path)).resize(288,360).toBuffer(), left:x,top:y });
    svg += label(`${d.id.toUpperCase()}  ${d.name}`, x, y + 393, 19, '#172932', true);
    for (let p = 1; p < 5; p++) {
      const bx = 32 + ((i % 2) * 4 + p - 1) * 201, by = 100 + Math.floor(i / 2) * 305;
      bodyLayers.push({ input: await sharp(path.join(root, d.pages[p].path)).resize(188,235).toBuffer(),left:bx,top:by });
      bodySvg += label(`${d.id.toUpperCase()} · ${p+1}/5`, bx, by+260, 15);
    }
    const strip = [];
    for (let p=0; p<5; p++) strip.push({ input: await sharp(path.join(root,d.pages[p].path)).resize(400,500).toBuffer(),left:24+p*418,top:74 });
    const titleSvg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2120" height="598">${label(`${d.id.toUpperCase()} / ${d.name} · 표지와 본문 전체`,24,45,28,'#172932',true)}</svg>`).render().asPng();
    await sharp({create:{width:2120,height:598,channels:3,background:'#E9ECEE'}}).composite([...strip,{input:titleSvg}]).png().toFile(path.join(root,`${d.id}-full-set.png`));
  }
  coverLayers.push({input:new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1630" height="1020">${svg}</svg>`).render().asPng(),left:0,top:0});
  bodyLayers.push({input:new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1670" height="1630">${bodySvg}</svg>`).render().asPng(),left:0,top:0});
  await sharp({create:{width:1630,height:1020,channels:3,background:'#F1F3F4'}}).composite(coverLayers).png().toFile(path.join(root,`${family}-overview.png`));
  await sharp({create:{width:1670,height:1630,channels:3,background:'#F1F3F4'}}).composite(bodyLayers).png().toFile(path.join(root,`${family}-bodies.png`));
}
