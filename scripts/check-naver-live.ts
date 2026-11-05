/** Read-only connection check; reports provider and status, never credentials or source content. */
import { inArray, count } from "drizzle-orm";
import { getDb, closeDb } from "../server/db";
import { decryptValue } from "../server/secretStore";
import { storedSecrets } from "../shared/schema";
import { naverSearch, naverProviderInUse, NaverError } from "../server/services/naver";

try {
  if (!process.env.APP_DATABASE_URL) throw new Error("database_unconfigured");
  const envPair = { id: process.env.NAVER_CLIENT_ID || "", secret: process.env.NAVER_CLIENT_SECRET || "" };
  const db = getDb();
  const rows = await db.select().from(storedSecrets).where(inArray(storedSecrets.key, ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]));
  const [total] = await db.select({ count: count() }).from(storedSecrets);
  const saved: Record<string, string> = {};
  for (const row of rows) try { saved[row.key] = decryptValue(row); } catch { /* incomplete configuration */ }
  const storedPair = { id: saved.NAVER_CLIENT_ID || "", secret: saved.NAVER_CLIENT_SECRET || "" };
  const envReady = !!envPair.id && !!envPair.secret, storedReady = !!storedPair.id && !!storedPair.secret;
  const samePair = envReady && storedReady && envPair.id === storedPair.id && envPair.secret === storedPair.secret;
  console.log(JSON.stringify({ githubPair: envReady, storedPair: storedReady, samePair, storedNaverRows: rows.length, storedRows: total.count }));
  let attempts = 0;
  for (const [label, pair] of [["stored", storedPair], ["github", envPair]] as const) {
    if (!pair.id || !pair.secret || (label === "github" && samePair)) continue;
    attempts++;
    process.env.NAVER_CLIENT_ID = pair.id;
    process.env.NAVER_CLIENT_SECRET = pair.secret;
    for (const endpoint of ["news", "webkr"] as const) {
      try {
        const found = await naverSearch("청소년 과학 캠프", endpoint, 1, { naver: 0, limit: 4 });
        console.log(JSON.stringify({ source: label, endpoint, ok: true, results: found.length, provider: naverProviderInUse() }));
      } catch (e) {
        console.log(JSON.stringify({ source: label, endpoint, ok: false, kind: e instanceof NaverError ? e.kind : "unknown", status: e instanceof NaverError ? e.status : undefined }));
      }
    }
  }
  if (!attempts) console.log(JSON.stringify({ noCompletePair: true }));
} catch { console.log(JSON.stringify({ database: "unavailable" })); process.exitCode = 1; }
finally { await closeDb(); }
