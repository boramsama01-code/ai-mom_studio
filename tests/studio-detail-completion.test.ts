/** Simulates a worker commit between independent SELECT statements; no live DB or AI. */
import { describe, expect, it } from "vitest";
import type { DB } from "../server/db";
import { setTestEnv } from "./helpers";
setTestEnv();
const { studioDetail } = await import("../server/services/studio");
const { studioContentSchema } = await import("../shared/studio");
const { studioCards, studioRevisions, jobs } = await import("../shared/schema");

function databaseAtCompletion({ candidate = false, finishesAfterJobRead = false } = {}) {
  const at = new Date("2026-11-04T00:00:00Z");
  const original = studioContentSchema.parse({ title: "생성 중인 콘텐츠", characters: [], panels: Array.from({ length: 4 }, () => ({ scene: "장면", dialogue: "본문" })) });
  const generated = { ...original, panels: original.panels.map((panel, index) => index === 0 ? { ...panel, imageId: 72 } : panel) };
  let completed = false;
  const read = (table: unknown) => {
    if (table === jobs) {
      // The old implementation has already read the card by this point.
      // A real worker transaction may commit just before the jobs SELECT starts.
      completed = true;
      return [{ id: 9, status: finishesAfterJobRead ? "running" : "succeeded", lastError: null, result: { applied: !candidate, revisionId: 12 }, createdAt: at, finishedAt: finishesAfterJobRead ? null : at }];
    }
    if (table === studioCards) return [{
      id: 5, version: candidate ? 3 : completed ? 2 : 1, sourceItemId: null, importedMeta: null, trashedAt: null,
      content: candidate ? { ...original, caption: "사용자가 새로 저장한 내용" } : completed ? generated : original, createdAt: at, updatedAt: at,
    }];
    if (table === studioRevisions) return completed ? [{ id: 12, cardId: 5, version: 2, snapshot: generated, applied: !candidate, instruction: "1컷 생성", provider: "openai", model: "mock", createdAt: at }] : [];
    throw new Error("Unexpected SELECT in the isolated completion fixture");
  };
  const db = { select: () => ({ from: (table: unknown) => {
    const query: Record<string, unknown> = {};
    for (const method of ["where", "orderBy", "limit"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(() => read(table)).then(resolve, reject);
    return query;
  } }) };
  return db as unknown as DB;
}

describe("Studio terminal-job response includes its saved output", () => {
  it("cannot return succeeded with the older card or missing image when completion races with the GET", async () => {
    const detail = await studioDetail(databaseAtCompletion(), 5);
    expect(detail.jobs[0].status).toBe("succeeded");
    expect(detail.card.version).toBe(2);
    expect(detail.card.panels[0].imageId).toBe(72);
    expect(detail.revisions.find(revision => revision.id === detail.jobs[0].result?.revisionId)?.snapshot.panels[0].imageId).toBe(72);
  });
  it("includes an unapplied candidate in history while preserving the newer user card", async () => {
    const detail = await studioDetail(databaseAtCompletion({ candidate: true }), 5);
    expect(detail.jobs[0]).toMatchObject({ status: "succeeded", result: { applied: false, revisionId: 12 } });
    expect(detail.card).toMatchObject({ version: 3, caption: "사용자가 새로 저장한 내용" });
    expect(detail.card.panels[0].imageId).toBeNull();
    expect(detail.revisions.find(revision => revision.id === 12)).toMatchObject({ applied: false, snapshot: { panels: expect.arrayContaining([expect.objectContaining({ imageId: 72 })]) } });
  });
  it("may report running for one extra poll if completion happens after the job status was read", async () => {
    const detail = await studioDetail(databaseAtCompletion({ finishesAfterJobRead: true }), 5);
    expect(detail.jobs[0].status).toBe("running");
    expect(detail.card.version).toBe(2);
    expect(detail.card.panels[0].imageId).toBe(72);
  });
});
