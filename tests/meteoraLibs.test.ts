import { describe, it, expect } from 'vitest';

describe('lib/meteora utilities', () => {
  it('imports dbc module successfully', async () => {
    const module = await import('../src/lib/meteora/dbc');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
  });

  it('imports universalExit module successfully', async () => {
    const module = await import('../src/lib/meteora/universalExit');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
  });

  it('imports migration module successfully', async () => {
    const module = await import('../src/lib/meteora/migration');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
  });

  it('imports dammv2 module successfully', async () => {
    const module = await import('../src/lib/meteora/dammv2');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
  });
});