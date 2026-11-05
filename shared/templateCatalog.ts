import { cardDesignOptions } from "./cardDesigns";
import { READING_CARD_PROFILES } from "./readingCardProfiles";

export type TemplateFormat = "standard" | "family_dialogue_8";
export type TemplateFamily = "recruitment" | "news" | "food";
export type TemplateColor = { key: string; name: string; bg: string; ink: string; accent: string; secondary?: string };

/** Selection metadata is not a content migration. Callers must explicitly
 * handle version changes while preserving a saved draft and its images. */
export type TemplateCatalogItem = {
  key: string;
  templateKey: string;
  name: string;
  description: string;
  kind: "builtin" | "custom";
  family?: TemplateFamily;
  setId?: string;
  format: TemplateFormat;
  cardCopyVersion: 1 | 2;
  /** Number of sample pages, not a promise to truncate a variable-length copy. */
  pageCount: number;
  previewPageCount: number;
  pageCountMode: "variable" | "fixed";
  pageLabels?: string[];
  generation?: "legacy" | "cardnews14";
  thumbnailUrl?: string;
  overviewUrl?: string;
  templateVersion?: string;
  colors?: TemplateColor[];
  id?: number;
  layout?: string;
  textTone?: string;
  overlay?: number;
  allChannels?: boolean;
};

export type TemplateListReply = { items: TemplateCatalogItem[]; current: string };

/** Older callers can still supply the original option shape. New API replies
 * always include the version/format contract above. */
export type TemplateOption = Pick<TemplateCatalogItem, "key" | "name" | "description" | "kind">
  & Partial<Omit<TemplateCatalogItem, "key" | "name" | "description" | "kind">>;

const READING_PAGE_LABELS = ["표지", "뉴스 읽기 1", "뉴스 읽기 2", "STEP 1", "STEP 2", "STEP 3", "STEP 4", "닫는 표지"];
const LEGACY_READING_NAMES: Record<string, string> = {
  "reading-ink-lime-v1": "검정라임 · 기존 버전",
  "reading-cobalt-paper-v1": "코발트페이퍼 · 기존 버전",
};

/** Native rendering capability determines availability here. Canva source
 * approval and Autofill verification have their own independent gates. */
export function templateCatalogOptions(): TemplateCatalogItem[] {
  const reading: TemplateCatalogItem[] = READING_CARD_PROFILES.map(profile => ({
    key: profile.templateKey,
    templateKey: profile.templateKey,
    name: LEGACY_READING_NAMES[profile.id] ?? profile.label,
    description: `${profile.sourceStyleId ? "표지부터 닫는 표지까지 완성된" : "기존에 저장한 디자인을 유지하는"} 8장 세트 · 뉴스 읽기와 STEP 1–4`,
    kind: "builtin",
    family: "news",
    format: "family_dialogue_8",
    cardCopyVersion: 2,
    pageCount: 8,
    previewPageCount: 8,
    pageCountMode: "fixed",
    pageLabels: [...READING_PAGE_LABELS],
    generation: profile.sourceStyleId ? "cardnews14" : "legacy",
    templateVersion: profile.templateVersion,
    ...(profile.sourceStyleId ? {
      thumbnailUrl: `/cardnews14/${profile.sourceStyleId}-cover.webp`,
      overviewUrl: `/cardnews14/${profile.sourceStyleId}.webp`,
    } : {}),
  }));
  // The newest full sets are visible immediately; every original key survives.
  return [...reading.filter(item => item.generation === "cardnews14"), ...reading.filter(item => item.generation === "legacy"), ...cardDesignOptions()];
}

export function templateIncludesKey(template: TemplateOption, key: string): boolean {
  return template.key === key || !!template.colors?.some(color => color.key === key);
}

/** Resolve a palette to its exact selected key while retaining set metadata. */
export function templateSelection(item: TemplateOption, key = item.key): TemplateCatalogItem {
  const reading = item.format === "family_dialogue_8" || item.cardCopyVersion === 2;
  const previewPageCount = item.previewPageCount ?? item.pageCount ?? 1;
  return {
    ...item,
    key,
    templateKey: key,
    format: reading ? "family_dialogue_8" : "standard",
    cardCopyVersion: reading ? 2 : 1,
    pageCount: previewPageCount,
    previewPageCount,
    pageCountMode: item.pageCountMode ?? (reading ? "fixed" : "variable"),
  };
}

export function templateCatalogItem(key: string): TemplateCatalogItem | undefined {
  const item = templateCatalogOptions().find(item => templateIncludesKey(item, key));
  return item ? templateSelection(item, key) : undefined;
}
