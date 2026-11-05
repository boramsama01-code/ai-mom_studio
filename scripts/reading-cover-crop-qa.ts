/** Offline proof of all sixteen live reading-cover layouts. No paid APIs. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import runtime from '../shared/cardnews14Layout.json';
import legacyRuntime from '../shared/readingCardLayout.json';
import { READING_CARD_PROFILES, readingProfileDesigns, type ReadingImageBox } from '../shared/readingCardProfiles';
import { READING_COVER_SAFE_BOUNDS } from '../shared/readingCoverSafety';
import { defaultPageDesigns } from '../shared/familyDialogue';
import { layoutReadingProfilePage, rasterizeReadingCardSvg } from '../server/services/readingCard';
import { prepareReadingArtwork } from '../server/services/readingCardImages';

const root = process.cwd(), output = path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--')) ?? 'test-results/reading-cover-crops');
const updatePreviews = process.argv.includes('--update-previews');
await fs.mkdir(output, {recursive:true});
const sourceRoot = path.join(root, 'assets/cardnews14/layouts');
const sources = await Promise.all((await fs.readdir(sourceRoot)).map(async folder => JSON.parse(await fs.readFile(path.join(sourceRoot, folder, 'layout.json'), 'utf8'))));
const assets: Record<string, Buffer> = {
  A: await fs.readFile('assets/cardnews14/cinematic-ink-teal-background.jpg'),
  B: await fs.readFile('assets/cardnews14/monochrome-editorial-background.jpg'),
  C: await fs.readFile('assets/cardnews14/amber-cream-editorial-background.jpg'),
};
const proofs: Array<Record<string, unknown>> = [], tiles: Buffer[] = [], changes: Array<Record<string, unknown>> = [], nativeCovers: Array<Record<string, unknown>> = [];
const keys = ['x','y','width','height','fontSize'] as const;
const geometry = (element: any) => Object.fromEntries(keys.filter(key => element[key] !== undefined).map(key => [key, element[key]]));
for (const profile of READING_CARD_PROFILES) {
  const styleId = profile.sourceStyleId ?? (profile.id.includes('ink-lime') ? 'ink-lime' : 'cobalt-paper');
  const source = sources.find(candidate => candidate.id === styleId);
  if (!source) throw new Error(`Missing sample source: ${styleId}`);
  const layout = profile.pages[0], images = new Map<string,string>(), designs = readingProfileDesigns(profile, defaultPageDesigns());
  const values = Object.fromEntries(source.pages[0].elements.filter((element:any) => element.kind === 'text').map((element:any) => [element.field, element.copy ?? '']));
  for (const element of source.pages[0].elements.filter((element:any) => element.kind === 'image')) {
    const slot = layout.imageBoxes.find(image => image.field === element.field) as ReadingImageBox;
    if (!slot || !assets[element.asset]) throw new Error(`Missing artwork: ${profile.id}:${element.field}`);
    const bytes = await prepareReadingArtwork(assets[element.asset], designs.cover, slot, layout.background);
    images.set(slot.field, `data:image/png;base64,${bytes.toString('base64')}`);
    await fs.writeFile(path.join(output,`${profile.sourceStyleId??profile.id}-artwork.png`),bytes);
  }
  const coverImage = images.get('P01_COVER_IMAGE');
  const measured = layoutReadingProfilePage(profile, 1, values, {images, imageDataUrl:coverImage});
  const bounds = READING_COVER_SAFE_BOUNDS;
  for (const run of measured.textRuns) {
    if (run.x < bounds.x || run.y < bounds.y || run.x + run.width > bounds.x + bounds.width + .01 || run.y + run.height > bounds.y + bounds.height + .01) throw new Error(`Outside safe bounds: ${profile.id}:${run.field}`);
    if (run.lines.join('').replace(/\s/gu,'') !== run.text.replace(/\s/gu,'')) throw new Error(`Text lost: ${profile.id}:${run.field}`);
  }
  const image = await rasterizeReadingCardSvg(measured.svg), key = profile.sourceStyleId ?? profile.id;
  await fs.writeFile(path.join(output, `${key}.jpg`), image);
  if (updatePreviews && profile.sourceStyleId) {
    const thumb = await sharp(image).resize(270,337,{fit:'fill'}).png().toBuffer();
    const coverPath = path.join(root,'client/public/cardnews14',`${key}-cover.webp`);
    const overviewPath = path.join(root,'client/public/cardnews14',`${key}.webp`);
    const previous = await fs.readFile(overviewPath), metadata = await sharp(previous).metadata();
    const tile = metadata.width===1660 && metadata.height===1120 ? {left:20,top:70,width:400,height:500}
      :metadata.width===1180 && metadata.height===799 ? {left:20,top:85,width:270,height:337}
      :metadata.width===1180 && metadata.height===800 ? {left:20,top:70,width:270,height:337}
      :null;
    if(!tile)throw new Error(`Unexpected preview overview geometry: ${key}`);
    // Keep all seven earlier inner-page previews and the title exactly where
    // they were. Lossless encoding preserves their decoded pixels.
    const overviewThumb=await sharp(image).resize(tile.width,tile.height,{fit:'fill'}).png().toBuffer();
    const overview = await sharp(previous).composite([{input:overviewThumb,left:tile.left,top:tile.top}]).webp({lossless:true}).toBuffer();
    await fs.writeFile(coverPath,await sharp(thumb).webp({quality:92}).toBuffer());
    await fs.writeFile(overviewPath,overview);
  }
  const square = await sharp(image).extract({left:0,top:135,width:1080,height:1080}).jpeg({quality:92}).toBuffer();
  const grid = await sharp(image).resize(810,1080,{fit:'cover',position:'centre'}).jpeg({quality:92}).toBuffer();
  await fs.writeFile(path.join(output, `${key}-square.jpg`), square);
  await fs.writeFile(path.join(output, `${key}-grid.jpg`), grid);
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="840" height="48"><rect width="840" height="48" fill="#172029"/><text x="16" y="30" fill="#fff" font-family="sans-serif" font-size="21">${key} / original - square - grid</text></svg>`);
  const previews = await Promise.all([sharp(image).resize(270,338).png().toBuffer(), sharp(square).resize(270,270).png().toBuffer(), sharp(grid).resize(254,338).png().toBuffer()]);
  tiles.push(await sharp({create:{width:840,height:402,channels:3,background:'#26323b'}}).composite([{input:label,left:0,top:0},{input:previews[0],left:10,top:54},{input:previews[1],left:290,top:88},{input:previews[2],left:575,top:54}]).png().toBuffer());
  proofs.push({profileId:profile.id,templateVersion:profile.templateVersion,sha256:createHash('sha256').update(image).digest('hex'),textFields:measured.textRuns.map(run=>({field:run.field,...geometry(run),lines:run.lines})),file:`${key}.jpg`,square:`${key}-square.jpg`,grid:`${key}-grid.jpg`});
  if (profile.sourceStyleId) {
    const before = runtime.styles.find(style=>style.id===profile.sourceStyleId)!.pages[0].elements;
    nativeCovers.push({styleId:profile.sourceStyleId,profileId:profile.id,templateVersion:profile.templateVersion,page:1,width:1080,height:1350,background:layout.background,elements:layout.elements!.map((element,index)=>({...source.pages[0].elements[index],...element,...(element.kind==='image'?{preparedArtworkPath:path.join(output,`${key}-artwork.png`)}:{})}))});
    changes.push({styleId:profile.sourceStyleId,profileId:profile.id,templateVersion:profile.templateVersion,page:1,changes:layout.elements!.flatMap((element,index)=>JSON.stringify(geometry(element))===JSON.stringify(geometry(before[index]))?[]:[{index,kind:element.kind,...('field' in element?{field:element.field}:{}),before:geometry(before[index]),after:geometry(element),...('fill' in element?{fill:element.fill}:{})}])});
  } else {
    const before = legacyRuntime.styles.find(style=>style.id===styleId.replace('-','_'))!.pages[0];
    changes.push({styleId:profile.id,profileId:profile.id,templateVersion:profile.templateVersion,page:1,changes:[...layout.textBoxes,...layout.imageBoxes].map(element=>({kind:'field' in element&&element.field==='P01_COVER_IMAGE'?'image':'text',field:element.field,before:geometry([...before.textBoxes,...before.imageBoxes].find(candidate=>candidate.field===element.field)),after:geometry(element)}))});
  }
}
for(let index=0;index<tiles.length;index+=4) {
  await sharp({create:{width:1680,height:804,channels:3,background:'#26323b'}}).composite(tiles.slice(index,index+4).map((input,i)=>({input,left:(i%2)*840,top:Math.floor(i/2)*402}))).png().toFile(path.join(output,`contact-${index/4+1}.png`));
}
await fs.writeFile(path.join(output,'geometry-changes.json'),JSON.stringify(changes,null,2)+'\n');
await fs.writeFile(path.join(output,'native-cover-layouts.json'),JSON.stringify(nativeCovers,null,2)+'\n');
await fs.writeFile(path.join(output,'proof.json'),JSON.stringify({generatedAt:new Date().toISOString(),bounds:READING_COVER_SAFE_BOUNDS,coverCount:proofs.length,paidAiCalls:0,externalWrites:0,proofs},null,2)+'\n');
console.log(`Validated ${proofs.length} covers and produced original, square and 3:4 previews in ${output}`);
