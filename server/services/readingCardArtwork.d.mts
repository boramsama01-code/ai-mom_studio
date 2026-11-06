import type { PageDesign } from '../../shared/familyDialogue';
import type { ReadingImageBox } from '../../shared/readingCardProfiles';
import type { ReadingImageRect } from '../../shared/readingImageGeometry';
export function prepareReadingArtworkNative(bytes:Buffer|null,design:PageDesign,slot:Pick<ReadingImageBox,'width'|'height'>&Partial<Pick<ReadingImageBox,'radius'|'treatment'>>,background:string,containViewport?:ReadingImageRect):Promise<Buffer>;
