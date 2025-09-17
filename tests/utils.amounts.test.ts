import { describe, it, expect } from 'vitest';
import { BN } from '@coral-xyz/anchor';
import { calculatePriceImpact, validateSwapAmounts, isValidPublicKey } from '../src/utils';

describe('utils: amounts + validation', () => {
  it('validateSwapAmounts catches zero and small amounts', () => {
    const zeroIn = validateSwapAmounts(new BN(0), 9, new BN(10));
    expect(zeroIn.valid).toBe(false);
    expect(zeroIn.error).toMatch(/greater than 0/);

    const zeroOut = validateSwapAmounts(new BN(10), 9, new BN(0));
    expect(zeroOut.valid).toBe(false);

    // input smaller than 0.001 (for 9 decimals -> 1_000_000)
    const tiny = validateSwapAmounts(new BN(999_999), 9, new BN(10));
    expect(tiny.valid).toBe(false);

    const ok = validateSwapAmounts(new BN(2_000_000), 9, new BN(10));
    expect(ok.valid).toBe(true);
  });

  it('calculatePriceImpact handles zero reserves and computes impact', () => {
    expect(calculatePriceImpact(new BN(10), new BN(10), new BN(0), new BN(100))).toBe(0);

    const impact = calculatePriceImpact(
      new BN(1000),
      new BN(900),
      new BN(10_000),
      new BN(9_000)
    );
    expect(typeof impact).toBe('number');
    expect(impact).toBeGreaterThanOrEqual(0);
  });

  it('isValidPublicKey validates correctly', () => {
    expect(isValidPublicKey('11111111111111111111111111111111')).toBe(true);
    expect(isValidPublicKey('not-a-key')).toBe(false);
  });
});
