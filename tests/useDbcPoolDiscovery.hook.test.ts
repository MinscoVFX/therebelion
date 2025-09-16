import { describe, it, expect, vi, beforeEach } from 'vitest';
/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useDbcPoolDiscovery } from '../scaffolds/fun-launch/src/hooks/useDbcPoolDiscovery';

// We only need minimal wallet + connection mocks; focus is on exercising effect path.
const mockGetTokenAccountBalance = vi.fn();
const mockGetParsedTokenAccountsByOwner = vi.fn();

vi.mock('@solana/wallet-adapter-react', () => {
  const pk = new PublicKey('11111111111111111111111111111111');
  return {
    useConnection: () => ({
      connection: {
        getTokenAccountBalance: mockGetTokenAccountBalance,
        getParsedTokenAccountsByOwner: mockGetParsedTokenAccountsByOwner,
      },
    }),
    useWallet: () => ({
      publicKey: pk,
    }),
  };
});

// Mock global fetch for the Meteora API registry call (ignore actual network)
const mockFetch: any = vi.fn(); // eslint-disable-line @typescript-eslint/no-explicit-any
// Assign with minimal cast acceptable to linter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.fetch = mockFetch as unknown as typeof fetch;

describe('useDbcPoolDiscovery', () => {
  beforeEach(() => {
    mockGetTokenAccountBalance.mockReset();
    mockGetParsedTokenAccountsByOwner.mockReset();
    mockFetch.mockReset();
  });

  it('returns empty pools when no balances found', async () => {
    mockGetTokenAccountBalance.mockResolvedValue({ value: { amount: '0' } });
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });
    mockFetch.mockResolvedValue({ text: async () => '', ok: true });

    const { result } = renderHook(() => useDbcPoolDiscovery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pools.length).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('discovers a pool via token account scan when balance > 0', async () => {
    mockGetTokenAccountBalance.mockResolvedValue({ value: { amount: '0' } }); // known pools path yields none
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: 'Mint1111111111111111111111111111111111',
                  tokenAmount: { amount: '7' },
                },
              },
            },
          },
        },
      ],
    });
    mockFetch.mockResolvedValue({ text: async () => '', ok: true });

    const { result } = renderHook(() => useDbcPoolDiscovery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pools.length).toBe(1);
    expect(result.current.pools[0].lpAmount).toBe(7n);
    expect(result.current.pools[0].badge).toBe('[discovered]');
  });
});
