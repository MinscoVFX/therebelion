import { describe, it, expect, vi, beforeEach } from 'vitest';
/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react';

// Mocks must be declared before importing the hook under test.
// Mock web3: VersionedTransaction with predictable deserialize/serialize.
vi.mock('@solana/web3.js', () => {
  class MockVersionedTx {
    message = { recentBlockhash: 'RECENT_BLOCKHASH' };
    static deserialize(_b: Buffer) {
      return new MockVersionedTx();
    }
    serialize() {
      return Buffer.from('signed');
    }
  }
  return { VersionedTransaction: MockVersionedTx };
});

// Mock planner + signing utils by mocking the module imports inside hook dir
vi.mock('../scaffolds/fun-launch/src/hooks/universalExitPlanner', () => ({
  planUniversalExits: vi.fn(async () => []), // no tasks -> skip deserialize path
}));

vi.mock('../scaffolds/fun-launch/src/hooks/signingUtils', () => ({
  signTransactionsAdaptive: vi.fn(async (_wallet: any, txs: any[]) => ({
    // eslint-disable-line @typescript-eslint/no-explicit-any
    signed: txs,
    errors: txs.map(() => null),
    usedBatch: true,
  })),
}));

// Wallet + connection mocks
const sendRawTransaction = vi.fn(async () => 'Sig111');
const confirmTransaction = vi.fn(async () => ({}));
vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({
    publicKey: { toBase58: () => 'WalletABC', toString: () => 'WalletABC' },
    signTransaction: vi.fn(async (tx: any) => tx), // eslint-disable-line @typescript-eslint/no-explicit-any
  }),
  useConnection: () => ({
    connection: { sendRawTransaction, confirmTransaction },
  }),
}));

// Import hook & real (possibly partially mocked) web3 to patch deserialize robustly
import { useUniversalExit } from '../scaffolds/fun-launch/src/hooks/useUniversalExit';
import * as web3 from '@solana/web3.js';

// Force deserialize to return a stub no matter the input (some nested imports may have pulled real class)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.spyOn(web3 as any, 'VersionedTransaction', 'get').mockReturnValue(
  class VT {
    message = { recentBlockhash: 'RBH' };
    static deserialize() {
      return new VT();
    }
    serialize() {
      return Buffer.from('signed');
    }
  }
);

describe('useUniversalExit', () => {
  beforeEach(() => {
    sendRawTransaction.mockClear();
    confirmTransaction.mockClear();
  });

  it('handles empty plan gracefully', async () => {
    const { result } = renderHook(() => useUniversalExit());
    await act(async () => {
      await result.current.run({});
    });
    expect(result.current.state.items.length).toBe(0);
    expect(result.current.state.running).toBe(false);
  });
});
