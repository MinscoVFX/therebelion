import { describe, it, expect } from 'vitest';

describe('server adapters basic functionality', () => {
  it('imports dbc-adapter successfully', async () => {
    // Simple import test to trigger module loading and get some basic coverage
    const module = await import('../scaffolds/fun-launch/src/server/dbc-adapter');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
    
    // Check that the module exports some expected functions/objects
    const moduleKeys = Object.keys(module);
    expect(moduleKeys.length).toBeGreaterThan(0);
  });

  it('imports studioRuntime successfully', async () => {
    const module = await import('../scaffolds/fun-launch/src/server/studioRuntime');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
  });
});