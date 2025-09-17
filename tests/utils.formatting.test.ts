import { describe, it, expect } from 'vitest';
import { formatNumber, shortenAddress } from '../src/utils';

describe('utils: formatting', () => {
  it('formatNumber handles ranges', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(0.005)).toBe('<0.01');
    expect(formatNumber(15)).toBe('15.00');
    expect(formatNumber(1500)).toBe('1.50K');
    expect(formatNumber(1_500_000)).toBe('1.50M');
    expect(formatNumber(2_000_000_000)).toBe('2.00B');
  });

  it('shortenAddress trims correctly', () => {
    const addr = '11111111111111111111111111111111';
    expect(shortenAddress(addr, 4)).toBe('1111...1111');
    expect(shortenAddress(addr, 8)).toBe('11111111...11111111');
    // when address shorter than threshold, returns untouched
    expect(shortenAddress('abcd', 4)).toBe('abcd');
  });
});
