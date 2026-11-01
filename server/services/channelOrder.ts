import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { appSettings, channels } from "../../shared/schema";

export const CHANNEL_ORDER_KEY = "channel_display_order";
export const channelIdsSchema = z.array(z.number().int().positive()).max(2000);
export async function orderedChannels(db: DB) {
  const rows = await db.select().from(channels).orderBy(asc(channels.id));
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, CHANNEL_ORDER_KEY));
  const parsed = channelIdsSchema.safeParse(setting?.value);
  const rank = new Map((parsed.success ? parsed.data : []).map((id, index) => [id, index]));
  const [redirects] = await db.select().from(appSettings).where(eq(appSettings.key, "channel_redirects"));
  const retired = new Set(Object.keys((redirects?.value ?? {}) as object).map(Number));
  return rows.filter(c => !retired.has(c.id)).sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
}

