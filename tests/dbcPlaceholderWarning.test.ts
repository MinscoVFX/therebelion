/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DBC placeholder warning suppression', () => {
  const ORIGINAL_ENV = { ...process.env };
  let warnSpy: any;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('emits warning when placeholder and suppression flag not set', async () => {
    process.env.DBC_CLAIM_FEE_DISCRIMINATOR = '0102030405060708';
    delete process.env.DBC_SUPPRESS_PLACEHOLDER_WARNING;
    const mod = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    // force usage via exported helper
    const usingPlaceholder = mod.isUsingPlaceholderDiscriminator();
    expect(usingPlaceholder).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('suppresses warning when suppression flag set', async () => {
    process.env.DBC_CLAIM_FEE_DISCRIMINATOR = '0102030405060708';
    process.env.DBC_SUPPRESS_PLACEHOLDER_WARNING = 'true';
    const mod = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    const usingPlaceholder = mod.isUsingPlaceholderDiscriminator();
    expect(usingPlaceholder).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
