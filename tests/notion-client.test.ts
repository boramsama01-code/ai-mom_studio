import { describe, expect, it, vi } from "vitest";
import {
  createNotionClient, normalizeNotionPageId, NOTION_API_VERSION, NOTION_PHOTO_HOSTS, NOTION_PHOTO_MAX_BYTES,
  withNotionWriteLease, NotionSyncError,
} from "../server/services/notionClient";
import { DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID, notionDocumentSchema } from "../shared/notionSync";
import { SECRET_GROUPS } from "../shared/secretsCatalog";
import type { safeFetch } from "../server/services/safeFetch";

const id = (n: number) => `4135c7c8-45fc-8101-ba1c-${String(n).padStart(12, "0")}`;
const pageId = id(1), token = "secret-fixture-never-return";
const assetUrl = "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/file/photo.png?X-Amz-Signature=first";
function rich(text: string, bold = false) { return [{ type: "text", text: { content: text }, plain_text: text, annotations: { bold, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }]; }
function block(n: number, type: string, text: string, bold = false): any { return { id: id(n), type, has_children: false, [type]: { rich_text: rich(text, bold) } }; }
function fixture() {
  const page: any = { object: "page", id: pageId, parent: { type: "data_source_id", data_source_id: DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID },
    last_edited_time: "2026-11-09T02:04:39.914Z", archived: false, properties: {
      "제목": { type: "title", title: rich("서울 중등 영재교육원") }, "표지제목": { type: "rich_text", rich_text: rich("원서만 쓰면 끝?") },
      "채널": { type: "select", select: { name: "HighScoop" } }, "소분류": { type: "multi_select", multi_select: [{ name: "영재교육" }] },
      "콘텐츠키": { type: "rich_text", rich_text: rich("GED2027-서울-중등") }, "템플릿": { type: "rich_text", rich_text: rich("highscoop-a") },
      "제작상태": { type: "status", status: { name: "원고 검토" } }, "검증상태": { type: "select", select: { name: "원문 대조" } },
      "사진 원본": { type: "files", id: "photos", files: [{ name: "휴대폰.png", type: "file", file: { url: assetUrl, expiry_time: "2026-11-09T03:00:00Z" } }] },
    } };
  const blocks: any[] = [block(2, "heading_2", "게시용 원고"), block(3, "heading_3", "1장"),
    block(4, "paragraph", "원서만 쓰면 끝? 전형료 납부까지 확인하세요", true), block(5, "paragraph", "2027학년도 서울 중등 영재교육원\n강남서초 사례\n2026년 기준"),
    { id: id(6), type: "image", image: { type: "file", file: { url: assetUrl.replace("photo.png", "body.png") }, caption: rich("실험 사진") } },
    block(7, "heading_3", "2장"), block(8, "paragraph", "학생 마감과 추천 마감은 다릅니다", true), block(9, "paragraph", "학생 지원: 11월 4일~11일 18시\n교사 추천: 11월 4일~12일"),
    block(10, "paragraph", "원문: GED 공고 25796"), block(11, "heading_2", "내부 검토 — 카드에 넣지 않음"), block(12, "paragraph", "비공개 검토 메모 보존"),
    { id: id(13), type: "image", image: { type: "file", file: { url: assetUrl.replace("photo.png", "private.png") }, caption: rich("내부 이미지") } }];
  const calls: Array<{ path: string; method: string; body?: any; init?: RequestInit }> = [];
  let failBlock: string | undefined, networkBlock: string | undefined;
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), path = url.pathname + url.search, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body, init });
    if (method === "GET" && url.pathname === `/v1/pages/${pageId}`) return Response.json(structuredClone(page));
    if (method === "GET" && url.pathname === `/v1/blocks/${pageId}/children`) return Response.json({ results: structuredClone(blocks), has_more: false, next_cursor: null });
    if (method === "GET" && url.pathname.endsWith("/children")) return Response.json({ results: [], has_more: false, next_cursor: null });
    if (method === "PATCH" && url.pathname.startsWith("/v1/blocks/")) {
      const key = url.pathname.split("/").at(-1)!;
      if (key === networkBlock) throw new Error(token);
      if (key === failBlock) return Response.json({ message: token }, { status: 500 });
      const item = blocks.find(x => x.id === key)!; Object.assign(item[item.type], body[item.type]);
      return Response.json(structuredClone(item));
    }
    if (method === "PATCH" && url.pathname === `/v1/pages/${pageId}`) {
      for (const [k, v] of Object.entries(body.properties)) Object.assign(page.properties[k] ??= {}, v);
      return Response.json(structuredClone(page));
    }
    throw new Error(`Unexpected fixture request ${path}`);
  }) as unknown as typeof fetch;
  const client = createNotionClient({ fetch: transport, env: () => ({ NOTION_API_TOKEN: token }), pause: async () => {} });
  return { client, page, blocks, calls, transport, fail: (key: string) => { failBlock = key; }, failNetwork: (key: string) => { networkBlock = key; } };
}

