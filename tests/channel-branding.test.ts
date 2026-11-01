import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { login, resetDb, setTestEnv } from "./helpers";
import { collectionSample } from "../server/services/cardDesignSamples";
setTestEnv();
const { getPool, closeDb } = await import("../server/db");
const { createApp } = await import("../server/app");
beforeAll(resetDb);
afterAll(closeDb);

describe("channel brand rollout", () => {
  it("migrates current board keys once while preserving authored content and old revisions", async () => {
    const pool = getPool();
    const original = { title: "직접 쓴 제목", channel: "highway", memo: "수정하지 않을 메모", characters: ["pempem"] };
    const card = (await pool.query("insert into studio_cards(content,version,external_id) values ($1,3,'legacy-brand-test') returning *", [JSON.stringify(original)])).rows[0];
    await pool.query("insert into studio_revisions(card_id,version,snapshot,instruction,applied) values ($1,3,$2,'원본',true)", [card.id,JSON.stringify(original)]);
    const migration = fs.readFileSync("migrations/0009_studio_brand_keys.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration);
    const saved = (await pool.query("select * from studio_cards where id=$1",[card.id])).rows[0];
    expect(saved).toMatchObject({ id: card.id, version: 4, external_id: "legacy-brand-test", content: { ...original, channel: "highscoop" } });
    const revisions = (await pool.query("select * from studio_revisions where card_id=$1 order by version",[card.id])).rows;
    expect(revisions).toHaveLength(2);
    expect(revisions[0].snapshot).toEqual(original);
    const { agent, csrf } = await login(createApp());
    const restored = await agent.post(`/api/studio/cards/${card.id}/restore`).set("x-csrf-token",csrf).send({ version: 4, revisionId: revisions[0].id });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ channel: "highscoop", memo: original.memo, characters: ["pempem"] });
  });

  it("renames existing channels in place without altering their settings or content", async () => {
    const pool = getPool();
    await pool.query("update channels set name = 'Highway', editorial_guide = '직접 쓴 지침', card_template = 'set:r05-plum' where slug = 'opportunities'");
    const before = (await pool.query("select * from channels where slug = 'opportunities'")).rows[0];
    const item = (await pool.query("insert into content_items(channel_id,title,kind) values ($1,'변경하지 않을 제목','notice') returning *", [before.id])).rows[0];
    const dest = (await pool.query("insert into destinations(channel_id,platform,label) values ($1,'telegram_channel','기존 연결') returning *", [before.id])).rows[0];
    const custom = (await pool.query("insert into channels(slug,name,content_type,accent_color,budget) values ('custom-brand','내 채널','manual','#222222','{}') returning *")).rows[0];
    const migration = fs.readFileSync("migrations/0008_channel_brands.sql", "utf8");
    await pool.query(migration);
    const after = (await pool.query("select * from channels where id=$1", [before.id])).rows[0];
    expect(after).toEqual({ ...before, name: "Highscoop", version: before.version + 1, updated_at: expect.any(Date) });
    expect((await pool.query("select * from content_items where id=$1", [item.id])).rows[0]).toEqual(item);
    expect((await pool.query("select * from destinations where id=$1", [dest.id])).rows[0]).toEqual(dest);
    expect((await pool.query("select * from channels where id=$1", [custom.id])).rows[0]).toEqual(custom);
    await pool.query(migration);
    expect((await pool.query("select * from channels where id=$1", [before.id])).rows[0]).toEqual(after);
  });

  it("uses the chosen channel on every sample page and isolates preview caches", async () => {
    const { agent } = await login(createApp());
    for (const name of ["Highscoop", "Alligodang · 과학", "Fryday"]) {
      const sample = collectionSample("n04-charcoal", name);
      expect([sample.plan.base, ...sample.plan.pages].every(page => page.brandLine === name.split(" · ")[0])).toBe(true);
    }
    const url = "/api/studio/design-preview?key=set:n04-charcoal&page=2&size=sm";
    const first = await agent.get(`${url}&channel=highway`);
    const second = await agent.get(`${url}&channel=news`);
    const repeated = await agent.get(`${url}&channel=highway`);
    expect([first.status, second.status, repeated.status]).toEqual([200, 200, 200]);
    expect(first.body.equals(second.body)).toBe(false);
    expect(first.body.equals(repeated.body)).toBe(true);
    expect((await agent.get(`${url}&channel=missing`)).status).toBe(404);
    const collected = await agent.get("/api/channels/1/templates/preview?key=set:n04-charcoal&page=2&size=sm");
    const news = await agent.get("/api/channels/3/templates/preview?key=set:n04-charcoal&page=2&size=sm");
    expect([collected.status, news.status]).toEqual([200, 200]);
    expect(collected.body.equals(news.body)).toBe(false);
  });
});
