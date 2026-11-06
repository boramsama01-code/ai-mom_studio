// Trusted internal SVG only. Never load fonts, jobs, credentials or providers.
// A fresh OS process returns one JPEG, then the parent reaps it before another
// page starts. This releases native allocator arenas at the process boundary.
import {Resvg} from '@resvg/resvg-js';
import sharp from 'sharp';
process.once('disconnect',()=>process.exit(1));
process.once('message',async message=>{
  let result;
  try{
    if(typeof message?.svg!=='string')throw new Error('Missing reading-card SVG');
    sharp.cache(false);sharp.concurrency(1);
    const {pixels,width,height}=new Resvg(message.svg,{font:{loadSystemFonts:false}}).render();
    const bytes=await sharp(pixels,{raw:{width,height,channels:4}}).flatten({background:'#ffffff'}).toColorspace('srgb').removeAlpha().jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
    result={bytes,peakRssKiB:process.resourceUsage().maxRSS};
  }catch(error){result={error:error instanceof Error?error.message:'카드 이미지를 만들지 못했습니다.',peakRssKiB:process.resourceUsage().maxRSS};}
  if(process.send)process.send(result,error=>{if(error)process.exit(1);});
  else process.exit(1);
});