describe("Notion identifiers and connection configuration", () => {
  it("accepts UUIDs and official Notion links without fetching user-provided URLs", () => {
    expect(normalizeNotionPageId(pageId.toUpperCase())).toBe(pageId);
    expect(normalizeNotionPageId(pageId.replaceAll("-", ""))).toBe(pageId);
    expect(normalizeNotionPageId(`https://www.notion.so/원고-${pageId.replaceAll("-", "")}?pvs=4`)).toBe(pageId);
    expect(normalizeNotionPageId(`https://app.notion.com/p/${pageId.replaceAll("-", "")}`)).toBe(pageId);
  });
  it.each([`https://notion.so.evil.example/${pageId}`, `http://www.notion.so/${pageId}`, `https://user:pass@notion.so/${pageId}`, `https://notion.so:8443/${pageId}`, `https://127.0.0.1/${pageId}`, "not-a-page"])("rejects an untrusted identifier %s", value => {
    expect(() => normalizeNotionPageId(value)).toThrow();
  });
  it("uses the actual content data source and exposes no token in connection status or errors", async () => {
    const c = createNotionClient({ env: () => ({}) });
    expect(c.getNotionConnectionStatus()).toEqual({ configured: false, dataSourceId: DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID, missing: ["NOTION_API_TOKEN"] });
    await expect(c.fetchNotionDocument(pageId)).rejects.toMatchObject({ status: 503, code: "NOTION_NOT_CONFIGURED" });
    const f = fixture(); expect(f.client.getNotionConnectionStatus().configured).toBe(true);
    expect(JSON.stringify(f.client.getNotionConnectionStatus())).not.toContain(token);
    const fields = SECRET_GROUPS.find(g => g.id === "notion")!.fields;
    expect(fields.find(f => f.key === "NOTION_API_TOKEN")?.secret).toBe(true);
    expect(fields.find(f => f.key === "NOTION_CONTENT_DATA_SOURCE_ID")?.secret).toBe(false);
  });
});

