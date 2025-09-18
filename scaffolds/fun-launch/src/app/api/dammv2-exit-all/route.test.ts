import { POST } from './route';
import { PublicKey } from '@solana/web3.js';
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

describe('dammv2-exit-all API', () => {
  it('returns 400 if owner is missing', async () => {
    const req = { json: async () => ({}) } as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns error if CpAmm helper is missing', async () => {
    const req = {
      json: async () => ({ owner: new PublicKey('11111111111111111111111111111111').toBase58() }),
    } as any;
    // Monkey patch import to simulate missing helper
    vi.mock('@meteora-ag/cp-amm-sdk', () => ({
      CpAmm: class {
        getAllPositionNftAccountByOwner: unknown = undefined;
      },
    }));
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toHaveProperty('error');
  });

  // Add more tests for main business logic, error handling, and edge cases
});
