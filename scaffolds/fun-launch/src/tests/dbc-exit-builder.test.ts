import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DBC Exit Builder discriminators', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DBC_CLAIM_FEE_DISCRIMINATOR = '0102030405060708';
    process.env.DBC_WITHDRAW_DISCRIMINATOR = '1112131415161718';
  });

  it('exposes an 8-byte claim discriminator hex string', async () => {
    const mod = await import('../server/dbc-exit-builder');
    const hex = mod.getActiveClaimDiscriminatorHex();
    expect(typeof hex).toBe('string');
    expect(hex.length).toBe(16); // 8 bytes -> 16 hex chars
  });

  it('exposes an 8-byte withdraw discriminator hex string', async () => {
    const mod = await import('../server/dbc-exit-builder');
    const hex = mod.getActiveWithdrawDiscriminatorHex();
    expect(typeof hex).toBe('string');
    expect(hex.length).toBe(16);
  });

  it('has resolution meta source values', async () => {
    const mod = await import('../server/dbc-exit-builder');
    // Trigger lazy resolution so meta objects populate
    mod.getActiveClaimDiscriminatorHex();
    mod.getActiveWithdrawDiscriminatorHex();
    const claimMeta = mod.getClaimDiscriminatorMeta();
    const withdrawMeta = mod.getWithdrawDiscriminatorMeta();
    expect(claimMeta?.source).toBeDefined();
    expect(withdrawMeta?.source).toBeDefined();
  });
});
