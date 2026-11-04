import type { StoredCardCopy } from "./storedCardCopy";

export type CardCarousel = {
  version: 1;
  pages: Array<{ id: number; sha256: string; title: string; altText?: string }>;
  altVersion?: number;
  cover: { kind: "ai" | "upload" | "typography"; credit: string; model?: string };
  /** Immutable editorial snapshot of these exact rendered pages. Absent on legacy decks. */
  copy?: StoredCardCopy;
  /** Final exports retain their actual renderer; a local preview is never a Canva export. */
  rendererProvider?: "builtin" | "canva";
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
