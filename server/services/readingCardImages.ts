import sharp from 'sharp';
import type { PageDesign } from '../../shared/familyDialogue';

/** One crop used by both the Studio preview and Canva's fixed photograph slots. */
export async function prepareReadingArtwork(bytes:Buffer|null,design:PageDesign,slot:{width:number;height:number},background:string):Promise<Buffer> {
  const {width,height}=slot, settings=design.background;
  if(!bytes) return sharp({create:{width,height,channels:3,background}}).png().toBuffer();
  const normalized=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'}).rotate().toBuffer();
  const meta=await sharp(normalized).metadata();
  if(!meta.width||!meta.height) throw new Error('사진 크기를 확인할 수 없습니다.');
  let output:Buffer;
  if(settings.fit==='contain') output=await sharp(normalized).resize(width,height,{fit:'contain',background}).png().toBuffer();
  else {
    const scale=Math.max(width/meta.width,height/meta.height),rw=Math.max(width,Math.round(meta.width*scale)),rh=Math.max(height,Math.round(meta.height*scale));
    const left=Math.round((rw-width)*settings.focalX/100),top=Math.round((rh-height)*settings.focalY/100);
    output=await sharp(normalized).resize(rw,rh,{fit:'fill'}).extract({left,top,width,height}).png().toBuffer();
  }
  output=await sharp(output).modulate({brightness:settings.brightness/100}).flatten({background}).toColorspace('srgb').png().toBuffer();
  if(settings.overlay>0) {
    const overlay=await sharp({create:{width,height,channels:4,background:{r:parseInt(background.slice(1,3),16),g:parseInt(background.slice(3,5),16),b:parseInt(background.slice(5,7),16),alpha:settings.overlay/100}}}).png().toBuffer();
    output=await sharp(output).composite([{input:overlay}]).png().toBuffer();
  }
  return output;
}
