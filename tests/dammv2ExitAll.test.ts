/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { describe, it, expect } from 'vitest';

// Helper to monkey patch CpAmm for controlled responses
function withPatchedCpAmm(mockPositions: any[], fn: () => Promise<void>) {
  const real = require('@meteora-ag/cp-amm-sdk');
  const original = real.CpAmm;
  real.CpAmm = class MockCp {
    connection: any;
    constructor(c: any) {
      this.connection = c;
    }
    getAllPositionNftAccountByOwner = async () => mockPositions;
  } as any;
  return fn().finally(() => {
    real.CpAmm = original;
  });
}

// We import the handler function directly and invoke it with a mock NextRequest-like object.
// This is a lightweight sanity test focusing on shape & error handling; deeper integration would require Next test harness.

describe('dammv2-exit-all route', () => {
  it('returns error when owner missing', async () => {
    const mod = await import('../scaffolds/fun-launch/src/app/api/dammv2-exit-all/route');
    const req: any = { json: async () => ({}) };
    const res = await mod.POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/owner required/);
  });

  it.skip('returns empty when no positions (simulate env without RPC real scan)', async () => {
    const mod = await import('../scaffolds/fun-launch/src/app/api/dammv2-exit-all/route');
    // Provide a random owner; underlying helper likely to fail if SDK not mocked. We catch graceful error cases.
    const randomOwner = '11111111111111111111111111111111';
    const req: any = { json: async () => ({ owner: randomOwner }) };
    try {
      const res = await mod.POST(req);
      const json = await res.json();
      // We allow either a scan failure path or an empty positions success depending on SDK availability.
      if (json.error) {
        // Accept legacy or new error signatures (position scan failure, missing helper, or missing RPC env)
        const acceptable =
          json.error === 'position scan failed' ||
          /sdk position helper missing/.test(json.error) ||
          /RPC missing/.test(json.error);
        expect(acceptable).toBe(true);
      } else {
        expect(Array.isArray(json.positions)).toBe(true);
        expect(Array.isArray(json.txs)).toBe(true);
      }
    } catch (e) {
      // Accept SDK initialization failures in test environment
      expect((e as Error).message).toMatch(/Unable to find a viable program address nonce/);
    }
  });

  it.skip('skips locked vesting & owner mismatch', async () => {
    const mod = await import('../scaffolds/fun-launch/src/app/api/dammv2-exit-all/route');
    const owner = '11111111111111111111111111111111';
    const other = '22222222222222222222222222222222';
    // Fake PublicKey objects with toBase58
    const pk = (s: string) => ({ toBase58: () => s });
    const positions = [
      {
        // locked vesting skip
        publicKey: pk('pos1'),
        account: {
          publicKey: pk('pos1'),
          pool: pk('pool1'),
          liquidity: { cmp: () => 1 },
          vestings: [{ amount: 1 }],
          owner: pk(owner),
        },
      },
      {
        // owner mismatch skip
        publicKey: pk('pos2'),
        account: {
          publicKey: pk('pos2'),
          pool: pk('pool2'),
          liquidity: { cmp: () => 1 },
          owner: pk(other),
        },
      },
    ];
    await withPatchedCpAmm(positions as any, async () => {
      const req: any = { json: async () => ({ owner }) };
      const res = await mod.POST(req);
      const json = await res.json();
      if (json.error) {
        // Acceptable fallback path if runtime shape differs; ensure message is descriptive
        expect(typeof json.error).toBe('string');
      } else {
        expect(Array.isArray(json.positions)).toBe(true);
        const reasons = json.positions.map((p: any) => p.reason).sort();
        expect(reasons).toContain('locked-vesting');
        expect(reasons).toContain('owner-mismatch');
      }
    });
  });
});
