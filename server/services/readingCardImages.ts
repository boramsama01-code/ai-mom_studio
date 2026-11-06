import type { PageDesign } from '../../shared/familyDialogue';
import type { ReadingImageBox } from '../../shared/readingCardProfiles';
import {readingContainViewport,type ReadingImageRect} from '../../shared/readingImageGeometry';
import {prepareReadingArtworkNative} from './readingCardArtwork.mjs';

type ArtworkSlot = Pick<ReadingImageBox, 'width' | 'height'> & Partial<Pick<ReadingImageBox, 'radius' | 'treatment'>>;
export type ReadingArtworkInput={bytes:Buffer|null;design:PageDesign;slot:ArtworkSlot;background:string;containViewport?:ReadingImageRect};
export function readingArtworkInput(bytes:Buffer|null,design:PageDesign,slot:ArtworkSlot,background:string):ReadingArtworkInput{
  return {bytes,design,slot,background,...(bytes&&design.background.fit==='contain'?{containViewport:readingContainViewport(slot)}:{})};
}

/** One crop used by both the Studio preview and Canva's fixed photograph slots. */
export async function prepareReadingArtwork(bytes:Buffer|null,design:PageDesign,slot:ArtworkSlot,background:string):Promise<Buffer> {
  const input=readingArtworkInput(bytes,design,slot,background);
  return prepareReadingArtworkNative(input.bytes,input.design,input.slot,input.background,input.containViewport);
}
