import { describe, it, expect } from 'vitest';
import { getDbcState, claimDbcFees, planFeeClaim } from '@/lib/meteora/dbc';

// These are stub implementations; tests document current contract so future real impls can adjust.

describe('meteora dbc utils stubs', () => {
  it('getDbcState returns null (stub)', () => {
    expect(getDbcState()).toBeNull();
  });
  it('claimDbcFees returns null (stub)', () => {
    expect(claimDbcFees()).toBeNull();
  });
  it('planFeeClaim returns stub object with ix null and reason stub', () => {
    const res = planFeeClaim();
    expect(res).toBeDefined();
    expect(res.ix).toBeNull();
    expect(res.reason).toBe('stub');
  });
});
