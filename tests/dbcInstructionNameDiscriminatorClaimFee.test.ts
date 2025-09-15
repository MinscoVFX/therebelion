import { describe, it, expect } from 'vitest';
// discriminator derivation verified indirectly through builder helper

describe('DBC instruction-name discriminator (claim_fee)', () => {
  it('derives discriminator for claim_fee', async () => {
    delete process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
    process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME = 'claim_fee';
    const mod = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    if (mod.__resetDbcExitBuilderCacheForTests) mod.__resetDbcExitBuilderCacheForTests();
  const hex = mod.__resolveClaimDiscForTests();
    const meta = mod.getClaimDiscriminatorMeta();
    expect(meta?.instructionName).toBe('claim_fee');
    expect(hex).toHaveLength(16);
  });
});
