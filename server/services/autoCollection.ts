import type { DB } from '../db';
import { env } from '../env';
import { getSetting } from '../seed';

/** A saved switch overrides the deployment default, including saved false.
 * Only a missing setting falls back to AUTO_COLLECT; malformed stored values
 * fail closed rather than starting a scheduled collection. */
export async function autoCollectEnabled(db: DB): Promise<boolean> {
  return (await getSetting<unknown>(db, 'auto_collect', env.autoCollect)) === true;
}
