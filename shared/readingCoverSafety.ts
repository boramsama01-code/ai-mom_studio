import type { ReadingElement, ReadingImageBox, ReadingPageLayout, ReadingShape, ReadingTextBox } from './readingCardProfiles';
import { INSTAGRAM_COVER_SAFE } from './instagramCrop';

/** Our production margin, not an Instagram-specified safe area. A 4:5 cover
 * keeps these bounds in both a centred square and a centred 3:4 thumbnail. */
export const READING_COVER_SAFE_BOUNDS = INSTAGRAM_COVER_SAFE;
export const READING_COVER_LAYOUT_REVISION = 'crop-safe-20261105';

type BoxPatch = Partial<Pick<ReadingTextBox, 'x'|'y'|'width'|'height'|'fontSize'>>;
type ElementPatch = BoxPatch;
type FieldPatch = BoxPatch & Partial<Pick<ReadingImageBox,'fit'>>;
type CoverEdits = { fields: Record<string, FieldPatch>; elements?: Record<number, ElementPatch> };
const footer: Record<string, BoxPatch> = {
  P01_IMAGE_CREDIT: { x: 90, y: 1129, width: 660, height: 30 },
  P01_PAGE_NUMBER: { x: 822, y: 1129, width: 168, height: 32 },
};

/** Each style keeps its own hierarchy, type and image treatment. These are
 * measured page-one edits; no raster shrinking, text truncation or blanket
 * vertical scaling is applied. Decorative backgrounds can remain full bleed. */
const edits: Record<string, CoverEdits> = {
  cinematic: {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 189, width: 900 },
      P01_HEADLINE: { x: 90, y: 520, width: 900 },
      P01_SUBTITLE: { x: 94, y: 892, width: 892 },
    },
    elements: { 14: { x: 92, y: 823 } },
  },
  'monochrome-coral': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 189, width: 900 },
      P01_HEADLINE: { x: 90, y: 310, width: 900 },
      P01_SUBTITLE: { x: 90, y: 961, width: 900 },
    },
    elements: { 2: { x: 90, y: 259 } },
  },
  'amber-cream': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 189, width: 900 },
      P01_HEADLINE: { x: 90, y: 310, width: 900, height: 300 },
      P01_SUBTITLE: { x: 90, y: 952, width: 900 },
    },
    elements: { 2: { x: 90, y: 259, width: 900 }, 3: { x: 90, y: 1176, width: 900 }, 8: { x: 92, y: 604 } },
  },
  'swiss-modernism': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 96, y: 189 },
      P01_HEADLINE: { x: 96, y: 264, height: 242 },
      P01_SUBTITLE: { x: 96, y: 522 },
      P01_COVER_IMAGE: { x: 110, y: 662, width: 860, height: 430, fit: 'contain' },
      P01_IMAGE_CREDIT: { x: 96, y: 1120, width: 700, height: 32 },
      P01_PAGE_NUMBER: { x: 804, y: 1120, width: 180, height: 32 },
    },
    elements: {
      0: { y: 162, height: 1020 }, 1: { y: 242 }, 5: { y: 650 },
      7: { x: 838, y: 662 }, 9: { y: 1170 },
    },
  },
  'studio-2am': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 109, y: 195 },
      P01_HEADLINE: { x: 90, width: 900 },
      P01_SUBTITLE: { x: 90, width: 900 },
    },
    elements: { 2: { x: 90, y: 181 }, 5: { x: 90, width: 900 } },
  },
  ichestyime: {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 189 },
      P01_HEADLINE: { x: 90, y: 275, width: 900, height: 240 },
      P01_SUBTITLE: { x: 90, y: 530, width: 830 },
      P01_COVER_IMAGE: { x: 540, y: 674, width: 430, height: 430, fit: 'contain' },
    },
    elements: { 1: { x: 918, y: 189, width: 72, height: 72 }, 6: { x: 90, y: 742, height: 300 } },
  },
  'sharp-serif': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 205 },
      P01_HEADLINE: { x: 90, y: 315, width: 900 },
      P01_SUBTITLE: { x: 94, y: 723, width: 846 },
    },
    elements: { 2: { x: 90, y: 176, width: 900 }, 5: { x: 94, y: 674 } },
  },
  'bang-bang': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 189 },
      P01_HEADLINE: { x: 90, y: 269, width: 900, height: 280 },
      P01_SUBTITLE: { x: 90, y: 572, width: 900, height: 120 },
      P01_COVER_IMAGE: { x: 90, y: 734, width: 900, height: 346, fit: 'contain' },
    },
    elements: { 3: { x: 78, y: 722, width: 924, height: 370 }, 5: { y: 1103, height: 247 } },
  },
  hello: {
    fields: {
      P01_PAGE_NUMBER: { x: 95, y: 1033, width: 78, height: 96 },
      P01_IMAGE_CREDIT: { x: 226, y: 1129, width: 764, height: 30 },
      P01_TOPIC_TAG: { x: 90, y: 196 },
      P01_HEADLINE: { x: 226, y: 210, width: 764, height: 244, fontSize: 100 },
      P01_SUBTITLE: { x: 226, y: 470, width: 764 },
      P01_COVER_IMAGE: { x: 226, y: 630, width: 764, height: 456, fit: 'contain' },
    },
    elements: {
      0: { x: 72, y: 170, width: 936, height: 1010 },
      1: { x: 196, y: 170, height: 1010 }, 2: { x: 196, y: 610, width: 812 },
      3: { x: 85, y: 1019 }, 10: { x: 85, y: 490, height: 454 },
    },
  },
  'ekiden-pack': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 109, y: 196 },
      P01_HEADLINE: { x: 90, y: 707, width: 900, height: 266 },
      P01_SUBTITLE: { x: 90, y: 977, width: 900, height: 120 },
    },
    elements: { 2: { x: 90, y: 181 }, 4: { y: 610 } },
  },
  'you-and-me': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 90, y: 189, width: 900 },
      P01_HEADLINE: { x: 90, y: 350, width: 900 },
    },
    elements: { 3: { y: 270 } },
  },
  'ott-recommendation': {
    fields: { ...footer,
      P01_TOPIC_TAG: { x: 114, y: 200 },
      P01_COVER_IMAGE: { x: 90, y: 270, width: 900, height: 830, fit: 'contain' },
      P01_HEADLINE: { x: 108, y: 748, width: 864, height: 245 },
      P01_SUBTITLE: { x: 108, y: 1005, width: 864, height: 96 },
    },
    elements: {
      1: { x: 90, y: 181 }, 3: { x: 927, y: 202 }, 4: { x: 954, y: 231 },
      6: { x: 90, y: 270, width: 900, height: 830 },
      9: { x: 90, y: 1176, width: 900 }, 10: { x: 90, y: 1176, width: 225 },
      11: { x: 311, y: 1170 },
    },
  },
};

