import { z } from "zod";

export const NEWS_EDITORIAL_RESOURCE_TITLE_MAX = 180;
export const NEWS_EDITORIAL_RESOURCE_URL_MAX = 2000;
const norm = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

function publicHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}

/** Canonical metadata copied by the server from an actually supplied source, never authored by AI. */
export const newsEditorialResourceSchema = z.object({
  sourceId: z.number().int().positive(),
  title: z.string().trim().min(1).refine(value => [...value].length <= NEWS_EDITORIAL_RESOURCE_TITLE_MAX, "참고자료 제목은 180자 이내여야 합니다."),
  url: z.string().trim().max(NEWS_EDITORIAL_RESOURCE_URL_MAX).refine(publicHttpUrl, "참고자료는 실제 HTTP(S) 원문 주소여야 합니다."),
}).strict();
export type NewsEditorialResource = z.infer<typeof newsEditorialResourceSchema>;
export type NewsEditorialResourceSource = { source_id: number; title: string; url: string; text: string };

/** The caller supplies only successfully fetched sources belonging to this item. No network I/O. */
export function resolveNewsEditorialResource(sourceId: number, sources: NewsEditorialResourceSource[]): NewsEditorialResource | null {
  const matches = sources.filter(source => source.source_id === sourceId);
  if (matches.length !== 1 || matches[0].text.trim().length < 100) return null;
  const source = matches[0];
  const parsed = newsEditorialResourceSchema.safeParse({ sourceId, title: norm(source.title), url: source.url.trim() });
  return parsed.success ? parsed.data : null;
}

export function validateNewsEditorialResource(resource: unknown, sources: NewsEditorialResourceSource[]): string | null {
  const parsed = newsEditorialResourceSchema.safeParse(resource);
  if (!parsed.success) return "추가 활동 참고자료의 형식이 올바르지 않습니다.";
  const canonical = resolveNewsEditorialResource(parsed.data.sourceId, sources);
  if (!canonical) return "추가 활동 참고자료의 본문을 현재 원문에서 확인할 수 없습니다. 자료를 다시 확인하거나 참고자료를 지워 주세요.";
  if (parsed.data.title !== canonical.title || parsed.data.url !== canonical.url) return "추가 활동 참고자료의 제목·주소가 확보한 원문과 다릅니다. 원문에서 확인된 자료를 다시 선택해 주세요.";
  return null;
}

/**
 * This checks literal resource references, not scientific accuracy or venue availability.
 * Concrete names are presented through canonical metadata; short named mentions must
 * also occur in that selected source. General source-reading/search tasks remain usable.
 */
export function validateNewsEditorialActivity(text: string, resource: NewsEditorialResource | undefined, sources: NewsEditorialResourceSource[]): string | null {
  const unsupported = /(?:논문|과학관|박물관|전시회|학술지|DOI|arxiv)/i;
  const genericResearchTask = /(?:이|기사의)\s*(?:핵심\s*)?(?:개념|주제)(?:을|를)\s*(?:다룬|다루는|설명한)\s*논문/g;
  let remaining = norm(text).replace(genericResearchTask, "관련 자료");
  if (!unsupported.test(remaining)) return null;
  if (!resource) return "추가 활동의 특정 논문·방문 장소는 확보한 원문을 참고자료로 선택해야 합니다. 자료가 없으면 원문 읽기·관찰·비교 활동으로 제안해 주세요.";
  const invalid = validateNewsEditorialResource(resource, sources);
  if (invalid) return invalid;
  const source = sources.find(value => value.source_id === resource.sourceId)!;
  const corpus = norm(`${source.title}\n${source.text}`);
  // A quoted paper/exhibition name must actually occur in the selected source.
  remaining = remaining.replace(/[「『“‘"']([^」』”’"']{2,180})[」』”’"']\s*(논문|과학관|박물관|전시회|학술지)/g, (match, title: string) => corpus.includes(norm(title)) ? "참고자료" : match);
  // Full canonical names need no model-authored title or URL.
  remaining = remaining.split(norm(resource.title)).join("참고자료");
  // Named Korean institutions such as 국립중앙과학관 are checked as a whole word.
  remaining = remaining.replace(/[\p{L}\p{N}·]+(?:논문|과학관|박물관|전시회|학술지)/gu, match => corpus.includes(match) ? "참고자료" : match);
  remaining = remaining.replace(/(?:이|해당|참고자료의|원문에\s*소개된)\s*(논문|과학관|박물관|전시회|학술지)/g, (match, type: string) => corpus.includes(type) ? "참고자료" : match);
  return unsupported.test(remaining) ? "추가 활동에서 언급한 논문·방문 장소의 이름이 선택한 참고 원문과 일치하지 않습니다. 자료 제목은 참고자료 영역에 표시하고 본문에는 관찰·비교할 행동을 써 주세요." : null;
}
