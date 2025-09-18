import { describe, it, expect } from 'vitest';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  buildDammV2RemoveAllLpIxs,
  DammV2PoolKeys,
} from '../scaffolds/fun-launch/src/server/dammv2-adapter';

// Minimal mock Connection (only methods we call)
interface TokenAccountBalanceLike {
  context: { slot: number };
  value: { amount: string; decimals: number; uiAmount: number; uiAmountString: string };
}
class MockConnection {
  constructor(public rpcEndpoint: string = 'http://localhost') {}
  async getTokenAccountBalance(): Promise<TokenAccountBalanceLike> {
    return {
      context: { slot: 0 },
      value: { amount: '123456', decimals: 6, uiAmount: 0, uiAmountString: '0' },
    };
  }
}

const owner = new PublicKey('11111111111111111111111111111111');

function makePool(): DammV2PoolKeys {
  const pk = (n: number) => new PublicKey(Buffer.alloc(32, n));
  return {
    programId: pk(1),
    pool: pk(2),
    lpMint: pk(3),
    tokenAMint: pk(4),
    tokenBMint: pk(5),
    tokenAVault: pk(6),
    tokenBVault: pk(7),
    authorityPda: pk(8),
  };
}

function makeRuntime(removeOk = true): Record<string, unknown> {
  if (!removeOk) return {}; // missing builder
  return {
    buildRemoveLiquidityIx: () => {
      return new TransactionInstruction({
        programId: new PublicKey(Buffer.alloc(32, 9)),
        keys: [],
        data: Buffer.from([1, 2, 3]),
      });
    },
  };
}

describe('dammv2 adapter', () => {
  it('throws if builder missing', async () => {
    await expect(
      buildDammV2RemoveAllLpIxs({
        connection: new MockConnection() as unknown as import('@solana/web3.js').Connection,
        owner,
        poolKeys: makePool(),
        runtimeModule: makeRuntime(false),
      })
    ).rejects.toThrow(/remove-liquidity function not found/);
  });

  it.skip('throws if lp amount zero', async () => {
    // Intentionally not reusing a connection instance across tests; each call constructs minimal mock
    // Monkey patch balance to zero
    class ZeroLpConnection extends MockConnection {
      async getTokenAccountBalance(): Promise<TokenAccountBalanceLike> {
        return {
          context: { slot: 0 },
          value: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' },
        };
      }
    }
    const zeroConn = new ZeroLpConnection() as unknown as import('@solana/web3.js').Connection;
    await expect(
      buildDammV2RemoveAllLpIxs({
        connection: zeroConn,
        owner,
        poolKeys: makePool(),
        runtimeModule: makeRuntime(true),
        priorityMicros: 0, // Disable priority fee for test
      })
    ).rejects.toThrow(/No LP tokens/);
  });

  it.skip('returns expected instructions when lp present', async () => {
    const conn = new MockConnection() as unknown as import('@solana/web3.js').Connection;
    const ixs = await buildDammV2RemoveAllLpIxs({
      connection: conn,
      owner,
      poolKeys: makePool(),
      runtimeModule: makeRuntime(true),
      priorityMicros: 0, // Disable priority fee for test
    });
    // Expect: 2 ATA create + remove builder = >=3
    expect(ixs.length).toBeGreaterThanOrEqual(3);
    // First should be ATA create
    expect(
      ixs[0].programId.equals(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))
    ).toBe(true);
    // Last should be our mock remove instruction (data [1,2,3])
    expect(ixs[ixs.length - 1].data.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });
});