const splitFields: Record<string, FieldPatch> = {
  ...footer,
  P01_TOPIC_TAG: { x: 106, y: 189 },
  P01_HEADLINE: { x: 90, y: 260, width: 900, height: 244 },
  P01_SUBTITLE: { x: 94, y: 528, width: 892, height: 98 },
  P01_COVER_IMAGE: { x: 90, y: 654, width: 900, height: 462, fit: 'contain' },
};
const splitElements: Record<number, ElementPatch> = {
  0: { height: 652 }, 1: { x: 90, y: 181 },
  2: { y: 652, height: 698 }, 3: { y: 638 },
  4: { x: 86, y: 650, width: 908, height: 470 },
  5: { x: 90, y: 1176, width: 900 },
};
edits['cobalt-paper'] = { fields: splitFields, elements: splitElements };
edits['ink-lime'] = { fields: splitFields, elements: splitElements };

function checkedText(box: ReadingTextBox): ReadingTextBox {
  const safe = READING_COVER_SAFE_BOUNDS;
  if (box.x < safe.x || box.y < safe.y || box.x + box.width > safe.x + safe.width + .01 || box.y + box.height > safe.y + safe.height + .01) {
    throw new Error(`Cover field outside the crop margin: ${box.field}`);
  }
  return box;
}

export function readingCoverSafety(styleId: string, page: ReadingPageLayout): ReadingPageLayout {
  if (page.page !== 1) return page;
  const patch = edits[styleId];
  if (!patch) throw new Error(`Missing crop-safe cover layout: ${styleId}`);
  if (page.elements) {
    const elements = page.elements.map((element, index) => {
      const changes = element.kind === 'rect' ? patch.elements?.[index] : patch.fields[element.field];
      const next = changes ? { ...element, ...changes } as ReadingElement : element;
      if (next.kind === 'text') checkedText(next);
      return next;
    });
    return { ...page, elements,
      shapes: elements.filter((element): element is Extract<ReadingElement, {kind:'rect'}> => element.kind === 'rect').map(({kind, ...shape}) => ({type:'rect' as const, ...shape})),
      textBoxes: elements.filter((element): element is Extract<ReadingElement, {kind:'text'}> => element.kind === 'text'),
      imageBoxes: elements.filter((element): element is Extract<ReadingElement, {kind:'image'}> => element.kind === 'image').map(({kind, ...box}) => ({...box, kind:'artwork' as const})),
    };
  }
  // The two original reading styles use shapes rather than ordered elements.
  // Their geometry matches the split-page source. Keep the renderer unchanged.
  const shapes: ReadingShape[] = page.shapes.map((shape, index) => {
    const change = splitElements[index];
    if (!change) return shape;
    return shape.type === 'line'
      ? { ...shape, x1: 90, x2: 990, y1: 1176, y2: 1176 }
      : { ...shape, ...change };
  });
  return { ...page, shapes,
    textBoxes: page.textBoxes.map(box => checkedText({ ...box, ...splitFields[box.field] })),
    imageBoxes: page.imageBoxes.map(box => ({ ...box, ...splitFields[box.field] })),
  };
}
