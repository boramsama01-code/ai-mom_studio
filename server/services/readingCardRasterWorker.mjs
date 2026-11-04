// Trusted, internally constructed SVG only: paths, registered shapes and PNG
// data URLs. Do not add font loading, provider calls or publication here.
import {parentPort,workerData} from 'node:worker_threads';
import {Resvg} from '@resvg/resvg-js';
import sharp from 'sharp';

try{
  if(typeof workerData?.svg!=='string')throw new Error('Missing reading-card SVG');
  const {pixels,width,height}=new Resvg(workerData.svg,{font:{loadSystemFonts:false}}).render();
  const bytes=await sharp(pixels,{raw:{width,height,channels:4}}).flatten({background:'#ffffff'}).toColorspace('srgb').removeAlpha().jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
  parentPort.postMessage({bytes});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:'카드 이미지를 만들지 못했습니다. 원고는 유지했습니다.'});}
