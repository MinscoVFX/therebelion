import { describe, it, expect } from 'vitest';

describe('DBC instruction-name discriminator derivation', () => {
  it('derives discriminator when DBC_CLAIM_FEE_INSTRUCTION_NAME is set', async () => {
    // anchor discriminator of "claim_partner_trading_fee" should match IDL if available.
  process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME = 'claim_partner_trading_fee';
  delete process.env.DBC_CLAIM_FEE_DISCRIMINATOR; // ensure explicit hex not used
  // Provide withdraw discriminator so module load succeeds
  process.env.DBC_WITHDRAW_DISCRIMINATOR = '1112131415161718';
    const mod = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    const isPlaceholder = mod.isUsingPlaceholderDiscriminator();
    // Since we supplied an instruction name, we should NOT still be on placeholder.
    expect(isPlaceholder).toBe(false);
  });
});
