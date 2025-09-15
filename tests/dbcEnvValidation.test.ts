import { describe, it, expect } from 'vitest';

// Lightweight env validation around DBC config. This doesn't assert correctness of the
// real discriminator value (needs official IDL) but ensures format is plausible.

describe('DBC environment configuration', () => {
  it('claim fee discriminator is valid 8-byte hex', () => {
    const raw = (process.env.DBC_CLAIM_FEE_DISCRIMINATOR || '0102030405060708').replace(/^0x/, '');
    expect(raw.length).toBe(16);
    expect(/^[0-9a-fA-F]{16}$/.test(raw)).toBe(true);
  });

  it('program id is non-empty base58-like string', () => {
    const prog = process.env.DBC_PROGRAM_ID || 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
    // Loose check: base58 chars only & length within Solana pubkey bounds (32 bytes -> ~44 chars)
  // Accept 32-50 chars; actual Solana base58 pubkeys are 32 bytes -> length 32-44 in base58 representation.
  expect(/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(prog)).toBe(true);
  });
});
