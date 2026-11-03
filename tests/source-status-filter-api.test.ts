import { afterAll, beforeAll, expect, it } from "vitest";
import { login, resetDb, setTestEnv } from "./helpers";

setTestEnv();
const { createApp } = await import("../server/app");
const { getDb, closeDb } = await import("../server/db");
const { contentItems, sourceDocuments } = await import("../shared/schema");
const app = createApp(), prefix = "본문필터검증자료";
const statuses = ["ok", "not_fetched", "failed", "blocked", "unsupported"] as const;
const ids = new Map<string, number>();

beforeAll(async () => {
  await resetDb();
  for (const fetchStatus of statuses) {
    const url = `https://press.example/filter/${fetchStatus}`;
    const [source] = await getDb().insert(sourceDocuments).values({ normalizedUrl: url, originalUrl: url, title: `${prefix} ${fetchStatus}`, kind: "news", fetchStatus }).returning();
    const [item] = await getDb().insert(contentItems).values({ channelId: 1, kind: "notice", title: source.title, primarySourceId: source.id, origin: "collected" }).returning();
    ids.set(fetchStatus, item.id);
  }
  const [manual] = await getDb().insert(contentItems).values({ channelId: 1, kind: "notice", title: `${prefix} 수동`, origin: "manual" }).returning();
  ids.set("manual", manual.id);
});
afterAll(closeDb);

it("filters acquired and not-yet-requested bodies separately, with matching totals", async () => {
  const { agent } = await login(app);
  for (const fetchStatus of ["ok", "not_fetched"]) {
    const r = await agent.get("/api/items").query({ channelId: 1, q: prefix, fetchStatus });
    expect(r.status).toBe(200); expect(r.body.total).toBe(1);
    expect(r.body.items.map((row: { item: { id: number } }) => row.item.id)).toEqual([ids.get(fetchStatus)]);
    expect(r.body.items[0].source.fetchStatus).toBe(fetchStatus);
  }
});

it("supports a combined failure filter across all channels without including unattempted items", async () => {
  const { agent } = await login(app);
  const r = await agent.get("/api/items").query({ channelId: "all", q: prefix, fetchStatus: "failed,blocked,unsupported" });
  expect(r.status).toBe(200); expect(r.body.total).toBe(3);
  expect(new Set(r.body.items.map((row: { item: { id: number } }) => row.item.id))).toEqual(new Set([ids.get("failed"), ids.get("blocked"), ids.get("unsupported")]));
});

it("retains source-free manual items in the unfiltered list and rejects unknown status values", async () => {
  const { agent } = await login(app);
  const all = await agent.get("/api/items").query({ channelId: 1, q: prefix });
  expect(all.status).toBe(200); expect(all.body.total).toBe(6);
  expect(all.body.items.some((row: { item: { id: number } }) => row.item.id === ids.get("manual"))).toBe(true);
  const invalid = await agent.get("/api/items").query({ channelId: 1, fetchStatus: "ok,unknown" });
  expect(invalid.status).toBe(400);
});
