import { describe, it, expect } from 'vitest';

describe('utils index', () => {
  it('imports successfully and exposes utilities', async () => {
    const module = await import('../src/utils/index');
    
    // Check that module has expected exports
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
    
    // Test that we can access some of the utility functions
    const moduleKeys = Object.keys(module);
    expect(moduleKeys.length).toBeGreaterThan(0);
  });

  it('provides consistent utility exports', async () => {
    const { shortenAddress, sleep, formatNumber } = await import('../src/utils/index');
    
    // Test shortenAddress function
    expect(typeof shortenAddress).toBe('function');
    const shortened = shortenAddress('1234567890abcdef', 4);
    expect(shortened).toMatch(/1234\.\.\.cdef/);
    
    // Test formatNumber function
    expect(typeof formatNumber).toBe('function');
    expect(formatNumber(1000)).toBe('1.00K');
    
    // Test sleep function
    expect(typeof sleep).toBe('function');
    
    // Basic functionality test for sleep
    const start = Date.now();
    await sleep(1);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1);
  });
});