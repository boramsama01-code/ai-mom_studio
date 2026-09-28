import type { DB } from "./db";
import { auditLogs } from "../shared/schema";

type Tx = Pick<DB, "insert">;

export async function audit(
  db: Tx,
  a: { actor: string; action: string; entity: string; entityId?: string | number | null; channelId?: number | null; detail?: Record<string, unknown> },
) {
  await db.insert(auditLogs).values({
    actor: a.actor,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId == null ? null : String(a.entityId),
    channelId: a.channelId ?? null,
    detail: a.detail ?? {},
  });
}
