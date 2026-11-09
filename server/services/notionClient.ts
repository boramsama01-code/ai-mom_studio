import { createHash } from "node:crypto";
import {
  DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID, notionDocumentQuerySchema, notionDocumentUpdateSchema,
  type NotionConnectionStatus, type NotionDocument, type NotionDocumentList,
  type NotionDocumentPage, type NotionDocumentQuery, type NotionDocumentSummary,
  type NotionDocumentUpdate, type NotionPhoto,
} from "../../shared/notionSync";
import { safeFetch } from "./safeFetch";

export const NOTION_API_VERSION = "2025-09-03";
const API = "https://api.notion.com/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID = /^[0-9a-f]{32}$/i;
const MAX_BLOCKS = 600, MAX_DEPTH = 5, MAX_API_BYTES = 3 * 1024 * 1024;
export const NOTION_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
export const NOTION_PHOTO_HOSTS = [
  "prod-files-secure.s3.us-west-2.amazonaws.com", "prod-files-secure.s3.amazonaws.com",
  "s3.us-west-2.amazonaws.com", "secure.notion-static.com", "file.notion.so",
];

export class NotionSyncError extends Error {
  constructor(message: string, public status = 502, public code = "NOTION_REQUEST_FAILED", public details?: Record<string, unknown>) {
    super(message); this.name = "NotionSyncError";
  }
}

/** URLs are identifiers only. They are never fetched or used as API destinations. */
export function normalizeNotionPageId(value: string): string {
  let candidate = String(value ?? "").trim();
  if (/^https?:\/\//i.test(candidate)) {
    let url: URL;
    try { url = new URL(candidate); } catch { throw new NotionSyncError("노션 페이지 주소를 확인해 주세요.", 400, "INVALID_NOTION_ID"); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["notion.so", "www.notion.so", "notion.com", "www.notion.com", "app.notion.com"].includes(url.hostname.toLowerCase()))
      throw new NotionSyncError("공식 노션 페이지 주소 또는 페이지 ID를 입력해 주세요.", 400, "INVALID_NOTION_ID");
    const tail = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    candidate = tail.match(/(?:^|-)([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] ?? "";
  }
  if (COMPACT_UUID.test(candidate)) candidate = candidate.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  if (!UUID.test(candidate)) throw new NotionSyncError("노션 페이지 ID를 확인해 주세요.", 400, "INVALID_NOTION_ID");
  return candidate.toLowerCase();
}

type Obj = Record<string, any>;
type Block = { id: string; type: string; has_children?: boolean; [key: string]: any };
type PageLayout = { page: NotionDocumentPage; heading: Block; title?: Block; body: Block[]; writable: boolean };
type Snapshot = { document: NotionDocument; layouts: PageLayout[] };
export type NotionPropertyPatch = { coverTitle?: string; studioUrl?: string; outputUrl?: string };
type ClientOptions = {
  fetch?: typeof globalThis.fetch; safeFetch?: typeof safeFetch;
  env?: () => Record<string, string | undefined>; pause?: (ms: number) => Promise<void>;
};
export type NotionWriteOptions={signal?:AbortSignal;beforeWrite?:()=>Promise<void>};
function cancellationError(signal:AbortSignal):NotionSyncError {
  return signal.reason instanceof NotionSyncError?signal.reason:new NotionSyncError("동기화 요청이 중단되었습니다. 노션 원고를 다시 확인해 주세요.",409,"NOTION_OPERATION_CANCELLED");
}
function checkSignal(signal?:AbortSignal){if(signal?.aborted)throw cancellationError(signal);}
async function abortable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return promise;if(signal.aborted){void promise.catch(()=>{});throw cancellationError(signal);}
  let listener:()=>void=()=>{};
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{listener=()=>reject(cancellationError(signal));signal.addEventListener('abort',listener,{once:true});})]);}
  finally{signal.removeEventListener('abort',listener);}
}
/** Renewal is fenced by the durable operation token supplied by the caller. */
export async function withNotionWriteLease<T>(renew:()=>Promise<boolean>,operation:(options:NotionWriteOptions)=>Promise<T>,timing:{heartbeatMs?:number;timeoutMs?:number}={}):Promise<T>{
  const controller=new AbortController();let pending:Promise<void>|undefined;
  const deadline=setTimeout(()=>controller.abort(new NotionSyncError('노션 반영 시간이 길어 중단했습니다. 원고를 다시 불러와 반영 상태를 확인해 주세요.',504,'NOTION_OPERATION_TIMEOUT')),timing.timeoutMs??180_000);
  deadline.unref?.();
  const beforeWrite=async()=>{
    checkSignal(controller.signal);
    if(!pending)pending=(async()=>{
      try{if(!await renew())throw new NotionSyncError('동기화 작업의 연결 상태가 바뀌었습니다. 원고를 다시 확인해 주세요.',409,'NOTION_LEASE_LOST');}
      catch(error){controller.abort(error instanceof NotionSyncError?error:new NotionSyncError('동기화 작업의 잠금을 갱신하지 못했습니다. 원고를 다시 확인해 주세요.',503,'NOTION_LEASE_UNAVAILABLE'));throw cancellationError(controller.signal);}
    })().finally(()=>{pending=undefined;});
    await abortable(pending,controller.signal);checkSignal(controller.signal);
  };
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  try{
    await beforeWrite();
    heartbeat=setInterval(()=>{void beforeWrite().catch(()=>{});},timing.heartbeatMs??20_000);heartbeat.unref?.();
    return await operation({signal:controller.signal,beforeWrite});
  }finally{clearTimeout(deadline);if(heartbeat)clearInterval(heartbeat);}
}
const richText = (value: unknown): string => Array.isArray(value)
  ? value.map((r: Obj) => typeof r.plain_text === "string" ? r.plain_text : r.text?.content ?? "").join("") : "";
