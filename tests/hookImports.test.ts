import { describe, it, expect } from 'vitest';

describe('hook modules basic imports', () => {
  it('imports useDammV2ExitAll hook', async () => {
    const module = await import('../scaffolds/fun-launch/src/hooks/useDammV2ExitAll');
    expect(module).toBeDefined();
    expect(typeof module.useDammV2ExitAll).toBe('function');
  });

  it('imports useDbcAutoBatchExit hook', async () => {
    const module = await import('../scaffolds/fun-launch/src/hooks/useDbcAutoBatchExit');
    expect(module).toBeDefined();
    expect(typeof module.useDbcAutoBatchExit).toBe('function');
  });
});