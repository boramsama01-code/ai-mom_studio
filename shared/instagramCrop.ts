/** Studio composition margins, not a guarantee about every Instagram surface. */
export const INSTAGRAM_CARD_SIZE = { width: 1080, height: 1350 } as const;
export const INSTAGRAM_COMPOSITION_VERSION = "instagram-center-safe-20261105";
export type CropBounds = { x: number; y: number; width: number; height: number };
export type InstagramPreviewMode = "full" | "square" | "profile";
export const INSTAGRAM_COVER_SAFE: CropBounds = { x: 90, y: 189, width: 900, height: 972 };

/** A central cover crop. Preview only: this never changes the downloaded file. */
export function instagramCropWindow(mode: InstagramPreviewMode, width = 1080, height = 1350): CropBounds {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error("이미지 크기를 확인해 주세요.");
  const ratio = mode === "square" ? 1 : mode === "profile" ? 3 / 4 : width / height;
  const cropWidth = Math.min(width, height * ratio), cropHeight = Math.min(height, width / ratio);
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

export function intersectBounds(a: CropBounds, b: CropBounds): CropBounds | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export const INSTAGRAM_ARTWORK_RULE = [
  "Instagram crop-safe composition: the final carousel card is 1080×1350 (4:5). Its central square is y=135–1215; a centered 3:4 profile preview can also trim both sides.",
  "Keep all indispensable subject details — the complete face, eyes, head or helmet, meaningful hands, and important props — together inside the protected central region, with breathing room. Background, atmosphere and nonessential decoration may extend to the edges. Avoid edge-to-edge close-ups, clipped heads or hands, and important objects straddling crop boundaries.",
  "The square AI output is a source image, not the final square preview: it will first be fitted into a template image window. Follow the precise source-image safe bounds below when supplied. Reserve the template's actual text rectangles as quiet negative space; do not put a face behind a headline. Never draw the crop guides, lettering or logos into the image.",
].join("\n");

export const DEFAULT_INSTAGRAM_ARTWORK_COMPOSITION = "For a full-bleed card made from a square source, keep essential details within source x=17%–83%, y=14%–86%. On the final 1080×1350 card, the Studio's inner safe area is x=90–990, y=189–1161. These are composition margins, not visible frames. A more specific template source-image safe area takes precedence.";
