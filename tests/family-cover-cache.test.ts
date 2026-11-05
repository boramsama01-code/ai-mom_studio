import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { cardImagePrompts } from "../shared/cardImagePromptDb";
import { familyEditorialStages } from "../shared/familyEvidenceDb";
import { contentItems, mediaAssets } from "../shared/schema";
import { studioImagePrompt } from "../shared/studioImagePrompt";
import type { VisualBrief } from "../shared/familyDialogue";
import { familyHash } from "../server/services/familyEvidence";
import { generateFamilyCoverArtwork } from "../server/services/familyEditorialImage";
import type { FamilyStageContext } from "../server/services/familyEditorialStages";

afterEach(() => vi.unstubAllGlobals());
const dialect = new PgDialect();
const scene = "유리 저울과 작은 조명, 글자 없는 사진";
const brief: VisualBrief = { pageId: "cover", visualSubject: "유리 저울", composition: "중앙", mood: "차분함", palette: ["#163333"], textSafeArea: "제목 영역", referenceAssetIds: [], avoidElements: ["글자"], imagePrompt: scene };

function fixture(compositionPrompt: string) {
  const selection = { provider: "openai", model: "gpt-image-test" };
  const cacheInput = { stage: "image_generation", sourceSnapshotId: "crop-fixture", contentRevision: 30, selection, brief };
  const legacyHash = familyHash({ ...cacheInput, prompt: scene, instruction: "", promptVersion: 1 });
  const fullPrompt = studioImagePrompt({ purpose: "cover", prompt: scene, compositionPrompt });
  const records: Array<typeof familyEditorialStages.$inferSelect> = [], lookups: unknown[][] = [];
  // Read-only SQL receipt fixture. Actual DB locks remain covered by the PG suite.
  // The hash predicates are compiled, so a missed historical key cannot pass.
  const db: any = {
    select: () => {
      let table: unknown, condition: SQL;
      const query: any = {
        from: (value: unknown) => { table = value; return query; },
        where: (value: SQL) => { condition = value; return query; },
        orderBy: () => query, limit: () => query, for: () => query,
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const params = dialect.sqlToQuery(condition).params;
          let rows: unknown[];
          if (table === cardImagePrompts) rows = [{ version: 1, prompt: scene, instruction: "" }];
          else if (table === familyEditorialStages) { lookups.push(params); rows = records.filter(row => params.includes(row.inputHash)); }
          else if (table === contentItems) rows = [{ version: 4, currentRevisionId: 30 }];
          else if (table === mediaAssets) rows = [{ id: 91 }];
          else throw new Error("Unexpected table in crop-cache test");
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
    transaction: (run: (value: unknown) => unknown) => run(db),
    insert: () => { throw new Error("A cache read must not start a new paid request"); },
    update: () => { throw new Error("A cache read must not mutate an earlier receipt"); },
  };
  const context = {
    db, itemId: 11, channelId: 2, baseRevision: 30, requestId: "crop-test", runs: [], allowPaidRetry: false,
    plan: { sourceSnapshotId: cacheInput.sourceSnapshotId, roles: { image_generation: selection } },
    budget: { used: 0, limit: 2 }, startedAt: Date.now() - 200_000,
  } as unknown as FamilyStageContext;
  const fetcher = vi.fn(() => { throw new Error("No provider call is allowed in a cache check"); }); vi.stubGlobal("fetch", fetcher);
  const add = (status: string, prompt?: string) => records.push({ id: "legacy-image", channelId: 2, contentItemId: 11, stage: "image_generation", inputHash: legacyHash, requestId: "earlier-request", baseRevision: 30, status, result: { ...(status === "ready" ? { assetId: 91 } : {}), ...(prompt ? { prompt } : {}) }, provenance: null, startedAt: new Date(0), finishedAt: new Date(1) });
  return { context, records, lookups, legacyHash, fullPrompt, fetcher, add,
    run: () => generateFamilyCoverArtwork(context, { version: 4, brief, compositionPrompt }) };
}

describe("cover cache keeps crop changes and unknown paid outcomes distinct", () => {
  it("reuses an earlier completed image only when the entire provider prompt still matches", async () => {
    const f = fixture("원본 x=17~83%, y=14~86% 안에 배치"); f.add("ready", f.fullPrompt);
    expect(await f.run()).toEqual({ assetId: 91 });
    expect(f.context.runs).toHaveLength(1); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("never reuses a different or unrecorded old composition, without charging an automatic retry", async () => {
    for (const recorded of [undefined, "Earlier provider prompt without safe-area geometry"]) {
      const f = fixture("원본 x=34~67%, y=20~75% 안에 배치"); f.add("ready", recorded);
      const before = structuredClone(f.records), result = await f.run();
      expect(result.assetId).toBeNull(); expect(result.reviewFlag?.message).toContain("현재 구도 지시가 달라");
      expect(f.context.runs).toHaveLength(0); expect(f.records).toEqual(before); expect(f.fetcher).not.toHaveBeenCalled();
    }
  });

  it("still finds historical failed or running receipts after the crop-prompt cache key changes", async () => {
    for (const status of ["failed", "running"]) {
      const f = fixture("새 사진창의 구도"); f.add(status);
      const result = await f.run();
      expect(result.assetId).toBeNull(); expect(result.reviewFlag?.message).toContain("유료 요청을 반복하지 않았습니다");
      expect(f.lookups[0]).toContain(f.legacyHash); expect(f.fetcher).not.toHaveBeenCalled();
    }
  });

  it("keeps the scene lookup stable but gives changed slot geometry its own successful-image identity", async () => {
    const hashes: string[][] = [];
    for (const composition of ["전체 표시: x=0~100%", "전체 표시: x=0~100%", "창 채우기: x=20~80%"]) {
      const f = fixture(composition); await f.run();
      hashes.push(f.lookups[0].filter((value): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)));
      expect(f.fetcher).not.toHaveBeenCalled();
    }
    expect(hashes[0]).toHaveLength(2); expect(hashes[0]).toEqual(hashes[1]);
    expect(hashes[2][0]).not.toBe(hashes[0][0]); expect(hashes[2][1]).toBe(hashes[0][1]);
  });
});
