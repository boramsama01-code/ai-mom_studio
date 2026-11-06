// One native artwork recipe shared by Canva preparation and the short-lived
// reading-card isolate. Pixel geometry and encoders remain unchanged.
import sharp from 'sharp';

export async function prepareReadingArtworkNative(bytes,design,slot,background,containViewport){
  const width=Math.round(slot.width),height=Math.round(slot.height),settings=design.background;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>8_000_000)throw new Error('등록된 사진창 크기를 확인해 주세요.');
  if(!/^#[0-9a-f]{6}$/i.test(background))throw new Error('등록된 사진창 바탕색을 확인해 주세요.');
  let output;
  if(!bytes)output=await sharp({create:{width,height,channels:3,background}}).png().toBuffer();
  else{
    const normalized=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'}).rotate().toBuffer();
    const meta=await sharp(normalized).metadata();
    if(!meta.width||!meta.height)throw new Error('사진 크기를 확인할 수 없습니다.');
    if(settings.fit==='contain'){
      const viewport=containViewport;
      if(!viewport)throw new Error('사진창 크기를 확인해 주세요.');
      const scale=Math.min(viewport.width/meta.width,viewport.height/meta.height);
      const placedWidth=Math.max(1,Math.min(viewport.width,Math.round(meta.width*scale))),placedHeight=Math.max(1,Math.min(viewport.height,Math.round(meta.height*scale)));
      const x=viewport.x+Math.floor((viewport.width-placedWidth)/2),y=viewport.y+Math.floor((viewport.height-placedHeight)/2);
      output=await sharp(normalized).resize(placedWidth,placedHeight,{fit:'fill'})
        .extend({left:x,top:y,right:width-x-placedWidth,bottom:height-y-placedHeight,background}).png().toBuffer();
    }else{
      const scale=Math.max(width/meta.width,height/meta.height),rw=Math.max(width,Math.round(meta.width*scale)),rh=Math.max(height,Math.round(meta.height*scale));
      const left=Math.round((rw-width)*settings.focalX/100),top=Math.round((rh-height)*settings.focalY/100);
      output=await sharp(normalized).resize(rw,rh,{fit:'fill'}).extract({left,top,width,height}).png().toBuffer();
    }
    let treatment=sharp(output);
    if(slot.treatment?.tone==='monochrome')treatment=treatment.greyscale();
    output=await treatment.modulate({brightness:settings.brightness/100}).flatten({background}).toColorspace('srgb').png().toBuffer();
    if(settings.overlay>0){
      const overlay=await sharp({create:{width,height,channels:4,background:{r:parseInt(background.slice(1,3),16),g:parseInt(background.slice(3,5),16),b:parseInt(background.slice(5,7),16),alpha:settings.overlay/100}}}).png().toBuffer();
      output=await sharp(output).composite([{input:overlay}]).png().toBuffer();
    }
  }
  if(slot.radius&&slot.radius>0){
    const rx=Math.min(width/2,slot.radius*width/slot.width),ry=Math.min(height/2,slot.radius*height/slot.height);
    const mask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${rx}" ry="${ry}" fill="#fff"/></svg>`);
    output=await sharp(output).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  }
  return output;
}
