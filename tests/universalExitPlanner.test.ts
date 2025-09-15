import { describe, it, expect, vi } from 'vitest';
import { planUniversalExits } from '../scaffolds/fun-launch/src/hooks/universalExitPlanner';

// We'll mock fetch to simulate discovery + build endpoints.

const mockTxBase64 = 'AQAAAA=='; // minimal base64 (not a real versioned tx, but planner not validating here)

function mockFetchFactory() {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/api/dbc-discover')) {
      return new Response(JSON.stringify({ positions: [{ pool: 'PoolAAA', feeVault: 'FeeAAA' }] }), { status: 200 });
    }
    if (u.endsWith('/api/dbc-exit')) {
      return new Response(JSON.stringify({ tx: mockTxBase64, lastValidBlockHeight: 123 }), { status: 200 });
    }
    if (u.endsWith('/api/dammv2-discover')) {
      return new Response(JSON.stringify({ positions: [{ pool: 'DammPool', position: 'Pos123' }] }), { status: 200 });
    }
    if (u.endsWith('/api/dammv2-exit')) {
      return new Response(JSON.stringify({ tx: mockTxBase64, lastValidBlockHeight: 456 }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('universal exit planner', () => {
  it('plans dbc and dammv2 tasks', async () => {
    global.fetch = mockFetchFactory();
    const tasks = await planUniversalExits({ owner: 'WalletABC' });
    expect(tasks.length).toBe(2);
    const kinds = tasks.map(t => t.protocol).sort();
    expect(kinds).toEqual(['dammv2', 'dbc']);
  });

  it('respects include flags', async () => {
    global.fetch = mockFetchFactory();
    const tasks = await planUniversalExits({ owner: 'WalletABC', include: { dbc: false } });
    expect(tasks.length).toBe(1);
    expect(tasks[0].protocol).toBe('dammv2');
  });
});
