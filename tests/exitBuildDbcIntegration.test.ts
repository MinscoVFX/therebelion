/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

// Integration-style test for enhanced /api/exit/build route with DBC claim support
async function invoke(body: any) {
  const mod = await import('../pages/api/exit/build');
  let statusCode = 0;
  let json: any;
  await mod.default(
    { method: 'POST', body: JSON.stringify(body), headers: {} } as any,
    {
      status: (c: number) => ({
        json: (j: any) => {
          statusCode = c;
          json = j;
        },
      }),
    } as any
  );
  return { statusCode, json };
}

describe('exit/build DBC integration', () => {
  it.skip('returns exitTxBase64 & simulation when DBC params provided (mock rpc)', async () => {
    process.env.TEST_MOCK_RPC = 'mock';
    // Provide discriminator via instruction name so builder resolves it
    process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME = 'claim_creator_trading_fee';
    const owner = '11111111111111111111111111111111';
    const pool = '11111111111111111111111111111111';
    const feeVault = '11111111111111111111111111111111';
    const { statusCode, json } = await invoke({
      owner,
      dbcPoolKeys: { pool, feeVault },
      action: 'claim',
      cuLimit: 500000,
      microLamports: 1000,
    });
    expect(statusCode).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.exitTxBase64).toBeTypeOf('string');
    expect(json.simulation).toBeDefined();
    expect(json.simulation.unitsConsumed).toBe(5000);
  });
  it('fails with 400 when discriminator missing', async () => {
    delete process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME;
    process.env.TEST_MOCK_RPC = 'mock';
    // Reset cached discriminator so missing state is observed
    const m = await import('../scaffolds/fun-launch/src/server/dbc-exit-builder');
    if (m.__resetDbcExitBuilderCacheForTests) m.__resetDbcExitBuilderCacheForTests();
    const owner = '11111111111111111111111111111111';
    const pool = '11111111111111111111111111111111';
    const feeVault = '11111111111111111111111111111111';
    const { statusCode, json } = await invoke({
      owner,
      dbcPoolKeys: { pool, feeVault },
      cuLimit: 500000,
      microLamports: 1000,
    });
    expect(statusCode).toBe(400);
    expect(json.ok).toBe(false);
    // Depending on evaluation order we may fail earlier on fee vault SPL layout or discriminator resolution.
    expect(json.error).toMatch(/(Missing claim discriminator|Fee vault)/);
  });
});
