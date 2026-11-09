import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../server/db";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), setting: vi.fn(), fetch: vi.fn(), load: vi.fn(), hash: vi.fn(), pull: vi.fn(), push: vi.fn() }));
vi.mock("../server/services/notionClient", () => ({ notionConfigured: mocks.configured, fetchNotionDocument: mocks.fetch }));
vi.mock("../server/services/notionStudio", () => ({ loadNotionStudioState: mocks.load, notionCopyHash: mocks.hash, pullNotionStudio: mocks.pull, pushNotionStudio: mocks.push }));
vi.mock("../server/seed", () => ({ getSetting: mocks.setting }));
vi.mock("../server/env", () => ({ env: { inlineWorker: false, canonicalRedirectUrl: "" } }));
const { syncNotionOnce } = await import("../server/worker/notion");

function database(ids = [1]) {
  const updates: Array<Record<string, unknown>> = [];
  const limit = vi.fn(async () => ids.map(id => ({ id })));
  const where = vi.fn(() => ({ orderBy: vi.fn(() => ({ limit })) }));
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where })) }));
  const db = { select, update: () => ({ set: (values: Record<string, unknown>) => { updates.push(values); return { where: async () => undefined }; } }) } as unknown as DB;
  return { db, select, updates };
}
const initial = () => ({ link: { version: 4, autoSync: true, notionPageId: "source-page", sourceHash: "old", baseCopyHash: "base", canva: { phase: "idle" }, operationToken: null, operationUntil: null }, item: { version: 7 }, copy: { fixture: true } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.configured.mockReturnValue(true); mocks.setting.mockResolvedValue(false); mocks.load.mockImplementation(async () => initial());
  mocks.fetch.mockResolvedValue({ sourceHash: "old" }); mocks.hash.mockReturnValue("base"); mocks.pull.mockResolvedValue({}); mocks.push.mockResolvedValue({});
});

describe("linked Notion auto sync worker", () => {
  it.each(["not-configured", "global-stop"])("does not start work when %s", async kind => {
    const { db, select } = database(); if (kind === "not-configured") mocks.configured.mockReturnValue(false); else mocks.setting.mockResolvedValue(true);
    expect(await syncNotionOnce(db)).toMatchObject({ checked: 0, pulled: 0, pushed: 0 }); expect(select).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("respects an exhausted time budget before reading a draft", async () => {
    const { db } = database(); await syncNotionOnce(db, { maxMs: 0 }); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps both edited drafts intact and records a comparison request", async () => {
    const { db, updates } = database(); mocks.fetch.mockResolvedValue({ sourceHash: "new-notion" }); mocks.hash.mockReturnValue("new-studio");
    expect(await syncNotionOnce(db)).toMatchObject({ checked: 1, conflicts: 1, pulled: 0, pushed: 0 }); expect(mocks.pull).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
    expect(updates[0].lastError).toEqual(expect.stringContaining("두 원고를 비교"));
  });
  it("clears a previous temporary error when a fresh comparison succeeds without changes", async () => {
    const { db, updates } = database(); expect(await syncNotionOnce(db)).toMatchObject({ checked: 1, failed: 0, conflicts: 0 });
    expect(updates).toEqual([expect.objectContaining({ lastError: null, lastCheckedAt: expect.any(Date) })]);
    expect(mocks.pull).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  });
  it.each(["notion", "studio"])("only applies the changed %s draft with conflict resolution disabled", async kind => {
    const { db } = database(); if (kind === "notion") mocks.fetch.mockResolvedValue({ sourceHash: "new-notion" }); else mocks.hash.mockReturnValue("new-studio");
    const result = await syncNotionOnce(db); const action = kind === "notion" ? mocks.pull : mocks.push;
    expect(action).toHaveBeenCalledExactlyOnceWith(db, 1, { version: 4, itemVersion: 7, expectedSourceHash: kind === "notion" ? "new-notion" : "old", resolveConflict: false }, "notion-auto-sync");
    expect(kind === "notion" ? result.pulled : result.pushed).toBe(1); expect(kind === "notion" ? mocks.push : mocks.pull).not.toHaveBeenCalled();
  });
  it.each(["importing", "exporting", "result_unknown", "lease"])("rechecks a newly blocked %s draft without touching Notion", async kind => {
    const { db } = database(); const state = initial(); if (kind === "lease") { Object.assign(state.link, { operationToken: "another-worker", operationUntil: new Date(Date.now() + 60_000) }); } else state.link.canva.phase = kind;
    mocks.load.mockResolvedValue(state); await syncNotionOnce(db); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.pull).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  });
});
