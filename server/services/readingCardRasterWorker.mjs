// Trusted, internally constructed SVG only: paths, registered shapes and PNG
// data URLs. Do not add font loading, provider calls or publication here.
import {parentPort,workerData} from 'node:worker_threads';
import {Resvg} from '@resvg/resvg-js';
import sharp from 'sharp';
import {prepareReadingArtworkNative} from './readingCardArtwork.mjs';

// A single page needs no retained libvips operation cache or parallel pixel pools.
sharp.cache(false);sharp.concurrency(1);
try{
  let svg=workerData?.svg;
  if(workerData?.artwork){
    const input=workerData.artwork;
    const source=input.bytes?Buffer.from(input.bytes.buffer,input.bytes.byteOffset,input.bytes.byteLength):null;
    const png=await prepareReadingArtworkNative(source,input.design,input.slot,input.background,input.containViewport);
    parentPort.postMessage({imageDataUrl:`data:image/png;base64,${png.toString('base64')}`});
    svg=await new Promise((resolve,reject)=>parentPort.once('message',message=>typeof message?.svg==='string'?resolve(message.svg):reject(new Error('Missing reading-card SVG'))));
  }
  if(typeof svg!=='string')throw new Error('Missing reading-card SVG');
  const {pixels,width,height}=new Resvg(svg,{font:{loadSystemFonts:false}}).render();
  const bytes=await sharp(pixels,{raw:{width,height,channels:4}}).flatten({background:'#ffffff'}).toColorspace('srgb').removeAlpha().jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
  parentPort.postMessage({bytes});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:'카드 이미지를 만들지 못했습니다. 원고는 유지했습니다.'});}
