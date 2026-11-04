import type {Cardnews14StyleId} from './readingCardProfiles';
/** Saved source designs supplied in CARDNEWS14_HANDOFF (2026-11-04).
 * These links are source references, never proof of a successful Autofill/export. */
const sources:Record<Cardnews14StyleId,{sourceId:string;editUrl:string}>={
  'cinematic':{sourceId:'DAHZ7x2nTrg',editUrl:'https://www.canva.com/d/yB8FQPoR8rao40k'},
  'monochrome-coral':{sourceId:'DAHZ77WyFFc',editUrl:'https://www.canva.com/d/g2TMQTVdSYXxQvx'},
  'amber-cream':{sourceId:'DAHZ7w_VOXw',editUrl:'https://www.canva.com/d/hwIkT6EPMsSkGsR'},
  'cobalt-paper':{sourceId:'DAHZ77ioKBQ',editUrl:'https://www.canva.com/d/Vz0LsXPG1kt2BTU'},
  'ink-lime':{sourceId:'DAHZ75gK2o8',editUrl:'https://www.canva.com/d/pYzAN7RFBuq8g5P'},
  'swiss-modernism':{sourceId:'DAHZ7_pJigM',editUrl:'https://www.canva.com/d/EE8Bok0hGS-6CdG'},
  'studio-2am':{sourceId:'DAHZ7xFMR2I',editUrl:'https://www.canva.com/d/KAFgu-CUpjJ99UB'},
  'ichestyime':{sourceId:'DAHZ713lepM',editUrl:'https://www.canva.com/d/KMW861zBT7f98Uy'},
  'sharp-serif':{sourceId:'DAHZ75naDWI',editUrl:'https://www.canva.com/d/isgjYkT8F8IaaPT'},
  'bang-bang':{sourceId:'DAHZ73hpbLs',editUrl:'https://www.canva.com/d/Bkz9SXgVUXTSFTf'},
  'hello':{sourceId:'DAHZ7w5jqIQ',editUrl:'https://www.canva.com/d/mffebKzVqRg3MDu'},
  'ekiden-pack':{sourceId:'DAHZ7zhq7OA',editUrl:'https://www.canva.com/d/8reG71VHi8cagAn'},
  'you-and-me':{sourceId:'DAHZ8I9YNnY',editUrl:'https://www.canva.com/d/XwKAxkpoSCIQNPy'},
  'ott-recommendation':{sourceId:'DAHZ8P4K3dw',editUrl:'https://www.canva.com/d/vR3bMgSiCRM9TdH'},
};
export function cardnews14Source(styleId:Cardnews14StyleId){return {...sources[styleId],productionEnabled:false as const,sourceVerifiedBy:'handoff-20261104' as const,autofillVerified:false as const};}
