import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DB } from '../server/db';

const state = vi.hoisted(() => ({ missing: true, value: undefined as unknown, read: vi.fn() }));
vi.mock('../server/seed', () => ({ getSetting: state.read }));
const { autoCollectEnabled } = await import('../server/services/autoCollection');
const db = {} as DB;

beforeEach(() => {
  state.missing = true; state.value = undefined;
  state.read.mockReset().mockImplementation(async (_db: DB, _key: string, fallback: unknown) => state.missing ? fallback : state.value);
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  { stored: false, env: 'true', expected: false },
  { stored: true, env: 'false', expected: true },
  { stored: false, env: 'false', expected: false },
  { stored: true, env: 'true', expected: true },
])('honors the saved boolean before the environment: $stored/$env', async ({ stored, env, expected }) => {
  state.missing = false; state.value = stored; vi.stubEnv('AUTO_COLLECT', env);
  expect(await autoCollectEnabled(db)).toBe(expected);
  expect(state.read).toHaveBeenCalledWith(db, 'auto_collect', env === 'true');
});

it.each([null, undefined, 'true', 'false', 1, {}, []])('fails closed for a malformed saved value %j even when the environment is true', async stored => {
  state.missing = false; state.value = stored; vi.stubEnv('AUTO_COLLECT', 'true');
  expect(await autoCollectEnabled(db)).toBe(false);
});

it.each(['false', 'true'])('uses the environment only when no switch has been saved: %s', async env => {
  vi.stubEnv('AUTO_COLLECT', env);
  expect(await autoCollectEnabled(db)).toBe(env === 'true');
});
