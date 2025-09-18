/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComputeBudgetProgram } from '@solana/web3.js';

// Helper to invoke a Next.js api handler
async function invoke(handler: any, reqInit: Partial<any> = {}) {
  let statusCode = 0;
  let jsonBody: any = undefined;
  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return {
        json: (obj: any) => {
          jsonBody = obj;
        },
      };
    },
  };
  const req: any = {
    method: reqInit.method || 'POST',
    body: reqInit.body,
    headers: reqInit.headers || {},
  };
  await handler(req, res);
  return { statusCode, jsonBody };
}

describe('exit API route suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch as any; // reset
  });

  it.skip('build route uses provided body numbers', async () => {
    const mod = await import('../pages/api/exit/build');
    const cuLimit = 777777;
    const microLamports = 12345;
    const { statusCode, jsonBody } = await invoke(mod.default, {
      body: JSON.stringify({
        cuLimit,
        microLamports,
        owner: '11111111111111111111111111111111',
        dbcPoolKeys: {
          pool: '11111111111111111111111111111111',
          feeVault: '11111111111111111111111111111111',
        },
      }),
    });
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.cuLimit).toBe(cuLimit);
    expect(jsonBody.microLamports).toBe(microLamports);
    expect(Array.isArray(jsonBody.computeBudgetIxs)).toBe(true);
    expect(jsonBody.computeBudgetIxs.length).toBe(2);
    // Expect program ids to match compute budget program
    for (const ix of jsonBody.computeBudgetIxs) {
      expect(ix.programId).toEqual(ComputeBudgetProgram.programId);
    }
  });

  it.skip('build route falls back to /api/fees/recommend when invalid body', async () => {
    const recommended = { cuLimit: 888000, microLamports: 54321 };
    global.fetch = vi.fn().mockResolvedValue({ json: async () => recommended });
    const mod = await import('../pages/api/exit/build');
    const { statusCode, jsonBody } = await invoke(mod.default, {
      body: JSON.stringify({
        owner: '11111111111111111111111111111111',
        dbcPoolKeys: {
          pool: '11111111111111111111111111111111',
          feeVault: '11111111111111111111111111111111',
        },
      }),
    });
    expect(statusCode).toBe(200);
    expect(jsonBody.cuLimit).toBe(recommended.cuLimit);
    expect(jsonBody.microLamports).toBe(recommended.microLamports);
    expect(jsonBody.computeBudgetIxs.length).toBe(2);
  });

  it.skip('build route uses hardcoded defaults when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network fail'));
    const mod = await import('../pages/api/exit/build');
    const { statusCode, jsonBody } = await invoke(mod.default, { body: undefined });
    expect(statusCode).toBe(200);
    expect(jsonBody.cuLimit).toBe(600_000);
    expect(jsonBody.microLamports).toBe(5_000);
  });

  it('withdraw route returns 501 disabled', async () => {
    const mod = await import('../pages/api/exit/withdraw');
    const { statusCode, jsonBody } = await invoke(mod.default, { method: 'POST' });
    expect(statusCode).toBe(501);
    expect(jsonBody.ok).toBe(false);
  });

  it('plan route returns plan null', async () => {
    const mod = await import('../pages/api/exit/plan');
    const { statusCode, jsonBody } = await invoke(mod.default, { method: 'GET' });
    expect(statusCode).toBe(200);
    expect(jsonBody.plan).toBe(null);
  });

  it('execute route returns executed true', async () => {
    const mod = await import('../pages/api/exit/execute');
    const { statusCode, jsonBody } = await invoke(mod.default, { method: 'POST' });
    expect(statusCode).toBe(200);
    expect(jsonBody.executed).toBe(true);
  });
});
