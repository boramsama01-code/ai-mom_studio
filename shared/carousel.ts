import type { CardCopy } from "./cardCopy";

export type CardCarousel = {
  version: 1;
  pages: Array<{ id: number; sha256: string; title: string; altText?: string }>;
  altVersion?: number;
  cover: { kind: "ai" | "upload" | "typography"; credit: string; model?: string };
  /** Immutable editorial snapshot of these exact rendered pages. Absent on legacy decks. */
  copy?: CardCopy;
};
export type SourceOutput = {
  assetId: number;
  channelId: number;
  itemId: number;
  revisionId: number;
  stale: boolean;
  pages: Array<{ id: number; title: string; altText?: string }>;
  coverCredit: string;
};
