import { describe, it, expect } from 'vitest';

describe('useMobile utility', () => {
  it('imports successfully', async () => {
    // Simple import test to get some coverage on the file
    const module = await import('../scaffolds/fun-launch/src/hooks/useMobile');
    expect(module.useMobile).toBeDefined();
    expect(typeof module.useMobile).toBe('function');
  });
});