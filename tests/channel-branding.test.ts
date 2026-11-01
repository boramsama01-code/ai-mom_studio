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
