import { describe, it, expect } from 'vitest';
import { 
  isValidPublicKey,
  parseTokenAmount,
  formatTokenAmount,
  calculatePriceImpact,
  validateSwapAmounts
} from '../src/utils/index';
import { BN } from '@coral-xyz/anchor';

describe('utils functions coverage boost', () => {
  it('validates public keys', () => {
    expect(isValidPublicKey('11111111111111111111111111111111')).toBe(true);
    expect(isValidPublicKey('invalid')).toBe(false);
    expect(isValidPublicKey('')).toBe(false);
  });

  it('parses token amounts', () => {
    const amount = parseTokenAmount('1.5', 6);
    expect(amount).toBeInstanceOf(BN);
    expect(amount.toString()).toBe('1500000');
  });

  it('formats token amounts', () => {
    const amount = new BN('1500000');
    const formatted = formatTokenAmount(amount, 6, 2);
    expect(formatted).toBe('1.5');
  });

  it('calculates price impact', () => {
    const inputAmount = new BN('100000');
    const outputAmount = new BN('95000');
    const inputReserve = new BN('1000000');
    const outputReserve = new BN('1000000');
    
    const impact = calculatePriceImpact(inputAmount, outputAmount, inputReserve, outputReserve);
    expect(typeof impact).toBe('number');
  });

  it('validates swap amounts', () => {
    const inputAmount = new BN('1000000');
    const outputAmount = new BN('900000');
    
    const result = validateSwapAmounts(inputAmount, 6, outputAmount);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('validates swap amounts with zero input', () => {
    const inputAmount = new BN('0');
    const outputAmount = new BN('900000');
    
    const result = validateSwapAmounts(inputAmount, 6, outputAmount);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Input amount must be greater than 0');
  });
});