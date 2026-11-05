import sharp from 'sharp';
import type { PageDesign } from '../../shared/familyDialogue';
import type { ReadingImageBox } from '../../shared/readingCardProfiles';

type ArtworkSlot = Pick<ReadingImageBox, 'width' | 'height'> & Partial<Pick<ReadingImageBox, 'radius' | 'treatment'>>;

/** One crop used by both the Studio preview and Canva's fixed photograph slots. */
export async function prepareReadingArtwork(bytes:Buffer|null,design:PageDesign,slot:ArtworkSlot,background:string):Promise<Buffer> {
  // Imported Canva geometry includes fractional dimensions. Only the raster's
  // pixel grid is rounded; the SVG/Canva placement keeps the original geometry.
  const width=Math.round(slot.width),height=Math.round(slot.height),settings=design.background;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>8_000_000) throw new Error('등록된 사진창 크기를 확인해 주세요.');
  if(!/^#[0-9a-f]{6}$/i.test(background)) throw new Error('등록된 사진창 바탕색을 확인해 주세요.');
  let output:Buffer;
  if(!bytes) output=await sharp({create:{width,height,channels:3,background}}).png().toBuffer();
  else {
    const normalized=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'}).rotate().toBuffer();
    const meta=await sharp(normalized).metadata();
    if(!meta.width||!meta.height) throw new Error('사진 크기를 확인할 수 없습니다.');
    if(settings.fit==='contain') output=await sharp(normalized).resize(width,height,{fit:'contain',background}).png().toBuffer();
    else {
      const scale=Math.max(width/meta.width,height/meta.height),rw=Math.max(width,Math.round(meta.width*scale)),rh=Math.max(height,Math.round(meta.height*scale));
      const left=Math.round((rw-width)*settings.focalX/100),top=Math.round((rh-height)*settings.focalY/100);
      output=await sharp(normalized).resize(rw,rh,{fit:'fill'}).extract({left,top,width,height}).png().toBuffer();
    }
    // The treatment is a registered slot property, not a guess from a style
    // name or the user's image. Both local preview and Canva upload use it.
    let treatment=sharp(output);
    if(slot.treatment?.tone==='monochrome') treatment=treatment.greyscale();
    output=await treatment.modulate({brightness:settings.brightness/100}).flatten({background}).toColorspace('srgb').png().toBuffer();
    if(settings.overlay>0) {
      const overlay=await sharp({create:{width,height,channels:4,background:{r:parseInt(background.slice(1,3),16),g:parseInt(background.slice(3,5),16),b:parseInt(background.slice(5,7),16),alpha:settings.overlay/100}}}).png().toBuffer();
      output=await sharp(output).composite([{input:overlay}]).png().toBuffer();
    }
  }
  if(slot.radius && slot.radius>0) {
    const rx=Math.min(width/2,slot.radius*width/slot.width),ry=Math.min(height/2,slot.radius*height/slot.height);
    const mask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${rx}" ry="${ry}" fill="#fff"/></svg>`);
    output=await sharp(output).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  }
  return output;
}
