export type ReadingImageGeometry = { width:number; height:number; radius?:number };
export type ReadingImageRect = { x:number; y:number; width:number; height:number };

/** The pixel viewport available to a contained picture. Insetting by
 * r × (1 − 1/√2) keeps its four corners inside the rounded mask. For a circle
 * this is the inscribed square; normal square frames need no inset. */
export function readingContainViewport(slot:ReadingImageGeometry):ReadingImageRect {
  const width=Math.round(slot.width),height=Math.round(slot.height);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw new Error('사진창 크기를 확인해 주세요.');
  const radius=Math.max(0,slot.radius??0),corner=1-Math.SQRT1_2;
  const insetX=radius>0?Math.min(Math.floor((width-1)/2),Math.ceil(Math.min(width/2,radius*width/slot.width)*corner)):0;
  const insetY=radius>0?Math.min(Math.floor((height-1)/2),Math.ceil(Math.min(height/2,radius*height/slot.height)*corner)):0;
  return {x:insetX,y:insetY,width:Math.max(1,width-insetX*2),height:Math.max(1,height-insetY*2)};
}

/** Exact integer placement used by the rasterizer and source-image guidance.
 * The square generated source is the default for prompt projection. */
export function readingContainedImageBounds(slot:ReadingImageGeometry,source:{width:number;height:number}={width:1,height:1}):ReadingImageRect {
  if(!Number.isFinite(source.width)||!Number.isFinite(source.height)||source.width<=0||source.height<=0)throw new Error('원본 이미지 크기를 확인해 주세요.');
  const viewport=readingContainViewport(slot),scale=Math.min(viewport.width/source.width,viewport.height/source.height);
  const width=Math.max(1,Math.min(viewport.width,Math.round(source.width*scale))),height=Math.max(1,Math.min(viewport.height,Math.round(source.height*scale)));
  return {x:viewport.x+Math.floor((viewport.width-width)/2),y:viewport.y+Math.floor((viewport.height-height)/2),width,height};
}