const textOf = (block: Block): string => block.type === "table_row"
  ? (block.table_row?.cells ?? []).map(richText).join(" | ") : richText(block[block.type]?.rich_text);
const property = (page: Obj, key: string): Obj => page.properties?.[key] ?? {};
function propertyText(page: Obj, key: string): string {
  const p = property(page, key);
  if (p.type === "title" || p.type === "rich_text") return richText(p[p.type]);
  return p.select?.name ?? p.status?.name ?? p.url ?? "";
}
const plainBody = (parts: string[]): string => parts.filter(x => x.trim()).join("\n").trim();
function stableFileIdentity(url: string): string {
  try { const u = new URL(url); return `${u.hostname.toLowerCase()}${u.pathname}`; } catch { return ""; }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function summaryOf(page: Obj): NotionDocumentSummary {
  const id = normalizeNotionPageId(page.id);
  const category = property(page, "소분류").multi_select?.map((x: Obj) => x.name).filter(Boolean) ?? [];
  return {
    pageId: id, url: `https://www.notion.so/${id.replaceAll("-", "")}`,
    lastEditedAt: typeof page.last_edited_time === "string" ? page.last_edited_time : "",
    contentKey: propertyText(page, "콘텐츠키"), title: propertyText(page, "제목") || "제목 없는 원고",
    coverTitle: propertyText(page, "표지제목"), channel: propertyText(page, "채널"),
    category: category[0] ?? "", template: propertyText(page, "템플릿"), stage: propertyText(page, "제작상태"),
    verified: propertyText(page, "검증상태") === "원문 대조",
  };
}
function imageFile(block: Block): Obj | null {
  if (block.type !== "image") return null;
  return block.image?.file ?? block.image?.external ?? null;
}
function parseDocument(page: Obj, blocks: Block[]): Snapshot {
  const summary = summaryOf(page), photos: NotionPhoto[] = [], photoKeys = new Set<string>();
  const addPhoto = (key: string, name: string, url: unknown) => {
    if (typeof url !== "string" || photos.length >= 12 || photoKeys.has(key)) return;
    try { assertNotionPhotoUrl(url); } catch { return; }
    photoKeys.add(key); photos.push({ key, name, url });
  };
  for (const name of ["사진원본", "사진 원본"]) {
    const p = property(page, name);
    for (const file of p.files ?? []) {
      const url = file.file?.url ?? file.external?.url;
      addPhoto(`property:${p.id ?? name}:${hash([file.name ?? "사진", stableFileIdentity(url ?? "")]).slice(0, 24)}`, file.name ?? "사진", url);
    }
  }
  for (const b of blocks) {
    if (/^heading_[123]$/.test(b.type) && /^내부\s*검토/.test(textOf(b).trim())) break;
    const file = imageFile(b); if (file) addPhoto(`block:${b.id}`, richText(b.image.caption) || "본문 사진", file.url);
  }

  const layouts: PageLayout[] = [];
  let publishing = false, captionMode = false;
  const captionParts: string[] = [];
  let current: { heading: Block; index: number; inlineTitle: string; blocks: Block[] } | null = null;
  const flush = () => {
    if (!current) return;
    // Source citations and verification notes remain in Notion, outside editable card copy.
    const textBlocks = current.blocks.filter(b => (Array.isArray(b[b.type]?.rich_text) || b.type === "table_row")
      && !/^(원문|출처|자료\s*출처|확인일|검증\s*기준일)\s*[:：]/.test(textOf(b).trim()));
    const first = textBlocks.find(b => textOf(b).trim());
    const title = first && Array.isArray(first[first.type]?.rich_text) && (first[first.type].rich_text.every((r: Obj) => !richText([r]).trim() || r.annotations?.bold)
      || !current.inlineTitle || /^(표지|내지|마무리|채널소개)$/.test(current.inlineTitle)) ? first : undefined;
    const body = textBlocks.filter(b => b !== title);
    const result: NotionDocumentPage = {
      index: current.index, title: title ? textOf(title).trim() : current.inlineTitle,
      body: plainBody(body.map(textOf)), headingBlockId: current.heading.id,
      bodyBlockIds: body.map(b => b.id), ...(title ? { titleBlockId: title.id } : {}),
    };
    layouts.push({ page: result, heading: current.heading, title, body,
      writable: !current.blocks.some(b => b.has_children) && ![...body, ...(title ? [title] : [])].some(b => !["paragraph", "bulleted_list_item", "numbered_list_item", "quote", "callout"].includes(b.type)) });
    current = null;
  };
  for (const b of blocks) {
    const text = textOf(b).trim(), heading = /^heading_[123]$/.test(b.type);
    if (heading && /^내부\s*검토/.test(text)) { flush(); break; }
    if (heading && /^게시용\s*원고/.test(text)) { flush(); publishing = true; continue; }
    if (heading && /^(게시용\s*)?캡션$/.test(text)) { flush(); captionMode = true; continue; }
    if (captionMode) { if (text) captionParts.push(text); continue; }
    if (!publishing) continue;
    const chapter = heading ? /^(\d{1,2})\s*장(?:\s*[—–\-:：]\s*(.*))?$/.exec(text) : null;
    if (chapter) { flush(); current = { heading: b, index: Number(chapter[1]), inlineTitle: chapter[2]?.trim() ?? "", blocks: [] }; continue; }
    if (current) current.blocks.push(b);
  }
  flush();
  if (layouts.length > 30 || new Set(layouts.map(x => x.page.index)).size !== layouts.length)
    throw new NotionSyncError("장 번호가 중복되거나 지원 범위를 넘었습니다. 노션 원고 구성을 확인해 주세요.", 422, "NOTION_DOCUMENT_STRUCTURE");
  // Signed URL query/expiry values and our outbound studio/result links are deliberately absent.
  const caption = propertyText(page, "캡션") || plainBody(captionParts);
  const sourceHash = hash({
    ...summary, lastEditedAt: undefined, caption,
    sourceUrl: propertyText(page, "원문링크"), verificationNotes: propertyText(page, "확인메모"),
    sourceReferences: property(page, "출처자료").relation?.map((r: Obj) => r.id) ?? [],
    photoSources: ["사진원본", "사진 원본"].flatMap(name => (property(page, name).files ?? []).map((file: Obj) => ({
      name: file.name ?? "사진", identity: stableFileIdentity(file.file?.url ?? file.external?.url ?? ""),
    }))),
    photos: photos.map(({ key, name }) => ({ key, name })),
    blocks: blocks.map(b => ({ id: b.id, type: b.type, text: textOf(b), hasChildren: !!b.has_children,
      richText: b[b.type]?.rich_text?.map((r: Obj) => ({ text: richText([r]), annotations: r.annotations, link: r.text?.link?.url ?? r.href ?? null })),
      image: imageFile(b) ? stableFileIdentity(imageFile(b)!.url ?? "") : undefined })),
  });
  return { document: { ...summary, caption, sourceHash, pages: layouts.map(x => x.page), photos }, layouts };
}

export function assertNotionPhotoUrl(value: string): URL {
  let u: URL;
  try { u = new URL(value); } catch { throw new NotionSyncError("사진 주소를 확인해 주세요.", 400, "INVALID_NOTION_PHOTO_URL"); }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !NOTION_PHOTO_HOSTS.includes(u.hostname.toLowerCase())
    || u.hostname === "s3.us-west-2.amazonaws.com" && !/^\/(secure\.notion-static\.com|prod-files-secure)\//.test(u.pathname))
    throw new NotionSyncError("노션에 업로드한 사진 원본만 가져올 수 있습니다.", 400, "INVALID_NOTION_PHOTO_URL");
  return u;
}

export function createNotionClient(options: ClientOptions = {}) {
  const transport = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const mediaFetch = options.safeFetch ?? safeFetch;
  const env = options.env ?? (() => process.env);
  const pause = options.pause ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const configuration = () => {
    const values = env(), token = values.NOTION_API_TOKEN?.trim() ?? "";
    let dataSourceId = "";
    try { dataSourceId = normalizeNotionPageId(values.NOTION_CONTENT_DATA_SOURCE_ID?.trim() || DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID); } catch { /* Report only a field name, never its submitted value. */ }
    return { token, dataSourceId };
  };
  const getNotionConnectionStatus = (): NotionConnectionStatus => {
    const c = configuration(), missing = [...(!c.token ? ["NOTION_API_TOKEN"] : []), ...(!c.dataSourceId ? ["NOTION_CONTENT_DATA_SOURCE_ID"] : [])];
    return { configured: missing.length === 0, dataSourceId: c.dataSourceId, missing };
  };
  const notionConfigured = () => getNotionConnectionStatus().configured;
  async function request(path: string, method = "GET", body?: Obj, signal?:AbortSignal): Promise<Obj> {
    checkSignal(signal);
    const c = configuration();
    if (!notionConfigured()) throw new NotionSyncError("연결 관리에서 노션 연결 키와 제작표를 확인해 주세요.", 503, "NOTION_NOT_CONFIGURED");
    let res: Response;
    try { res = await transport(`${API}${path}`, { method, redirect: "error", signal: signal?AbortSignal.any([signal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000),
      headers: { Authorization: `Bearer ${c.token}`, "Notion-Version": NOTION_API_VERSION, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { checkSignal(signal);throw new NotionSyncError("노션 서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.", 502, "NOTION_NETWORK_ERROR"); }
    if (!res.ok) {
      await res.body?.cancel();
      const status = res.status === 404 ? 404 : res.status === 429 ? 429 : res.status === 401 || res.status === 403 ? 403 : 502;
      throw new NotionSyncError(res.status === 401 || res.status === 403 ? "노션 연결 권한을 확인해 주세요. 제작표를 해당 연결에 공유해야 합니다."
        : res.status === 404 ? "연결에서 접근할 수 있는 노션 원고를 찾지 못했습니다."
          : res.status === 429 ? "노션 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요." : "노션 요청을 완료하지 못했습니다.", status, "NOTION_API_ERROR", { upstreamStatus: res.status });
    }
    const reader = res.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
        if (length > MAX_API_BYTES) { await reader.cancel(); throw new NotionSyncError("노션 응답이 지원 크기를 넘었습니다.", 413, "NOTION_RESPONSE_TOO_LARGE"); } chunks.push(part.value); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (e) { checkSignal(signal);if (e instanceof NotionSyncError) throw e; throw new NotionSyncError("노션 응답을 읽지 못했습니다.", 502, "NOTION_INVALID_RESPONSE"); }
  }
  function assertMembership(page: Obj) {
    if (page.archived || page.in_trash) throw new NotionSyncError("휴지통의 노션 원고는 가져올 수 없습니다.", 404, "NOTION_PAGE_ARCHIVED");
    const parent = page.parent?.data_source_id;
    if (!parent || normalizeNotionPageId(parent) !== configuration().dataSourceId)
      throw new NotionSyncError("연결한 콘텐츠 제작표 안의 원고만 사용할 수 있습니다.", 403, "NOTION_PAGE_OUTSIDE_DATA_SOURCE");
  }
  async function listBlocks(id: string, depth: number, budget: { count: number },signal?:AbortSignal): Promise<Block[]> {
    if (depth > MAX_DEPTH) throw new NotionSyncError("노션 원고의 중첩 구조가 너무 깊습니다.", 422, "NOTION_DOCUMENT_TOO_LARGE");
    const blocks: Block[] = []; let cursor: string | undefined;
    for (let batch = 0; batch < 7; batch++) {
      const result = await request(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`,"GET",undefined,signal);
      if (!Array.isArray(result.results)) throw new NotionSyncError("노션 블록 응답을 확인할 수 없습니다.", 502, "NOTION_INVALID_RESPONSE");
      for (const item of result.results) {
        if (++budget.count > MAX_BLOCKS) throw new NotionSyncError("노션 원고가 지원 크기를 넘었습니다.", 422, "NOTION_DOCUMENT_TOO_LARGE");
        const b = item as Block; b.id = normalizeNotionPageId(b.id); blocks.push(b);
        if (b.has_children) blocks.push(...await listBlocks(b.id, depth + 1, budget,signal));
      }
      if (!result.has_more) return blocks;
      if (typeof result.next_cursor !== "string" || result.next_cursor === cursor) throw new NotionSyncError("노션 페이지 나누기 응답을 확인해 주세요.", 502, "NOTION_INVALID_RESPONSE");
      cursor = result.next_cursor;
    }
    throw new NotionSyncError("노션 원고의 블록 수가 지원 범위를 넘었습니다.", 422, "NOTION_DOCUMENT_TOO_LARGE");
  }
  async function snapshot(pageId: string,signal?:AbortSignal): Promise<Snapshot> {
    const id = normalizeNotionPageId(pageId), page = await request(`/pages/${id}`,"GET",undefined,signal); assertMembership(page);
    return parseDocument(page, await listBlocks(id, 0, { count: 0 },signal));
  }
  async function resolveChannelOption(channel: string): Promise<string | undefined> {
    const source = await request(`/data_sources/${configuration().dataSourceId}`);
    const property = source.properties?.["채널"];
    if (property?.type !== "select" || !Array.isArray(property.select?.options))
      throw new NotionSyncError("제작표의 ‘채널’은 선택(select) 속성이어야 합니다. 노션 제작표의 속성 형식을 확인해 주세요.", 422, "NOTION_CHANNEL_SCHEMA_UNSUPPORTED");
    const options = property.select.options as Obj[];
    if (options.some(option => typeof option?.name !== "string" || !option.name.trim()))
      throw new NotionSyncError("노션 채널의 선택 항목 응답을 확인할 수 없습니다.", 502, "NOTION_INVALID_RESPONSE");
    const names = options.map(option => option.name as string), fold = (name: string) => name.trim().toLowerCase();
    // Notion select filters require the stored option's exact spelling. Preserve
    // custom channel names; only fall back to the app's known Korean brand alias.
    const exact = names.find(name => name === channel);
    if (exact !== undefined) return exact;
    const matching = names.filter(name => fold(name) === fold(channel));
    if (!matching.length && channel === "우주펭귄상회") matching.push(...names.filter(name => fold(name) === "spacepenguin"));
    if (matching.length > 1)
      throw new NotionSyncError("노션 채널의 선택 항목 이름이 겹칩니다. 정확한 이름으로 구분해 주세요.", 422, "NOTION_CHANNEL_SCHEMA_UNSUPPORTED");
    return matching[0];
  }
  async function queryNotionDocuments(input: NotionDocumentQuery = {}): Promise<NotionDocumentList> {
    const data = notionDocumentQuerySchema.parse(input), filters: Obj[] = [];
    if (data.query) filters.push({ property: "제목", title: { contains: data.query } });
    if (data.channel) {
      const channel = await resolveChannelOption(data.channel);
      if (channel === undefined) return { documents: [], hasMore: false };
      filters.push({ property: "채널", select: { equals: channel } });
    }
    const documents: NotionDocumentSummary[] = []; let cursor = data.cursor, hasMore = false;
    for (let i = 0; i < 2; i++) {
      const result = await request(`/data_sources/${configuration().dataSourceId}/query`, "POST", {
        page_size: 50, sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        ...(filters.length ? { filter: { and: filters } } : {}), ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!Array.isArray(result.results)) throw new NotionSyncError("노션 목록 응답을 확인할 수 없습니다.", 502, "NOTION_INVALID_RESPONSE");
      documents.push(...result.results.filter((p: Obj) => !p.archived && !p.in_trash).map(summaryOf));
      hasMore = !!result.has_more;
      if (!hasMore) return { documents, hasMore: false };
      if (typeof result.next_cursor !== "string" || result.next_cursor === cursor) throw new NotionSyncError("노션 목록 페이지 정보를 확인할 수 없습니다.", 502, "NOTION_INVALID_RESPONSE");
      cursor = result.next_cursor;
    }
    return { documents, hasMore, ...(hasMore ? { nextCursor: cursor } : {}) };
  }
  const fetchNotionDocument = async (pageId: string): Promise<NotionDocument> => (await snapshot(pageId)).document;
  function propertyChanges(patch: NotionPropertyPatch): Obj {
    const result: Obj = {};
    if (patch.coverTitle !== undefined && patch.coverTitle.length > 4000) throw new NotionSyncError("표지제목이 지원 길이를 넘었습니다.", 400, "NOTION_TITLE_TOO_LONG");
    if (patch.coverTitle !== undefined) result["표지제목"] = { rich_text: makeRichText(patch.coverTitle) };
    for (const [key, name] of [["studioUrl", "스튜디오링크"], ["outputUrl", "결과물링크"]] as const) if (patch[key] !== undefined) {
      let u: URL; try { u = new URL(patch[key]!); } catch { throw new NotionSyncError("결과물 주소를 확인해 주세요.", 400, "INVALID_NOTION_LINK"); }
      if (u.protocol !== "https:" || u.username || u.password) throw new NotionSyncError("HTTPS 결과물 주소를 입력해 주세요.", 400, "INVALID_NOTION_LINK");
      result[name] = { url: u.href };
    }
    return result;
  }
  async function patchNotionDocumentProperties(pageId: string, patch: NotionPropertyPatch): Promise<void> {
    const id = normalizeNotionPageId(pageId), changes = propertyChanges(patch);
    if (!Object.keys(changes).length) return;
    assertMembership(await request(`/pages/${id}`));
    await request(`/pages/${id}`, "PATCH", { properties: changes });
  }
  async function updateNotionDocument(input: NotionDocumentUpdate,options:NotionWriteOptions={}): Promise<NotionDocument> {
    const data = notionDocumentUpdateSchema.parse(input), id = normalizeNotionPageId(data.pageId), before = await snapshot(id,options.signal);
    if (before.document.sourceHash !== data.expectedSourceHash)
      throw new NotionSyncError("노션 원고가 바뀌었습니다. 최신 원고를 비교한 뒤 다시 반영해 주세요.", 409, "NOTION_SOURCE_CONFLICT", { current: before.document });
    if (before.layouts.length !== data.pages.length || before.layouts.some((p, i) => p.page.index !== data.pages[i].index || !p.writable))
      throw new NotionSyncError("노션과 스튜디오의 장 구성 또는 본문 구조가 다릅니다. 같은 장 수의 원고만 다시 반영할 수 있습니다.", 409, "NOTION_STRUCTURE_CONFLICT");
    const changes: Array<{ block: Block; text: string }> = [];
    for (let i = 0; i < before.layouts.length; i++) {
      const layout = before.layouts[i], next = data.pages[i];
      if (next.title !== layout.page.title) {
        if (layout.title) changes.push({ block: layout.title, text: next.title });
        else changes.push({ block: layout.heading, text: `${next.index}장 — ${next.title}` });
      }
      if (next.body !== layout.page.body) {
        if (!layout.body.length) throw new NotionSyncError("본문을 넣을 기존 블록이 없습니다. 노션에서 본문을 먼저 작성해 주세요.", 409, "NOTION_STRUCTURE_CONFLICT");
        const lines = next.body.split("\n");
        layout.body.forEach((block, j) => changes.push({ block, text: j === layout.body.length - 1 ? lines.slice(j).join("\n") : lines[j] ?? "" }));
      }
    }
    const properties = propertyChanges(data), appliedBlockIds: string[] = [];
    const snapshots = changes.map(({ block }) => ({ blockId: block.id, type: block.type, richText: block[block.type].rich_text }));
    let propertyPatchApplied = false, propertyPatchAttempted = false, attemptedBlockId: string | undefined;
    try {
      for (const change of changes) {
        if (appliedBlockIds.length) await abortable(pause(350),options.signal);
        await options.beforeWrite?.();checkSignal(options.signal);
        attemptedBlockId = change.block.id;
        await request(`/blocks/${change.block.id}`, "PATCH", { [change.block.type]: { rich_text: makeRichText(change.text, change.block[change.block.type].rich_text) } },options.signal);
        appliedBlockIds.push(change.block.id);
      }
      if (Object.keys(properties).length) { if (appliedBlockIds.length) await abortable(pause(350),options.signal);await options.beforeWrite?.();checkSignal(options.signal);propertyPatchAttempted = true; await request(`/pages/${id}`, "PATCH", { properties },options.signal); propertyPatchApplied = true; }
    } catch (error) {
      const explicitlyRejected=error instanceof NotionSyncError&&error.code==='NOTION_API_ERROR'&&[400,401,403,404,429].includes(Number(error.details?.upstreamStatus));
      if (!appliedBlockIds.length&&!propertyPatchApplied&&(!attemptedBlockId&&!propertyPatchAttempted||explicitlyRejected)) throw error;
      throw new NotionSyncError("노션 수정 결과가 일부만 확인되었습니다. 노션 원고를 다시 불러와 확인해 주세요.", 502, "NOTION_PARTIAL_WRITE", { appliedBlockIds, attemptedBlockId, propertyPatchAttempted, propertyPatchApplied, snapshots });
    }
    try { return (await snapshot(id,options.signal)).document; }
    catch { throw new NotionSyncError("노션 수정 요청은 완료됐지만 결과를 다시 읽지 못했습니다. 원고를 다시 불러와 확인해 주세요.", 502, "NOTION_WRITE_READBACK_FAILED", { appliedBlockIds, propertyPatchApplied, snapshots }); }
  }
  async function downloadNotionPhoto(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const parsed = assertNotionPhotoUrl(url);
    const result = await mediaFetch(parsed.href, { maxBytes: NOTION_PHOTO_MAX_BYTES, timeoutMs: 18000, maxRedirects: 3,
      allowedHosts: NOTION_PHOTO_HOSTS, accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" });
    assertNotionPhotoUrl(result.finalUrl);
    const mimeType = result.contentType.split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"].includes(mimeType)
      || !imageSignatureMatches(result.body, mimeType)
      || !result.body.length || result.body.length > NOTION_PHOTO_MAX_BYTES)
      throw new NotionSyncError("지원하는 사진 원본(JPG·PNG·WebP·GIF·HEIC) 12MB 이하만 가져올 수 있습니다.", 415, "NOTION_INVALID_PHOTO");
    return { buffer: result.body, mimeType };
  }
  return { notionConfigured, getNotionConnectionStatus, queryNotionDocuments, fetchNotionDocument, updateNotionDocument, patchNotionDocumentProperties, downloadNotionPhoto };
}

function makeRichText(text: string, existing?: Obj[]): Obj[] {
  const annotation = existing?.find(x => x.type === "text")?.annotations;
  const chunks: Obj[] = [];
  // A Notion rich-text text.content value is limited to 2000 characters.
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + 1800, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push({ type: "text", text: { content: text.slice(i, end) }, ...(annotation ? { annotations: annotation } : {}) });
    i = end;
  }
  return chunks;
}
function imageSignatureMatches(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mime === "image/gif") return bytes.length >= 6 && /^(GIF87a|GIF89a)$/.test(bytes.toString("ascii", 0, 6));
  return ["image/heic", "image/heif"].includes(mime) && bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp" && /heic|heix|hevc|hevx|mif1|msf1/.test(bytes.toString("ascii", 8, Math.min(64, bytes.length)));
}
const defaultClient = createNotionClient();
export const { notionConfigured, getNotionConnectionStatus, queryNotionDocuments, fetchNotionDocument, updateNotionDocument, patchNotionDocumentProperties, downloadNotionPhoto } = defaultClient;
