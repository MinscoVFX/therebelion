import { describe, it, expect } from 'vitest';
import { getActiveClaimDiscriminatorHex, getClaimDiscriminatorMeta } from '../server/dbc-exit-builder';

// This test relies on module evaluation side-effects that resolve the discriminator at import time.
describe('DBC Exit Builder discriminator', () => {
  it('exposes an 8-byte discriminator hex string', () => {
    const hex = getActiveClaimDiscriminatorHex();
    expect(typeof hex).toBe('string');
    expect(hex.length).toBe(16); // 8 bytes -> 16 hex chars
  });

  it('has a resolution meta source value', () => {
    const meta = getClaimDiscriminatorMeta();
    expect(meta?.source).toBeDefined();
  });
});