describe("Notion source parsing and bounded queries", () => {
  it("imports current heading/bold-title manuscripts without internal notes, source notes, or internal images", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId);
    expect(notionDocumentSchema.parse(d)).toEqual(d);
    expect(d.pages).toHaveLength(2); expect(d.pages[0]).toMatchObject({ index: 1, title: "원서만 쓰면 끝? 전형료 납부까지 확인하세요", body: "2027학년도 서울 중등 영재교육원\n강남서초 사례\n2026년 기준", headingBlockId: id(3), titleBlockId: id(4), bodyBlockIds: [id(5)] });
    expect(d.pages[1].body).not.toMatch(/원문|검토 메모/); expect(d.photos).toHaveLength(2);
    expect(d.photos.some(p => p.url.includes("private.png"))).toBe(false);
    expect(d.verified).toBe(true); expect(d.channel).toBe("HighScoop");
    expect(f.calls[0].init?.headers).toMatchObject({ "Notion-Version": NOTION_API_VERSION, Authorization: `Bearer ${token}` });
  });
  it("also reads level-two chapter headings with a title in the heading", async () => {
    const f = fixture(); f.blocks.splice(1, f.blocks.length - 1,
      block(3, "heading_2", "1장 — 영재교육 꿀팁"), block(5, "paragraph", "첫 번째 본문"),
      block(7, "heading_2", "2장 — 조건 확인"), block(9, "paragraph", "두 번째 본문"), block(11, "heading_2", "내부 검토"), block(12, "paragraph", "비공개"));
    const d = await f.client.fetchNotionDocument(pageId);
    expect(d.pages.map(p => [p.title, p.body])).toEqual([["영재교육 꿀팁", "첫 번째 본문"], ["조건 확인", "두 번째 본문"]]);
  });
  it("takes a separate caption section out of the last card body", async () => {
    const f = fixture(); f.blocks.splice(9, 0, block(14, "heading_2", "게시용 캡션"), block(15, "paragraph", "저장하고 다음 소식도 확인하세요."));
    const d = await f.client.fetchNotionDocument(pageId);
    expect(d.caption).toBe("저장하고 다음 소식도 확인하세요."); expect(d.pages[1].body).not.toContain("저장하고");
  });
  it("keeps source hashes stable when signed photo URLs or outbound result links refresh", async () => {
    const f = fixture(), first = await f.client.fetchNotionDocument(pageId);
    f.page.properties["사진 원본"].files[0].file.url = assetUrl.replace("first", "refreshed");
    f.blocks[4].image.file.url = f.blocks[4].image.file.url.replace("first", "refreshed");
    f.page.last_edited_time = "2026-11-10T00:00:00Z";
    f.page.properties["스튜디오링크"] = { type: "url", url: "https://studio.example/content/1" };
    const next = await f.client.fetchNotionDocument(pageId);
    expect(next.sourceHash).toBe(first.sourceHash); expect(next.photos[0].key).toBe(first.photos[0].key);
    f.blocks[3].paragraph.rich_text = rich("변경된 원문");
    expect((await f.client.fetchNotionDocument(pageId)).sourceHash).not.toBe(first.sourceHash);
  });
  it("limits photos to twelve and rejects non-Notion external image hosts", async () => {
    const f = fixture(); f.page.properties["사진 원본"].files = Array.from({ length: 20 }, (_, i) => ({ name: `${i}.png`, file: { url: assetUrl.replace("photo.png", `${i}.png`) } }));
    expect((await f.client.fetchNotionDocument(pageId)).photos).toHaveLength(12);
    f.page.properties["사진 원본"].files = [{ name: "외부", external: { url: "https://evil.example/file.jpg" } }];
    expect((await f.client.fetchNotionDocument(pageId)).photos).toHaveLength(1);
  });
  it("only reads pages belonging to the configured content table", async () => {
    const f = fixture(); f.page.parent.data_source_id = id(99);
    await expect(f.client.fetchNotionDocument(pageId)).rejects.toMatchObject({ status: 403, code: "NOTION_PAGE_OUTSIDE_DATA_SOURCE" });
    expect(f.calls.some(c => c.path.includes("children"))).toBe(false);
  });
  it("follows block pagination without silently returning an incomplete manuscript", async () => {
    const f = fixture(); let batches = 0;
    const transport = vi.fn(async (input: any) => {
      const u = new URL(String(input));
      if (u.pathname.includes("/pages/")) return Response.json(f.page);
      batches++; return Response.json(batches === 1
        ? { results: f.blocks.slice(0, 5), has_more: true, next_cursor: "next-blocks" }
        : { results: f.blocks.slice(5), has_more: false });
    });
    const d = await createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) }).fetchNotionDocument(pageId);
    expect(d.pages).toHaveLength(2); expect(d.pages[1].title).toBe("학생 마감과 추천 마감은 다릅니다");
    expect(transport.mock.calls[2][0]).toContain("start_cursor=next-blocks");
  });
  it("queries the data-source endpoint with channel/title filters and stops after two batches", async () => {
    const f = fixture(); let count = 0;
    const transport = vi.fn(async (_u: any, init: any) => {
      if (init.method === "GET") return Response.json({ properties: { "채널": { type: "select", select: { options: [{ name: "HighScoop" }] } } } });
      count++; return Response.json({ results: Array.from({ length: 50 }, () => f.page), has_more: true, next_cursor: `cursor-${count}` });
    });
    const c = createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) });
    const list = await c.queryNotionDocuments({ query: "서울", channel: "Highscoop", cursor: "previous-page" });
    expect(list.documents).toHaveLength(100); expect(list).toMatchObject({ hasMore: true, nextCursor: "cursor-2" }); expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls[0][0]).toBe(`https://api.notion.com/v1/data_sources/${DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID}`);
    expect(transport.mock.calls[1][0]).toBe(`https://api.notion.com/v1/data_sources/${DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID}/query`);
    expect(JSON.parse(String(transport.mock.calls[1][1].body))).toMatchObject({ start_cursor: "previous-page", filter: { and: [{ property: "제목", title: { contains: "서울" } }, { property: "채널", select: { equals: "HighScoop" } }] } });
    expect(JSON.parse(String(transport.mock.calls[2][1].body)).start_cursor).toBe("cursor-1");
  });
  it.each([
    ["Highscoop", "HighScoop"], ["Alligodang", "ALLigodang"], ["fryday", "Fryday"],
    ["우주펭귄상회", "SpacePenguin"], ["future edit", "Future Edit"],
  ])("resolves app channel %s to the real Notion option %s", async (channel, expected) => {
    const transport = vi.fn(async (_url: any, init: any) => init.method === "GET"
      ? Response.json({ properties: { "채널": { type: "select", select: { options: ["HighScoop", "ALLigodang", "Fryday", "SpacePenguin", "Future Edit"].map(name => ({ name })) } } } })
      : Response.json({ results: [], has_more: false }));
    const c = createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) });
    expect(await c.queryNotionDocuments({ channel })).toEqual({ documents: [], hasMore: false });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(transport.mock.calls[1][1].body)).filter).toEqual({ and: [{ property: "채널", select: { equals: expected } }] });
  });
  it("treats an unknown channel option as an empty result without querying an invalid option", async () => {
    const transport = vi.fn(async (_url: any, _init: any) => Response.json({ properties: { "채널": { type: "select", select: { options: [{ name: "HighScoop" }] } } } }));
    const c = createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) });
    expect(await c.queryNotionDocuments({ channel: "없는 채널", cursor: "old-page" })).toEqual({ documents: [], hasMore: false });
    expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0][1].method).toBe("GET");
  });
  it.each([{}, { query: "서울" }, { channel: " " }])("does not fetch the data-source schema without a channel filter: %j", async query => {
    const f = fixture(), transport = vi.fn(async (_url: any, _init: any) => Response.json({ results: [f.page], has_more: false }));
    const c = createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) });
    expect((await c.queryNotionDocuments(query)).documents).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(`https://api.notion.com/v1/data_sources/${DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID}/query`);
    expect(transport.mock.calls[0][1].method).toBe("POST");
  });
  it.each([undefined, { type: "status" }, { type: "rich_text" }, { type: "multi_select" }, { type: "select", select: {} }])("reports an unsupported channel property format before querying: %j", async property => {
    const transport = vi.fn(async () => Response.json({ properties: { "채널": property } }));
    const c = createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) });
    await expect(c.queryNotionDocuments({ channel: "Highscoop" })).rejects.toMatchObject({ status: 422, code: "NOTION_CHANNEL_SCHEMA_UNSUPPORTED" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404])("preserves a real schema-access failure instead of reporting an empty channel: %i", async status => {
    const transport = vi.fn(async () => Response.json({ message: token }, { status }));
    const c = createNotionClient({ fetch: transport as typeof fetch, env: () => ({ NOTION_API_TOKEN: token }) });
    await expect(c.queryNotionDocuments({ channel: "Highscoop" })).rejects.toMatchObject({ status, code: "NOTION_API_ERROR" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("sanitizes upstream errors instead of returning token-bearing API responses", async () => {
    const c = createNotionClient({ env: () => ({ NOTION_API_TOKEN: token }), fetch: vi.fn(async () => Response.json({ message: token }, { status: 403 })) as typeof fetch });
    const error = await c.fetchNotionDocument(pageId).catch(e => e);
    expect(error.status).toBe(403); expect(JSON.stringify(error)).not.toContain(token); expect(error.message).not.toContain(token);
  });
});

describe("Notion writeback preservation and conflicts", () => {
  it("checks a fresh source hash before making any modification", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId); f.blocks[3].paragraph.rich_text = rich("휴대폰에서 수정한 최신 원문");
    await expect(f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages: d.pages.map(({ index, title, body }) => ({ index, title, body })) })).rejects.toMatchObject({ status: 409, code: "NOTION_SOURCE_CONFLICT" });
    expect(f.calls.filter(c => c.method === "PATCH")).toHaveLength(0);
  });
  it("updates only existing chapter text while preserving citations, photos, and private notes", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId), preserved = structuredClone([f.blocks[4], ...f.blocks.slice(8)]);
    const pages = d.pages.map((p, i) => ({ index: p.index, title: i ? p.title : "다듬은 제목", body: i ? p.body : "다듬은 본문\n두 번째 줄" }));
    const result = await f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages, coverTitle: "새 표지", studioUrl: "https://studio.example/content/1" });
    expect(result.pages[0]).toMatchObject({ title: "다듬은 제목", body: "다듬은 본문\n두 번째 줄" });
    expect([f.blocks[4], ...f.blocks.slice(8)]).toEqual(preserved);
    expect(f.calls.filter(c => c.method === "PATCH" && c.path.includes("/blocks/")).map(c => c.path)).toEqual([`/v1/blocks/${id(4)}`, `/v1/blocks/${id(5)}`]);
    expect(f.page.properties["사진 원본"].files).toHaveLength(1);
    expect(f.blocks[2].paragraph.rich_text[0].annotations.bold).toBe(true);
  });
  it("rejects a chapter-count mismatch without changing blocks", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId);
    await expect(f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages: d.pages.slice(0, 1).map(({ index, title, body }) => ({ index, title, body })) })).rejects.toMatchObject({ code: "NOTION_STRUCTURE_CONFLICT" });
    expect(f.calls.some(c => c.method === "PATCH")).toBe(false);
  });
  it("reads nested content but refuses to overwrite that unsupported structure", async () => {
    const f = fixture(); f.blocks[3].has_children = true;
    const d = await f.client.fetchNotionDocument(pageId);
    await expect(f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages: d.pages.map(({ index, title, body }) => ({ index, title, body })) })).rejects.toMatchObject({ code: "NOTION_STRUCTURE_CONFLICT" });
    expect(f.calls.some(c => c.method === "PATCH")).toBe(false);
  });
  it("reports successful block IDs and original snapshots after a later write fails", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId); f.fail(id(5));
    const error = await f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages: d.pages.map((p, i) => ({ index: p.index, title: i ? p.title : "바뀐 제목", body: i ? p.body : "바뀐 본문" })) }).catch(e => e);
    expect(error).toMatchObject({ status: 502, code: "NOTION_PARTIAL_WRITE", details: { appliedBlockIds: [id(4)], propertyPatchApplied: false } });
    expect(error.details.snapshots.map((s: any) => s.blockId)).toEqual([id(4), id(5)]);
    expect(error.details.snapshots[0].richText[0].text.content).toBe(d.pages[0].title);
    expect(f.calls.filter(c => c.method === "PATCH")).toHaveLength(2);
  });
  it("reports the attempted block and snapshot when a first write has an uncertain network result", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId); f.failNetwork(id(4));
    const error = await f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages: d.pages.map((p, i) => ({ index: p.index, title: i ? p.title : "새 제목", body: p.body })) }).catch(e => e);
    expect(error).toMatchObject({ code: "NOTION_PARTIAL_WRITE", details: { appliedBlockIds: [], attemptedBlockId: id(4) } });
    expect(error.details.snapshots[0].blockId).toBe(id(4)); expect(error.message).not.toContain(token);
  });
  it("splits long text into bounded Notion rich-text pieces without truncation", async () => {
    const f = fixture(), d = await f.client.fetchNotionDocument(pageId), long = "가".repeat(1799) + "🍨" + "긴 본문 ".repeat(1000);
    const result = await f.client.updateNotionDocument({ pageId, expectedSourceHash: d.sourceHash, pages: d.pages.map((p, i) => ({ index: p.index, title: p.title, body: i ? p.body : long })) });
    const texts = f.blocks[3].paragraph.rich_text.map((r: any) => r.text.content);
    expect(texts.every((t: string) => t.length <= 1800 && !/[\uD800-\uDBFF]$/.test(t) && !/^[\uDC00-\uDFFF]/.test(t))).toBe(true); expect(texts.join("")).toBe(long);
    expect(result.pages[0].body).toBe(long.trim());
  });
  it("patches only the supported URL/title properties and rejects unsafe links before mutation", async () => {
    const f = fixture(); await f.client.patchNotionDocumentProperties(pageId, { outputUrl: "https://www.canva.com/design/abc/edit" });
    expect(f.calls.filter(c => c.method === "PATCH")[0].body).toEqual({ properties: { "결과물링크": { url: "https://www.canva.com/design/abc/edit" } } });
    const count = f.calls.length;
    await expect(f.client.patchNotionDocumentProperties(pageId, { studioUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "INVALID_NOTION_LINK" });
    expect(f.calls).toHaveLength(count);
  });
});

