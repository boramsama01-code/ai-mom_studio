import { describe, expect, it } from 'vitest';
import { canvaDesignIdFromInput, canvaReconcileRequestSchema, canvaReconciliations } from '../shared/canvaReconciliation';
import { canvaRecoveryToken } from '../server/services/canvaReconciliation';

describe('Canva manual reconciliation request boundary', () => {
  it('accepts a bounded Canva ID or editor link and discards URL query data', () => {
    expect(canvaDesignIdFromInput(' Dtest_design ')).toBe('Dtest_design');
    expect(canvaDesignIdFromInput('https://www.canva.com/design/Dtest_design/edit?tracking=discarded')).toBe('Dtest_design');
    expect(canvaDesignIdFromInput('https://canva.com/design/Dtest_design/view')).toBe('Dtest_design');
  });
  it.each(['https://canva.com.attacker.example/design/Dtest/edit', 'http://www.canva.com/design/Dtest/edit', 'https://user:password@www.canva.com/design/Dtest/edit', 'https://www.canva.com:444/design/Dtest/edit', 'https://www.canva.com/templates/Dtest', 'Dtest/../../users', 'D'])('rejects an unrelated or unsafe input: %s', value => {
    expect(canvaDesignIdFromInput(value)).toBeNull();
  });
  it('requires explicit confirmation and the current opaque recovery token', () => {
    const body = { version: 2, designId: 'Dtest_design', confirmed: true, expectedRecoveryToken: 'a'.repeat(64) };
    expect(canvaReconcileRequestSchema.safeParse(body).success).toBe(true);
    for (const invalid of [{ ...body, confirmed: false }, { ...body, expectedRecoveryToken: undefined }, { ...body, version: 0 }, { ...body, accessToken: 'must-not-store' }]) expect(canvaReconcileRequestSchema.safeParse(invalid).success).toBe(false);
  });
  it('changes the recovery token after a new unknown attempt and never invents one for settled jobs', () => {
    const job = { id: 10, requestId: '10000000-0000-4000-8000-000000000001', sourceVersion: 1, status: 'result_unknown', phase: 'autofill_submitting', updatedAt: new Date('2026-11-04T01:00:00Z'), autofillJobId: null, exportJobId: null, designId: null };
    expect(canvaRecoveryToken(job)).toMatch(/^[a-f0-9]{64}$/);
    expect(canvaRecoveryToken({ ...job })).toBe(canvaRecoveryToken(job));
    expect(canvaRecoveryToken({ ...job, updatedAt: new Date('2026-11-04T01:00:01Z') })).not.toBe(canvaRecoveryToken(job));
    expect(canvaRecoveryToken({ ...job, phase: 'export_submitting', designId: 'Dtest_design' })).not.toBe(canvaRecoveryToken(job));
    expect(canvaRecoveryToken({ ...job, status: 'queued' })).toBeNull();
  });
  it('does not treat incomplete or untrusted recovery markers as confirmed requests', () => {
    expect(canvaReconciliations({ reconciled: true, reconciliation: {}, reconciliationHistory: [{ recoveryToken: 'a'.repeat(64) }] })).toEqual([]);
  });
});
