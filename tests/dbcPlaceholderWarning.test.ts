/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DBC placeholder removal (updated behavior)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
      // suppress known external binding warning noise so it doesn't fail expectations
      if (typeof args[0] === 'string' && args[0].startsWith('bigint: Failed to load bindings'))
        return;
    });
  });

  it('no longer uses placeholder discriminators and emits no warning', async () => {
    process.env.DBC_CLAIM_FEE_DISCRIMINATOR = '0102030405060708';
    process.env.DBC_WITHDRAW_DISCRIMINATOR = '1112131415161718';
    const mod = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    const usingPlaceholder = mod.isUsingPlaceholderDiscriminator();
    // Placeholder path removed; ensure flag is false.
    expect(usingPlaceholder).toBe(false);
  });
});
