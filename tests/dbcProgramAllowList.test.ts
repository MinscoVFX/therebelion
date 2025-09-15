/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DBC program allow list', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    process.env = { ...ORIGINAL };
    vi.resetModules();
  });

  it('passes when no allow list configured', async () => {
    const mod = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    expect(mod.isUsingPlaceholderDiscriminator()).toBe(true);
  });

  it('throws when program not in allow list', async () => {
    process.env.ALLOWED_DBC_PROGRAM_IDS = 'SomeOtherProgram1111111111111111111111111111111';
    await expect(import('../scaffolds/fun-launch/src/server/dbc-exit-builder'))
      .resolves.toBeTruthy();
    const { buildDbcExitTransaction } = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    await expect(async () => {
      await buildDbcExitTransaction({} as any, {
        owner: '11111111111111111111111111111111',
        dbcPoolKeys: { pool: '11111111111111111111111111111111', feeVault: '11111111111111111111111111111111' },
      });
    }).rejects.toThrow(/not in ALLOWED_DBC_PROGRAM_IDS/);
  });

  it('allows when program present in allow list', async () => {
    // Use default program id from builder
    process.env.ALLOWED_DBC_PROGRAM_IDS = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
    const { buildDbcExitTransaction } = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    // Minimal mock connection implementing just the methods we need.
    const mockConnection = {
      getAccountInfo: async () => ({ data: Buffer.alloc(165, 1) }), // sufficient length to mimic SPL token account
      getLatestBlockhash: async () => ({ blockhash: '1111111111111111111111111111111111111111111111', lastValidBlockHeight: 123 }),
      simulateTransaction: async () => ({ value: { logs: [], unitsConsumed: 0, err: null } }),
    } as any;
    const result = await buildDbcExitTransaction(mockConnection, {
      owner: '11111111111111111111111111111111',
      dbcPoolKeys: { pool: '11111111111111111111111111111111', feeVault: '11111111111111111111111111111111' },
      simulateOnly: true,
    });
    expect(result.simulation).toBeDefined(); // ensure we actually executed path, not blocked by allow list
  });
});
