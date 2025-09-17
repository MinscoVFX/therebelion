/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';

// Capture args passed to builders for assertions
let capturedSingle: any = null;
let capturedAll: any = null;

function resetCaptures() {
  capturedSingle = null;
  capturedAll = null;
}

// Simple helper to monkey-patch cp-amm SDK
function patchCpAmm(mock: any) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require('@meteora-ag/cp-amm-sdk');
  const original = real.CpAmm;
  real.CpAmm = class MockCp {
    connection: any;
    constructor(c: any) {
      this.connection = c;
    }
    getAllPositionNftAccountByOwner = async ({ owner }: { owner: PublicKey }) => {
      return mock.positions(owner);
    };
    getWithdrawQuote = async (args: any) => {
      return mock.withdrawQuote(args);
    };
    removeLiquidity = (args: any) => {
      capturedSingle = args;
      return { ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })] };
    };
    removeAllLiquidity = (args: any) => {
      capturedAll = args;
      return { ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })] };
    };
  } as any;
  return () => {
    real.CpAmm = original;
  };
}

describe('DAMM v2 min-out thresholds with slippageBps', () => {
  beforeEach(() => resetCaptures());

  it('single exit uses withdraw quote to set thresholds when slippageBps provided', async () => {
    const owner = '11111111111111111111111111111111';
  const pool = '11111111111111111111111111111111';
    const unpatch = patchCpAmm({
      positions: () => [
        {
          publicKey: { toBase58: () => 'Pos111' },
          account: {
            publicKey: { toBase58: () => 'Pos111' },
            pool: { toBase58: () => pool },
            liquidity: { cmp: () => 1 },
          },
        },
      ],
      withdrawQuote: () => ({ tokenAOut: 123n, tokenBOut: 456n }),
    });

    try {
      const mod = await import('../app/api/dammv2-exit/route');
      const req: any = {
        json: async () => ({
          owner,
          pool,
          percent: 50, // ensure removeLiquidity (not removeAllLiquidity) path
          slippageBps: 50,
          simulateOnly: true,
        }),
      };
      const res = await mod.POST(req);
      const js = await res.json();
      expect(res.status).toBe(200);
      expect(js.tx).toBeTypeOf('string');
      // thresholds forwarded to builder
      expect(capturedSingle?.tokenAAmountThreshold).toBe(123n);
      expect(capturedSingle?.tokenBAmountThreshold).toBe(456n);
    } finally {
      unpatch();
    }
  });

  it('exit-all uses withdraw quote to set thresholds when slippageBps provided', async () => {
    const owner = '11111111111111111111111111111111';
    const pool = 'Pool222222222222222222222222222222222222222';
    const unpatch = patchCpAmm({
      positions: () => [
        {
          publicKey: { toBase58: () => 'Pos222' },
          account: {
            publicKey: { toBase58: () => 'Pos222' },
            pool: { toBase58: () => pool },
            liquidity: { cmp: () => 1 },
            // also include some optional props accessed in builder args
            tokenAMint: { toBase58: () => 'TokenA' },
            tokenBMint: { toBase58: () => 'TokenB' },
          },
        },
      ],
      withdrawQuote: () => ({ outAmountA: 999n, outAmountB: 111n }),
    });

    try {
      const mod = await import('../app/api/dammv2-exit-all/route');
      const req: any = { json: async () => ({ owner, slippageBps: 75 }) };
      const res = await mod.POST(req);
      const js = await res.json();
      expect(res.status).toBe(200);
      expect(Array.isArray(js.txs)).toBe(true);
      expect(js.txs.length).toBe(1);
      // thresholds forwarded to builder
      expect(capturedAll?.tokenAAmountThreshold).toBe(999n);
      expect(capturedAll?.tokenBAmountThreshold).toBe(111n);
    } finally {
      unpatch();
    }
  });
});
