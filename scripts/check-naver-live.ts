/** Read-only smoke check. No messages, content changes, AI or publishing. */
import { inArray } from "drizzle-orm";
import { getDb, closeDb } from "../server/db";
import { decryptValue } from "../server/secretStore";
import { storedSecrets } from "../shared/schema";
import { naverSearch, naverProviderInUse, NaverError } from "../server/services/naver";

try {
  if (!process.env.APP_DATABASE_URL) throw new Error("database_unconfigured");
  const rows = await getDb().select().from(storedSecrets)
    .where(inArray(storedSecrets.key, ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]));
  for (const row of rows) {
    if (!process.env[row.key]) {
      try { process.env[row.key] = decryptValue(row); } catch { /* configuration remains incomplete */ }
    }
  }
  const configured = !!process.env.NAVER_CLIENT_ID && !!process.env.NAVER_CLIENT_SECRET;
  console.log(JSON.stringify({ configured }));
  if (!configured) { process.exitCode = 1; }
  else for (const endpoint of ["news", "webkr"] as const) {
    try {
      const found = await naverSearch("청소년 과학 캠프", endpoint, 1, { naver: 0, limit: 4 });
      console.log(JSON.stringify({ endpoint, ok: true, results: found.length, provider: naverProviderInUse() }));
    } catch (e) {
      console.log(JSON.stringify({ endpoint, ok: false, kind: e instanceof NaverError ? e.kind : "unknown", status: e instanceof NaverError ? e.status : undefined }));
      process.exitCode = 1;
    }
  }
} catch { console.log(JSON.stringify({ database: "unavailable" })); process.exitCode = 1; }
finally { await closeDb(); }
