/** Read-only aggregate verification; no source contents or credentials are logged. */
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../server/db";
try {
  if (!process.env.APP_DATABASE_URL) throw new Error("database_unconfigured");
  const info = await getDb().transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const sources = await tx.execute(sql`
      SELECT c.slug, c.active,
        COUNT(o.id) FILTER (WHERE o.enabled AND o.adapter = 'generic_board' AND o.verified_at IS NOT NULL AND o.domain IS NOT NULL AND o.board_url IS NOT NULL)::int AS connected,
        COUNT(o.id) FILTER (WHERE o.enabled AND o.adapter_config->>'sourceRole' = 'discovery')::int AS discovery
      FROM channels c LEFT JOIN official_sources o ON o.channel_id = c.id
      WHERE c.slug IN ('opportunities', 'current-dialogue')
      GROUP BY c.slug, c.active ORDER BY c.slug`);
    const rules = await tx.execute(sql`
      SELECT COUNT(*)::int AS web_rules FROM search_rules r JOIN channels c ON c.id = r.channel_id
      WHERE c.slug = 'opportunities' AND r.endpoint = 'webkr' AND r.enabled AND r.deleted_at IS NULL`);
    const flags = await tx.execute(sql`
      SELECT key, value FROM app_settings WHERE key IN ('auto_collect','global_stop')`);
    return { channels: sources.rows, rules: rules.rows, flags: flags.rows, autoCollectEnvironment: process.env.AUTO_COLLECT === "true" };
  });
  console.log(JSON.stringify(info));
} catch { console.log(JSON.stringify({ database: "unavailable" })); process.exitCode = 1; }
finally { await closeDb(); }
