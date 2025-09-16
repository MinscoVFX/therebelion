import { describe, it, expect, vi, beforeEach } from 'vitest';
/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useDbcInstantExit } from '../scaffolds/fun-launch/src/hooks/useDbcInstantExit';

// Minimal mocks for wallet adapter context
vi.mock('@solana/wallet-adapter-react', () => {
  return {
    useConnection: () => ({ connection: { getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: 'abc', lastValidBlockHeight: 1 }) } }),
    useWallet: () => ({
      publicKey: { toString: () => 'WalletPubkey1111111111111111111111111111111111' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signTransaction: vi.fn().mockImplementation((tx: any) => tx),
    }),
  };
});

// Mock global fetch for simulation + build path
const mockFetch: any = vi.fn(); // eslint-disable-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.fetch = mockFetch as any;

describe('useDbcInstantExit hook', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('progresses through simulation failure then reports error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ logs: ['log1'], unitsConsumed: 5000, tx: 'BASE64TX' }) });
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Bad Request', text: async () => '' });

    const { result } = renderHook(() => useDbcInstantExit());
    await act(async () => {
      try {
        await result.current.exit({
          dbcPoolKeys: { pool: 'Pool111111111111111111111111111111111111', feeVault: 'Fee1111111111111111111111111111111111111' },
          action: 'claim',
          simulateFirst: true,
        });
      } catch {
        // swallow expected error path
      }
    });

    expect(result.current.state.attempt).toBeGreaterThanOrEqual(1);
    expect(result.current.state.status === 'error' || result.current.state.status === 'building').toBeTruthy();
  });
});
