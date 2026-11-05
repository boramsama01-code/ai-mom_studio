import type {Cardnews14StyleId} from './readingCardProfiles';
/** Native Canva designs saved and re-read on 2026-11-04.
 * Preserve the supplied handoff originals as provenance. Saving and verifying
 * pages/dataset is not proof of a successful Autofill or eight-page export. */
const sources:Record<Cardnews14StyleId,{sourceId:string;editUrl:string;originalSourceId:string;originalEditUrl:string}>={
  'cinematic':{sourceId:'DAHZ9TMtgv8',editUrl:'https://www.canva.com/d/_Lwz5y7Yhnr5eGQ',originalSourceId:'DAHZ7x2nTrg',originalEditUrl:'https://www.canva.com/d/yB8FQPoR8rao40k'},
  'monochrome-coral':{sourceId:'DAHZ9fHI418',editUrl:'https://www.canva.com/d/gTzOrLDKlrVUwFP',originalSourceId:'DAHZ77WyFFc',originalEditUrl:'https://www.canva.com/d/g2TMQTVdSYXxQvx'},
  'amber-cream':{sourceId:'DAHZ9YzSAv4',editUrl:'https://www.canva.com/d/KHc_m61t8-xUSiE',originalSourceId:'DAHZ7w_VOXw',originalEditUrl:'https://www.canva.com/d/hwIkT6EPMsSkGsR'},
  'cobalt-paper':{sourceId:'DAHZ9UpAYzo',editUrl:'https://www.canva.com/d/LwfG6VmPnSMu61X',originalSourceId:'DAHZ77ioKBQ',originalEditUrl:'https://www.canva.com/d/Vz0LsXPG1kt2BTU'},
  'ink-lime':{sourceId:'DAHZ9akH8KQ',editUrl:'https://www.canva.com/d/56N0cOI_bYgNut6',originalSourceId:'DAHZ75gK2o8',originalEditUrl:'https://www.canva.com/d/pYzAN7RFBuq8g5P'},
  'swiss-modernism':{sourceId:'DAHZ9f8a6pQ',editUrl:'https://www.canva.com/d/8u0sYbtOzH4hYXh',originalSourceId:'DAHZ7_pJigM',originalEditUrl:'https://www.canva.com/d/EE8Bok0hGS-6CdG'},
  'studio-2am':{sourceId:'DAHZ9d5EEac',editUrl:'https://www.canva.com/d/1iGPtwDsSigxIf_',originalSourceId:'DAHZ7xFMR2I',originalEditUrl:'https://www.canva.com/d/KAFgu-CUpjJ99UB'},
  'ichestyime':{sourceId:'DAHZ9VrdeQo',editUrl:'https://www.canva.com/d/r9xYSE9kJWMVTpc',originalSourceId:'DAHZ713lepM',originalEditUrl:'https://www.canva.com/d/KMW861zBT7f98Uy'},
  'sharp-serif':{sourceId:'DAHZ9dZOsRo',editUrl:'https://www.canva.com/d/WPDLVOSgnzr7RjA',originalSourceId:'DAHZ75naDWI',originalEditUrl:'https://www.canva.com/d/isgjYkT8F8IaaPT'},
  'bang-bang':{sourceId:'DAHZ9Q7pbec',editUrl:'https://www.canva.com/d/4XNgwqkcNvvDY6G',originalSourceId:'DAHZ73hpbLs',originalEditUrl:'https://www.canva.com/d/Bkz9SXgVUXTSFTf'},
  'hello':{sourceId:'DAHZ9a3kGO4',editUrl:'https://www.canva.com/d/v6BZ1flMuAe1dGr',originalSourceId:'DAHZ7w5jqIQ',originalEditUrl:'https://www.canva.com/d/mffebKzVqRg3MDu'},
  'ekiden-pack':{sourceId:'DAHZ9d76By0',editUrl:'https://www.canva.com/d/B2hK6f1LCP16CrI',originalSourceId:'DAHZ7zhq7OA',originalEditUrl:'https://www.canva.com/d/8reG71VHi8cagAn'},
  'you-and-me':{sourceId:'DAHZ9f8T-zs',editUrl:'https://www.canva.com/d/zz7txMleiYUibI1',originalSourceId:'DAHZ8I9YNnY',originalEditUrl:'https://www.canva.com/d/XwKAxkpoSCIQNPy'},
  'ott-recommendation':{sourceId:'DAHZ9bmpgiM',editUrl:'https://www.canva.com/d/dUvNhYYRBpEs_CK',originalSourceId:'DAHZ8P4K3dw',originalEditUrl:'https://www.canva.com/d/vR3bMgSiCRM9TdH'},
};
export function cardnews14Source(styleId:Cardnews14StyleId){return {...sources[styleId],productionEnabled:false as const,sourceVerifiedBy:'native-save-20261104' as const,autofillVerified:false as const};}
