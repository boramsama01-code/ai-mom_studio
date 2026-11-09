import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testNotion } from "../server/services/connectionTest";
import { NOTION_API_VERSION } from "../server/services/notionClient";
import { DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID } from "../shared/notionSync";

const token = "secret-fixture-never-return";
beforeEach(() => { vi.stubEnv("NOTION_API_TOKEN", token); vi.stubEnv("NOTION_CONTENT_DATA_SOURCE_ID", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("Notion connection check", () => {
  it("checks access with one read-only query and never imports or updates content", async () => {
    const transport = vi.fn(async () => Response.json({ results: [], has_more: false }));
    const result = await testNotion(transport);
    expect(result.ok).toBe(true); expect(result.message).toContain("수정하지 않았습니다");
    expect(transport).toHaveBeenCalledExactlyOnceWith(`https://api.notion.com/v1/data_sources/${DEFAULT_NOTION_CONTENT_DATA_SOURCE_ID}/query`, expect.objectContaining({
      method: "POST", redirect: "error", body: JSON.stringify({ page_size: 1 }),
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_API_VERSION, "Content-Type": "application/json" },
    }));
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each(["missing-token", "invalid-data-source"])("does not call Notion with %s", async kind => {
    if (kind === "missing-token") vi.stubEnv("NOTION_API_TOKEN", "");
    else vi.stubEnv("NOTION_CONTENT_DATA_SOURCE_ID", "https://untrusted.test/notion");
    const transport = vi.fn(); expect((await testNotion(transport)).ok).toBe(false); expect(transport).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 429, 500])("reports HTTP %s without returning upstream text or secrets", async status => {
    const result = await testNotion(vi.fn(async () => Response.json({ message: token, details: "private document contents" }, { status })));
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain("private document contents");
    if (status === 404) expect(result.message).toContain("데이터 소스");
    if (status === 429) expect(result.message).toContain("잠시 후");
  });

  it("keeps transport exception details private", async () => {
    const result = await testNotion(vi.fn(async () => { throw new Error(token); }));
    expect(result.ok).toBe(false); expect(result.message).toContain("연결할 수 없습니다"); expect(JSON.stringify(result)).not.toContain(token);
  });
});
