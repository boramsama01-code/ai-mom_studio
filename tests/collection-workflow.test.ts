import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { nextCollectionAt } from '../shared/collection';

const workflow = readFileSync(new URL('../.github/workflows/collect.yml', import.meta.url), 'utf8');

it('keeps the registered daily cron and displayed next collection time in agreement', () => {
  const cron = workflow.match(/^\s+schedule:\s*\n\s+- cron: "([^"]+)"/m)?.[1];
  expect(cron).toBeDefined();
  const [minute, hour, ...days] = cron!.split(' ');
  expect(days).toEqual(['*', '*', '*']);
  for (const instant of ['2026-11-07T22:59:59Z', '2026-11-07T23:00:00Z', '2026-12-31T23:01:00Z']) {
    const now = new Date(instant), expected = new Date(now);
    expected.setUTCHours(Number(hour), Number(minute), 0, 0);
    if (expected <= now) expected.setUTCDate(expected.getUTCDate() + 1);
    expect(nextCollectionAt(now)).toBe(expected.toISOString());
  }
});

it('retains manual connection checks and passes scheduled events to the collection gate', () => {
  expect(workflow).toMatch(/workflow_dispatch:\s*\n\s+inputs:/);
  expect(workflow).toContain('npm run collect:once -- --check');
  expect(workflow).toContain("github.event_name == 'schedule' && 'false'");
  const entry = readFileSync(new URL('../scripts/collect-once.ts', import.meta.url), 'utf8');
  expect(entry).toContain('isSchedule: process.env.GITHUB_EVENT_NAME === "schedule"');
});