describe("Notion photo boundary", () => {
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const media = (contentType = "image/png", body = png, finalUrl = assetUrl) => vi.fn(async () => ({ contentType, body, finalUrl, status: 200 })) as unknown as typeof safeFetch;
  it.each(["http://file.notion.so/a.png", "https://localhost/a.png", "https://file.notion.so.evil.example/a.png", "https://s3.us-west-2.amazonaws.com/someone-else/a.png", "https://user:secret@file.notion.so/a.png"])("blocks unknown or unauthenticated photo locations before any request: %s", async url => {
    const fetcher = media(), c = createNotionClient({ safeFetch: fetcher });
    await expect(c.downloadNotionPhoto(url)).rejects.toMatchObject({ code: "INVALID_NOTION_PHOTO_URL" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("reuses DNS/redirect-safe fetching with exact known hosts, image MIME and byte caps", async () => {
    const fetcher = media(), c = createNotionClient({ safeFetch: fetcher });
    expect(await c.downloadNotionPhoto(assetUrl)).toEqual({ buffer: png, mimeType: "image/png" });
    expect(fetcher).toHaveBeenCalledWith(assetUrl, expect.objectContaining({ allowedHosts: NOTION_PHOTO_HOSTS, maxBytes: NOTION_PHOTO_MAX_BYTES, maxRedirects: 3 }));
  });
  it("rejects a redirected host, non-image MIME, and oversized binary response", async () => {
    for (const f of [media("image/png", png, "https://evil.example/a.png"), media("text/html"), media("image/jpeg", Buffer.from("<html>not a photo</html>")), media("image/png", Buffer.alloc(NOTION_PHOTO_MAX_BYTES + 1))])
      await expect(createNotionClient({ safeFetch: f }).downloadNotionPhoto(assetUrl)).rejects.toThrow();
  });
});

describe("Notion remote write lease",()=>{
  const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
  const untilAbort=(signal:AbortSignal)=>new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  it("renews a live slow operation beyond the old 120-second expiry and cleans up timers",async()=>{
    vi.useFakeTimers();
    try{
      const renew=vi.fn(async()=>true);
      const run=withNotionWriteLease(renew,async({beforeWrite})=>{await wait(150_000);await beforeWrite!();return 'complete';});
      await vi.advanceTimersByTimeAsync(150_001);
      expect(await run).toBe('complete');expect(renew.mock.calls.length).toBeGreaterThanOrEqual(8);expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it("aborts an in-flight operation as soon as token renewal loses ownership",async()=>{
    vi.useFakeTimers();
    try{
      const renew=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
      const run=withNotionWriteLease(renew,async({signal})=>untilAbort(signal!)).catch(error=>error);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await run).toMatchObject({code:'NOTION_LEASE_LOST',status:409});expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it("applies an overall deadline even while heartbeats are succeeding",async()=>{
    vi.useFakeTimers();
    try{
      const renew=vi.fn(async()=>true),run=withNotionWriteLease(renew,async({signal})=>untilAbort(signal!),{heartbeatMs:10,timeoutMs:45}).catch(error=>error);
      await vi.advanceTimersByTimeAsync(46);
      expect(await run).toMatchObject({code:'NOTION_OPERATION_TIMEOUT',status:504});expect(renew.mock.calls.length).toBeGreaterThan(2);expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it("never starts a remote write after a timed-out renewal eventually finishes",async()=>{
    vi.useFakeTimers();
    try{
      let finish!:(value:boolean)=>void;
      const operation=vi.fn(async()=> 'must not run');
      const run=withNotionWriteLease(()=>new Promise<boolean>(resolve=>{finish=resolve;}),operation,{timeoutMs:20}).catch(error=>error);
      await vi.advanceTimersByTimeAsync(21);expect(await run).toMatchObject({code:'NOTION_OPERATION_TIMEOUT'});
      finish(true);await vi.advanceTimersByTimeAsync(1);expect(operation).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it("checks the fencing callback before every block/property mutation and stops partial writes",async()=>{
    const f=fixture(),d=await f.client.fetchNotionDocument(pageId),beforeWrite=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new NotionSyncError('다른 작업이 잠금을 소유합니다.',409,'NOTION_LEASE_LOST'));
    const error=await f.client.updateNotionDocument({pageId,expectedSourceHash:d.sourceHash,pages:d.pages.map((p,i)=>({index:p.index,title:i?p.title:'새 제목',body:i?p.body:'새 본문'}))},{beforeWrite}).catch(error=>error);
    expect(error).toMatchObject({code:'NOTION_PARTIAL_WRITE',details:{appliedBlockIds:[id(4)]}});
    expect(f.calls.filter(call=>call.method==='PATCH')).toHaveLength(1);
  });
});
